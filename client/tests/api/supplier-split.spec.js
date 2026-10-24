/**
 * tests/api/supplier-split.spec.js
 *
 * Réquisition répartie entre plusieurs fournisseurs (migration 38, BPMN : sous-processus SubProcess_SupplierOrder
 * répété par part) :
 *   - « Déterminer la méthode d'achat » avec multiSupplier (refusé pour un appel d'offres)
 *   - achat direct réparti → « Répartition par fournisseur » directement (pas d'étape « Achat direct »)
 *   - répartition contrôlée : tous les articles, une seule part par article, au moins deux fournisseurs, pro-forma
 *   - 5 articles → 3 fournisseurs (1 / 2 / 2) → 3 étapes « Créer le bon de commande », une par part
 *   - bon de commande : fournisseur et articles de la part imposés, un seul par part
 *   - une part rejetée s'arrête sans bloquer les autres ; les deux autres vont, en parallèle, jusqu'au paiement
 *   - réquisition terminée (COMPLETED) quand toutes les commandes actives sont payées
 *
 * Requiert GoFlow.
 */
import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth, PDF_BUFFER } from './helpers.js';

const POLL_TIMEOUT = 60_000;
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const ITEMS = ['Ramettes A4', 'Classeurs', 'Stylos', 'Cartouches', 'Agrafeuses'];

let token, approverToken, req, suppliers;
const lots = {};   // lettre (A / B / C) → { supplier, itemIds, lotId, po }

async function openTasks(request) {
  const res = await request.get(`/api/tasks/process/${req.process_instance_id}`, { headers: auth(token) });
  if (!res.ok()) return [];
  return ((await res.json()).data || []).filter(t => t.status !== 'COMPLETED');
}

/** count tâches ouvertes de cette clé (filtre facultatif), renvoyées */
async function waitForTasks(request, key, count = 1, filter = () => true) {
  let tasks = [];
  await expect.poll(async () => {
    tasks = (await openTasks(request)).filter(t => t.taskDefinitionKey === key && filter(t));
    return tasks.length;
  }, { message: `${count} tâche(s) ${key}`, timeout: POLL_TIMEOUT, intervals: [2000] }).toBeGreaterThanOrEqual(count);
  return tasks;
}
const taskOfPo = async (request, key, po) => (await waitForTasks(request, key, 1, t => String(t.lot?.poId) === String(po.id)))[0];

const complete = (request, task, variables, tk = token) =>
  request.post(`/api/tasks/${task.id}/complete`, { headers: auth(tk), data: { variables } });

async function proforma(request) {
  const upload = await request.post('/api/upload', { headers: auth(token), multipart: {
    file: { name: 'proforma.pdf', mimeType: 'application/pdf', buffer: PDF_BUFFER },
    entity_type: 'requisition', entity_id: req.id,
  } });
  expect(upload.status(), await upload.text()).toBe(200);
  return (await upload.json()).data.id;
}

