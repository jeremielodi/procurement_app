/**
 * tests/api/procurement-method.spec.js
 *
 * Méthode d'achat choisie par les achats (Activity_DetermineType) puis cycle complet piloté par GoFlow :
 * la classification (worker classify_procurement) reprend le choix au lieu de le recalculer d'après le montant.
 *   - choix obligatoire, refusé s'il est moins exigeant que le montant (sauf source unique justifiée)
 *   - Source unique → « Justification source unique » → « Créer le bon de commande »
 *   - Achat direct  → « Achat direct » → « Créer le bon de commande »
 *   - puis approbation du PO, confirmation fournisseur, réception, SAN, facture, paiement → processus terminé
 *
 * Requiert GoFlow (sinon les tests s'ignorent).
 */
import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth } from './helpers.js';

const POLL_TIMEOUT = 60_000;
const SOURCING_TASKS = ['Activity_DirectPurchase', 'Activity_RequestQuotations', 'Activity_RFPProcess', 'Activity_SoleSource'];
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

let token, approverToken;

async function openTasks(request, pid) {
  const res = await request.get(`/api/tasks/process/${pid}`, { headers: auth(token) });
  if (!res.ok()) return [];
  const body = await res.json();
  return (body.data || body.tasks || []).filter(t => t.status !== 'COMPLETED');
}

async function waitForTask(request, req, key) {
  let task = null;
  await expect.poll(async () => {
    task = (await openTasks(request, req.process_instance_id)).find(t => t.taskDefinitionKey === key) || null;
    return !!task;
  }, { message: `tâche ${key}`, timeout: POLL_TIMEOUT, intervals: [2000] }).toBe(true);
  return task;
}

const complete = (request, task, variables, tk = token) =>
  request.post(`/api/tasks/${task.id}/complete`, { headers: auth(tk), data: { variables } });

/**
 * method : méthode choisie ; sourcingTask : étape attendue ensuite ; amount : montant de la réquisition
 * refused : méthode moins exigeante que le montant (refusée) + méthode exigée, ou null
 */
