import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth, waitForProcessTask, PM_APPROVAL, getProcurementAgentId } from './helpers.js';
import rules from '../../../backend/src/utils/stockPlanning.js';

// Prévision du réapprovisionnement (migration 55_stock_planning.sql) :
//  - CMM = sorties (moins annulations et retours) ÷ jours où l'article était disponible × 30,4 (au moins 30 jours)
//  - minimum = CMM × (sécurité + délai), maximum = minimum + CMM × fréquence, à commander = maximum − position
//  - en commande / demandé : réquisitions en cours et bons de commande, par dépôt de destination de la ligne
test.describe('Règles de calcul (utils/stockPlanning)', () => {
  test('Les jours de rupture ne comptent pas dans la CMM', () => {
    const s = rules.consumptionStats({
      openingBalance: 100, hasHistoryBefore: true, periodStart: new Date('2026-01-01T00:00:00Z'), now: new Date('2026-07-01T00:00:00Z'),
      movements: [
        { at: '2026-03-01T00:00:00Z', type: 'ISSUE', quantity: -100 },   // rupture du 1er mars au 1er mai (61 jours)
        { at: '2026-05-01T00:00:00Z', type: 'RECEIPT', quantity: 50 },
        { at: '2026-06-01T00:00:00Z', type: 'ISSUE', quantity: -20 },
        { at: '2026-06-02T00:00:00Z', type: 'TRANSFER_OUT', quantity: -5 }, // un transfert n'est pas une consommation
      ],
    });
    expect(s).toMatchObject({ consumption: 120, stockoutDays: 61, availableDays: 120, amc: 30.4 });
  });

  test('Annulations et retours réduisent la consommation ; au moins 30 jours au dénominateur', () => {
    const s = rules.consumptionStats({
      hasHistoryBefore: false, periodStart: new Date('2026-01-01T00:00:00Z'), now: new Date('2026-06-11T00:00:00Z'),
      movements: [
        { at: '2026-06-01T00:00:00Z', type: 'ADJUSTMENT_IN', quantity: 100 },
        { at: '2026-06-02T00:00:00Z', type: 'ISSUE', quantity: -40 },
        { at: '2026-06-03T00:00:00Z', type: 'ISSUE_REVERSAL', quantity: 10 },
        { at: '2026-06-04T00:00:00Z', type: 'RETURN', quantity: 5 },
        { at: '2026-06-05T00:00:00Z', type: 'ADJUSTMENT_OUT', quantity: -3 },  // perte : hors consommation
      ],
    });
    expect(s).toMatchObject({ consumption: 25, observedDays: 10, stockoutDays: 0, amc: 25.33 });
  });

  test('Seuils, quantité à commander et états', () => {
    const p = (stock, extra = {}) => rules.planRow({ amc: 30.4, stock, safetyMonths: 2, leadTimeDays: 30.4, intervalMonths: 1, ...extra });
    expect(p(0)).toMatchObject({ status: 'STOCKOUT', toOrder: 122, safetyStock: 60.8, minStock: 91.2, maxStock: 121.6 });
    expect(p(50).status).toBe('BELOW_SAFETY');
    expect(p(70)).toMatchObject({ status: 'TO_ORDER', toOrder: 52, monthsOfStock: 2.3 });
    expect(p(70, { onOrder: 30 })).toMatchObject({ status: 'OK', toOrder: 0 });
    expect(p(200).status).toBe('OVERSTOCK');
    expect(rules.planRow({ amc: 0, stock: 10, safetyMonths: 2, leadTimeDays: 30, intervalMonths: 1 }).status).toBe('NO_CONSUMPTION');
    // Sans consommation : repli sur le stock minimum du catalogue (total de l'entreprise)
    expect(rules.fallbackRow({ stock: 3, minQuantity: 10 })).toMatchObject({ status: 'TO_ORDER', toOrder: 17 });
    expect(rules.fallbackRow({ stock: 3, minQuantity: 10, reorderQuantity: 50 }).toOrder).toBe(50);
    expect(rules.fallbackRow({ stock: 3, minQuantity: null })).toBeNull();
  });
});

