/**
 * tests/api/partial-delivery.spec.js
 *
 * Livraisons partielles (BPMN) : pour chaque livraison, SAN (demandeur) puis GRN (logistique) ;
 * tant qu'il reste à livrer, une nouvelle SAN puis un nouveau GRN sont demandés ; reliquat soldé → facture.
 *   1. 10 commandés : SAN → GRN 6 → nouvelle SAN → GRN 4 → facture
 *   2. 10 commandés : SAN → GRN 6 + « le fournisseur ne livrera pas le reste » (motif) → facture ; GRN suivant refusé
 *   3. 10 commandés : SAN → GRN 6 → SAN en attente → « Solder le reliquat » (fiche du PO) → facture
 *   + contrôles : motif obligatoire, rien de reçu → solde refusé, étapes SAN / GRN refusées hors formulaire
 *
 * Requiert GoFlow (BPMN redéployé).
 */
import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth, directPurchaseVariables } from './helpers.js';

const POLL_TIMEOUT = 60_000;
const PRICE = 100; // 10 × 100 = 1 000 → N1, achat direct
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

let token, approverToken, refs;

async function openTasks(request, pid) {
  const res = await request.get(`/api/tasks/process/${pid}`, { headers: auth(token) });
  if (!res.ok()) return [];
  const body = await res.json();
  return (body.data || body.tasks || []).filter(t => t.status !== 'COMPLETED');
}

async function waitForTask(request, pid, key) {
  let task = null;
  await expect.poll(async () => {
    task = (await openTasks(request, pid)).find(t => t.taskDefinitionKey === key) || null;
    return !!task;
  }, { message: `tâche ${key}`, timeout: POLL_TIMEOUT, intervals: [1500] }).toBe(true);
  return task;
}

const complete = (request, task, variables, tk = token) =>
  request.post(`/api/tasks/${task.id}/complete`, { headers: auth(tk), data: { variables } });

/** Réquisition de 10 unités menée jusqu'au PO confirmé par le fournisseur → { req, po, poItem } */
async function orderConfirmed(request, label) {
  const H = auth(token);
  const created = await request.post('/api/requisitions', { headers: H, data: {
    title: `[TEST LIVRAISON PARTIELLE] ${label} ${Date.now()}`, description: label, departmentId: refs.dept.id, projectId: refs.project.id,
    estimatedAmount: 10 * PRICE, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'Test',
    items: [{ description: 'Cartons de ramettes', quantity: 10, frequency: 1, unitPrice: PRICE, budgetLineId: refs.line }],
  } });
  expect(created.status()).toBe(201);
  let req = (await created.json()).data;
  await expect.poll(async () => {
    req = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data;
    return req.process_instance_id || null;
  }, { timeout: 15_000 }).toBeTruthy();
  const pid = req.process_instance_id;

  expect((await complete(request, await waitForTask(request, pid, 'Activity_ValidationN1_Manager'), { approved: true }, approverToken)).status()).toBe(200);
  expect((await complete(request, await waitForTask(request, pid, 'Activity_DetermineType'), { procurementMethod: 'DIRECT_PURCHASE' })).status()).toBe(200);
  expect((await complete(request, await waitForTask(request, pid, 'Activity_DirectPurchase'), await directPurchaseVariables(request, token, req.id, refs.supplier.id))).status()).toBe(200);
  await waitForTask(request, pid, 'Activity_CreatePO');

  const poRes = await request.post('/api/purchase-orders', { headers: H, data: {
    requisitionId: req.id, supplierId: refs.supplier.id, currency: 'USD', totalAmount: 10 * PRICE, deliveryDate: future(20),
    items: [{ description: 'Cartons de ramettes', quantity: 10, unitPrice: PRICE }],
  } });
  expect([200, 201]).toContain(poRes.status());
  const po = (await poRes.json()).data;
  await waitForTask(request, pid, 'Activity_POApproval');
  expect((await request.post(`/api/purchase-orders/${po.id}/approve`, { headers: auth(approverToken), data: { comments: 'ok' } })).status()).toBe(200);
  await waitForTask(request, pid, 'Activity_SupplierConfirmation');
  expect((await request.post(`/api/purchase-orders/${po.id}/supplier-response`, { headers: H, data: { response: 'CONFIRMED', deliveryDate: future(5) } })).status()).toBe(200);
  const poItem = (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: H })).json()).data.items[0];
  return { req, pid, po, poItem };
}