test.describe.serial('Réquisition répartie entre plusieurs fournisseurs (GoFlow)', () => {
  test('Réquisition de 5 articles approuvée → « Déterminer la méthode d\'achat »', async ({ request }) => {
    token = await getToken(request);
    approverToken = await getApproverToken(request);
    const H = auth(token);
    const [depts, projects] = await Promise.all([
      request.get('/api/departments', { headers: H }).then(r => r.json()).then(b => b.data || []),
      request.get('/api/projects', { headers: H }).then(r => r.json()).then(b => b.data || []),
    ]);
    const project = projects[0];
    const line = (await (await request.post('/api/budget', { headers: H, data: {
      entityCode: `BL-SPLIT-${Date.now()}`, description: 'Ligne test répartition', allocatedAmount: 1000000, projectId: project.id,
    } })).json()).data;
    suppliers = (await (await request.get('/api/suppliers', { headers: H, params: { forPurchaseOrder: 1 } })).json()).data;
    test.skip(suppliers.length < 3, 'Il faut au moins trois fournisseurs actifs');

    const created = await request.post('/api/requisitions', { headers: H, data: {
      title: `[TEST REPARTITION] ${Date.now()}`, description: 'Répartition', departmentId: depts[0].id, projectId: project.id,
      estimatedAmount: 4500, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'Test',
      items: ITEMS.map(description => ({ description, quantity: 1, frequency: 1, unitPrice: 900, budgetLineId: line?.id ?? line })),
    } });
    expect(created.status()).toBe(201);
    req = (await created.json()).data;
    await expect.poll(async () => {
      req = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data;
      return req.process_instance_id || null;
    }, { timeout: 15_000 }).toBeTruthy();
    test.skip(!req.process_instance_id, 'GoFlow indisponible');

    const [n1] = await waitForTasks(request, 'Activity_ValidationN1_Manager');
    expect((await complete(request, n1, { approved: true, comment: 'OK' }, approverToken)).status()).toBe(200);
    await waitForTasks(request, 'Activity_DetermineType');
  });

  test('Appel d\'offres réparti refusé ; achat direct réparti → « Répartition par fournisseur »', async ({ request }) => {
    const [task] = await waitForTasks(request, 'Activity_DetermineType');
    const rfp = await complete(request, task, { procurementMethod: 'RFP', multiSupplier: true });
    expect(rfp.status()).toBe(400);
    expect((await rfp.json()).code).toBe('SPLIT_NOT_AVAILABLE_FOR_RFP');

    const res = await complete(request, task, { procurementMethod: 'DIRECT_PURCHASE', multiSupplier: true });
    expect(res.status(), await res.text()).toBe(200);
    await waitForTasks(request, 'Activity_AllocateSuppliers');
    // Achat direct réparti : fournisseurs et pro-formas se désignent dans la répartition
    expect((await openTasks(request)).map(t => t.taskDefinitionKey)).not.toContain('Activity_DirectPurchase');
  });

  test('Répartition contrôlée par le serveur', async ({ request }) => {
    const [task] = await waitForTasks(request, 'Activity_AllocateSuppliers');
    const ids = req.items.map(i => i.id);
    const [a, b, c] = suppliers;
    const cases = [
      [{}, 'ALLOCATION_REQUIRED'],
      [{ lots: [{ supplierId: a.id, itemIds: ids, attachmentId: await proforma(request) }] }, 'SPLIT_MIN_SUPPLIERS'],
      [{ lots: [{ supplierId: a.id, itemIds: ids.slice(0, 2) }, { supplierId: b.id, itemIds: ids.slice(1) }] }, 'ITEM_ALLOCATED_TWICE'],
      [{ lots: [{ supplierId: a.id, itemIds: ids.slice(0, 1) }, { supplierId: b.id, itemIds: ids.slice(1, 3) }] }, 'ITEM_NOT_ALLOCATED'],
      [{ lots: [{ supplierId: a.id, itemIds: ids.slice(0, 2) }, { supplierId: c.id, itemIds: ids.slice(2) }] }, 'PROFORMA_REQUIRED'],
    ];
    for (const [variables, code] of cases) {
      const res = await complete(request, task, variables);
      expect(res.status(), `${code} : ${await res.text()}`).toBe(400);
      expect((await res.json()).code).toBe(code);
    }
    expect((await (await request.get(`/api/requisitions/${req.id}/supplier-lots`, { headers: auth(token) })).json()).data).toEqual([]);
  });

  test('5 articles → 3 fournisseurs (1 / 2 / 2) → une étape « Créer le bon de commande » par part', async ({ request }) => {
    const [task] = await waitForTasks(request, 'Activity_AllocateSuppliers');
    const ids = req.items.map(i => i.id);
    const plan = { A: [suppliers[0], ids.slice(0, 1)], B: [suppliers[1], ids.slice(1, 3)], C: [suppliers[2], ids.slice(3)] };
    const payload = [];
    for (const [letter, [supplier, itemIds]] of Object.entries(plan)) {
      lots[letter] = { supplier, itemIds };
      payload.push({ supplierId: supplier.id, itemIds, attachmentId: await proforma(request), amount: itemIds.length * 900 });
    }
    const res = await complete(request, task, { lots: payload });
    expect(res.status(), await res.text()).toBe(200);

    const saved = (await (await request.get(`/api/requisitions/${req.id}/supplier-lots`, { headers: auth(token) })).json()).data;
    expect(saved.map(l => [l.lot_number, l.supplier_id, l.items.length])).toEqual([
      [1, suppliers[0].id, 1], [2, suppliers[1].id, 2], [3, suppliers[2].id, 2],
    ]);
    for (const l of saved) Object.values(lots).find(x => x.supplier.id === l.supplier_id).lotId = l.id;

    const creates = await waitForTasks(request, 'Activity_CreatePO', 3);
    expect(creates.map(t => t.lot?.supplierId).sort()).toEqual(suppliers.slice(0, 3).map(s => s.id).sort());
    for (const l of Object.values(lots)) l.createTask = creates.find(t => t.lot?.id === l.lotId);
  });

  test('Bon de commande : fournisseur et articles de la part imposés, un seul par part', async ({ request }) => {
    const H = auth(token);
    const poBody = (l, overrides = {}) => ({
      requisitionId: req.id, taskId: l.createTask.id, supplierId: l.supplier.id, currency: 'USD',
      totalAmount: l.itemIds.length * 900, deliveryDate: future(20),
      items: l.itemIds.map(id => ({ description: req.items.find(i => i.id === id).item_description, quantity: 1, unitPrice: 900, requisitionItemId: id })),
      ...overrides,
    });
    const wrongSupplier = await request.post('/api/purchase-orders', { headers: H, data: poBody(lots.A, { supplierId: lots.B.supplier.id }) });
    expect(wrongSupplier.status()).toBe(409);
    expect((await wrongSupplier.json()).code).toBe('LOT_SUPPLIER_MISMATCH');
    const wrongItems = await request.post('/api/purchase-orders', { headers: H, data: poBody(lots.A, { items: poBody(lots.B).items }) });
    expect(wrongItems.status()).toBe(400);
    expect((await wrongItems.json()).code).toBe('LOT_ITEMS_MISMATCH');

    for (const l of Object.values(lots)) {
      const created = await request.post('/api/purchase-orders', { headers: H, data: poBody(l) });
      const body = await created.json();
      expect(created.status(), JSON.stringify(body)).toBe(201);
      l.po = body.data;
    }
    const again = await request.post('/api/purchase-orders', { headers: H, data: poBody(lots.A, { taskId: undefined }) });
    expect(again.status()).toBe(409);
    expect((await again.json()).code).toBe('LOT_ALREADY_ORDERED');

    const approvals = await waitForTasks(request, 'Activity_POApproval', 3);
    expect(approvals.map(t => String(t.lot?.poId)).sort()).toEqual(Object.values(lots).map(l => String(l.po.id)).sort());
    expect((await openTasks(request)).some(t => t.taskDefinitionKey === 'Activity_CreatePO')).toBe(false);
  });

  test('Part C rejetée : les parts A et B continuent', async ({ request }) => {
    const reject = await request.post(`/api/purchase-orders/${lots.C.po.id}/reject`, { headers: auth(approverToken), data: { reason: 'Prix trop élevé' } });
    expect(reject.status(), await reject.text()).toBe(200);
    for (const l of [lots.A, lots.B]) {
      const ok = await request.post(`/api/purchase-orders/${l.po.id}/approve`, { headers: auth(approverToken), data: { comments: 'ok' } });
      expect(ok.status(), await ok.text()).toBe(200);
    }
    const confirmations = await waitForTasks(request, 'Activity_SupplierConfirmation', 2);
    expect(confirmations.map(t => String(t.lot?.poId)).sort()).toEqual([lots.A, lots.B].map(l => String(l.po.id)).sort());
    expect((await openTasks(request)).some(t => String(t.lot?.poId) === String(lots.C.po.id))).toBe(false);
  });

  test('Parts A et B en parallèle : confirmation → SAN → réception, chacune sur son bon', async ({ request }) => {
    const H = auth(token);
    for (const l of [lots.A, lots.B]) {
      const res = await request.post(`/api/purchase-orders/${l.po.id}/supplier-response`, { headers: H, data: { response: 'CONFIRMED', deliveryDate: future(5) } });
      expect(res.status(), await res.text()).toBe(200);
    }
    // Deux SAN ouvertes en même temps : celle de B d'abord, avec le taskId de A (ignoré : la tâche de B est terminée)
    const sans = await waitForTasks(request, 'Activity_ServiceAcceptance', 2);
    const sanA = sans.find(t => String(t.lot?.poId) === String(lots.A.po.id));
    const sanB = await request.post('/api/service-acceptance-notes', { headers: H, data: { poId: lots.B.po.id, taskId: sanA.id, serviceAccepted: true, comments: 'Conforme' } });
    expect([200, 201], await sanB.text()).toContain(sanB.status());
    await taskOfPo(request, 'Activity_GoodsReceipt', lots.B.po);
    expect((await openTasks(request)).some(t => t.id === sanA.id)).toBe(true);
    const sanARes = await request.post('/api/service-acceptance-notes', { headers: H, data: { poId: lots.A.po.id, taskId: sanA.id, serviceAccepted: true, comments: 'Conforme' } });
    expect([200, 201], await sanARes.text()).toContain(sanARes.status());

    for (const l of [lots.A, lots.B]) {
      const grnTask = await taskOfPo(request, 'Activity_GoodsReceipt', l.po);
      const poItems = (await (await request.get(`/api/purchase-orders/${l.po.id}`, { headers: H })).json()).data.items;
      const grnRes = await request.post('/api/goods-receipts', { headers: H, data: {
        poId: l.po.id, taskId: grnTask.id, observations: 'Reçu',
        grnItems: poItems.map(it => ({ po_item_id: it.id, item_description: it.item_description, quantity_ordered: 1, quantity_received: 1, quantity_accepted: 1, quantity_rejected: 0 })),
      } });
      const grnBody = await grnRes.json();
      expect([200, 201], JSON.stringify(grnBody)).toContain(grnRes.status());
      expect(grnBody.camundaTaskCompleted).toBe(true);
      l.grn = grnBody.data;
    }
  });

  test('Une facture et un paiement par part → réquisition terminée', async ({ request }) => {
    const H = auth(token);
    for (const l of [lots.A, lots.B]) {
      const invTask = await taskOfPo(request, 'Activity_EnterInvoice', l.po);
      const amount = l.itemIds.length * 900;
      const invRes = await request.post('/api/invoices', { headers: H, data: {
        poId: l.po.id, grnId: l.grn.id, taskId: invTask.id, supplierInvoiceNumber: `F-SPLIT-${l.po.id}-${Date.now()}`,
        invoiceDate: future(0), dueDate: future(30), subtotal: amount, taxAmount: 0, totalAmount: amount, currency: 'USD',
      } });
      const invBody = await invRes.json();
      expect([200, 201], JSON.stringify(invBody)).toContain(invRes.status());
      expect(invBody.camundaTaskCompleted).toBe(true);

      const payTask = await taskOfPo(request, 'Activity_ProcessPayment', l.po);
      const payRes = await request.post('/api/payments', { headers: H, data: {
        invoiceId: invBody.data.id, taskId: payTask.id, amount, currency: 'USD', paymentMethod: 'BANK_TRANSFER',
        paymentDate: future(0), reference: `PAY-SPLIT-${l.po.id}-${Date.now()}`,
      } });
      const payBody = await payRes.json();
      expect([200, 201], JSON.stringify(payBody)).toContain(payRes.status());
      expect(payBody.camundaTaskCompleted).toBe(true);
    }
    // Dernière part payée : le sous-processus se termine, la clôture (close_requisition) passe la réquisition COMPLETED
    // — la part rejetée (C) ne compte pas parmi les commandes actives
    await expect.poll(async () => (await openTasks(request)).length, { timeout: POLL_TIMEOUT }).toBe(0);
    await expect.poll(async () => (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data.status,
      { timeout: POLL_TIMEOUT }).toBe('COMPLETED');
    const panel = (await (await request.get(`/api/requisitions/${req.id}/supplier-lots`, { headers: H })).json()).data;
    expect(panel.map(l => [l.lot_number, l.paid])).toEqual([[1, true], [2, true], [3, false]]);

    const timeline = (await (await request.get(`/api/requisitions/${req.id}/timeline`, { headers: H })).json()).data;
    const steps = Object.fromEntries((timeline.steps || []).map(s => [s.key, s]));
    console.log('étapes :', (timeline.steps || []).map(s => `${s.key}=${s.status}${s.info ? ` (${s.info})` : ''}`).join(' | '));
    expect(steps.allocation?.status).toBe('done');
    expect(steps.po.info).toContain('2 / 2');
  });
});
