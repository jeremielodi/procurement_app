/**
 * tests/api/tender-per-item.spec.js
 *
 * Appel d'offres attribué article par article (migration 39) :
 *   - mode d'attribution annoncé à la publication (PER_ITEM), verrouillé dès qu'une offre est déposée
 *   - les fournisseurs ne chiffrent qu'une partie des articles
 *   - attribution contrôlée : article chiffré par le fournisseur, une seule fois, tous les articles ayant une offre
 *   - deux attributaires → réquisition répartie (une part par fournisseur, prix de l'offre retenue) →
 *     une étape « Créer le bon de commande » par part
 *   - chaque fournisseur ne voit que SES articles remportés
 *
 * Requiert BpmnGo.
 */
import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth, supplierRegistration, firstReferenceIds } from './helpers.js';

const POLL_TIMEOUT = 60_000;
const APPROVALS = ['Activity_ValidationN1_Manager', 'Activity_ValidationN2_Finance', 'Activity_ValidationN3_DG'];
const ITEMS = ['Groupe électrogène', 'Panneaux solaires', 'Batteries'];
const stamp = Date.now();

let token, approverToken, req, tender;
const suppliers = []; // { id, token, name }

async function openTasks(request) {
  const res = await request.get(`/api/tasks/process/${req.process_instance_id}`, { headers: auth(token) });
  return res.ok() ? ((await res.json()).data || []).filter(t => t.status !== 'COMPLETED') : [];
}
async function waitForTasks(request, keys, count = 1) {
  const list = Array.isArray(keys) ? keys : [keys];
  let tasks = [];
  await expect.poll(async () => {
    tasks = (await openTasks(request)).filter(t => list.includes(t.taskDefinitionKey));
    return tasks.length;
  }, { message: `${count} tâche(s) ${list.join('|')}`, timeout: POLL_TIMEOUT, intervals: [2000] }).toBeGreaterThanOrEqual(count);
  return tasks;
}
const complete = (request, task, variables, tk = token) =>
  request.post(`/api/tasks/${task.id}/complete`, { headers: auth(tk), data: { variables } });