const san = async (request, ctx) => {
  const task = await waitForTask(request, ctx.pid, 'Activity_ServiceAcceptance');
  const res = await request.post('/api/service-acceptance-notes', { headers: auth(token), data: { poId: ctx.po.id, taskId: task.id, serviceAccepted: true, comments: 'Livraison conforme' } });
  expect([200, 201], JSON.stringify(await res.json())).toContain(res.status());
};
const grn = async (request, ctx, qty, extra = {}) => {
  const task = await waitForTask(request, ctx.pid, 'Activity_GoodsReceipt');
  const res = await request.post('/api/goods-receipts', { headers: auth(token), data: {
    poId: ctx.po.id, taskId: task.id, ...extra,
    grnItems: [{ poItemId: ctx.poItem.id, item_description: 'Cartons de ramettes', quantity_received: qty, quantity_accepted: qty, quantity_rejected: 0 }],
  } });
  const body = await res.json();
  expect([200, 201], JSON.stringify(body)).toContain(res.status());
  return body.data;
};
const delivery = async (request, ctx) => (await (await request.get(`/api/purchase-orders/${ctx.po.id}/delivery`, { headers: auth(token) })).json()).data;
const keys = async (request, ctx) => (await openTasks(request, ctx.pid)).map(t => t.taskDefinitionKey);

