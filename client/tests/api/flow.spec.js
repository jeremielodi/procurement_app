/**
 * tests/api/flow.spec.js
 *
 * Test séquentiel du cycle procure-to-pay complet via l'API.
 * Chaque step construit sur le précédent via des variables de module partagées.
 *
 * Prérequis :
 *   - Backend démarré  (http://localhost:5000)
 *   - PostgreSQL accessible
 *   - Camunda/GoFlow en cours (pour les étapes 4-6) — sinon, ces steps sont skipped
 *   - Au moins un département et un fournisseur dans la DB
 *
 * Lancer avec :
 *   npx playwright test tests/api/flow.spec.js --project=api --reporter=line
 */
import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// ── Shared state ──────────────────────────────────────────────────────────────
let token      = null;
let dept       = null;
let supplier   = null;
let project    = null;
let budgetLine = null;  // budget allocation ID for the test item

let requisition   = null;   // { id, requisition_number, process_instance_id, ... }
let approvalTask  = null;   // Camunda task object for Manager N1 approval
let purchaseOrder = null;   // { id, po_number, ... }
let grn           = null;   // { id, grnNumber, status, grnCompliant }
let invoice       = null;   // { id, invoiceNumber, matchStatus }
let payment       = null;   // { id, paymentNumber, amount }

const FLOW_AMOUNT  = 10000;  // < 25 000 → Manager N1 approval only
const POLL_TIMEOUT = 60_000; // 60 s pour que les workers Camunda s'exécutent
const POLL_INTERVAL = 3_000; // sondage toutes les 3 s