function scenario({ method, sourcingTask, amount, justification, refused }) {
  test.describe.serial(`${method} (${amount}) → cycle complet GoFlow`, () => {
    let req, po, grn;

    test('Réquisition approuvée (N1) → « Déterminer la méthode d\'achat »', async ({ request }) => {
      token = await getToken(request);
      approverToken = await getApproverToken(request);
      const H = auth(token);
      const [depts, projects] = await Promise.all([
        request.get('/api/departments', { headers: H }).then(r => r.json()).then(b => b.data || []),
        request.get('/api/projects', { headers: H }).then(r => r.json()).then(b => b.data || []),
      ]);
      const project = projects[0];
      const line = (await (await request.post('/api/budget', { headers: H, data: {
        entityCode: `BL-METH-${Date.now()}`, description: 'Ligne test méthode d\'achat', allocatedAmount: 1000000, projectId: project.id,
      } })).json()).data;

      const created = await request.post('/api/requisitions', { headers: H, data: {
        title: `[TEST METHODE ${method}] ${Date.now()}`, description: method, departmentId: depts[0].id, projectId: project.id,
        estimatedAmount: amount, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'Test',
        items: [{ description: 'Pièce constructeur', quantity: 1, frequency: 1, unitPrice: amount, budgetLineId: line?.id ?? line }],
      } });
      expect(created.status()).toBe(201);
      req = (await created.json()).data;
      await expect.poll(async () => {
        req = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data;
        return req.process_instance_id || null;
      }, { timeout: 15_000 }).toBeTruthy();

      const n1 = await waitForTask(request, req, 'Activity_ValidationN1_Manager');
      expect((await complete(request, n1, { approved: true, comment: 'OK' }, approverToken)).status()).toBe(200);
      await waitForTask(request, req, 'Activity_DetermineType');
    });

    test('Choix contrôlé par le serveur', async ({ request }) => {
      const task = await waitForTask(request, req, 'Activity_DetermineType');
      const noMethod = await complete(request, task, { justification: 'x' });
      expect(noMethod.status()).toBe(400);
      expect((await noMethod.json()).code).toBe('PROCUREMENT_METHOD_REQUIRED');

      if (refused) {
        const res = await complete(request, task, { procurementMethod: refused.method });
        expect(res.status()).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('METHOD_BELOW_THRESHOLD');
        expect(body.requiredMethod).toBe(refused.required);
      }
      const noJustif = await complete(request, task, { procurementMethod: 'SOLE_SOURCE', justification: '  ' });
      expect((await noJustif.json()).code).toBe('JUSTIFICATION_REQUIRED');

      expect((await openTasks(request, req.process_instance_id)).some(t => t.taskDefinitionKey === 'Activity_DetermineType')).toBe(true);
    });

    test(`${method} → ${sourcingTask} → création du PO`, async ({ request }) => {
      const task = await waitForTask(request, req, 'Activity_DetermineType');
      const res = await complete(request, task, { procurementMethod: method, ...(justification ? { justification } : {}) });
      expect(res.status()).toBe(200);

      const sourcing = await waitForTask(request, req, sourcingTask);
      const keys = (await openTasks(request, req.process_instance_id)).map(t => t.taskDefinitionKey);
      for (const other of SOURCING_TASKS.filter(k => k !== sourcingTask)) expect(keys).not.toContain(other);
      const current = (await (await request.get(`/api/requisitions/${req.id}`, { headers: auth(token) })).json()).data;
      expect(current.status).toBe(`CLASSIFIED_${method}`);

      expect((await complete(request, sourcing, { comment: 'Étape réalisée' })).status()).toBe(200);
      await waitForTask(request, req, 'Activity_CreatePO');
    });

    test('PO créé (termine Activity_CreatePO) puis approuvé par un autre administrateur', async ({ request }) => {
      const H = auth(token);
      const supplier = (await (await request.get('/api/suppliers', { headers: H })).json()).data[0];
      const created = await request.post('/api/purchase-orders', { headers: H, data: {
        requisitionId: req.id, supplierId: supplier.id, currency: 'USD', totalAmount: amount, deliveryDate: future(20),
        items: [{ description: 'Pièce constructeur', quantity: 1, unitPrice: amount }],
      } });
      const body = await created.json();
      expect([200, 201], JSON.stringify(body)).toContain(created.status());
      po = body.data;
      await waitForTask(request, req, 'Activity_POApproval');

      expect((await request.post(`/api/purchase-orders/${po.id}/approve`, { headers: auth(approverToken), data: { comments: 'ok' } })).status()).toBe(200);
      await waitForTask(request, req, 'Activity_SupplierConfirmation');
    });

    test('Confirmation fournisseur → réception → SAN', async ({ request }) => {
      const H = auth(token);
      const confirm = await request.post(`/api/purchase-orders/${po.id}/supplier-response`, { headers: H, data: { response: 'CONFIRMED', deliveryDate: future(5) } });
      expect(confirm.status(), JSON.stringify(await confirm.json())).toBe(200);

      const grnTask = await waitForTask(request, req, 'Activity_GoodsReceipt');
      const poItem = (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: H })).json()).data.items[0];
      const grnRes = await request.post('/api/goods-receipts', { headers: H, data: {
        poId: po.id, taskId: grnTask.id, observations: 'Reçu',
        grnItems: [{ po_item_id: poItem.id, item_description: 'Pièce constructeur', quantity_ordered: 1, quantity_received: 1, quantity_accepted: 1, quantity_rejected: 0 }],
      } });
      const grnBody = await grnRes.json();
      expect([200, 201], JSON.stringify(grnBody)).toContain(grnRes.status());
      grn = grnBody.data;

      const sanTask = await waitForTask(request, req, 'Activity_ServiceAcceptance');
      const sanRes = await request.post('/api/service-acceptance-notes', { headers: H, data: { poId: po.id, taskId: sanTask.id, serviceAccepted: true, comments: 'Conforme' } });
      expect([200, 201], JSON.stringify(await sanRes.json())).toContain(sanRes.status());
    });

    test('Facture → paiement → processus terminé', async ({ request }) => {
      const H = auth(token);
      const invTask = await waitForTask(request, req, 'Activity_EnterInvoice');
      const invRes = await request.post('/api/invoices', { headers: H, data: {
        poId: po.id, grnId: grn.id, taskId: invTask.id, supplierInvoiceNumber: `F-METH-${Date.now()}`,
        invoiceDate: future(0), dueDate: future(30), subtotal: amount, taxAmount: 0, totalAmount: amount, currency: 'USD',
      } });
      const invBody = await invRes.json();
      expect([200, 201], JSON.stringify(invBody)).toContain(invRes.status());

      const payTask = await waitForTask(request, req, 'Activity_ProcessPayment');
      const payRes = await request.post('/api/payments', { headers: H, data: {
        invoiceId: invBody.data.id, taskId: payTask.id, amount, currency: 'USD', paymentMethod: 'BANK_TRANSFER',
        paymentDate: future(0), reference: `PAY-METH-${Date.now()}`,
      } });
      expect([200, 201], JSON.stringify(await payRes.json())).toContain(payRes.status());

      await expect.poll(async () => (await openTasks(request, req.process_instance_id)).length, { timeout: POLL_TIMEOUT }).toBe(0);
      const timeline = (await (await request.get(`/api/requisitions/${req.id}/timeline`, { headers: H })).json()).data;
      console.log(`[${method}] étapes :`, (timeline.steps || []).map(s => `${s.key || s.id}=${s.status}`).join(' | '));
      expect((timeline.steps || []).every(s => s.status !== 'current' && s.status !== 'failed')).toBe(true);
    });
  });
}

// Montant > 5 000 : l'achat direct est refusé, la source unique (justifiée) reste possible
scenario({
  method: 'SOLE_SOURCE', sourcingTask: 'Activity_SoleSource', amount: 10000,
  justification: 'Seul distributeur agréé du constructeur',
  refused: { method: 'DIRECT_PURCHASE', required: 'MULTIPLE_QUOTATIONS' },
});

// Montant ≤ 5 000 : achat direct
scenario({ method: 'DIRECT_PURCHASE', sourcingTask: 'Activity_DirectPurchase', amount: 4000 });