test.describe.serial('API › Stock — prévision du réapprovisionnement', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let admin, me, whA, whB, item, project, line, requisitionId, initialSettings, firstIssueId;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const plan = async (request, query) => (await json(await request.get(`/api/stock/planning?${query}`, { headers: H() })));
  const rowOf = (data, whId) => data.rows.find(r => r.stockItemId === item.id && (whId === undefined || r.warehouseId === whId));

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    me = (await (await request.get('/api/auth/profile', { headers: H() })).json()).data;
    initialSettings = (await (await request.get('/api/enterprises/current/stock-planning', { headers: H() })).json()).data;
    // Paramètres connus pour le calcul attendu
    const put = await json(await request.put('/api/enterprises/current/stock-planning', { headers: H(), data: { amcMonths: 6, safetyMonths: 2, orderIntervalMonths: 1, leadTimeDays: 30 } }));
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    const mkWarehouse = async (suffix) => (await (await request.post('/api/warehouses', { headers: H(), data: { code: `PL${suffix}-${stamp}`.slice(0, 30), name: `Dépôt prévision ${suffix} ${stamp}`, locationId: locations[0].id } })).json()).data;
    whA = await mkWarehouse('A');
    whB = await mkWarehouse('B');
    item = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `PL-SAV-${stamp}`, name: `Savon prévision ${stamp}`, unit: 'pce', categoryId: (cats.find(c => c.is_stockable) || cats[0]).id } })).json()).data;
    expect(me?.id && whA?.id && whB?.id && item?.id).toBeTruthy();
    const r = await json(await request.post('/api/stock-adjustments', { headers: H(), data: { warehouseId: whA.id, stockItemId: item.id, quantity: 100, reason: 'FOUND', comment: 'Stock initial' } }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  test.afterAll(async ({ request }) => {
    if (requisitionId) await request.delete(`/api/requisitions/${requisitionId}`, { headers: H() });
    if (line?.id) await request.delete(`/api/budget/${line.id}`, { headers: H() });
    if (initialSettings) {
      const { amcMonths, safetyMonths, orderIntervalMonths, leadTimeDays } = initialSettings;
      await request.put('/api/enterprises/current/stock-planning', { headers: H(), data: { amcMonths, safetyMonths, orderIntervalMonths, leadTimeDays } });
    }
  });

  test('Paramètres : lecture, contrôles, audit', async ({ request }) => {
    const get = await json(await request.get('/api/enterprises/current/stock-planning', { headers: H() }));
    expect(get.body.data).toMatchObject({ amcMonths: 6, safetyMonths: 2, orderIntervalMonths: 1, leadTimeDays: 30, defaults: { amcMonths: 6 } });
    for (const data of [{ amcMonths: 0, safetyMonths: 2, orderIntervalMonths: 1, leadTimeDays: 30 }, { amcMonths: 6, safetyMonths: 2, orderIntervalMonths: 1, leadTimeDays: 1.5 }, { amcMonths: 6 }]) {
      const bad = await json(await request.put('/api/enterprises/current/stock-planning', { headers: H(), data }));
      expect([bad.status, bad.body.code]).toEqual([400, 'STOCK_PLANNING_INVALID']);
    }
    const bad = await json(await request.put(`/api/warehouses/${whB.id}`, { headers: H(), data: { safetyStockMonths: 30 } }));
    expect([bad.status, bad.body.code]).toEqual([400, 'SAFETY_STOCK_INVALID']);
    const badItem = await json(await request.put(`/api/stock-items/${item.id}`, { headers: H(), data: { leadTimeDays: -1 } }));
    expect([badItem.status, badItem.body.code]).toEqual([400, 'LEAD_TIME_INVALID']);
  });

  test('Sans consommation : « Sans consommation » ; une sortie donne la CMM, l\'état et la quantité à commander', async ({ request }) => {
    let r = await plan(request, `warehouseId=${whA.id}&search=${item.code}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(rowOf(r.body.data, whA.id)).toMatchObject({ status: 'NO_CONSUMPTION', stock: 100, amc: 0, toOrder: 0 });

    const issue = await json(await request.post('/api/stock-issues', { headers: H(), data: { warehouseId: whA.id, recipientId: me.id, purpose: 'Distribution', lines: [{ stockItemId: item.id, quantity: 30 }] } }));
    expect(issue.status, JSON.stringify(issue.body)).toBe(201);
    firstIssueId = issue.body.data.id;
    // Une sortie annulée ne compte pas
    const other = await json(await request.post('/api/stock-issues', { headers: H(), data: { warehouseId: whA.id, recipientId: me.id, purpose: 'Erreur', lines: [{ stockItemId: item.id, quantity: 10 }] } }));
    expect((await json(await request.post(`/api/stock-issues/${other.body.data.id}/cancel`, { headers: H(), data: { reason: 'Erreur de saisie' } }))).status).toBe(200);

    r = await plan(request, `warehouseId=${whA.id}&search=${item.code}`);
    // 30 sortis, article arrivé aujourd'hui → 30 jours au dénominateur : CMM = 30 / 30 × 30,4 ; délai 30 j ≈ 0,99 mois
    expect(rowOf(r.body.data, whA.id)).toMatchObject({
      status: 'TO_ORDER', stock: 70, consumption: 30, amc: 30.4, safetyStock: 60.8, minStock: 90.8, maxStock: 121.2, toOrder: 52, basis: 'AMC',
    });
    expect(r.body.data.counts.TO_ORDER).toBeGreaterThanOrEqual(1);
    // Filtre par état
    r = await plan(request, `warehouseId=${whA.id}&search=${item.code}&status=OK,OVERSTOCK`);
    expect(rowOf(r.body.data, whA.id)).toBeUndefined();
  });

  test('Délai de l\'article et stock de sécurité du dépôt remplacent ceux de l\'entreprise', async ({ request }) => {
    expect((await json(await request.put(`/api/stock-items/${item.id}`, { headers: H(), data: { leadTimeDays: 0 } }))).status).toBe(200);
    let row = rowOf((await plan(request, `warehouseId=${whA.id}&search=${item.code}`)).body.data, whA.id);
    expect(row).toMatchObject({ leadTimeDays: 0, minStock: 60.8, maxStock: 91.2, status: 'OK', toOrder: 0 });
    expect((await json(await request.put(`/api/warehouses/${whA.id}`, { headers: H(), data: { safetyStockMonths: 3 } }))).status).toBe(200);
    row = rowOf((await plan(request, `warehouseId=${whA.id}&search=${item.code}`)).body.data, whA.id);
    expect(row).toMatchObject({ safetyMonths: 3, safetyStock: 91.2, status: 'BELOW_SAFETY', toOrder: 52 });
    await request.put(`/api/warehouses/${whA.id}`, { headers: H(), data: { safetyStockMonths: null } });
    await request.put(`/api/stock-items/${item.id}`, { headers: H(), data: { leadTimeDays: null } });
  });

  test('Un transfert n\'est pas une consommation ; total de l\'entreprise', async ({ request }) => {
    const t = await json(await request.post('/api/stock-issues', { headers: H(), data: { destinationType: 'WAREHOUSE', warehouseId: whA.id, destinationWarehouseId: whB.id, lines: [{ stockItemId: item.id, quantity: 20 }] } }));
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect((await json(await request.post(`/api/stock-issues/${t.body.data.id}/receive`, { headers: H(), data: {} }))).status).toBe(200);
    const all = (await plan(request, `search=${item.code}`)).body.data;
    expect(rowOf(all, whA.id)).toMatchObject({ stock: 50, consumption: 30, amc: 30.4, status: 'BELOW_SAFETY' });
    expect(rowOf(all, whB.id)).toMatchObject({ stock: 20, amc: 0, status: 'NO_CONSUMPTION' });
    const total = rowOf((await plan(request, `level=enterprise&search=${item.code}`)).body.data);
    expect(total).toMatchObject({ warehouseId: null, warehouseCount: 2, stock: 70, amc: 30.4, minStock: 90.8, toOrder: 52, status: 'TO_ORDER' });

    const exported = await request.get(`/api/stock/planning/export?search=${item.code}&lang=en`, { headers: H() });
    expect(exported.status()).toBe(200);
    expect(exported.headers()['content-type']).toContain('spreadsheetml');
  });

  test('Réquisition de réapprovisionnement : demandé par dépôt de destination, contrôles', async ({ request }) => {
    const [proj] = (await (await request.get('/api/projects', { headers: H() })).json()).data;
    project = proj;
    line = (await (await request.post('/api/budget', { headers: H(), data: { entityCode: `PLAN-${stamp}`, description: 'Prévision', allocatedAmount: 100000, projectId: project.id } })).json()).data;
    const body = (items) => ({ title: `[TEST PREVISION] ${stamp}`, description: 'x', projectId: project.id, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'x', items });
    const free = await json(await request.post('/api/requisitions', { headers: H(), data: body([{ description: 'Texte libre', quantity: 1, frequency: 1, unitPrice: 1, budgetLineId: line.id, destinationWarehouseId: whA.id }]) }));
    expect([free.status, free.body.code]).toEqual([400, 'DESTINATION_NEEDS_ITEM']);
    const res = await json(await request.post('/api/requisitions', { headers: H(), data: body([{ description: item.name, quantity: 20, frequency: 2, unitPrice: 1, budgetLineId: line.id, stockItemId: item.id, destinationWarehouseId: whA.id }]) }));
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    requisitionId = res.body.data.id;
    const req = (await (await request.get(`/api/requisitions/${requisitionId}`, { headers: H() })).json()).data;
    expect(req.items[0]).toMatchObject({ destination_warehouse_id: whA.id, destination_warehouse_name: whA.name });

    // Réquisition soumise (hors brouillon) : 20 × 2 demandés au dépôt A
    test.skip(req.status === 'DRAFT', 'BpmnGo indisponible : réquisition restée en brouillon');
    const row = rowOf((await plan(request, `warehouseId=${whA.id}&search=${item.code}`)).body.data, whA.id);
    expect(row).toMatchObject({ requested: 40, position: 90, toOrder: 32 });
    const total = rowOf((await plan(request, `level=enterprise&search=${item.code}`)).body.data);
    expect(total.requested).toBe(40);
  });

  test('Bon de commande de la réquisition : la quantité passe de « demandé » à « en commande » au dépôt de destination', async ({ request }) => {
    test.setTimeout(180_000);
    const approver = await getApproverToken(request);
    const pm = await waitForProcessTask(request, admin, requisitionId, PM_APPROVAL);
    test.skip(!pm, 'BpmnGo indisponible');
    const step = async (key, token, variables) => {
      const t = await waitForProcessTask(request, admin, requisitionId, key);
      const r = await request.post(`/api/tasks/${t.task.id}/complete`, { headers: auth(token), data: { variables } });
      expect(r.ok(), await r.text()).toBeTruthy();
    };
    await step(PM_APPROVAL, approver, { approved: true, procurementAgentId: await getProcurementAgentId(request), comment: 'OK' });
    await step('Activity_DetermineType', admin, { procurementMethod: 'SOLE_SOURCE', justification: 'Fournisseur unique (test)' });
    await step('Activity_SoleSource', admin, { comment: 'Justifiée' });
    await waitForProcessTask(request, admin, requisitionId, 'Activity_CreatePO');
    const reqItem = (await (await request.get(`/api/requisitions/${requisitionId}`, { headers: H() })).json()).data.items[0];
    const supplier = (await (await request.get('/api/suppliers', { headers: H(), params: { forPurchaseOrder: 1 } })).json()).data[0];
    const po = await json(await request.post('/api/purchase-orders', { headers: H(), data: {
      requisitionId, supplierId: supplier.id, currency: 'USD', totalAmount: 15,
      deliveryDate: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
      items: [{ description: item.name, quantity: 15, unitPrice: 1, requisitionItemId: reqItem.id, stockItemId: item.id }],
    } }));
    expect(po.status, JSON.stringify(po.body)).toBeLessThan(300);
    const row = rowOf((await plan(request, `warehouseId=${whA.id}&search=${item.code}`)).body.data, whA.id);
    expect(row).toMatchObject({ onOrder: 15, requested: 25, position: 90 });
    // Bon rejeté à la révision : il ne compte plus, la quantité redevient « demandée »
    const rejected = await json(await request.post(`/api/purchase-orders/${po.body.data.id}/review`, { headers: auth(approver), data: { decision: 'REJECT', comment: 'Test prévision' } }));
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const after = rowOf((await plan(request, `warehouseId=${whA.id}&search=${item.code}`)).body.data, whA.id);
    expect(after).toMatchObject({ onOrder: 0, requested: 40 });
  });

  test('Détail d\'un article : prévision par dépôt, total et consommation des 12 derniers mois', async ({ request }) => {
    const r = await json(await request.get(`/api/stock/planning/items/${item.id}`, { headers: H() }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.months).toHaveLength(12);
    expect(r.body.data.months.at(-1).consumption).toBe(30);
    expect(r.body.data.warehouses.map(w => w.warehouseId).sort()).toEqual([whA.id, whB.id].sort());
    expect(r.body.data.total).toMatchObject({ stockItemId: item.id, stock: 70 });
    const onlyB = await json(await request.get(`/api/stock/planning/items/${item.id}?warehouseId=${whB.id}`, { headers: H() }));
    expect(onlyB.body.data.months.at(-1).consumption).toBe(0);
  });

  test('Retour rendu dans un autre dépôt : la consommation baisse dans le dépôt de la sortie', async ({ request }) => {
    const issue = (await (await request.get(`/api/stock-issues/${firstIssueId}`, { headers: H() })).json()).data;
    const ret = await json(await request.post('/api/stock-returns', { headers: H(), data: {
      warehouseId: whB.id, returnedBy: me.id, lines: [{ issueLineId: issue.lines[0].id, quantity: 6, condition: 'GOOD' }],
    } }));
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    const all = (await plan(request, `search=${item.code}`)).body.data;
    expect(rowOf(all, whA.id)).toMatchObject({ stock: 50, consumption: 24, amc: 24.32 });
    expect(rowOf(all, whB.id)).toMatchObject({ stock: 26, consumption: 0 });
    // Vue d'un seul dépôt : le retour rendu ailleurs compte quand même
    const onlyA = rowOf((await plan(request, `warehouseId=${whA.id}&search=${item.code}`)).body.data, whA.id);
    expect(onlyA.consumption).toBe(24);
    const detail = (await (await request.get(`/api/stock/planning/items/${item.id}?warehouseId=${whA.id}`, { headers: H() })).json()).data;
    expect(detail.months.at(-1).consumption).toBe(24);
  });

  test('Cloisonnement : article d\'une autre entreprise introuvable, droits', async ({ request }) => {
    const unknown = await request.get('/api/stock/planning/items/00000000-0000-4000-8000-000000000000', { headers: H() });
    expect(unknown.status()).toBe(404);
    const anonymous = await request.get('/api/stock/planning');
    expect(anonymous.status()).toBe(401);
  });
});
