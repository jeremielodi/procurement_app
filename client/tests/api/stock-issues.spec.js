import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Sorties de stock vers un utilisateur (bons de sortie) :
// stock constitué par réception → sortie FEFO (lots les plus proches de la péremption d'abord) → bénéficiaire
// notifié, consulte ses bons et confirme la réception → annulation = retour en stock.
const future = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);

test.describe.serial('API › Sorties de stock vers un utilisateur', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const logistic = { email: `iss.log.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const requester = { email: `iss.req.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  let admin, logToken, reqToken, logisticId, requesterId;
  let wh, otherWh, fuel, med, lotSoon, lotLate, issue;

  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const balance = async (request, itemId, lotId = null) => {
    const rows = (await (await request.get(`/api/stock/balances?warehouseId=${wh.id}&stockItemId=${itemId}&includeEmpty=1`, { headers: auth(logToken) })).json()).data;
    return Number(rows.find(r => (r.lot_id || null) === lotId)?.quantity ?? 0);
  };

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const H = auth(admin);
    const get = async (u) => (await (await request.get(u, { headers: H })).json()).data;
    const [locations, depts, projects, suppliers, cats] = await Promise.all(
      ['/api/public/locations', '/api/departments', '/api/projects', '/api/suppliers', '/api/public/market-categories'].map(get)
    );
    for (const [account, profile] of [[logistic, 'prof_logistic'], [requester, 'prof_requester']]) {
      const created = await request.post('/api/users', { headers: H, data: { username: account.email.split('@')[0], email: account.email, password: account.password, firstName: profile === 'prof_logistic' ? 'Lucie' : 'Rémi', lastName: profile, profileIds: [profile] } });
      expect(created.status()).toBe(201);
      if (profile === 'prof_logistic') logisticId = (await created.json()).data.id; else requesterId = (await created.json()).data.id;
    }
    logToken = (await (await request.post('/api/auth/login', { data: logistic })).json()).data.token;
    reqToken = (await (await request.post('/api/auth/login', { data: requester })).json()).data.token;

    const goma = locations.find(l => l.code === 'GOMA');
    wh = (await (await request.post('/api/warehouses', { headers: H, data: { code: `IS-${stamp}`.slice(0, 30), name: `Dépôt sorties ${stamp}`, locationId: goma.id } })).json()).data;
    otherWh = (await (await request.post('/api/warehouses', { headers: H, data: { code: `IX-${stamp}`.slice(0, 30), name: `Dépôt sans accès ${stamp}`, locationId: goma.id } })).json()).data;
    await request.put(`/api/warehouses/${wh.id}/users`, { headers: H, data: { userIds: [logisticId] } });

    fuel = (await (await request.post('/api/stock-items', { headers: H, data: { code: `ISF-${stamp}`, name: 'Gasoil sorties', unit: 'L', categoryId: cats.find(c => c.code === 'FUEL').id } })).json()).data;
    med = (await (await request.post('/api/stock-items', { headers: H, data: { code: `ISM-${stamp}`, name: 'Antipaludéen', unit: 'boîte', categoryId: cats.find(c => c.code === 'MEDICAL_SUPPLIES').id, trackLots: true, trackExpiry: true } })).json()).data;

    // Stock : réception de 100 L de gasoil et de 2 lots de médicaments (péremptions différentes)
    const req = (await (await request.post('/api/requisitions', { headers: H, data: {
      title: `[TEST SORTIES] ${stamp}`, description: 'x', departmentId: depts[0].id, projectId: projects[0]?.id, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'x',
      items: [{ description: 'Gasoil', quantity: 100, frequency: 1, unitPrice: 1.5, stockItemId: fuel.id }, { description: 'Antipaludéen', quantity: 50, frequency: 1, unitPrice: 4, stockItemId: med.id }],
    } })).json()).data;
    const detail = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data;
    const po = (await (await request.post('/api/purchase-orders', { headers: H, data: {
      requisitionId: req.id, supplierId: suppliers[0].id, currency: 'USD', totalAmount: 350,
      items: detail.items.map(i => ({ description: i.item_description, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), stockItemId: i.stock_item_id, requisitionItemId: i.id })),
    } })).json()).data;
    const poItems = (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: H })).json()).data.items;
    const fuelLine = poItems.find(i => i.stock_item_id === fuel.id), medLine = poItems.find(i => i.stock_item_id === med.id);
    const grn = await request.post('/api/goods-receipts', { headers: auth(logToken), data: { poId: po.id, grnItems: [
      { poItemId: fuelLine.id, quantity_received: 100, quantity_accepted: 100, quantity_rejected: 0 },
      { poItemId: medLine.id, quantity_received: 30, quantity_accepted: 30, quantity_rejected: 0, lotNumber: `LATE-${stamp}`, expiryDate: future(400) },
      { poItemId: medLine.id, quantity_received: 20, quantity_accepted: 20, quantity_rejected: 0, lotNumber: `SOON-${stamp}`, expiryDate: future(60) },
    ] } });
    expect(grn.status(), JSON.stringify(await grn.json())).toBe(201);
    const lots = (await (await request.get(`/api/stock-items/${med.id}`, { headers: H })).json()).data.lots;
    lotSoon = lots.find(l => l.lot_number === `SOON-${stamp}`);
    lotLate = lots.find(l => l.lot_number === `LATE-${stamp}`);
  });

  test('Droits : le demandeur ne peut ni sortir du stock ni lister les bénéficiaires', async ({ request }) => {
    const H = auth(reqToken);
    expect((await request.get('/api/stock-issues/recipients', { headers: H })).status()).toBe(403);
    expect((await request.post('/api/stock-issues', { headers: H, data: { warehouseId: wh.id, recipientId: requesterId, lines: [{ stockItemId: fuel.id, quantity: 1 }] } })).status()).toBe(403);
    const recipients = (await (await request.get(`/api/stock-issues/recipients?q=${encodeURIComponent(requester.email)}`, { headers: auth(logToken) })).json()).data;
    expect(recipients.map(r => r.id)).toEqual([requesterId]);
  });

  test('Contrôles : stock insuffisant, dépôt sans accès, aucune ligne', async ({ request }) => {
    const post = (data) => request.post('/api/stock-issues', { headers: auth(logToken), data: { warehouseId: wh.id, recipientId: requesterId, ...data } });
    let r = await json(await post({ lines: [{ stockItemId: fuel.id, quantity: 100.5 }] }));
    expect([r.status, r.body.code, r.body.available]).toEqual([400, 'STOCK_INSUFFICIENT', 100]);
    // Deux lignes du même article : cumul contrôlé
    r = await json(await post({ lines: [{ stockItemId: fuel.id, quantity: 60 }, { stockItemId: fuel.id, quantity: 41 }] }));
    expect(r.body.code).toBe('STOCK_INSUFFICIENT');
    r = await json(await post({ warehouseId: otherWh.id, lines: [{ stockItemId: fuel.id, quantity: 1 }] }));
    expect([r.status, r.body.code]).toEqual([403, 'WAREHOUSE_FORBIDDEN']);
    r = await json(await post({ lines: [] }));
    expect(r.body.code).toBe('NO_LINES');
    expect(await balance(request, fuel.id)).toBe(100); // rien n'a bougé
  });

  test('Sortie : FEFO sur les lots, stock diminué, bénéficiaire notifié', async ({ request }) => {
    const r = await json(await request.post('/api/stock-issues', { headers: auth(logToken), data: {
      warehouseId: wh.id, recipientId: requesterId, purpose: 'Mission terrain Masisi',
      lines: [{ stockItemId: fuel.id, quantity: 40.5 }, { stockItemId: med.id, quantity: 25 }],
    } }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.issueNumber).toMatch(/^SOR-\d{4}-\d{5}$/);
    issue = r.body.data;

    const detail = (await (await request.get(`/api/stock-issues/${issue.id}`, { headers: auth(logToken) })).json()).data;
    const medLines = detail.lines.filter(l => l.stock_item_id === med.id).map(l => [l.lot_number, l.quantity]);
    expect(medLines).toEqual([[`SOON-${stamp}`, 20], [`LATE-${stamp}`, 5]]); // le lot qui périme le plus tôt sort en premier
    expect(detail.lines.every(l => /^MVT-/.test(l.movement_number))).toBe(true);
    expect([detail.recipient_name, detail.warehouse_name, detail.status]).toEqual(['Rémi prof_requester', wh.name, 'ISSUED']);

    expect(await balance(request, fuel.id)).toBe(59.5);
    expect(await balance(request, med.id, lotSoon.id)).toBe(0);
    expect(await balance(request, med.id, lotLate.id)).toBe(25);

    const notifs = (await (await request.get(`/api/notifications/${requesterId}`, { headers: auth(reqToken) })).json()).data;
    expect(notifs.some(n => n.title.includes(issue.issueNumber) && n.link === `/my-items/${issue.id}`)).toBe(true);
  });

  test('Lot imposé : uniquement ce lot', async ({ request }) => {
    const r = await json(await request.post('/api/stock-issues', { headers: auth(logToken), data: {
      warehouseId: wh.id, recipientId: requesterId, lines: [{ stockItemId: med.id, lotId: lotLate.id, quantity: 26 }],
    } }));
    expect([r.status, r.body.code, r.body.available]).toEqual([400, 'STOCK_INSUFFICIENT', 25]);
  });

  test('Bénéficiaire : voit ses bons, imprime le bon, confirme la réception', async ({ request }) => {
    const H = auth(reqToken);
    const list = (await (await request.get('/api/stock-issues', { headers: H })).json()).data; // sans VIEW_STOCK : les siens
    expect(list.map(i => i.id)).toEqual([issue.id]);
    expect(list[0].items).toContain('Gasoil sorties');
    const pdf = await request.get(`/api/stock-issues/${issue.id}/pdf?lang=en`, { headers: H });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');

    expect((await request.post(`/api/stock-issues/${issue.id}/acknowledge`, { headers: auth(logToken), data: {} })).status()).toBe(403);
    const ack = await json(await request.post(`/api/stock-issues/${issue.id}/acknowledge`, { headers: H, data: { comment: 'Bien reçu' } }));
    expect(ack.status).toBe(200);
    expect(ack.body.data.acknowledgement_comment).toBe('Bien reçu');
    expect((await request.post(`/api/stock-issues/${issue.id}/acknowledge`, { headers: H, data: {} })).status()).toBe(409);
    const notifs = (await (await request.get(`/api/notifications/${logisticId}`, { headers: auth(logToken) })).json()).data;
    expect(notifs.some(n => n.title.includes(issue.issueNumber))).toBe(true); // le magasinier est prévenu
  });

  test('Annulation : motif obligatoire, retour en stock par écritures inverses', async ({ request }) => {
    expect((await request.post(`/api/stock-issues/${issue.id}/cancel`, { headers: auth(reqToken), data: { reason: 'x' } })).status()).toBe(403);
    expect((await request.post(`/api/stock-issues/${issue.id}/cancel`, { headers: auth(logToken), data: {} })).status()).toBe(400);
    const r = await json(await request.post(`/api/stock-issues/${issue.id}/cancel`, { headers: auth(logToken), data: { reason: 'Mission reportée' } }));
    expect([r.status, r.body.data.reversedMovements]).toEqual([200, 3]);
    expect(await balance(request, fuel.id)).toBe(100);
    expect(await balance(request, med.id, lotSoon.id)).toBe(20);
    expect(await balance(request, med.id, lotLate.id)).toBe(30);
    expect((await request.post(`/api/stock-issues/${issue.id}/cancel`, { headers: auth(logToken), data: { reason: 'x' } })).status()).toBe(409);

    const mv = (await (await request.get(`/api/stock/movements?sourceType=ISSUE&sourceId=${issue.id}`, { headers: auth(logToken) })).json()).data;
    expect(mv.map(m => m.movement_type).sort()).toEqual(['ISSUE', 'ISSUE', 'ISSUE', 'ISSUE_REVERSAL', 'ISSUE_REVERSAL', 'ISSUE_REVERSAL']);
    expect(mv.every(m => m.issue_number === issue.issueNumber && m.recipient_name === 'Rémi prof_requester')).toBe(true);
    const detail = (await (await request.get(`/api/stock-issues/${issue.id}`, { headers: auth(reqToken) })).json()).data;
    expect([detail.status, detail.cancel_reason]).toEqual(['CANCELLED', 'Mission reportée']);
  });
});