test.describe.serial('Appel d\'offres attribué par article (BpmnGo)', () => {
  test('Trois fournisseurs inscrits ; réquisition de 36 000 approuvée → appel d\'offres', async ({ request }) => {
    token = await getToken(request);
    approverToken = await getApproverToken(request);
    const { locationId, categoryId } = await firstReferenceIds(request);
    for (const n of [1, 2, 3]) {
      const res = await request.post('/api/auth/register-supplier', { multipart: supplierRegistration({
        name: `Fournisseur Lot ${n} ${stamp}`, email: `lot${n}.${stamp}@example.com`, locationIds: [locationId], categoryIds: [categoryId],
      }) });
      expect(res.status(), await res.text()).toBe(201);
      const body = (await res.json()).data;
      const me = (await (await request.get('/api/supplier-portal/me', { headers: auth(body.token) })).json()).data;
      suppliers.push({ id: me.id, token: body.token, name: me.name });
    }

    const H = auth(token);
    const [depts, projects] = await Promise.all([
      request.get('/api/departments', { headers: H }).then(r => r.json()).then(b => b.data || []),
      request.get('/api/projects', { headers: H }).then(r => r.json()).then(b => b.data || []),
    ]);
    const line = (await (await request.post('/api/budget', { headers: H, data: {
      entityCode: `BL-AOLOT-${stamp}`, description: 'Ligne test AO par article', allocatedAmount: 1000000, projectId: projects[0].id,
    } })).json()).data;
    const created = await request.post('/api/requisitions', { headers: H, data: {
      title: `[TEST AO PAR ARTICLE] ${stamp}`, description: 'AO par article', departmentId: depts[0].id, projectId: projects[0].id,
      estimatedAmount: 36000, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'Test',
      items: ITEMS.map(description => ({ description, quantity: 1, frequency: 1, unitPrice: 12000, budgetLineId: line?.id ?? line })),
    } });
    expect(created.status()).toBe(201);
    req = (await created.json()).data;
    await expect.poll(async () => {
      req = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data;
      return req.process_instance_id || null;
    }, { timeout: 15_000 }).toBeTruthy();

    const [approval] = await waitForTasks(request, APPROVALS);
    expect((await complete(request, approval, { approved: true, returnedForCorrection: false }, approverToken)).status()).toBe(200);

    const [method] = await waitForTasks(request, 'Activity_DetermineType');
    // Répartition d'un AO : elle se décide à l'attribution, pas au choix de la méthode
    const split = await complete(request, method, { procurementMethod: 'RFP', multiSupplier: true });
    expect((await split.json()).code).toBe('SPLIT_NOT_AVAILABLE_FOR_RFP');
    expect((await complete(request, method, { procurementMethod: 'RFP' })).status()).toBe(200);
    await waitForTasks(request, 'Activity_RFPProcess');
  });

  test('AO publié « par article » ; chaque fournisseur chiffre une partie des articles', async ({ request }) => {
    const [rfp] = await waitForTasks(request, 'Activity_RFPProcess');
    const res = await request.post('/api/tenders', { headers: auth(token), data: {
      requisitionId: req.id, taskId: rfp.id, tenderNumber: `AO-LOT-${stamp}`, title: 'Énergie du bureau',
      startDate: new Date(Date.now() - 60_000).toISOString(), endDate: new Date(Date.now() + 3_600_000).toISOString(),
      maxDeliveryDays: 30, awardMode: 'PER_ITEM',
    } });
    expect(res.status(), await res.text()).toBe(201);
    tender = (await res.json()).data;
    expect(tender.award_mode).toBe('PER_ITEM');

    const [i1, i2, i3] = req.items.map(i => i.id);
    const bids = [
      [suppliers[0], [[i1, 9000], [i2, 11000]]],
      [suppliers[1], [[i2, 10000], [i3, 8000]]],
      [suppliers[2], [[i1, 9500]]],
    ];
    for (const [s, lines] of bids) {
      const detail = (await (await request.get(`/api/supplier-portal/tenders/${tender.id}`, { headers: auth(s.token) })).json()).data;
      expect(detail.award_mode).toBe('PER_ITEM');
      const sub = await request.put(`/api/supplier-portal/tenders/${tender.id}/submission`, { headers: auth(s.token), data: {
        deliveryDays: 15, items: lines.map(([requisitionItemId, unitPrice]) => ({ requisitionItemId, unitPrice })),
      } });
      expect(sub.status(), await sub.text()).toBe(200);
    }

    // Annoncé aux fournisseurs : le mode ne change plus une fois des offres déposées
    const change = await request.put(`/api/tenders/${tender.id}`, { headers: auth(token), data: {
      title: 'Énergie du bureau', startDate: tender.start_date, endDate: new Date(Date.now() + 3_600_000).toISOString(),
      maxDeliveryDays: 30, awardMode: 'SINGLE',
    } });
    expect(change.status()).toBe(409);
    expect((await change.json()).code).toBe('AWARD_MODE_LOCKED');

    expect((await request.post(`/api/tenders/${tender.id}/close`, { headers: auth(token) })).status()).toBe(200);
  });

  test('Attribution par article contrôlée', async ({ request }) => {
    const [i1, i2, i3] = req.items.map(i => i.id);
    const [a, b] = suppliers;
    const cases = [
      [[{ requisitionItemId: i1, supplierId: a.id }, { requisitionItemId: i2, supplierId: b.id }, { requisitionItemId: i3, supplierId: a.id }], 'ITEM_NOT_QUOTED'],
      [[{ requisitionItemId: i1, supplierId: a.id }, { requisitionItemId: i2, supplierId: b.id }], 'ITEM_NOT_AWARDED'],
      [[{ requisitionItemId: i1, supplierId: a.id }, { requisitionItemId: i1, supplierId: a.id }], 'ITEM_AWARDED_TWICE'],
    ];
    for (const [items, code] of cases) {
      const res = await request.post(`/api/tenders/${tender.id}/award`, { headers: auth(token), data: { items } });
      expect(res.status(), `${code} : ${await res.text()}`).toBe(400);
      expect((await res.json()).code).toBe(code);
    }
    const t = (await (await request.get(`/api/tenders/${tender.id}`, { headers: auth(token) })).json()).data;
    expect(t.effective_status).toBe('CLOSED');
  });

  test('Deux attributaires → réquisition répartie : une étape « Créer le bon de commande » par fournisseur', async ({ request }) => {
    const H = auth(token);
    const [i1, i2, i3] = req.items.map(i => i.id);
    const [a, b, c] = suppliers;
    const res = await request.post(`/api/tenders/${tender.id}/award`, { headers: H, data: {
      comment: 'Meilleur prix par article',
      items: [{ requisitionItemId: i1, supplierId: a.id }, { requisitionItemId: i2, supplierId: b.id }, { requisitionItemId: i3, supplierId: b.id }],
    } });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ split: true, camundaTaskCompleted: true });
    expect(body.lotIds).toHaveLength(2);

    const detail = (await (await request.get(`/api/tenders/${tender.id}`, { headers: H })).json()).data;
    expect(detail.effective_status).toBe('AWARDED');
    expect(detail.awarded_supplier_id).toBeNull();
    expect(detail.awards.map(x => [x.requisition_item_id, x.supplier_id, x.unit_price])).toEqual([[i1, a.id, 9000], [i2, b.id, 10000], [i3, b.id, 8000]]);

    const lots = (await (await request.get(`/api/requisitions/${req.id}/supplier-lots`, { headers: H })).json()).data;
    expect(lots.map(l => [l.supplier_id, l.items.map(i => i.awarded_unit_price), l.tender_id])).toEqual([
      [a.id, [9000], tender.id], [b.id, [10000, 8000], tender.id],
    ]);
    const creates = await waitForTasks(request, 'Activity_CreatePO', 2);
    expect(creates.map(t => t.lot?.supplierId).sort()).toEqual([a.id, b.id].sort());

    // Chaque fournisseur ne voit que ses articles ; le troisième n'a rien remporté
    const seen = async (s) => (await (await request.get(`/api/supplier-portal/tenders/${tender.id}`, { headers: auth(s.token) })).json()).data;
    expect(await seen(a)).toMatchObject({ is_awarded_to_me: true, my_awarded_item_ids: [i1] });
    expect(await seen(b)).toMatchObject({ is_awarded_to_me: true, my_awarded_item_ids: [i2, i3] });
    expect(await seen(c)).toMatchObject({ is_awarded_to_me: false, my_awarded_item_ids: [] });

    // Bon de commande de la part de B : ses articles, aux prix de son offre
    const taskB = creates.find(t => t.lot?.supplierId === b.id);
    const po = await request.post('/api/purchase-orders', { headers: H, data: {
      requisitionId: req.id, taskId: taskB.id, supplierId: b.id, currency: 'USD', totalAmount: 18000,
      items: [[i2, 10000], [i3, 8000]].map(([id, unitPrice]) => ({
        description: req.items.find(i => i.id === id).item_description, quantity: 1, unitPrice, requisitionItemId: id,
      })),
    } });
    expect(po.status(), await po.text()).toBe(201);
    await expect.poll(async () => (await openTasks(request)).filter(t => t.taskDefinitionKey === 'Activity_POApproval').length,
      { timeout: POLL_TIMEOUT }).toBe(1);
  });
});
