import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Valorisation au CMUP : réceptions à des prix différents, sortie au coût moyen, transfert neutre,
// article sans coût connu, valorisation à date, répartition par dépôt, export Excel.
test.describe.serial('API › Valorisation du stock (CMUP)', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let admin, whA, whB, fuel, misc, dept, project, supplier, requester;
  const H = () => auth(admin);
  const today = () => new Date().toISOString().slice(0, 10);

  async function receive(request, quantity, unitPrice) {
    const req = (await (await request.post('/api/requisitions', { headers: H(), data: {
      title: `[TEST CMUP] ${stamp}`, description: 'x', departmentId: dept.id, projectId: project?.id, currencyId: 1, currencyCode: 'USD',
      priority: 'LOW', justification: 'x', items: [{ description: fuel.name, quantity, frequency: 1, unitPrice, stockItemId: fuel.id }],
    } })).json()).data;
    const detail = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data;
    const po = (await (await request.post('/api/purchase-orders', { headers: H(), data: {
      requisitionId: req.id, supplierId: supplier.id, currency: 'USD', totalAmount: quantity * unitPrice,
      items: detail.items.map(i => ({ description: i.item_description, quantity, unitPrice, stockItemId: fuel.id, requisitionItemId: i.id })),
    } })).json()).data;
    const poItem = (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: H() })).json()).data.items[0];
    const grn = await request.post('/api/goods-receipts', { headers: H(), data: { poId: po.id, warehouseId: whA.id, grnItems: [{ poItemId: poItem.id, quantity_received: quantity, quantity_accepted: quantity, quantity_rejected: 0 }] } });
    expect(grn.status(), JSON.stringify(await grn.json())).toBe(201);
  }
  const valuation = async (request, query = '') => (await (await request.get(`/api/stock/valuation${query}`, { headers: H() })).json()).data;
  const line = (data, item) => data.items.find(r => r.stock_item_id === item.id);

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const get = async (u) => (await (await request.get(u, { headers: H() })).json()).data;
    const [locations, depts, projects, suppliers, cats] = await Promise.all(['/api/public/locations', '/api/departments', '/api/projects', '/api/suppliers?all=1', '/api/public/market-categories'].map(get));
    [dept] = depts; [project] = projects; [supplier] = suppliers;
    whA = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `VA-${stamp}`.slice(0, 30), name: `Dépôt CMUP A ${stamp}`, locationId: locations[0].id } })).json()).data;
    whB = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `VB-${stamp}`.slice(0, 30), name: `Dépôt CMUP B ${stamp}`, locationId: locations[0].id } })).json()).data;
    fuel = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `VF-${stamp}`, name: `Gasoil CMUP ${stamp}`, unit: 'L', categoryId: cats.find(c => c.code === 'FUEL').id } })).json()).data;
    misc = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `VM-${stamp}`, name: `Divers CMUP ${stamp}`, unit: 'pce', categoryId: cats.find(c => c.code === 'FUEL').id } })).json()).data;
    requester = (await get('/api/auth/profile')).id;
  });

  test('Réception 100 × 2, sortie 40, réception 60 × 3 → CMUP 2,5 et valeur 300', async ({ request }) => {
    await receive(request, 100, 2);
    let v = line(await valuation(request), fuel);
    expect([v.quantity, v.average_cost, v.value, v.currency, v.status]).toEqual([100, 2, 200, 'USD', 'VALUED']);

    const issue = await request.post('/api/stock-issues', { headers: H(), data: { destinationType: 'USER', warehouseId: whA.id, recipientId: requester, lines: [{ stockItemId: fuel.id, quantity: 40 }] } });
    expect(issue.status()).toBe(201);
    v = line(await valuation(request), fuel);
    expect([v.quantity, v.average_cost, v.value]).toEqual([60, 2, 120]);

    await receive(request, 60, 3);
    v = line(await valuation(request), fuel);
    expect([v.quantity, v.average_cost, v.value]).toEqual([120, 2.5, 300]);
  });

  test('Transfert entre dépôts : CMUP inchangé ; répartition par dépôt', async ({ request }) => {
    const tr = await request.post('/api/stock-issues', { headers: H(), data: { destinationType: 'WAREHOUSE', warehouseId: whA.id, destinationWarehouseId: whB.id, lines: [{ stockItemId: fuel.id, quantity: 20 }] } });
    expect(tr.status()).toBe(201);
    // En transit : compté dans le total de l'entreprise, dans aucun dépôt
    expect(line(await valuation(request), fuel)).toMatchObject({ quantity: 120, average_cost: 2.5, value: 300 });
    expect(line(await valuation(request, `?warehouseId=${whB.id}`), fuel)).toBeUndefined();
    expect((await request.post(`/api/stock-issues/${(await tr.json()).data.id}/acknowledge`, { headers: H(), data: {} })).status()).toBe(200);
    expect(line(await valuation(request), fuel)).toMatchObject({ quantity: 120, average_cost: 2.5, value: 300 });
    expect(line(await valuation(request, `?warehouseId=${whB.id}`), fuel)).toMatchObject({ quantity: 20, value: 50 });
    expect(line(await valuation(request, `?warehouseId=${whA.id}`), fuel)).toMatchObject({ quantity: 100, value: 250 });
  });

  test('Article sans coût connu (ajustement) : non valorisé ; valorisation à une date passée', async ({ request }) => {
    await request.post('/api/stock-adjustments', { headers: H(), data: { warehouseId: whA.id, stockItemId: misc.id, quantity: 7, reason: 'FOUND', comment: 'Stock initial' } });
    const data = await valuation(request);
    expect(line(data, misc)).toMatchObject({ quantity: 7, value: null, status: 'NO_COST' });
    expect(data.notValued).toBeGreaterThanOrEqual(1);
    expect(data.totals.find(tot => tot.currency === 'USD').value).toBeGreaterThanOrEqual(300);
    const past = await valuation(request, '?asOf=2000-01-01');
    expect(line(past, fuel)).toBeUndefined();
    expect(line(await valuation(request, `?asOf=${today()}`), fuel)).toMatchObject({ value: 300 });
  });

  test('Export Excel', async ({ request }) => {
    const res = await request.get('/api/stock/valuation/export?lang=fr', { headers: H() });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('spreadsheetml');
    expect((await res.body()).subarray(0, 2).toString()).toBe('PK');
  });
});
