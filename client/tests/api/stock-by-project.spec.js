import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// État du stock par projet (migration 29_stock_balances_by_project.sql) : solde article × dépôt × lot × projet.
//  - sortie avec un projet : stock de ce projet puis stock sans projet, jamais celui d'un autre projet
//  - sortie sans projet : stock sans projet d'abord, puis les projets
//  - transferts, annulations, inventaires, ajustements de sortie : chaque écriture garde le projet du stock touché
test.describe.serial('API › Stock — état par projet', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let admin, me, whA, whB, projectA, projectB, rice;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  // { codeProjet | 'none': quantité } des soldes non nuls d'un dépôt pour l'article
  const byProject = async (request, warehouse, query = '') => {
    const rows = (await (await request.get(`/api/stock/balances?warehouseId=${warehouse.id}&stockItemId=${rice.id}${query}`, { headers: H() })).json()).data;
    return Object.fromEntries(rows.filter(r => Number(r.quantity) > 0).map(r => [r.project_code || 'none', Number(r.quantity)]));
  };

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    me = (await (await request.get('/api/auth/profile', { headers: H() })).json()).data;
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    const mkProject = async (code) => (await (await request.post('/api/projects/', { headers: H(), data: { code, name: `Projet ${code}` } })).json()).data;
    projectA = await mkProject(`SPA-${stamp}`);
    projectB = await mkProject(`SPB-${stamp}`);
    const mkWarehouse = async (suffix) => (await (await request.post('/api/warehouses', { headers: H(), data: { code: `SP${suffix}-${stamp}`.slice(0, 30), name: `Dépôt projets ${suffix} ${stamp}`, locationId: locations[0].id } })).json()).data;
    whA = await mkWarehouse('A');
    whB = await mkWarehouse('B');
    rice = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `SP-RIZ-${stamp}`, name: 'Riz (sac 25 kg)', unit: 'sac', categoryId: (cats.find(c => c.is_stockable) || cats[0]).id } })).json()).data;
    expect(me?.id && projectA?.id && projectB?.id && whA?.id && whB?.id && rice?.id).toBeTruthy();
    for (const [quantity, projectId] of [[10, projectA.id], [6, projectB.id], [4, undefined]]) {
      const r = await json(await request.post('/api/stock-adjustments', { headers: H(), data: { warehouseId: whA.id, stockItemId: rice.id, quantity, reason: 'FOUND', comment: 'Stock initial', projectId } }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
  });

  test('Soldes par projet, filtres projet / sans projet, valorisation par projet', async ({ request }) => {
    expect(await byProject(request, whA)).toEqual({ [projectA.code]: 10, [projectB.code]: 6, none: 4 });
    expect(await byProject(request, whA, `&projectId=${projectB.id}`)).toEqual({ [projectB.code]: 6 });
    expect(await byProject(request, whA, '&projectId=none')).toEqual({ none: 4 });
    const rows = (await (await request.get(`/api/stock/balances?stockItemId=${rice.id}&projectId=${projectA.id}`, { headers: H() })).json()).data;
    expect(rows.map(r => [r.project_id, r.project_name])).toEqual([[projectA.id, projectA.name]]);

    const valuation = (await (await request.get(`/api/stock/valuation?projectId=${projectA.id}`, { headers: H() })).json()).data;
    expect(valuation.items.find(i => i.stock_item_id === rice.id)?.quantity).toBe(10);
    const asOf = await json(await request.get(`/api/stock/valuation?projectId=${projectA.id}&asOf=2026-01-01`, { headers: H() }));
    expect([asOf.status, asOf.body.code]).toEqual([400, 'PROJECT_AS_OF_UNSUPPORTED']);
    const exported = await request.get(`/api/stock/balances/export?stockItemId=${rice.id}`, { headers: H() });
    expect(exported.status()).toBe(200);
  });

  let issue;
  test('Sortie pour un projet : son stock puis le stock sans projet, jamais un autre projet ; annulation par projet', async ({ request }) => {
    const send = (data) => request.post('/api/stock-issues', { headers: H(), data: { warehouseId: whA.id, recipientId: me.id, purpose: 'Distribution', ...data } }).then(json);
    const r = await send({ projectId: projectA.id, lines: [{ stockItemId: rice.id, quantity: 12 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    issue = (await (await request.get(`/api/stock-issues/${r.body.data.id}`, { headers: H() })).json()).data;
    expect(Object.fromEntries(issue.lines.map(l => [l.project_code || 'none', l.quantity]))).toEqual({ [projectA.code]: 10, none: 2 });
    expect(await byProject(request, whA)).toEqual({ [projectB.code]: 6, none: 2 });

    // Le stock du projet B n'est jamais pris pour le projet A
    const short = await send({ projectId: projectA.id, lines: [{ stockItemId: rice.id, quantity: 5 }] });
    expect([short.status, short.body.code, short.body.details?.available ?? short.body.available]).toEqual([400, 'STOCK_INSUFFICIENT', 2]);

    const cancel = await json(await request.post(`/api/stock-issues/${issue.id}/cancel`, { headers: H(), data: { reason: 'Erreur de saisie' } }));
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(await byProject(request, whA)).toEqual({ [projectA.code]: 10, [projectB.code]: 6, none: 4 });
  });

  test('Transfert sans projet : stock sans projet d\'abord ; le projet suit la marchandise au dépôt de destination', async ({ request }) => {
    const r = await json(await request.post('/api/stock-issues', { headers: H(), data: {
      destinationType: 'WAREHOUSE', warehouseId: whA.id, destinationWarehouseId: whB.id, lines: [{ stockItemId: rice.id, quantity: 18 }],
    } }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await byProject(request, whA)).toEqual({ [projectB.code]: 2 });
    expect(await byProject(request, whB)).toEqual({});
    const received = await json(await request.post(`/api/stock-issues/${r.body.data.id}/receive`, { headers: H(), data: {} }));
    expect(received.status, JSON.stringify(received.body)).toBe(200);
    expect(await byProject(request, whB)).toEqual({ [projectA.code]: 10, [projectB.code]: 4, none: 4 });
  });

  test('Ajustement de sortie : stock d\'un projet, stock sans projet ou réparti', async ({ request }) => {
    const out = (data) => request.post('/api/stock-adjustments', { headers: H(), data: { warehouseId: whA.id, stockItemId: rice.id, reason: 'DAMAGE', comment: 'Sacs abîmés', ...data } }).then(json);
    const none = await out({ quantity: -1, projectId: 'none' });
    expect([none.status, none.body.code]).toEqual([409, 'STOCK_INSUFFICIENT']);
    expect((await out({ quantity: -2, projectId: projectA.id })).body.code).toBe('STOCK_INSUFFICIENT');
    expect((await out({ quantity: -2, projectId: projectB.id })).status).toBe(201);
    expect(await byProject(request, whA)).toEqual({});
  });

  test('Inventaire : attendu = total de l\'article, manque pris sur le stock sans projet d\'abord', async ({ request }) => {
    const opened = await json(await request.post('/api/stock-counts', { headers: H(), data: { warehouseId: whB.id } }));
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    const count = (await (await request.get(`/api/stock-counts/${opened.body.data.id}`, { headers: H() })).json()).data;
    const lines = count.lines.filter(l => l.item_code === rice.code);
    expect(lines.map(l => Number(l.expected_quantity))).toEqual([18]);
    expect((await request.put(`/api/stock-counts/${count.id}/lines`, { headers: H(), data: { entries: [{ lineId: lines[0].id, countedQuantity: 13 }] } })).status()).toBe(200);
    const validated = await json(await request.post(`/api/stock-counts/${count.id}/validate`, { headers: H() }));
    expect(validated.status, JSON.stringify(validated.body)).toBe(200);
    // Manque de 5 : 4 sans projet puis 1 sur le projet le mieux pourvu (A)
    expect(await byProject(request, whB)).toEqual({ [projectA.code]: 9, [projectB.code]: 4 });
    const movements = (await (await request.get(`/api/stock/movements?stockItemId=${rice.id}&sourceType=COUNT&limit=10`, { headers: H() })).json()).data;
    expect(movements.map(m => [Number(m.quantity), m.project_code || null]).sort()).toEqual([[-1, projectA.code], [-4, null]].sort());
  });
});
