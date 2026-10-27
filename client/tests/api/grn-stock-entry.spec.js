import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Entrée en stock APRÈS la réception : une ligne de GRN en texte libre (non liée au catalogue, donc hors stock)
// est rattachée ensuite à un article stockable → mouvement RECEIPT de la quantité acceptée, au prix du PO,
// dans le dépôt de la réception (un GRN = un seul dépôt), lien reporté sur la ligne de PO ; annulation du GRN = reprise.
const future = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);

test.describe.serial('API › GRN : entrée en stock après la réception', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const logistic = { email: `grnstock.log.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const requester = { email: `grnstock.req.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  let admin, logisticToken, requesterToken, logisticId;
  let w1, w2, items = {}, refs = {};
  let po, grn, lines = {};

  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const asAdmin = () => auth(admin);
  const asLogistic = () => auth(logisticToken);
  const entry = (request, line, data, headers = asLogistic()) =>
    request.post(`/api/goods-receipts/${grn.id}/items/${line.id}/stock-entry`, { headers, data });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const [locations, depts, projects, suppliers, cats] = await Promise.all(
      ['/api/public/locations', '/api/departments', '/api/projects', '/api/suppliers', '/api/public/market-categories']
        .map(async (u) => (await (await request.get(u, { headers: asAdmin() })).json()).data)
    );
    const cat = (code) => cats.find(c => c.code === code)?.id;
    refs = { dept: depts[0], project: projects[0], supplier: suppliers[0] };
    const goma = locations.find(l => l.code === 'GOMA') || locations[0];

    for (const [account, profile] of [[logistic, 'prof_logistic'], [requester, 'prof_requester']]) {
      const created = await request.post('/api/users', {
        headers: asAdmin(),
        data: { username: account.email.split('@')[0], email: account.email, password: account.password, firstName: 'Test', lastName: profile, profileIds: [profile], allProjectsProfileIds: [profile] },
      });
      expect(created.status(), `création ${profile}`).toBe(201);
      if (profile === 'prof_logistic') logisticId = (await created.json()).data.id;
    }
    logisticToken = (await (await request.post('/api/auth/login', { data: logistic })).json()).data.token;
    requesterToken = (await (await request.post('/api/auth/login', { data: requester })).json()).data.token;

    w1 = (await (await request.post('/api/warehouses', { headers: asAdmin(), data: { code: `GSE1-${stamp}`.slice(0, 30), name: 'Dépôt GSE 1', locationId: goma.id } })).json()).data;
    w2 = (await (await request.post('/api/warehouses', { headers: asAdmin(), data: { code: `GSE2-${stamp}`.slice(0, 30), name: 'Dépôt GSE 2', locationId: goma.id } })).json()).data;
    await request.put(`/api/warehouses/${w1.id}/users`, { headers: asAdmin(), data: { userIds: [logisticId] } });

    const createItem = async (data) => (await (await request.post('/api/stock-items', { headers: asAdmin(), data })).json()).data;
    items.fuel = await createItem({ code: `GSE-FUEL-${stamp}`, name: 'Gasoil GSE', unit: 'L', categoryId: cat('FUEL') });
    items.med = await createItem({ code: `GSE-MED-${stamp}`, name: 'Antipaludéen GSE', unit: 'boîte', categoryId: cat('MEDICAL_SUPPLIES'), trackLots: true, trackExpiry: true });
    items.laptop = await createItem({ code: `GSE-LAP-${stamp}`, name: 'Portable GSE', unit: 'pce', categoryId: cat('IT_EQUIPMENT'), trackSerials: true });
    items.hotel = await createItem({ code: `GSE-HOT-${stamp}`, name: 'Nuitée GSE', unit: 'nuit', categoryId: cat('HOTEL') });
    expect([items.fuel.is_stockable, items.hotel.is_stockable]).toEqual([true, false]);
  });

  test('Commande en texte libre puis réception : rien n\'entre en stock', async ({ request }) => {
    test.skip(!refs.dept || !refs.supplier, 'Département / fournisseur requis');
    const req = await json(await request.post('/api/requisitions', {
      headers: asAdmin(),
      data: {
        title: `[TEST GRN STOCK] ${stamp}`, description: 'Entrée en stock après réception', departmentId: refs.dept.id, projectId: refs.project?.id,
        currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'Test',
        items: [
          { description: `Carburant ${stamp}`, quantity: 40, frequency: 1, unitPrice: 1.5 },
          { description: `Médicaments ${stamp}`, quantity: 10, frequency: 1, unitPrice: 3 },
          { description: `Ordinateurs ${stamp}`, quantity: 2, frequency: 1, unitPrice: 800 },
          { description: `Pièces ${stamp}`, quantity: 2, frequency: 1, unitPrice: 5 },
        ],
      },
    }));
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const detail = (await (await request.get(`/api/requisitions/${req.body.data.id}`, { headers: asAdmin() })).json()).data;
    const created = await json(await request.post('/api/purchase-orders', {
      headers: asAdmin(),
      data: {
        requisitionId: detail.id, supplierId: refs.supplier.id, currency: 'USD', totalAmount: 1690,
        items: detail.items.map(i => ({ description: i.item_description, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), requisitionItemId: i.id })),
      },
    }));
    test.skip(created.status >= 300, `PO non créé (GoFlow requis ?) : ${JSON.stringify(created.body)}`);
    po = (await (await request.get(`/api/purchase-orders/${created.body.data.id}`, { headers: asAdmin() })).json()).data;
    const byName = (prefix) => po.items.find(i => i.item_description.startsWith(prefix));

    const r = await json(await request.post('/api/goods-receipts', {
      headers: asLogistic(),
      data: {
        poId: po.id,
        grnItems: [
          { poItemId: byName('Carburant').id, quantity_received: 40, quantity_accepted: 30, quantity_rejected: 10, rejection_reason: 'Fûts percés' },
          { poItemId: byName('Médicaments').id, quantity_received: 10, quantity_accepted: 10, quantity_rejected: 0 },
          { poItemId: byName('Ordinateurs').id, quantity_received: 2, quantity_accepted: 2, quantity_rejected: 0 },
          { poItemId: byName('Pièces').id, quantity_received: 2, quantity_accepted: 0, quantity_rejected: 2, rejection_reason: 'Cassées' },
        ],
      },
    }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.body.data.stockMovements, r.body.data.warehouseId]).toEqual([0, null]);
    grn = (await (await request.get(`/api/goods-receipts/${r.body.data.id}`, { headers: asLogistic() })).json()).data;
    for (const key of ['Carburant', 'Médicaments', 'Ordinateurs', 'Pièces']) {
      lines[key] = grn.items.find(i => i.item_description.startsWith(key));
      expect(lines[key].stock_item_id).toBeNull();
    }
  });

  test('Contrôles : permission, article, stockable, lot, n° de série, quantité acceptée', async ({ request }) => {
    test.skip(!grn);
    let r = await json(await entry(request, lines.Carburant, { stockItemId: items.fuel.id }, auth(requesterToken)));
    expect(r.status).toBe(403);
    r = await json(await entry(request, lines.Carburant, {}));
    expect([r.status, r.body.code]).toEqual([400, 'ITEM_REQUIRED']);
    r = await json(await entry(request, lines.Carburant, { stockItemId: items.hotel.id }));
    expect(r.body.code).toBe('ITEM_NOT_STOCKABLE');
    r = await json(await entry(request, lines.Médicaments, { stockItemId: items.med.id }));
    expect(r.body.code).toBe('LOT_REQUIRED');
    r = await json(await entry(request, lines.Médicaments, { stockItemId: items.med.id, lotNumber: 'OLD', expiryDate: '2020-01-01' }));
    expect(r.body.code).toBe('LOT_EXPIRED');
    r = await json(await entry(request, lines.Ordinateurs, { stockItemId: items.laptop.id, serials: ['SN-1'] }));
    expect(r.body.code).toBe('SERIALS_REQUIRED');
    r = await json(await entry(request, lines.Pièces, { stockItemId: items.fuel.id }));
    expect(r.body.code).toBe('NOTHING_ACCEPTED');
    r = await json(await entry(request, { id: 999999 }, { stockItemId: items.fuel.id }));
    expect([r.status, r.body.code]).toEqual([404, 'GRN_ITEM_NOT_FOUND']);
    // Rien n'a été écrit
    const mv = (await (await request.get(`/api/stock/movements?sourceType=GRN&sourceId=${grn.id}`, { headers: asAdmin() })).json()).data;
    expect(mv).toEqual([]);
  });

  test('Entrée de l\'accepté au prix du PO, dans le dépôt de l\'utilisateur, lien reporté sur la commande', async ({ request }) => {
    test.skip(!grn);
    const r = await json(await entry(request, lines.Carburant, { stockItemId: items.fuel.id }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ quantity: 30, warehouseId: w1.id, stockMovements: 1, stockItemCode: items.fuel.code });

    const balances = (await (await request.get(`/api/stock/balances?warehouseId=${w1.id}`, { headers: asAdmin() })).json()).data;
    expect(Number(balances.find(b => b.stock_item_id === items.fuel.id).quantity)).toBe(30);
    const mv = (await (await request.get(`/api/stock/movements?sourceType=GRN&sourceId=${grn.id}`, { headers: asAdmin() })).json()).data;
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ movement_type: 'RECEIPT', grn_number: grn.grn_number, project_id: refs.project?.id ?? null });
    expect(Number(mv[0].unit_cost)).toBe(1.5);

    const detail = (await (await request.get(`/api/goods-receipts/${grn.id}`, { headers: asAdmin() })).json()).data;
    expect(detail.warehouse_id).toBe(w1.id); // le dépôt devient celui de la réception
    const line = detail.items.find(i => i.id === lines.Carburant.id);
    expect([line.stock_item_id, line.movement_number]).toEqual([items.fuel.id, mv[0].movement_number]);
    const order = (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: asAdmin() })).json()).data;
    expect(order.items.find(i => i.id === lines.Carburant.po_item_id).stock_item_id).toBe(items.fuel.id);

    const again = await json(await entry(request, lines.Carburant, { stockItemId: items.fuel.id }));
    expect([again.status, again.body.code]).toEqual([409, 'ALREADY_IN_STOCK']);
  });

  test('Un seul dépôt par réception ; lots et n° de série', async ({ request }) => {
    test.skip(!grn);
    let r = await json(await entry(request, lines.Médicaments, { stockItemId: items.med.id, lotNumber: `L-${stamp}`, expiryDate: future(300), warehouseId: w2.id }, asAdmin()));
    expect([r.status, r.body.code]).toEqual([400, 'WAREHOUSE_MISMATCH']);
    r = await json(await entry(request, lines.Médicaments, { stockItemId: items.med.id, lotNumber: `L-${stamp}`, expiryDate: future(300) }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await json(await entry(request, lines.Ordinateurs, { stockItemId: items.laptop.id, serials: [`SN-A-${stamp}`, { serialNumber: `SN-B-${stamp}`, assetTag: `INV-${stamp}` }] }));
    expect([r.status, r.body.data?.stockMovements]).toEqual([200, 2]);

    const detail = (await (await request.get(`/api/goods-receipts/${grn.id}`, { headers: asAdmin() })).json()).data;
    expect(detail.items.find(i => i.id === lines.Médicaments.id).lot_number).toBe(`L-${stamp}`);
    expect(detail.items.find(i => i.id === lines.Ordinateurs.id).serials).toEqual([`SN-A-${stamp}`, `SN-B-${stamp}`]);
    const units = (await (await request.get(`/api/stock-units?stockItemId=${items.laptop.id}`, { headers: asAdmin() })).json()).data;
    expect(units.map(u => u.status)).toEqual(['IN_STOCK', 'IN_STOCK']);
    // N° d'inventaire envoyé ignoré : attribué automatiquement à chaque unité
    expect(units.map(u => u.asset_tag)).not.toContain(`INV-${stamp}`);
    for (const u of units) expect(u.asset_tag).toMatch(/^INV-\d{4}-\d{5}$/);
  });

  test('Annulation du GRN : les entrées faites après coup sont reprises ; plus d\'entrée possible', async ({ request }) => {
    test.skip(!grn);
    const r = await json(await request.post(`/api/goods-receipts/${grn.id}/cancel`, { headers: asAdmin(), data: { reason: 'Test' } }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.reversedMovements).toBe(4); // carburant + médicaments + 2 ordinateurs
    const balances = (await (await request.get(`/api/stock/balances?warehouseId=${w1.id}`, { headers: asAdmin() })).json()).data;
    expect(balances.filter(b => [items.fuel.id, items.med.id, items.laptop.id].includes(b.stock_item_id))).toEqual([]);
    const late = await json(await entry(request, lines.Pièces, { stockItemId: items.fuel.id }));
    expect([late.status, late.body.code]).toEqual([409, 'GRN_CANCELLED']);

    // Journal d'audit : entrées tracées
    const logs = (await (await request.get('/api/audit-logs?action=GOODS_RECEIPT_STOCK_ENTRY&limit=50', { headers: asAdmin() })).json()).data;
    expect(logs.filter(l => l.entity_ref === String(grn.id) || l.new_value?._label === grn.grn_number).length).toBeGreaterThanOrEqual(3);
  });
});
