import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Types de sortie de stock : vers un employé (couvert par stock-issues.spec.js), vers un autre dépôt (transfert)
// et vers un département — mouvements, équipements (n° de série), accusé de réception, annulation, retours.
test.describe.serial('API › Types de sortie de stock (transfert, département)', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const logistic = { email: `dst.log.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const keeper = { email: `dst.kep.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const manager = { email: `dst.mgr.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const ids = {};
  const tokens = {};
  let admin, whA, whB, fuel, laptop, units, dept, transfer, deptIssue;

  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const balance = async (request, warehouseId, itemId) => {
    const rows = (await (await request.get(`/api/stock/balances?warehouseId=${warehouseId}&stockItemId=${itemId}&includeEmpty=1`, { headers: auth(tokens.log) })).json()).data;
    return rows.reduce((s, r) => s + Number(r.quantity), 0);
  };
  const post = (request, token, url, data) => request.post(url, { headers: auth(token), data });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const H = auth(admin);
    const get = async (u) => (await (await request.get(u, { headers: H })).json()).data;
    const [locations, depts, projects, suppliers, cats] = await Promise.all(
      ['/api/public/locations', '/api/departments', '/api/projects', '/api/suppliers', '/api/public/market-categories'].map(get)
    );
    for (const [key, account, profile] of [['log', logistic, 'prof_logistic'], ['kep', keeper, 'prof_logistic'], ['mgr', manager, 'prof_requester']]) {
      const created = await request.post('/api/users', { headers: H, data: { username: account.email.split('@')[0], email: account.email, password: account.password, firstName: key, lastName: profile, profileIds: [profile] } });
      expect(created.status()).toBe(201);
      ids[key] = (await created.json()).data.id;
      tokens[key] = (await (await request.post('/api/auth/login', { data: account })).json()).data.token;
    }
    const goma = locations.find(l => l.code === 'GOMA');
    const kin = locations.find(l => l.code === 'KINSHASA');
    whA = (await (await request.post('/api/warehouses', { headers: H, data: { code: `DA-${stamp}`.slice(0, 30), name: `Dépôt A ${stamp}`, locationId: goma.id } })).json()).data;
    whB = (await (await request.post('/api/warehouses', { headers: H, data: { code: `DB-${stamp}`.slice(0, 30), name: `Dépôt B ${stamp}`, locationId: kin.id } })).json()).data;
    await request.put(`/api/warehouses/${whA.id}/users`, { headers: H, data: { userIds: [ids.log] } });
    await request.put(`/api/warehouses/${whB.id}/users`, { headers: H, data: { userIds: [ids.kep] } });
    dept = (await (await request.post('/api/departments', { headers: H, data: { code: `DP${stamp}`.slice(0, 20), name: `Département ${stamp}`, managerId: ids.mgr } })).json()).data;
    expect(dept?.id).toBeTruthy();

    fuel = (await (await request.post('/api/stock-items', { headers: H, data: { code: `DSF-${stamp}`, name: `Gasoil ${stamp}`, unit: 'L', categoryId: cats.find(c => c.code === 'FUEL').id } })).json()).data;
    laptop = (await (await request.post('/api/stock-items', { headers: H, data: { code: `DSL-${stamp}`, name: `Portable ${stamp}`, unit: 'pc', categoryId: cats.find(c => c.code === 'FUEL').id, trackSerials: true } })).json()).data;
    expect(laptop?.track_serials).toBe(true);

    // Stock au dépôt A : 100 L par réception, 3 ordinateurs (parc existant)
    const req = (await (await request.post('/api/requisitions', { headers: H, data: {
      title: `[TEST DESTINATIONS] ${stamp}`, description: 'x', departmentId: depts[0].id, projectId: projects[0]?.id, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'x',
      items: [{ description: 'Gasoil', quantity: 100, frequency: 1, unitPrice: 1.5, stockItemId: fuel.id }],
    } })).json()).data;
    const detail = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data;
    const po = (await (await request.post('/api/purchase-orders', { headers: H, data: {
      requisitionId: req.id, supplierId: suppliers[0].id, currency: 'USD', totalAmount: 150,
      items: detail.items.map(i => ({ description: i.item_description, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), stockItemId: i.stock_item_id, requisitionItemId: i.id })),
    } })).json()).data;
    const poItem = (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: H })).json()).data.items[0];
    const grn = await post(request, tokens.log, '/api/goods-receipts', { poId: po.id, grnItems: [{ poItemId: poItem.id, quantity_received: 100, quantity_accepted: 100, quantity_rejected: 0 }] });
    expect(grn.status(), JSON.stringify(await grn.json())).toBe(201);
    const reg = await post(request, tokens.log, '/api/stock-units/register', { stockItemId: laptop.id, warehouseId: whA.id, units: [`SN1-${stamp}`, `SN2-${stamp}`, `SN3-${stamp}`] });
    expect(reg.status()).toBe(201);
    units = (await (await request.get(`/api/stock-units?stockItemId=${laptop.id}`, { headers: H })).json()).data;
    expect(units).toHaveLength(3);
  });

  test('Destinations : dépôts et départements actifs de l\'entreprise', async ({ request }) => {
    const r = await json(await request.get('/api/stock-issues/destinations', { headers: auth(tokens.log) }));
    expect(r.status).toBe(200);
    expect(r.body.data.warehouses.map(w => w.id)).toEqual(expect.arrayContaining([whA.id, whB.id]));
    expect(r.body.data.departments.map(d => d.id)).toContain(dept.id);
    expect((await request.get('/api/stock-issues/destinations', { headers: auth(tokens.mgr) })).status()).toBe(403);
  });

  test('Contrôles : type invalide, destination manquante, même dépôt', async ({ request }) => {
    const send = (data) => post(request, tokens.log, '/api/stock-issues', { warehouseId: whA.id, lines: [{ stockItemId: fuel.id, quantity: 1 }], ...data });
    expect((await json(await send({ destinationType: 'MARS' }))).body.code).toBe('INVALID_DESTINATION');
    expect((await json(await send({ destinationType: 'WAREHOUSE' }))).body.code).toBe('DESTINATION_REQUIRED');
    expect((await json(await send({ destinationType: 'WAREHOUSE', destinationWarehouseId: whA.id }))).body.code).toBe('SAME_WAREHOUSE');
    expect((await json(await send({ destinationType: 'DEPARTMENT' }))).body.code).toBe('DEPARTMENT_REQUIRED');
    expect((await json(await send({ destinationType: 'USER' }))).body.code).toBe('RECIPIENT_REQUIRED');
  });

  test('Transfert : expédition (en transit) puis réception au dépôt de destination ; équipement endommagé accepté', async ({ request }) => {
    // Un ordinateur endommagé peut partir en transfert (ex. réparation), pas en remise
    expect((await request.put(`/api/stock-units/${units[0].id}`, { headers: auth(tokens.log), data: { condition: 'DAMAGED' } })).status()).toBe(200);
    const res = await json(await post(request, tokens.log, '/api/stock-issues', {
      destinationType: 'WAREHOUSE', warehouseId: whA.id, destinationWarehouseId: whB.id, purpose: 'Réapprovisionnement',
      lines: [{ stockItemId: fuel.id, quantity: 40 }, { stockItemId: laptop.id, unitIds: [units[0].id, units[1].id] }],
    }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    transfer = res.body.data;
    expect(transfer.destinationType).toBe('WAREHOUSE');
    // En transit : sorti du dépôt A, pas encore entré au dépôt B
    expect([await balance(request, whA.id, fuel.id), await balance(request, whB.id, fuel.id)]).toEqual([60, 0]);
    expect([await balance(request, whA.id, laptop.id), await balance(request, whB.id, laptop.id)]).toEqual([1, 0]);
    const inTransit = (await (await request.get(`/api/stock-units/${units[0].id}`, { headers: auth(admin) })).json()).data;
    expect([inTransit.status, inTransit.warehouse_id]).toEqual(['IN_TRANSIT', null]);
    const transitList = (await (await request.get(`/api/stock-issues?inTransit=1&warehouseId=${whB.id}`, { headers: auth(admin) })).json()).data;
    expect(transitList.map(i => i.id)).toEqual([transfer.id]);

    // Le magasinier du dépôt B est prévenu, voit le bon (sans être bénéficiaire) et le réceptionne
    const notes = (await (await request.get(`/api/notifications/${ids.kep}`, { headers: auth(tokens.kep) })).json()).data;
    expect(notes.some(n => n.title.includes(transfer.issueNumber))).toBe(true);
    // Le logisticien du dépôt A ne peut pas réceptionner à la place du dépôt B
    expect((await json(await post(request, tokens.log, `/api/stock-issues/${transfer.id}/acknowledge`, {}))).body.code).toBe('NOT_RECIPIENT');
    const view = (await (await request.get(`/api/stock-issues/${transfer.id}`, { headers: auth(tokens.kep) })).json()).data;
    expect([view.destination_type, view.destination_warehouse_name, view.can_acknowledge]).toEqual(['WAREHOUSE', whB.name, true]);
    expect((await post(request, tokens.kep, `/api/stock-issues/${transfer.id}/acknowledge`, { comment: 'Bien arrivé' })).status()).toBe(200);
    const acked = (await (await request.get(`/api/stock-issues/${transfer.id}`, { headers: auth(tokens.kep) })).json()).data;
    expect(acked.acknowledged_by).toBe(ids.kep);
    expect(acked.lines.every(l => l.received_quantity === l.quantity)).toBe(true);
    expect([await balance(request, whA.id, fuel.id), await balance(request, whB.id, fuel.id)]).toEqual([60, 40]);
    expect([await balance(request, whA.id, laptop.id), await balance(request, whB.id, laptop.id)]).toEqual([1, 2]);

    const moved = (await (await request.get(`/api/stock-units/${units[0].id}`, { headers: auth(admin) })).json()).data;
    expect([moved.status, moved.warehouse_id, moved.condition]).toEqual(['IN_STOCK', whB.id, 'DAMAGED']);

    const movements = (await (await request.get(`/api/stock/movements?stockItemId=${fuel.id}`, { headers: auth(admin) })).json()).data;
    const ofTransfer = movements.filter(m => m.source_id === transfer.id);
    expect(ofTransfer.map(m => [m.movement_type, Number(m.quantity), m.warehouse_id]).sort()).toEqual(
      [['TRANSFER_IN', 40, whB.id], ['TRANSFER_OUT', -40, whA.id]].sort());
    expect(ofTransfer.find(m => m.movement_type === 'TRANSFER_OUT').recipient_name).toBe(whB.name);
    expect(ofTransfer.find(m => m.movement_type === 'TRANSFER_IN').recipient_name).toBe(whA.name);

    // Liste filtrée par type et par dépôt (transferts reçus compris)
    const list = (await (await request.get(`/api/stock-issues?destinationType=WAREHOUSE&warehouseId=${whB.id}`, { headers: auth(admin) })).json()).data;
    expect(list.map(i => i.id)).toEqual([transfer.id]);
    // PDF « bon de transfert »
    const pdf = await request.get(`/api/stock-issues/${transfer.id}/pdf?lang=fr`, { headers: auth(tokens.kep) });
    expect([pdf.status(), pdf.headers()['content-type']]).toEqual([200, 'application/pdf']);
  });

  test('Remise : un équipement endommagé ne peut pas être remis', async ({ request }) => {
    const r = await json(await post(request, tokens.kep, '/api/stock-issues', {
      destinationType: 'USER', warehouseId: whB.id, recipientId: ids.mgr, lines: [{ stockItemId: laptop.id, unitIds: [units[0].id] }],
    }));
    expect([r.status, r.body.code]).toEqual([400, 'UNIT_UNAVAILABLE']);
  });

  test('Annulation d\'un transfert : refusée si le stock transféré a été utilisé, sinon retour au dépôt d\'origine', async ({ request }) => {
    // Le dépôt B consomme 10 L → l'annulation ne peut plus reprendre les 40 L
    const used = await post(request, tokens.kep, '/api/stock-issues', { destinationType: 'DEPARTMENT', warehouseId: whB.id, departmentId: dept.id, lines: [{ stockItemId: fuel.id, quantity: 10 }] });
    expect(used.status()).toBe(201);
    const refused = await json(await post(request, tokens.log, `/api/stock-issues/${transfer.id}/cancel`, { reason: 'Erreur' }));
    expect([refused.status, refused.body.code]).toEqual([409, 'TRANSFER_USED']);
    // Après annulation de la consommation, le transfert peut être annulé
    expect((await post(request, tokens.kep, `/api/stock-issues/${(await used.json()).data.id}/cancel`, { reason: 'Erreur' })).status()).toBe(200);
    const ok = await json(await post(request, tokens.log, `/api/stock-issues/${transfer.id}/cancel`, { reason: 'Mauvais dépôt' }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect([await balance(request, whA.id, fuel.id), await balance(request, whB.id, fuel.id)]).toEqual([100, 0]);
    expect([await balance(request, whA.id, laptop.id), await balance(request, whB.id, laptop.id)]).toEqual([3, 0]);
    const back = (await (await request.get(`/api/stock-units/${units[0].id}`, { headers: auth(admin) })).json()).data;
    expect([back.status, back.warehouse_id]).toEqual(['IN_STOCK', whA.id]);
  });

  test('Département : sortie ISSUE, équipement affecté au département, accusé par le responsable', async ({ request }) => {
    expect((await request.put(`/api/stock-units/${units[0].id}`, { headers: auth(tokens.log), data: { condition: 'GOOD' } })).status()).toBe(200);
    const res = await json(await post(request, tokens.log, '/api/stock-issues', {
      destinationType: 'DEPARTMENT', warehouseId: whA.id, departmentId: dept.id, purpose: 'Équipement du service',
      lines: [{ stockItemId: fuel.id, quantity: 15 }, { stockItemId: laptop.id, unitIds: [units[2].id] }],
    }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    deptIssue = res.body.data;
    expect(await balance(request, whA.id, fuel.id)).toBe(85);

    const unit = (await (await request.get(`/api/stock-units/${units[2].id}`, { headers: auth(admin) })).json()).data;
    expect([unit.status, unit.department_id, unit.holder_id, unit.department_name]).toEqual(['ASSIGNED', dept.id, null, dept.name]);
    const assigned = (await (await request.get(`/api/stock-units?departmentId=${dept.id}`, { headers: auth(admin) })).json()).data;
    expect(assigned.map(u => u.id)).toEqual([units[2].id]);

    // Sans « retiré par » : le responsable du département est prévenu et confirme ; la sortie n'entre pas dans SES détentions
    const notes = (await (await request.get(`/api/notifications/${ids.mgr}`, { headers: auth(tokens.mgr) })).json()).data;
    expect(notes.some(n => n.title.includes(deptIssue.issueNumber))).toBe(true);
    expect((await json(await post(request, tokens.log, `/api/stock-issues/${deptIssue.id}/acknowledge`, {}))).body.code).toBe('NOT_RECIPIENT');
    expect((await post(request, tokens.mgr, `/api/stock-issues/${deptIssue.id}/acknowledge`, {})).status()).toBe(200);
    const mine = (await (await request.get('/api/stock-holdings/mine', { headers: auth(tokens.mgr) })).json()).data;
    expect(mine).toHaveLength(0);
  });

  test('Retour depuis un département : détentions du département, équipement remis en stock', async ({ request }) => {
    const holdings = await json(await request.get(`/api/stock-holdings?departmentId=${dept.id}`, { headers: auth(tokens.log) }));
    expect(holdings.status).toBe(200);
    expect(holdings.body.department.id).toBe(dept.id);
    expect(holdings.body.data.map(h => [h.item_name, h.remaining]).sort()).toEqual([[fuel.name, 15], [laptop.name, 1]].sort());

    // Un employé ne peut pas rendre ce que le département détient
    const wrong = await json(await post(request, tokens.log, '/api/stock-returns', {
      warehouseId: whA.id, returnedBy: ids.mgr, lines: [{ issueLineId: holdings.body.data[0].issue_line_id, quantity: 1, condition: 'GOOD' }],
    }));
    expect([wrong.status, wrong.body.code]).toEqual([400, 'NOT_HOLDER']);

    const ret = await json(await post(request, tokens.log, '/api/stock-returns', {
      warehouseId: whA.id, departmentId: dept.id,
      lines: holdings.body.data.map(h => ({ issueLineId: h.issue_line_id, quantity: h.track_serials ? 1 : 5, condition: 'GOOD' })),
    }));
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect(await balance(request, whA.id, fuel.id)).toBe(90);
    const unit = (await (await request.get(`/api/stock-units/${units[2].id}`, { headers: auth(admin) })).json()).data;
    expect([unit.status, unit.warehouse_id, unit.department_id]).toEqual(['IN_STOCK', whA.id, null]);
    const returns = (await (await request.get(`/api/stock-returns?departmentId=${dept.id}`, { headers: auth(admin) })).json()).data;
    expect(returns.map(r => [r.id, r.returned_by_name])).toEqual([[ret.body.data.id, dept.name]]);
  });

  test('Département avec « retiré par » : la personne confirme, le bon apparaît dans ses articles reçus', async ({ request }) => {
    const res = await json(await post(request, tokens.log, '/api/stock-issues', {
      destinationType: 'DEPARTMENT', warehouseId: whA.id, departmentId: dept.id, recipientId: ids.kep, lines: [{ stockItemId: fuel.id, quantity: 2 }],
    }));
    expect(res.status).toBe(201);
    const mine = (await (await request.get('/api/stock-issues?mine=1', { headers: auth(tokens.kep) })).json()).data;
    expect(mine.map(i => i.id)).toContain(res.body.data.id);
    expect((await json(await post(request, tokens.mgr, `/api/stock-issues/${res.body.data.id}/acknowledge`, {}))).body.code).toBe('NOT_RECIPIENT');
    expect((await post(request, tokens.kep, `/api/stock-issues/${res.body.data.id}/acknowledge`, {})).status()).toBe(200);
  });
  test('Transfert en transit : réception partielle (perte en transit), équipement non reçu → perdu', async ({ request }) => {
    const a0 = await balance(request, whA.id, fuel.id);
    const res = await json(await post(request, tokens.log, '/api/stock-issues', {
      destinationType: 'WAREHOUSE', warehouseId: whA.id, destinationWarehouseId: whB.id,
      lines: [{ stockItemId: fuel.id, quantity: 30 }, { stockItemId: laptop.id, unitIds: [units[0].id] }],
    }));
    expect(res.status).toBe(201);
    const issue = (await (await request.get(`/api/stock-issues/${res.body.data.id}`, { headers: auth(tokens.kep) })).json()).data;
    const fuelLine = issue.lines.find(l => l.stock_item_id === fuel.id);
    const unitLine = issue.lines.find(l => l.unit_id);
    const bad = await json(await post(request, tokens.kep, `/api/stock-issues/${issue.id}/receive`, { lines: [{ lineId: fuelLine.id, receivedQuantity: 31 }] }));
    expect([bad.status, bad.body.code]).toEqual([400, 'INVALID_RECEIVED_QUANTITY']);
    const ok = await json(await post(request, tokens.kep, `/api/stock-issues/${issue.id}/receive`, {
      comment: 'Fût percé, ordinateur manquant', lines: [{ lineId: fuelLine.id, receivedQuantity: 27.5 }, { lineId: unitLine.id, receivedQuantity: 0 }],
    }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.linesWithLoss).toBe(2);
    expect([await balance(request, whA.id, fuel.id), await balance(request, whB.id, fuel.id)]).toEqual([a0 - 30, 27.5]);
    const lost = (await (await request.get(`/api/stock-units/${units[0].id}`, { headers: auth(admin) })).json()).data;
    expect(lost.status).toBe('LOST');
    expect((await json(await post(request, tokens.kep, `/api/stock-issues/${issue.id}/receive`, {}))).body.code).toBe('ALREADY_ACKNOWLEDGED');
    // Annulation après réception partielle : seule la quantité reçue repart vers le dépôt d'origine
    expect((await post(request, tokens.log, `/api/stock-issues/${issue.id}/cancel`, { reason: 'Retour au dépôt A' })).status()).toBe(200);
    expect([await balance(request, whA.id, fuel.id), await balance(request, whB.id, fuel.id)]).toEqual([a0 - 2.5, 0]);
  });

  test("Transfert annulé avant réception : tout revient au dépôt d'origine", async ({ request }) => {
    const res = await json(await post(request, tokens.log, '/api/stock-issues', {
      destinationType: 'WAREHOUSE', warehouseId: whA.id, destinationWarehouseId: whB.id,
      lines: [{ stockItemId: fuel.id, quantity: 20 }, { stockItemId: laptop.id, unitIds: [units[1].id] }],
    }));
    const a0 = await balance(request, whA.id, fuel.id) + 20;
    expect(res.status).toBe(201);
    expect((await post(request, tokens.log, `/api/stock-issues/${res.body.data.id}/cancel`, { reason: 'Camion indisponible' })).status()).toBe(200);
    expect([await balance(request, whA.id, fuel.id), await balance(request, whB.id, fuel.id)]).toEqual([a0, 0]);
    const unit = (await (await request.get(`/api/stock-units/${units[1].id}`, { headers: auth(admin) })).json()).data;
    expect([unit.status, unit.warehouse_id]).toEqual(['IN_STOCK', whA.id]);
  });

});
