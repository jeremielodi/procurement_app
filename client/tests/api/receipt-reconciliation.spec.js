import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth } from './helpers.js';

// Rapprochement « réceptions ↔ stock » (GET /api/stock/receipt-reconciliation[/export]) : chaque ligne de bon de
// réception comparée à ses mouvements de stock. Scénario : article stockable reçu (partiellement accepté), ligne en
// texte libre (non stockée), réception annulée (stock repris) → aucune anomalie, statuts attendus.
test.describe.serial('API › Rapprochement réceptions ↔ stock', () => {
  test.describe.configure({ timeout: 120_000 });
  const stamp = Date.now().toString(36).toUpperCase();
  const auditor = { email: `rr.aud.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const requester = { email: `rr.req.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  let admin, approver, auditorToken, requesterToken, warehouse, item, po, grnA, grnB;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const recon = async (request, query, token = admin) =>
    json(await request.get(`/api/stock/receipt-reconciliation?${query}`, { headers: auth(token) }));

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    approver = await getApproverToken(request);
    for (const [c, profile] of [[auditor, 'prof_auditor'], [requester, 'prof_requester']]) {
      const r = await request.post('/api/users', { headers: H(), data: { username: `rr${profile}${stamp}`.toLowerCase(), email: c.email, password: c.password, firstName: 'RR', lastName: stamp, profileIds: [profile] } });
      expect(r.status(), await r.text()).toBe(201);
    }
    const login = async (c) => (await (await request.post('/api/auth/login', { data: c })).json()).data.token;
    [auditorToken, requesterToken] = await Promise.all([login(auditor), login(requester)]);

    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    warehouse = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `RR-${stamp}`.slice(0, 30), name: `Dépôt rapprochement ${stamp}`, locationId: locations[0].id } })).json()).data;
    item = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `RR-${stamp}`, name: `Gasoil rapprochement ${stamp}`, unit: 'L', categoryId: (cats.find(c => c.code === 'FUEL') || cats[0]).id, isStockable: true, trackLots: false } })).json()).data;
    expect(warehouse?.id && item?.id).toBeTruthy();

    const [dept] = (await (await request.get('/api/departments', { headers: H() })).json()).data;
    const [project] = (await (await request.get('/api/projects', { headers: H() })).json()).data;
    const supplier = (await (await request.get('/api/suppliers?all=1', { headers: H() })).json()).data.find(s => s.status === 'ACTIVE');
    const req = (await (await request.post('/api/requisitions', { headers: H(), data: {
      title: `[TEST RAPPROCHEMENT] ${stamp}`, description: 'x', departmentId: dept.id, projectId: project.id, currencyId: 1, currencyCode: 'USD',
      priority: 'LOW', justification: 'x', items: [{ description: 'Gasoil', quantity: 100, frequency: 1, unitPrice: 1.5, stockItemId: item.id }],
    } })).json()).data;
    po = (await (await request.post('/api/purchase-orders', { headers: H(), data: {
      requisitionId: req.id, supplierId: supplier.id, currency: 'USD', totalAmount: 160, deliveryDate: new Date().toISOString().slice(0, 10),
      items: [{ description: 'Gasoil', quantity: 100, unitPrice: 1.5, stockItemId: item.id }, { description: 'Transport (prestation)', quantity: 1, unitPrice: 10 }],
    } })).json()).data;
    expect((await request.post(`/api/purchase-orders/${po.id}/approve`, { headers: auth(approver), data: {} })).status()).toBe(200);
    const lines = (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: H() })).json()).data.items;
    const fuelLine = lines.find(l => l.stock_item_id === item.id);
    const freeLine = lines.find(l => !l.stock_item_id);
    const grn = async (grnItems) => (await json(await request.post('/api/goods-receipts', { headers: H(), data: { poId: po.id, warehouseId: warehouse.id, grnItems } }))).body.data;
    grnA = await grn([
      { poItemId: fuelLine.id, quantity_received: 60, quantity_accepted: 55, quantity_rejected: 5, rejection_reason: 'Bidons abîmés' },
      { poItemId: freeLine.id, quantity_received: 1, quantity_accepted: 1, quantity_rejected: 0 },
    ]);
    grnB = await grn([{ poItemId: fuelLine.id, quantity_received: 20, quantity_accepted: 20, quantity_rejected: 0 }]);
    expect(grnA?.id && grnB?.id).toBeTruthy();
    expect((await request.post(`/api/goods-receipts/${grnB.id}/cancel`, { headers: H(), data: { reason: 'Erreur de saisie' } })).status()).toBe(200);
  });

  test('Réception d\'un article stockable : accepté = entré, au dépôt et au prix du bon de commande', async ({ request }) => {
    const r = await recon(request, `search=${grnA.grnNumber}`);
    expect(r.status).toBe(200);
    const fuel = r.body.data.rows.find(x => x.item_code === `RR-${stamp}`);
    expect(fuel).toEqual(expect.objectContaining({ status: 'OK', severity: 'ok', accepted: 55, rejected: 5, expected: 55, entered: 55, reversed: 0, warehouse_code: warehouse.code, po_price: 1.5, min_cost: 1.5 }));
    expect(fuel.movement_numbers).toMatch(/^MVT-/);
    const free = r.body.data.rows.find(x => !x.item_code);
    expect([free.status, free.severity, free.entered]).toEqual(['NOT_STOCKABLE', 'info', 0]);
  });

  test('Réception annulée : stock repris par écriture inverse', async ({ request }) => {
    const r = await recon(request, `search=${grnB.grnNumber}`);
    const row = r.body.data.rows[0];
    expect(row).toEqual(expect.objectContaining({ grn_status: 'CANCELLED', status: 'CANCELLED_REVERSED', entered: 20, reversed: 20, net: 0 }));
    expect(row.reversal_numbers).toMatch(/^MVT-/);
  });

  test('Synthèse, filtre « anomalies seulement », dépôt ; export Excel', async ({ request }) => {
    const all = await recon(request, `warehouseId=${warehouse.id}`);
    expect(all.body.data.summary).toEqual(expect.objectContaining({ lines: 3, grns: 2, ok: 1, info: 2, errors: 0 }));
    expect(all.body.data.summary.byCode).toEqual({ OK: 1, NOT_STOCKABLE: 1, CANCELLED_REVERSED: 1 });
    const issues = await recon(request, `warehouseId=${warehouse.id}&onlyIssues=1`);
    expect(issues.body.data.rows).toHaveLength(0);
    const xlsx = await request.get(`/api/stock/receipt-reconciliation/export?warehouseId=${warehouse.id}&lang=fr`, { headers: H() });
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
    expect((await xlsx.body()).subarray(0, 2).toString()).toBe('PK');
  });

  test('Accès : auditeur oui, demandeur non', async ({ request }) => {
    expect((await recon(request, 'onlyIssues=1', auditorToken)).status).toBe(200);
    expect((await recon(request, 'onlyIssues=1', requesterToken)).status).toBe(403);
  });
});