// Helper : sonde GET /api/tasks/process/:pid jusqu'à trouver une tâche avec le bon taskDefinitionKey
async function waitForTask(request, processInstanceId, taskDefinitionKey) {
  let found = null;
  await expect.poll(async () => {
    const res  = await request.get(`/api/tasks/process/${processInstanceId}`, { headers: auth(token) });
    if (!res.ok()) return null;
    const body = await res.json();
    found = (body.data || body.tasks || []).find(
      t => t.taskDefinitionKey === taskDefinitionKey
    );
    return found || null;
  }, {
    message: `Waiting for Camunda task "${taskDefinitionKey}"`,
    timeout:   POLL_TIMEOUT,
    intervals: [POLL_INTERVAL],
  }).toBeTruthy();
  return found;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
test.describe.serial('🔄 BPMN Procurement Flow — end to end', () => {

  // ── 0. Auth ────────────────────────────────────────────────────────────────
  test('0 · Authentification admin', async ({ request }) => {
    token = await getToken(request);
    expect(token).toBeTruthy();

    // Charger département, fournisseur et projet pour les étapes suivantes
    const [deptRes, suppRes, projRes] = await Promise.all([
      request.get('/api/departments', { headers: auth(token) }),
      request.get('/api/suppliers',   { headers: auth(token) }),
      request.get('/api/projects',    { headers: auth(token) }),
    ]);
    const deptBody = await deptRes.json();
    const suppBody = await suppRes.json();
    const projBody = await projRes.json();
    dept     = deptBody.data?.[0] ?? null;
    supplier = suppBody.data?.[0] ?? null;
    project  = projBody.data?.[0] ?? null;

    if (!dept)    console.warn('⚠️  Aucun département — certains tests seront skippés');
    if (!project) console.warn('⚠️  Aucun projet — certains tests seront skippés');

    // Créer un fournisseur de test s'il n'en existe pas
    if (!supplier) {
      const createRes = await request.post('/api/suppliers', {
        headers: auth(token),
        data: {
          name:          'Fournisseur Test Playwright',
          code:          'TEST-SUPP-PW',
          email:         'test-supplier@playwright.test',
          phone:         '+237600000000',
          address:       'Yaoundé, Cameroun',
          country:       'Cameroun',
          prequalified:  true,
        }
      });
      if (createRes.status() === 200 || createRes.status() === 201) {
        // Re-fetch suppliers to get the newly created supplier with its ID
        const listRes  = await request.get('/api/suppliers', { headers: auth(token) });
        const listBody = await listRes.json();
        supplier = listBody.data?.[0] ?? null;
        console.log(`✅  Fournisseur créé: ${supplier?.name} (id: ${supplier?.id})`);
      } else {
        console.warn('⚠️  Impossible de créer un fournisseur — PO test sera skippé');
      }
    }

    // Créer une ligne budgétaire de test s'il n'en existe pas (évite BUDGET_INSUFFICIENT)
    if (project) {
      const budgetRes = await request.get(`/api/budget/by-project/${project.id}`, { headers: auth(token) });
      const budgetBody = budgetRes.ok() ? await budgetRes.json() : { data: [] };
      budgetLine = budgetBody.data?.[0] ?? null;

      if (!budgetLine) {
        const createBudget = await request.post('/api/budget', {
          headers: auth(token),
          data: {
            entityCode:      'TEST-BL-PW',
            description:     'Ligne budget test Playwright',
            allocatedAmount: 1000000,
            projectId:       project.id,
          }
        });
        if (createBudget.status() === 200 || createBudget.status() === 201) {
          const bb = await createBudget.json();
          budgetLine = bb.data ?? null;
          console.log(`✅  Ligne budgétaire créée: ${budgetLine?.id ?? budgetLine}`);
        } else {
          console.warn('⚠️  Impossible de créer une ligne budgétaire — budget check échouera');
        }
      } else {
        console.log(`✅  Ligne budgétaire existante: ${budgetLine.id}`);
      }
    }
  });

  // ── 1. Créer une réquisition ───────────────────────────────────────────────
  test('1 · Créer une réquisition (10 000 XAF)', async ({ request }) => {
    if (!dept) test.skip('Pas de département dans la DB');

    const res  = await request.post('/api/requisitions', {
      headers: auth(token),
      data: {
        title:           `[TEST FLOW] ${Date.now()}`,
        description:     'Playwright BPMN end-to-end flow test',
        departmentId:    dept.id,
        projectId:       project?.id,
        estimatedAmount: FLOW_AMOUNT,
        currencyId:      1,         // USD (seed)
        currencyCode:    'USD',
        priority:        'MEDIUM',
        justification:   'Test automatisé',
        items: [
          {
            description:  'Article test Playwright',
            quantity:     1,
            frequency:    1,
            unitPrice:    FLOW_AMOUNT,
            budgetLineId: budgetLine?.id ?? budgetLine ?? undefined,
          }
        ]
      }
    });
    const body = await res.json();

    expect(res.status(), `Création réquisition: ${JSON.stringify(body)}`).toBe(201);
    expect(body.success).toBe(true);
    requisition = body.data;

    console.log(`✅  Réquisition ${requisition.requisition_number ?? requisition.number} créée`);
    console.log(`    process_instance_id: ${requisition.process_instance_id ?? '—'}`);

    // Si Camunda n'est pas démarré, process_instance_id sera null mais le test continue
  });

  // ── 2. Vérifier que la réquisition existe en DB ────────────────────────────
  test('2 · GET /api/requisitions/:id retourne la réquisition', async ({ request }) => {
    if (!requisition) test.skip('Réquisition non créée');

    const res  = await request.get(`/api/requisitions/${requisition.id}`, { headers: auth(token) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.data.id).toBe(requisition.id);
    // Status depends on Camunda: DRAFT/IN_PROGRESS (initial), or further along the workflow
    const VALID_STATUSES = ['DRAFT', 'IN_PROGRESS', 'PENDING', 'BUDGET_INSUFFICIENT', 'BUDGET_ADJUSTMENT', 'APPROVED'];
    expect(VALID_STATUSES).toContain(body.data.status);
    requisition = body.data;
  });

  // ── 3. Camunda : attendre la tâche d'approbation N1 ───────────────────────
  test('3 · [Camunda] Attendre la tâche Activity_ValidationN1_Manager', async ({ request }) => {
    if (!requisition?.process_instance_id) {
      test.skip('Camunda non disponible (process_instance_id absent)');
      return;
    }
    // If budget check failed, the process is at BudgetAdjustment — not at the approval task
    if (requisition.status === 'BUDGET_INSUFFICIENT' || requisition.status === 'BUDGET_ADJUSTMENT') {
      test.skip('Budget insuffisant — le workflow est en attente d\'ajustement budgétaire, pas d\'approbation N1');
      return;
    }

    approvalTask = await waitForTask(
      request,
      requisition.process_instance_id,
      'Activity_ValidationN1_Manager'
    );
    console.log(`✅  Tâche approbation trouvée: ${approvalTask.id}`);
    expect(approvalTask.taskDefinitionKey).toBe('Activity_ValidationN1_Manager');
  });

  // ── 4. Camunda : compléter l'approbation Manager N1 ──────────────────────
  test('4 · [Camunda] Approuver la réquisition (Manager N1)', async ({ request }) => {
    if (!approvalTask) test.skip('Tâche approbation non trouvée (step 3 skipped)');

    const res  = await request.post(`/api/tasks/${approvalTask.id}/complete`, {
      headers: auth(token),
      data: {
        variables: { approved: true },
        taskDefinitionKey: 'Activity_ValidationN1_Manager',
        requisitionId:     requisition.id,
        estimatedAmount:   FLOW_AMOUNT,
      }
    });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);

    // Attendre mise à jour DB
    await new Promise(r => setTimeout(r, 2000));

    const reqRes  = await request.get(`/api/requisitions/${requisition.id}`, { headers: auth(token) });
    const reqBody = await reqRes.json();
    expect(reqBody.data.status).toBe('APPROVED');
    console.log(`✅  Réquisition APPROVED`);
  });

  // ── 5. Créer un bon de commande ────────────────────────────────────────────
  test('5 · Créer un Purchase Order', async ({ request }) => {
    if (!requisition) test.skip('Réquisition non disponible');
    if (!supplier)    test.skip('Pas de fournisseur dans la DB');

    const res  = await request.post('/api/purchase-orders', {
      headers: auth(token),
      data: {
        requisitionId:   requisition.id,
        supplierId:      supplier.id,
        totalAmount:     FLOW_AMOUNT,
        currency:        'USD',
        orderDate:       '2026-06-23',
        deliveryDate:    '2026-08-01',
        shippingAddress: 'WWF HQ — Test',
        items: [
          {
            description: 'Article test Playwright',
            quantity:    1,
            unitPrice:   FLOW_AMOUNT,
          }
        ]
      }
    });
    const body = await res.json();

    expect([200, 201], `PO create (${res.status()}): ${JSON.stringify(body)}`).toContain(res.status());
    expect(body.success, `PO create: ${JSON.stringify(body)}`).toBe(true);
    purchaseOrder = body.data;
    console.log(`✅  PO ${purchaseOrder.poNumber || purchaseOrder.po_number} créé`);
  });

  // ── 6. Soumettre le PO pour approbation (DRAFT → PO_PENDING) ─────────────
  test('6 · Soumettre le PO pour approbation (DRAFT → PO_PENDING)', async ({ request }) => {
    if (!purchaseOrder) test.skip('PO non créé');

    // Le PO est créé en DRAFT — il faut le passer en PO_PENDING avant approbation
    const res  = await request.put(`/api/purchase-orders/${purchaseOrder.id}`, {
      headers: auth(token),
      data: { status: 'PO_PENDING' }
    });
    const body = await res.json();

    expect([200, 201]).toContain(res.status());
    console.log(`✅  PO soumis — statut: ${body.data?.status ?? 'PO_PENDING'}`);
  });

  // ── 7. Approuver le bon de commande (PO_PENDING → PO_APPROVED) ────────────
  test('7 · Approuver le Purchase Order (PO_PENDING → PO_APPROVED)', async ({ request }) => {
    if (!purchaseOrder) test.skip('PO non créé');

    const res  = await request.post(`/api/purchase-orders/${purchaseOrder.id}/approve`, {
      headers: auth(token),
      data: { notes: 'Approuvé par test Playwright' }
    });
    const body = await res.json();
    expect([200, 201]).toContain(res.status());

    // Recharger le PO pour vérifier le statut
    const poRes  = await request.get(`/api/purchase-orders/${purchaseOrder.id}`, { headers: auth(token) });
    const poBody = await poRes.json();
    console.log(`✅  PO statut final: ${poBody.data?.status}`);
    expect(poBody.data?.status).toBe('PO_APPROVED');
    purchaseOrder = poBody.data;
  });

  // ── 8. Créer un bon de réception (GRN) ────────────────────────────────────
  test('8 · Créer un GRN (tous les articles reçus)', async ({ request }) => {
    if (!purchaseOrder) test.skip('PO non disponible');

    const res  = await request.post('/api/goods-receipts', {
      headers: auth(token),
      data: {
        poId: purchaseOrder.id,
        observations: 'Tous les articles reçus en bon état — test Playwright',
        grnItems: [
          {
            item_description:  'Article test Playwright',
            quantity_ordered:  1,
            quantity_received: 1,
            quantity_accepted: 1,
            quantity_rejected: 0,
            rejection_reason:  '',
          }
        ]
      }
    });
    const body = await res.json();

    expect([200, 201]).toContain(res.status());
    expect(body.success, `GRN create: ${JSON.stringify(body)}`).toBe(true);
    grn = body.data;

    console.log(`✅  GRN ${grn.grnNumber} créé — statut: ${grn.status} | conforme: ${grn.grnCompliant}`);
    expect(grn.status).toBe('COMPLETE');
    expect(grn.grnCompliant).toBe(true);
  });

  // ── 9. Créer une facture (déclenche le rapprochement 3 voies) ─────────────
  test('9 · Créer une facture et vérifier le rapprochement 3 voies', async ({ request }) => {
    if (!purchaseOrder || !grn) test.skip('PO ou GRN manquant');

    const res  = await request.post('/api/invoices', {
      headers: auth(token),
      data: {
        poId:        purchaseOrder.id,
        grnId:       grn.id,
        invoiceDate: '2026-06-23',
        dueDate:     '2026-07-23',
        subtotal:    FLOW_AMOUNT,
        taxAmount:   0,
        totalAmount: FLOW_AMOUNT,
        currency:    'USD',
        notes:       'Facture test Playwright',
      }
    });
    const body = await res.json();

    expect([200, 201]).toContain(res.status());
    expect(body.success, `Invoice create: ${JSON.stringify(body)}`).toBe(true);
    invoice = body.data;

    console.log(`✅  Facture ${invoice.invoiceNumber} créée`);
    console.log(`    Rapprochement 3 voies: ${invoice.match_status}`);

    // Le rapprochement doit être MATCHED :
    //   Check 1 — montant facture ≤ PO × 1.02 ✓ (10 000 ≤ 10 200)
    //   Check 2 — GRN status = COMPLETE ✓
    expect(invoice.match_status).toBe('MATCHED');
  });

  // ── 10. Vérifier les détails de la facture ─────────────────────────────────
  test('10 · GET /api/invoices/:id — match_details contient les 2 checks', async ({ request }) => {
    if (!invoice) test.skip('Facture non créée');

    const res  = await request.get(`/api/invoices/${invoice.id}`, { headers: auth(token) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    const data = body.data;
    expect(data.match_status).toBe('MATCHED');

    const checks = data.match_details?.checks;
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThanOrEqual(2);
    checks.forEach(c => expect(c.passed).toBe(true));
    console.log(`✅  3-way match checks: ${checks.map(c => c.message).join(' | ')}`);
  });

  // ── 10. Créer un paiement ──────────────────────────────────────────────────
  test('10 · Créer un paiement', async ({ request }) => {
    if (!invoice) test.skip('Facture non disponible');

    const res  = await request.post('/api/payments', {
      headers: auth(token),
      data: {
        invoiceId:     invoice.id,
        amount:        FLOW_AMOUNT,
        currency:      'USD',
        paymentMethod: 'BANK_TRANSFER',
        paymentDate:   '2026-06-23',
        reference:     `PAY-TEST-${Date.now()}`,
        bankAccount:   'IBAN-TEST-001',
        notes:         'Paiement test Playwright',
      }
    });
    const body = await res.json();

    expect([200, 201]).toContain(res.status());
    expect(body.success, `Payment create: ${JSON.stringify(body)}`).toBe(true);
    payment = body.data;
    console.log(`✅  Paiement ${payment.paymentNumber} créé — montant: ${payment.amount} ${payment.currency}`);
    expect(parseFloat(payment.amount)).toBe(FLOW_AMOUNT);
  });

  // ── 11. Vérifier la facture est marquée PAID ───────────────────────────────
  test('11 · La facture est maintenant PAID', async ({ request }) => {
    if (!invoice || !payment) test.skip('Invoice ou payment manquant');

    const res  = await request.get(`/api/invoices/${invoice.id}`, { headers: auth(token) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    console.log(`✅  Statut facture après paiement: ${body.data.status}`);
    expect(['PAID', 'PARTIALLY_PAID']).toContain(body.data.status);
  });

  // ── 12. Récapitulatif du cycle complet ────────────────────────────────────
  test('12 · Récapitulatif — vérification finale de tous les états', async ({ request }) => {
    console.log('\n══════════════ BPMN FLOW SUMMARY ══════════════');
    console.log(`Réquisition : ${requisition?.requisition_number ?? 'N/A'} — ${requisition?.status ?? '?'}`);
    console.log(`PO          : ${purchaseOrder?.po_number ?? 'N/A'} — ${purchaseOrder?.status ?? '?'}`);
    console.log(`GRN         : ${grn?.grnNumber ?? 'N/A'} — ${grn?.status ?? '?'}`);
    console.log(`Facture     : ${invoice?.invoiceNumber ?? 'N/A'} — match: ${invoice?.matchStatus ?? '?'}`);
    console.log(`Paiement    : ${payment?.paymentNumber ?? 'N/A'} — ${payment?.status ?? '?'}`);
    console.log('═══════════════════════════════════════════════\n');

    // Au minimum la réquisition doit avoir été créée
    expect(requisition).toBeTruthy();
    expect(requisition.id).toBeTruthy();
  });
});

// ── Tests unitaires d'API séparés (CRUD rapide) ───────────────────────────────
test.describe('🔌 API CRUD — Vérifications rapides', () => {
  let _token;

  test.beforeAll(async ({ request }) => {
    _token = await getToken(request);
  });

  test('GET /api/requisitions retourne un tableau', async ({ request }) => {
    const res  = await request.get('/api/requisitions', { headers: auth(_token) });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/purchase-orders retourne un tableau', async ({ request }) => {
    const res  = await request.get('/api/purchase-orders', { headers: auth(_token) });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/goods-receipts retourne un tableau', async ({ request }) => {
    const res  = await request.get('/api/goods-receipts', { headers: auth(_token) });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/invoices retourne un tableau', async ({ request }) => {
    const res  = await request.get('/api/invoices', { headers: auth(_token) });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/payments retourne un tableau', async ({ request }) => {
    const res  = await request.get('/api/payments', { headers: auth(_token) });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/tasks/user retourne les tâches Camunda', async ({ request }) => {
    const res  = await request.get('/api/tasks/user', { headers: auth(_token) });
    const body = await res.json();
    // 200 même si Camunda n'est pas disponible (array vide)
    expect(res.status()).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    console.log(`Tasks disponibles: ${body.data.length}`);
  });

  test('POST sans body → 400 cohérent sur chaque endpoint', async ({ request }) => {
    const endpoints = [
      '/api/requisitions',
      '/api/purchase-orders',
      '/api/goods-receipts',
      '/api/invoices',
      '/api/payments',
    ];
    for (const ep of endpoints) {
      const res  = await request.post(ep, { headers: auth(_token), data: {} });
      const body = await res.json();
      expect(res.status(), `${ep} should return 4xx`).toBeGreaterThanOrEqual(400);
      expect(res.status(), `${ep} should not return 5xx`).toBeLessThan(500);
      expect(body.success).toBe(false);
    }
  });
});
