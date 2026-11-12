import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Partenaires et transferts de stock vers un partenaire (migration 66) : registre (type, localisation, responsable),
// comptes de l'espace partenaire, envoi (le stock sort à l'expédition), réception ligne par ligne par le partenaire
// (manque = perte en transit, équipement non reçu → perdu), cloisonnement de l'espace partenaire, annulation, retour.
test.describe.serial('API › Partenaires et transferts vers un partenaire', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const password = 'Secret123';
  let admin, wh, rice, laptop, units, partner, other, partnerToken, otherToken, shipment, shipment2;
  const ids = {};

  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const H = () => auth(admin);
  const balance = async (request, itemId) => {
    const rows = (await (await request.get(`/api/stock/balances?warehouseId=${wh.id}&stockItemId=${itemId}&includeEmpty=1`, { headers: H() })).json()).data;
    return rows.reduce((s, r) => s + Number(r.quantity), 0);
  };
  const login = async (request, email) => (await (await request.post('/api/auth/login', { data: { email, password } })).json()).data?.token;

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const get = async (u) => (await (await request.get(u, { headers: H() })).json()).data;
    const [locations, cats] = await Promise.all(['/api/public/locations', '/api/public/market-categories'].map(get));
    ids.goma = locations.find(l => l.code === 'GOMA').id;
    ids.kin = locations.find(l => l.code === 'KINSHASA').id;
    wh = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `PW-${stamp}`.slice(0, 30), name: `Dépôt partenaires ${stamp}`, locationId: ids.goma } })).json()).data;
    const cat = cats.find(c => c.code === 'FUEL').id;
    rice = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `PR-${stamp}`, name: `Riz ${stamp}`, unit: 'kg', categoryId: cat } })).json()).data;
    laptop = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `PL-${stamp}`, name: `Portable ${stamp}`, unit: 'pc', categoryId: cat, trackSerials: true } })).json()).data;
    const adj = await json(await request.post('/api/stock-adjustments', { headers: H(), data: { warehouseId: wh.id, stockItemId: rice.id, quantity: 100, reason: 'FOUND', comment: 'Stock initial' } }));
    expect(adj.status, JSON.stringify(adj.body)).toBe(201);
    const reg = await request.post('/api/stock-units/register', { headers: H(), data: { stockItemId: laptop.id, warehouseId: wh.id, units: [`PSN1-${stamp}`, `PSN2-${stamp}`, `PSN3-${stamp}`] } });
    expect(reg.status()).toBe(201);
    units = (await get(`/api/stock-units?stockItemId=${laptop.id}`));
    expect(units).toHaveLength(3);
  });

  test('Registre : contrôles, type « zone de santé », localisation, code unique', async ({ request }) => {
    const create = (data) => request.post('/api/partners', { headers: H(), data }).then(json);
    expect((await create({ name: 'X', locationId: ids.goma })).body.code).toBe('PARTNER_CODE_REQUIRED');
    expect((await create({ code: `ZS-${stamp}`, locationId: ids.goma })).body.code).toBe('PARTNER_NAME_REQUIRED');
    expect((await create({ code: `ZS-${stamp}`, name: 'ZS' })).body.code).toBe('LOCATION_REQUIRED');
    expect((await create({ code: `ZS-${stamp}`, name: 'ZS', locationId: ids.goma, partnerType: 'MARS' })).body.code).toBe('PARTNER_TYPE_INVALID');
    const r = await create({
      code: `zs-${stamp}`, name: `Zone de santé de Karisimbi ${stamp}`, partnerType: 'HEALTH_ZONE', locationId: ids.goma,
      contactName: 'Jean Mukendi', contactTitle: 'Médecin chef de zone', email: `mcz.${stamp.toLowerCase()}@nowhere.test`, phone: '+243 990 000 000',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    partner = r.body.data;
    expect(partner.code).toBe(`ZS-${stamp}`);
    expect(partner.partner_type).toBe('HEALTH_ZONE');
    expect((await create({ code: `ZS-${stamp}`.toLowerCase(), name: 'Doublon', locationId: ids.goma })).status).toBe(409);
    other = (await create({ code: `ONG-${stamp}`, name: `ONG ${stamp}`, partnerType: 'NGO', locationId: ids.kin })).body.data;

    const list = (await json(await request.get(`/api/partners?search=${stamp}&partnerType=HEALTH_ZONE`, { headers: H() }))).body.data;
    expect(list.map(p => p.id)).toEqual([partner.id]);
    const upd = await json(await request.put(`/api/partners/${partner.id}`, { headers: H(), data: { phone: '+243 811 111 111' } }));
    expect(upd.body.data.phone).toBe('+243 811 111 111');
    expect(upd.body.data.name).toBe(partner.name); // champs absents inchangés
  });

  test('Compte du responsable (mot de passe défini) puis espace partenaire cloisonné', async ({ request }) => {
    expect((await json(await request.post(`/api/partners/${partner.id}/accounts`, { headers: H(), data: { password: 'court' } }))).body.code).toBe('PASSWORD_TOO_SHORT');
    const r = await json(await request.post(`/api/partners/${partner.id}/accounts`, { headers: H(), data: { password } }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.email).toBe(partner.email);
    expect(r.body.data.first_name).toBe('Jean');
    expect(r.body.data.emailed).toBe(false);
    expect((await json(await request.post(`/api/partners/${partner.id}/accounts`, { headers: H(), data: { password } }))).body.code).toBe('EMAIL_IN_USE');
    const otherMail = `ong.${stamp.toLowerCase()}@nowhere.test`;
    expect((await request.post(`/api/partners/${other.id}/accounts`, { headers: H(), data: { email: otherMail, firstName: 'Awa', password } })).status()).toBe(201);

    partnerToken = await login(request, partner.email);
    otherToken = await login(request, otherMail);
    expect(partnerToken && otherToken).toBeTruthy();
    const me = await json(await request.get('/api/partner-portal/me', { headers: auth(partnerToken) }));
    expect(me.status).toBe(200);
    expect(me.body.data.name).toBe(partner.name);
    // Rien d'autre que l'espace partenaire
    for (const url of ['/api/stock-issues', '/api/requisitions', '/api/partners', '/api/users']) {
      expect((await request.get(url, { headers: auth(partnerToken) })).status(), url).toBe(403);
    }
    // Le compte partenaire n'apparaît pas parmi les utilisateurs de l'entreprise
    const users = (await json(await request.get('/api/stock-issues/recipients', { headers: H() }))).body.data;
    expect(users.some(u => u.email === partner.email)).toBe(false);
    const detail = (await json(await request.get(`/api/partners/${partner.id}`, { headers: H() }))).body.data;
    expect(detail.accounts.map(a => a.email)).toEqual([partner.email]);
  });

  test('Envoi : le stock sort à l\'expédition, équipements en transit', async ({ request }) => {
    const send = (data) => request.post('/api/stock-issues', { headers: H(), data: { warehouseId: wh.id, destinationType: 'PARTNER', purpose: 'Campagne', ...data } }).then(json);
    expect((await send({ lines: [{ stockItemId: rice.id, quantity: 1 }] })).body.code).toBe('PARTNER_REQUIRED');
    const r = await send({ partnerId: partner.id, lines: [{ stockItemId: rice.id, quantity: 40 }, { stockItemId: laptop.id, unitIds: [units[0].id, units[1].id] }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    shipment = r.body.data;
    expect(shipment.partnerId).toBe(partner.id);
    expect(await balance(request, rice.id)).toBe(60);
    expect(await balance(request, laptop.id)).toBe(1);
    const unit = (await json(await request.get(`/api/stock-units/${units[0].id}`, { headers: H() }))).body.data;
    expect(unit.status).toBe('IN_TRANSIT');

    const issue = (await json(await request.get(`/api/stock-issues/${shipment.id}`, { headers: H() }))).body.data;
    expect([issue.destination_type, issue.partner_name, issue.can_record_partner_receipt]).toEqual(['PARTNER', partner.name, true]);
    const pending = (await json(await request.get('/api/stock-issues?inTransit=1&destinationType=PARTNER', { headers: H() }))).body.data;
    expect(pending.map(i => i.id)).toContain(shipment.id);
  });

  test('Espace partenaire : ses envois seulement, réception ligne par ligne avec manque', async ({ request }) => {
    const list = (await json(await request.get('/api/partner-portal/transfers?status=pending', { headers: auth(partnerToken) }))).body.data;
    expect(list.map(i => i.id)).toEqual([shipment.id]);
    expect((await json(await request.get('/api/partner-portal/transfers', { headers: auth(otherToken) }))).body.data).toHaveLength(0);
    expect((await request.get(`/api/partner-portal/transfers/${shipment.id}`, { headers: auth(otherToken) })).status()).toBe(404);
    expect((await request.post(`/api/partner-portal/transfers/${shipment.id}/receive`, { headers: auth(otherToken), data: {} })).status()).toBe(404);

    const detail = (await json(await request.get(`/api/partner-portal/transfers/${shipment.id}`, { headers: auth(partnerToken) }))).body.data;
    expect(detail.can_receive).toBe(true);
    const riceLine = detail.lines.find(l => l.stock_item_id === rice.id);
    const lost = detail.lines.find(l => l.unit_id === units[1].id);
    const bad = await json(await request.post(`/api/partner-portal/transfers/${shipment.id}/receive`, { headers: auth(partnerToken), data: { lines: [{ lineId: riceLine.id, receivedQuantity: 41 }] } }));
    expect([bad.status, bad.body.code]).toEqual([400, 'INVALID_RECEIVED_QUANTITY']);

    const ok = await json(await request.post(`/api/partner-portal/transfers/${shipment.id}/receive`, {
      headers: auth(partnerToken),
      data: { comment: '2 sacs déchirés', lines: [{ lineId: riceLine.id, receivedQuantity: 38 }, { lineId: lost.id, receivedQuantity: 0 }] },
    }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.linesWithLoss).toBe(2);
    const issue = (await json(await request.get(`/api/stock-issues/${shipment.id}`, { headers: H() }))).body.data;
    expect(issue.acknowledgement_source).toBe('PORTAL');
    expect(issue.acknowledged_by).toBeTruthy();
    expect((await json(await request.get(`/api/stock-units/${units[0].id}`, { headers: H() }))).body.data.status).toBe('AT_PARTNER');
    expect((await json(await request.get(`/api/stock-units/${units[1].id}`, { headers: H() }))).body.data.status).toBe('LOST');
    // Le stock n'est pas réécrit à la réception
    expect(await balance(request, rice.id)).toBe(60);
    expect((await json(await request.post(`/api/partner-portal/transfers/${shipment.id}/receive`, { headers: auth(partnerToken), data: {} }))).body.code).toBe('ALREADY_ACKNOWLEDGED');
    // Reçu : plus annulable (retour)
    const cancel = await json(await request.post(`/api/stock-issues/${shipment.id}/cancel`, { headers: H(), data: { reason: 'Erreur' } }));
    expect([cancel.status, cancel.body.code]).toEqual([409, 'PARTNER_RECEIVED']);

    const pdf = await request.get(`/api/partner-portal/transfers/${shipment.id}/pdf?lang=fr`, { headers: auth(partnerToken) });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
  });

  test('Détentions et retour depuis le partenaire (seulement le reçu)', async ({ request }) => {
    const held = (await json(await request.get('/api/partner-portal/holdings', { headers: auth(partnerToken) }))).body.data;
    expect(held.map(h => [h.stock_item_id, h.remaining])).toEqual(expect.arrayContaining([[rice.id, 38], [laptop.id, 1]]));
    expect(held).toHaveLength(2);
    const mgmt = (await json(await request.get(`/api/stock-holdings?partnerId=${partner.id}`, { headers: H() }))).body;
    expect(mgmt.partner.id).toBe(partner.id);
    const riceHeld = mgmt.data.find(h => h.stock_item_id === rice.id);
    const laptopHeld = mgmt.data.find(h => h.stock_item_id === laptop.id);
    const over = await json(await request.post('/api/stock-returns', { headers: H(), data: { warehouseId: wh.id, partnerId: partner.id, lines: [{ issueLineId: riceHeld.issue_line_id, quantity: 39, condition: 'GOOD' }] } }));
    expect(over.body.code).toBe('OVER_RETURN');
    const ret = await json(await request.post('/api/stock-returns', { headers: H(), data: {
      warehouseId: wh.id, partnerId: partner.id,
      lines: [{ issueLineId: riceHeld.issue_line_id, quantity: 8, condition: 'GOOD' }, { issueLineId: laptopHeld.issue_line_id, quantity: 1, condition: 'GOOD' }],
    } }));
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect(await balance(request, rice.id)).toBe(68);
    expect((await json(await request.get(`/api/stock-units/${units[0].id}`, { headers: H() }))).body.data.status).toBe('IN_STOCK');
    const returns = (await json(await request.get(`/api/stock-returns?partnerId=${partner.id}`, { headers: H() }))).body.data;
    expect(returns[0].returned_by_name).toBe(partner.name);
  });

  test('Réception enregistrée par le magasin, annulation avant réception', async ({ request }) => {
    const send = () => request.post('/api/stock-issues', { headers: H(), data: { warehouseId: wh.id, destinationType: 'PARTNER', partnerId: partner.id, lines: [{ stockItemId: rice.id, quantity: 10 }] } }).then(json);
    shipment = (await send()).body.data;
    const store = await json(await request.post(`/api/stock-issues/${shipment.id}/partner-receipt`, { headers: H(), data: { comment: 'Bon signé sur papier' } }));
    expect(store.status, JSON.stringify(store.body)).toBe(200);
    expect(store.body.data.issue.acknowledgement_source).toBe('STORE');
    expect(store.body.data.issue.lines[0].received_quantity).toBe(10);

    shipment2 = (await send()).body.data;
    expect(await balance(request, rice.id)).toBe(48);
    const cancel = await json(await request.post(`/api/stock-issues/${shipment2.id}/cancel`, { headers: H(), data: { reason: 'Partenaire injoignable' } }));
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(await balance(request, rice.id)).toBe(58);
    expect((await json(await request.post(`/api/partner-portal/transfers/${shipment2.id}/receive`, { headers: auth(partnerToken), data: {} }))).body.code).toBe('CANCELLED');
  });

  test('Catalogue filtré par dépôt : articles en stock dans ce dépôt, quantité du dépôt', async ({ request }) => {
    const items = (await json(await request.get(`/api/stock-items?warehouseId=${wh.id}&limit=1000`, { headers: H() }))).body.data;
    const byId = Object.fromEntries(items.map(i => [i.id, Number(i.stock_quantity)]));
    expect(byId[rice.id]).toBe(58);
    expect(byId[laptop.id]).toBe(2); // 3 enregistrés, 1 chez le partenaire puis rendu, 1 perdu en transit
    // Un autre dépôt, sans stock : aucun de ces articles
    const empty = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `PV-${stamp}`.slice(0, 30), name: `Dépôt vide ${stamp}`, locationId: ids.kin } })).json()).data;
    const none = (await json(await request.get(`/api/stock-items?warehouseId=${empty.id}&search=${stamp}`, { headers: H() }))).body.data;
    expect(none).toHaveLength(0);
  });

  test('Partenaire désactivé : envoi refusé, espace fermé', async ({ request }) => {
    await request.put(`/api/partners/${other.id}`, { headers: H(), data: { isActive: false } });
    const r = await json(await request.post('/api/stock-issues', { headers: H(), data: { warehouseId: wh.id, destinationType: 'PARTNER', partnerId: other.id, lines: [{ stockItemId: rice.id, quantity: 1 }] } }));
    expect(r.body.code).toBe('PARTNER_INVALID');
    const me = await json(await request.get('/api/partner-portal/me', { headers: auth(otherToken) }));
    expect([me.status, me.body.code]).toEqual([403, 'PARTNER_INACTIVE']);
    const dest = (await json(await request.get('/api/stock-issues/destinations', { headers: H() }))).body.data;
    expect(dest.partners.map(p => p.id)).toContain(partner.id);
    expect(dest.partners.map(p => p.id)).not.toContain(other.id);
  });
});