test.describe.serial('Livraisons partielles : SAN puis GRN à chaque livraison', () => {
  // Chaque test refait le circuit GoFlow jusqu'au PO confirmé (achat direct avec pro-forma compris) puis les livraisons
  test.setTimeout(180_000);
  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
    approverToken = await getApproverToken(request);
    const H = auth(token);
    const get = async (u) => (await (await request.get(u, { headers: H })).json()).data;
    const [depts, projects, suppliers] = await Promise.all([get('/api/departments'), get('/api/projects'), get('/api/suppliers?forPurchaseOrder=1')]);
    const line = (await (await request.post('/api/budget', { headers: H, data: {
      entityCode: `BL-PART-${Date.now()}`, description: 'Ligne test livraisons partielles', allocatedAmount: 1000000, projectId: projects[0].id,
    } })).json()).data;
    refs = { dept: depts[0], project: projects[0], supplier: suppliers[0], line: line?.id ?? line };
  });

  test('1 · 6 puis 4 : nouvelle SAN puis nouveau GRN pour le reste, puis facture', async ({ request }) => {
    const ctx = await orderConfirmed(request, 'reste livré');
    expect(await keys(request, ctx)).toContain('Activity_ServiceAcceptance');
    expect(await keys(request, ctx)).not.toContain('Activity_GoodsReceipt');

    // Étapes SAN / GRN : jamais terminées sans leur document
    const sanTask = await waitForTask(request, ctx.pid, 'Activity_ServiceAcceptance');
    const generic = await complete(request, sanTask, { serviceAccepted: true });
    expect(generic.status()).toBe(400);
    expect((await generic.json()).code).toBe('FORM_REQUIRED');

    await san(request, ctx);
    const first = await grn(request, ctx, 6);
    expect(first).toMatchObject({ grnCompliant: true, poFullyDelivered: false, deliveryComplete: false });
    expect((await delivery(request, ctx)).deliveryStatus).toBe('PARTIALLY_DELIVERED');

    // Reste à livrer : nouvelle acceptation (SAN) du demandeur, pas de facture
    await waitForTask(request, ctx.pid, 'Activity_ServiceAcceptance');
    expect(await keys(request, ctx)).not.toContain('Activity_EnterInvoice');
    await san(request, ctx);
    const second = await grn(request, ctx, 4);
    expect(second).toMatchObject({ poFullyDelivered: true, deliveryComplete: true });

    await waitForTask(request, ctx.pid, 'Activity_EnterInvoice');
    const d = await delivery(request, ctx);
    expect(d.deliveryStatus).toBe('DELIVERED');
    expect(d.receipts).toHaveLength(2);

    const timeline = (await (await request.get(`/api/requisitions/${ctx.req.id}/timeline?lang=fr`, { headers: auth(token) })).json()).data;
    const order = timeline.steps.map(s => s.key);
    expect(order.indexOf('san')).toBeLessThan(order.indexOf('grn'));
    expect(timeline.steps.find(s => s.key === 'grn')).toMatchObject({ status: 'done' });
    expect(timeline.steps.find(s => s.key === 'grn').links).toHaveLength(2);
  });

  test('2 · 6 reçus + « le fournisseur ne livrera pas le reste » → facture ; plus de réception', async ({ request }) => {
    const ctx = await orderConfirmed(request, 'solde à la réception');
    await san(request, ctx);
    const task = await waitForTask(request, ctx.pid, 'Activity_GoodsReceipt');
    const noReason = await request.post('/api/goods-receipts', { headers: auth(token), data: {
      poId: ctx.po.id, taskId: task.id, closeRemaining: true, closeReason: '  ',
      grnItems: [{ poItemId: ctx.poItem.id, quantity_received: 6, quantity_accepted: 6, quantity_rejected: 0 }],
    } });
    expect(noReason.status()).toBe(400);
    expect((await noReason.json()).code).toBe('CLOSE_REASON_REQUIRED');

    const result = await grn(request, ctx, 6, { closeRemaining: true, closeReason: 'Rupture définitive chez le fournisseur' });
    expect(result).toMatchObject({ deliveryClosed: true, deliveryComplete: true, poFullyDelivered: false });

    await waitForTask(request, ctx.pid, 'Activity_EnterInvoice');
    expect(await keys(request, ctx)).not.toContain('Activity_ServiceAcceptance');
    const d = await delivery(request, ctx);
    expect(d.deliveryStatus).toBe('CLOSED_SHORT');
    expect(d.closure).toMatchObject({ reason: 'Rupture définitive chez le fournisseur' });

    const late = await request.post('/api/goods-receipts', { headers: auth(token), data: {
      poId: ctx.po.id, grnItems: [{ poItemId: ctx.poItem.id, quantity_received: 1, quantity_accepted: 1, quantity_rejected: 0 }],
    } });
    expect(late.status()).toBe(409);
    expect((await late.json()).code).toBe('DELIVERY_CLOSED');
  });

  test('3 · SAN en attente après une livraison partielle → « Solder le reliquat » depuis le PO → facture', async ({ request }) => {
    const ctx = await orderConfirmed(request, 'solde depuis le PO');
    const H = auth(token);
    // Rien encore reçu : solder est refusé (il faut rejeter / annuler la commande)
    const tooEarly = await request.post(`/api/purchase-orders/${ctx.po.id}/close-delivery`, { headers: H, data: { reason: 'x' } });
    expect((await tooEarly.json()).code).toBe('NOTHING_DELIVERED');

    await san(request, ctx);
    await grn(request, ctx, 6);
    await waitForTask(request, ctx.pid, 'Activity_ServiceAcceptance');

    expect((await (await request.post(`/api/purchase-orders/${ctx.po.id}/close-delivery`, { headers: H, data: { reason: ' ' } })).json()).code).toBe('CLOSE_REASON_REQUIRED');
    const closed = await request.post(`/api/purchase-orders/${ctx.po.id}/close-delivery`, { headers: H, data: { reason: 'Le fournisseur annule le reste' } });
    expect(closed.status(), JSON.stringify(await closed.json())).toBe(200);
    expect((await closed.json()).data).toMatchObject({ remaining: 4, accepted: 6, camundaTaskCompleted: true });

    await waitForTask(request, ctx.pid, 'Activity_EnterInvoice');
    expect(await keys(request, ctx)).not.toContain('Activity_GoodsReceipt');
    expect((await delivery(request, ctx)).deliveryStatus).toBe('CLOSED_SHORT');
    expect((await (await request.post(`/api/purchase-orders/${ctx.po.id}/close-delivery`, { headers: H, data: { reason: 'encore' } })).json()).code).toBe('DELIVERY_CLOSED');

    const timeline = (await (await request.get(`/api/requisitions/${ctx.req.id}/timeline?lang=fr`, { headers: H })).json()).data;
    expect(timeline.steps.find(s => s.key === 'grn').info).toContain('Reliquat soldé');
    expect(timeline.events.some(e => e.title.includes('soldé'))).toBe(true);
    const logs = (await (await request.get('/api/audit-logs?action=PO_DELIVERY_CLOSED', { headers: H })).json()).data;
    expect(logs[0].new_value).toMatchObject({ reason: 'Le fournisseur annule le reste' });
  });
});
