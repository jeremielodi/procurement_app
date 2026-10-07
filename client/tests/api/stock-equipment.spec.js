import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Équipements suivis par n° de série (ordinateurs…) affectés aux employés et récupérés à leur départ :
// réception avec n° de série → parc existant → affectation → départ bloqué tant qu'il détient du matériel
// → retour (bon état / perdu, autre dépôt) → réforme, unité endommagée non réaffectable, historique.
test.describe.serial('API › Équipements affectés et retours', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const logistic = { email: `eq.log.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const employee = { email: `eq.emp.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  let admin, logToken, empToken, logisticId, employeeId;
  let wh1, wh2, laptop, paper, po, poLines = {}, grnId, units = [], issue, holdings;
  const S = (n) => `SN-${stamp}-${n}`;

  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const L = () => auth(logToken);
  const balance = async (request, itemId, whId) => {
    const rows = (await (await request.get(`/api/stock/balances?warehouseId=${whId}&stockItemId=${itemId}&includeEmpty=1`, { headers: L() })).json()).data;
    return Number(rows[0]?.quantity ?? 0);
  };
  const unitsOf = async (request, query = '') => (await (await request.get(`/api/stock-units?stockItemId=${laptop.id}${query}`, { headers: L() })).json()).data;

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const H = auth(admin);
    const get = async (u) => (await (await request.get(u, { headers: H })).json()).data;
    const [locations, depts, projects, suppliers, cats] = await Promise.all(
      ['/api/public/locations', '/api/departments', '/api/projects', '/api/suppliers', '/api/public/market-categories'].map(get)
    );
    for (const [account, profile, first] of [[logistic, 'prof_logistic', 'Léa'], [employee, 'prof_requester', 'Eric']]) {
      const created = await request.post('/api/users', { headers: H, data: { username: account.email.split('@')[0], email: account.email, password: account.password, firstName: first, lastName: `Test${stamp}`, profileIds: [profile] } });
      expect(created.status()).toBe(201);
      if (profile === 'prof_logistic') logisticId = (await created.json()).data.id; else employeeId = (await created.json()).data.id;
    }
    logToken = (await (await request.post('/api/auth/login', { data: logistic })).json()).data.token;
    empToken = (await (await request.post('/api/auth/login', { data: employee })).json()).data.token;
    const loc = locations.find(l => l.code === 'KINSHASA');
    wh1 = (await (await request.post('/api/warehouses', { headers: H, data: { code: `EQ1-${stamp}`.slice(0, 30), name: `Magasin IT ${stamp}`, locationId: loc.id } })).json()).data;
    wh2 = (await (await request.post('/api/warehouses', { headers: H, data: { code: `EQ2-${stamp}`.slice(0, 30), name: `Bureau RH ${stamp}`, locationId: loc.id } })).json()).data;
    for (const w of [wh1, wh2]) await request.put(`/api/warehouses/${w.id}/users`, { headers: H, data: { userIds: [logisticId] } });

    let r = await json(await request.post('/api/stock-items', { headers: H, data: { code: `LAP-${stamp}`, name: 'Ordinateur portable', unit: 'pce', categoryId: cats.find(c => c.code === 'IT_EQUIPMENT').id, trackSerials: true } }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    laptop = r.body.data;
    paper = (await (await request.post('/api/stock-items', { headers: H, data: { code: `PAP-${stamp}`, name: 'Rame A4', unit: 'rame', categoryId: cats.find(c => c.code === 'OFFICE_SUPPLIES').id } })).json()).data;

    const req = (await (await request.post('/api/requisitions', { headers: H, data: {
      title: `[TEST EQUIPEMENTS] ${stamp}`, description: 'x', departmentId: depts[0].id, projectId: projects[0]?.id, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'x',
      items: [{ description: 'Ordinateur portable', quantity: 3, frequency: 1, unitPrice: 900, stockItemId: laptop.id }, { description: 'Rame A4', quantity: 50, frequency: 1, unitPrice: 6, stockItemId: paper.id }],
    } })).json()).data;
    const detail = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data;
    po = (await (await request.post('/api/purchase-orders', { headers: H, data: {
      requisitionId: req.id, supplierId: suppliers[0].id, currency: 'USD', totalAmount: 3000,
      items: detail.items.map(i => ({ description: i.item_description, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), stockItemId: i.stock_item_id, requisitionItemId: i.id })),
    } })).json()).data;
    const items = (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: H })).json()).data.items;
    poLines.laptop = items.find(i => i.stock_item_id === laptop.id);
    poLines.paper = items.find(i => i.stock_item_id === paper.id);
  });

  test('Catalogue : n° de série incompatible avec le suivi par lot', async ({ request }) => {
    const r = await request.post('/api/stock-items', { headers: auth(admin), data: { code: `BAD-${stamp}`, name: 'x', unit: 'pce', trackSerials: true, trackLots: true } });
    expect(r.status()).toBe(400);
  });

  test('Réception : un n° de série par unité acceptée, sans doublon', async ({ request }) => {
    const post = (serials) => request.post('/api/goods-receipts', { headers: L(), data: { poId: po.id, warehouseId: wh1.id, grnItems: [
      { poItemId: poLines.laptop.id, quantity_received: 3, quantity_accepted: 3, quantity_rejected: 0, serials },
      { poItemId: poLines.paper.id, quantity_received: 50, quantity_accepted: 50, quantity_rejected: 0 },
    ] } });
    let r = await json(await post([S(1), S(2)]));
    expect([r.status, r.body.code]).toEqual([400, 'SERIALS_REQUIRED']);
    r = await json(await post([S(1), S(2), S(1).toLowerCase()]));
    expect(r.body.code).toBe('SERIAL_DUPLICATE');
    r = await json(await post([S(1), { serialNumber: S(2), assetTag: `INV-${stamp}-2` }, S(3)]));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    grnId = r.body.data.id;
    expect(r.body.data.stockMovements).toBe(4); // 3 unités + 1 ligne de papier
    const detail = (await (await request.get(`/api/goods-receipts/${grnId}`, { headers: L() })).json()).data;
    expect(detail.items.find(i => i.po_item_id === poLines.laptop.id).serials).toEqual([S(1), S(2), S(3)]);
    units = await unitsOf(request);
    expect(units.map(u => [u.serial_number, u.status, u.warehouse_id])).toEqual([[S(1), 'IN_STOCK', wh1.id], [S(2), 'IN_STOCK', wh1.id], [S(3), 'IN_STOCK', wh1.id]]);
  });

  test('Parc existant : enregistrement de n° de série (OPENING)', async ({ request }) => {
    let r = await json(await request.post('/api/stock-units/register', { headers: L(), data: { stockItemId: laptop.id, warehouseId: wh1.id, units: [{ serialNumber: S(4) }, { serialNumber: S(1) }] } }));
    expect(r.body.code).toBe('SERIAL_EXISTS');
    r = await json(await request.post('/api/stock-units/register', { headers: L(), data: { stockItemId: laptop.id, warehouseId: wh1.id, units: [{ serialNumber: S(4) }, { serialNumber: S(5), assetTag: `INV-${stamp}-5` }] } }));
    expect([r.status, r.body.data.created]).toEqual([201, 2]);
    expect(await balance(request, laptop.id, wh1.id)).toBe(5);
    units = await unitsOf(request);
  });

  test('Affectation : unités précises au salarié', async ({ request }) => {
    const u = (n) => units.find(x => x.serial_number === S(n)).id;
    const post = (lines) => request.post('/api/stock-issues', { headers: L(), data: { warehouseId: wh1.id, recipientId: employeeId, purpose: 'Dotation', lines } });
    let r = await json(await post([{ stockItemId: laptop.id, quantity: 1 }]));
    expect(r.body.code).toBe('UNITS_REQUIRED');
    r = await json(await post([{ stockItemId: laptop.id, unitIds: [u(1), u(2)] }, { stockItemId: paper.id, quantity: 10 }]));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    issue = r.body.data;
    r = await json(await post([{ stockItemId: laptop.id, unitIds: [u(1)] }]));
    expect(r.body.code).toBe('UNIT_UNAVAILABLE'); // déjà affectée
    const assigned = await unitsOf(request, `&holderId=${employeeId}`);
    expect(assigned.map(x => [x.serial_number, x.status, x.holder_name])).toEqual([[S(1), 'ASSIGNED', `Eric Test${stamp}`], [S(2), 'ASSIGNED', `Eric Test${stamp}`]]);
    expect(await balance(request, laptop.id, wh1.id)).toBe(3);
    holdings = (await (await request.get('/api/stock-holdings/mine', { headers: auth(empToken) })).json()).data;
    expect(holdings.map(h => h.serial_number || h.item_code)).toEqual([S(1), S(2), paper.code]);
  });

  test('Départ : désactivation refusée tant que le salarié détient des équipements', async ({ request }) => {
    const r = await json(await request.patch(`/api/users/${employeeId}/toggle-active`, { headers: auth(admin), data: { isActive: false } }));
    expect([r.status, r.body.code, r.body.data.length]).toEqual([409, 'HOLDS_EQUIPMENT', 2]);
  });

  test('Retour : bon état dans un autre dépôt, perdu, consommable partiel', async ({ request }) => {
    const line = (serialOrCode) => holdings.find(h => h.serial_number === serialOrCode || h.item_code === serialOrCode).issue_line_id;
    const post = (data) => request.post('/api/stock-returns', { headers: L(), data: { warehouseId: wh2.id, returnedBy: employeeId, ...data } });
    let r = await json(await post({ lines: [{ issueLineId: line(paper.code), quantity: 11, condition: 'GOOD' }] }));
    expect([r.body.code, r.body.remaining]).toEqual(['OVER_RETURN', 10]);
    r = await json(await post({ returnedBy: logisticId, lines: [{ issueLineId: line(S(1)), condition: 'GOOD' }] }));
    expect(r.body.code).toBe('NOT_HOLDER');
    r = await json(await post({ comment: 'Départ de l\'entreprise', lines: [
      { issueLineId: line(S(1)), condition: 'GOOD' },
      { issueLineId: line(S(2)), condition: 'LOST' },
      { issueLineId: line(paper.code), quantity: 4, condition: 'GOOD' },
    ] }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.returnNumber).toMatch(/^RET-\d{4}-\d{5}$/);
    const ret = (await (await request.get(`/api/stock-returns/${r.body.data.id}`, { headers: L() })).json()).data;
    expect(ret.lines.map(l => [l.serial_number || l.item_code, l.condition, l.quantity, !!l.movement_number]).sort()).toEqual([
      [S(1), 'GOOD', 1, true], [S(2), 'LOST', 1, false], [paper.code, 'GOOD', 4, true],
    ].sort());

    const all = await unitsOf(request);
    const by = (n) => all.find(x => x.serial_number === S(n));
    expect([by(1).status, by(1).warehouse_id, by(1).holder_id]).toEqual(['IN_STOCK', wh2.id, null]);
    expect(by(2).status).toBe('LOST');
    expect(await balance(request, laptop.id, wh2.id)).toBe(1);
    expect(await balance(request, paper.id, wh2.id)).toBe(4);
    const left = (await (await request.get('/api/stock-holdings/mine', { headers: auth(empToken) })).json()).data;
    expect(left.map(h => [h.item_code, h.remaining])).toEqual([[paper.code, 6]]);
  });

  test('Annulation d\'un bon déjà partiellement rendu : refusée', async ({ request }) => {
    const r = await json(await request.post(`/api/stock-issues/${issue.id}/cancel`, { headers: L(), data: { reason: 'x' } }));
    expect([r.status, r.body.code]).toEqual([409, 'HAS_RETURNS']);
  });

  test('Plus d\'équipement détenu : le compte peut être désactivé', async ({ request }) => {
    const r = await request.patch(`/api/users/${employeeId}/toggle-active`, { headers: auth(admin), data: { isActive: false } });
    expect(r.status()).toBe(200);
    await request.patch(`/api/users/${employeeId}/toggle-active`, { headers: auth(admin), data: { isActive: true } });
  });

  test('Unité endommagée non réaffectable ; réforme ; historique', async ({ request }) => {
    const all = await unitsOf(request);
    const u3 = all.find(x => x.serial_number === S(3));
    let r = await json(await request.put(`/api/stock-units/${u3.id}`, { headers: L(), data: { condition: 'DAMAGED', notes: 'Écran fissuré' } }));
    expect([r.status, r.body.data.condition]).toEqual([200, 'DAMAGED']);
    r = await json(await request.post('/api/stock-issues', { headers: L(), data: { warehouseId: wh1.id, recipientId: employeeId, lines: [{ stockItemId: laptop.id, unitIds: [u3.id] }] } }));
    expect(r.body.code).toBe('UNIT_UNAVAILABLE');
    r = await json(await request.put(`/api/stock-units/${u3.id}`, { headers: L(), data: { retire: true, reason: 'Irréparable' } }));
    expect(r.body.data.status).toBe('RETIRED');
    expect(await balance(request, laptop.id, wh1.id)).toBe(2); // 5 − 2 affectés − 1 réformé

    const u1 = all.find(x => x.serial_number === S(1));
    const hist = (await (await request.get(`/api/stock-units/${u1.id}`, { headers: L() })).json()).data.history;
    expect(hist.map(h => h.movement_type).sort()).toEqual(['ISSUE', 'RECEIPT', 'RETURN']);
  });

  test('Annulation du GRN refusée : des équipements reçus ne sont plus en stock', async ({ request }) => {
    const r = await json(await request.post(`/api/goods-receipts/${grnId}/cancel`, { headers: auth(admin), data: { reason: 'x' } }));
    expect([r.status, r.body.code]).toEqual([409, 'STOCK_INSUFFICIENT']);
  });

  test('Droits : le salarié voit ce qu\'il détient, pas le parc', async ({ request }) => {
    const H = auth(empToken);
    expect((await request.get('/api/stock-units', { headers: H })).status()).toBe(403);
    expect((await request.post('/api/stock-returns', { headers: H, data: {} })).status()).toBe(403);
    expect((await request.get('/api/stock-holdings/mine', { headers: H })).status()).toBe(200);
  });
});
