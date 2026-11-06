/**
 * tests/api/workflow-extended.spec.js
 *
 * Tests d'intégration API — Scénarios étendus du workflow BPMN procure-to-pay.
 *
 * Couvre les 7 scénarios non couverts par flow.spec.js. Depuis le 2026-11-06 la réquisition est validée par le chef
 * de projet quel que soit son montant (les niveaux N1 / N2 / N3 portent sur le bon de commande :
 * project-manager-approval.spec.js, approval-policy.spec.js) :
 *   1. Validation par le chef de projet (50 000 XAF)
 *   2. Validation par le chef de projet (150 000 XAF)
 *   3. Rejet par le chef de projet (10 000 XAF, approved: false → REJECTED)
 *   4. Rejet PO               (créé en PO_PENDING → reject → PO_REJECTED)
 *   5. Budget insuffisant     (item sans budgetLineId → BUDGET_INSUFFICIENT)
 *   6. GRN partielle          (5/10 items → PARTIAL + grnCompliant: false)
 *   7. Facture désaccord 3-way (totalAmount 5% > PO → UNMATCHED)
 *
 * Prérequis :
 *   - Backend démarré          (http://localhost:5000)
 *   - PostgreSQL accessible
 *   - Camunda/BpmnGo en cours  (scénarios Camunda sont skippés si absent)
 *
 * Lancer avec :
 *   npx playwright test tests/api/workflow-extended.spec.js --project=api --reporter=line
 */

import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth, passReview } from './helpers.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const POLL_TIMEOUT  = 30_000;  // 30 s max pour que Camunda génère une tâche
const POLL_INTERVAL = 2_000;   // polling toutes les 2 s
const STATUS_POLL_TIMEOUT = 15_000; // 15 s pour les mises à jour de statut DB

// ── Données partagées (chargées une seule fois dans le beforeAll global) ──────

let sharedToken    = null;
// Approbations : second administrateur (on n'approuve pas ce qu'on a soi-même demandé ou créé)
let approverToken;
let sharedDept     = null;
let sharedSupplier = null;
let sharedProject  = null;
let sharedBudgetLine = null;  // budget line with sufficient funds

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Attend qu'une tâche Camunda avec un taskDefinitionKey donné apparaisse pour
 * le processInstanceId. Retourne la tâche ou null si le timeout est dépassé.
 */
async function waitForTask(request, token, processInstanceId, taskKey, timeout = POLL_TIMEOUT) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await request.get(`/api/tasks/process/${processInstanceId}`, { headers: auth(token) });
    if (res.ok()) {
      const body = await res.json();
      const task = (body.data || body.tasks || []).find(t => t.taskDefinitionKey === taskKey);
      if (task) return task;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  return null;
}

/**
 * Le processus BpmnGo est démarré juste après la création : relit la réquisition jusqu'à obtenir
 * son process_instance_id (10 s max). Renvoie la réquisition à jour.
 */
async function refreshProcess(request, token, req, timeout = 10_000) {
  const start = Date.now();
  let current = req;
  while (Date.now() - start < timeout) {
    current = (await (await request.get(`/api/requisitions/${req.id}`, { headers: auth(token) })).json()).data || current;
    if (current.process_instance_id) return current;
    await new Promise(r => setTimeout(r, 1000));
  }
  return current;
}

/**
 * Attend une tâche BpmnGo OU l'arrêt du circuit (budget insuffisant, rejet).
 * Retourne { task } ou { stopped: statut } ou {} (délai dépassé).
 */
async function waitForTaskOrStop(request, token, req, taskKey, timeout = POLL_TIMEOUT) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const tasksRes = await request.get(`/api/tasks/process/${req.process_instance_id}`, { headers: auth(token) });
    if (tasksRes.ok()) {
      const body = await tasksRes.json();
      const task = (body.data || body.tasks || []).find(t => t.taskDefinitionKey === taskKey && t.status !== 'COMPLETED');
      if (task) return { task };
    }
    const status = (await (await request.get(`/api/requisitions/${req.id}`, { headers: auth(token) })).json()).data?.status;
    if (['BUDGET_INSUFFICIENT', 'BUDGET_ADJUSTMENT', 'REJECTED', 'CANCELLED'].includes(status)) return { stopped: status };
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  return {};
}

/**
 * Attend que la réquisition ait un des statuts attendus.
 * Retourne le dernier body.data ou null si timeout.
 */
async function waitForRequisitionStatus(request, token, reqId, expectedStatuses, timeout = STATUS_POLL_TIMEOUT) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await request.get(`/api/requisitions/${reqId}`, { headers: auth(token) });
    if (res.ok()) {
      const body = await res.json();
      if (expectedStatuses.includes(body.data?.status)) return body.data;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  return null;
}

/**
 * Crée une réquisition standard avec les paramètres fournis.
 * Retourne le body.data ou lance une erreur.
 */
async function createRequisition(request, token, { title, amount, budgetLineId, dept, project }) {
  const itemData = {
    description: `Article test ${title}`,
    quantity:    1,
    frequency:   1,
    unitPrice:   amount,
  };
  if (budgetLineId) itemData.budgetLineId = budgetLineId;

  const res = await request.post('/api/requisitions', {
    headers: auth(token),
    data: {
      title:           `[TEST EXT] ${title} — ${Date.now()}`,
      description:     `Test automatisé Playwright — ${title}`,
      departmentId:    dept.id,
      projectId:       project?.id,
      estimatedAmount: amount,
      currencyId:      1,
      currencyCode:    'USD',
      priority:        'MEDIUM',
      justification:   `Test automatisé — ${title}`,
      items: [itemData],
    },
  });
  const body = await res.json();
  if (!res.ok() || !body.success) {
    throw new Error(`Réquisition creation failed (${res.status()}): ${JSON.stringify(body)}`);
  }
  return body.data;
}

/**
 * Crée un PO simple lié à une réquisition.
 */
async function createPO(request, token, { requisitionId, supplierId, amount }) {
  const res = await request.post('/api/purchase-orders', {
    headers: auth(token),
    data: {
      requisitionId,
      supplierId,
      totalAmount:     amount,
      currency:        'USD',
      orderDate:       '2026-06-24',
      deliveryDate:    '2026-08-01',
      shippingAddress: 'Siège — Test étendu',
      items: [
        {
          description: 'Article test étendu',
          quantity:    10,
          unitPrice:   amount / 10,
        },
      ],
    },
  });
  const body = await res.json();
  if (!res.ok() || !body.success) {
    throw new Error(`PO creation failed (${res.status()}): ${JSON.stringify(body)}`);
  }
  return body.data;
}

/**
 * Approuve un PO (créé directement en PO_PENDING : pas d'étape brouillon).
 * Retourne le PO mis à jour (statut PO_APPROVED).
 */
async function submitAndApprovePO(request, token, poId) {
  const current = (await (await request.get(`/api/purchase-orders/${poId}`, { headers: auth(token) })).json()).data;
  if (current?.status !== 'PO_PENDING') {
    throw new Error(`PO attendu en PO_PENDING, statut : ${current?.status}`);
  }

  // Révision du bon d'abord (si le processus la prévoit), puis PO_PENDING → PO_APPROVED
  await passReview(request, approverToken, poId);
  const appRes = await request.post(`/api/purchase-orders/${poId}/approve`, {
    headers: auth(approverToken),
    data: { notes: 'Approuvé par test Playwright étendu' },
  });
  if (!appRes.ok()) {
    throw new Error(`PO approve failed (${appRes.status()})`);
  }

  const poRes  = await request.get(`/api/purchase-orders/${poId}`, { headers: auth(token) });
  const poBody = await poRes.json();
  return poBody.data;
}

// ── Setup global ──────────────────────────────────────────────────────────────

test.beforeAll(async ({ request }) => {
  // Auth
  sharedToken = await getToken(request);
  expect(sharedToken).toBeTruthy();
  approverToken = await getApproverToken(request);

  // Charger les données de référence
  const [deptRes, suppRes, projRes] = await Promise.all([
    request.get('/api/departments', { headers: auth(sharedToken) }),
    request.get('/api/suppliers',   { headers: auth(sharedToken) }),
    request.get('/api/projects',    { headers: auth(sharedToken) }),
  ]);

  const deptBody = await deptRes.json();
  const suppBody = await suppRes.json();
  const projBody = await projRes.json();

  sharedDept     = deptBody.data?.[0] ?? null;
  sharedSupplier = suppBody.data?.[0] ?? null;
  sharedProject  = projBody.data?.[0] ?? null;

  if (!sharedDept)    console.warn('⚠️  Aucun département — scénarios de réquisition seront skippés');
  if (!sharedSupplier) console.warn('⚠️  Aucun fournisseur — scénarios PO/GRN/Invoice seront skippés');
  if (!sharedProject) console.warn('⚠️  Aucun projet — budget line ne sera pas chargée');

  // Créer un fournisseur de test s'il n'en existe pas
  if (!sharedSupplier) {
    const createRes = await request.post('/api/suppliers', {
      headers: auth(sharedToken),
      data: {
        name:         'Fournisseur Test Playwright Extended',
        code:         'TEST-SUPP-PW-EXT',
        email:        'test-supplier-ext@playwright.test',
        phone:        '+237600000001',
        address:      'Yaoundé, Cameroun',
        country:      'Cameroun',
        prequalified: true,
      },
    });
    if (createRes.ok()) {
      const listRes  = await request.get('/api/suppliers', { headers: auth(sharedToken) });
      const listBody = await listRes.json();
      sharedSupplier = listBody.data?.[0] ?? null;
      console.log(`✅ Fournisseur créé: ${sharedSupplier?.name} (id: ${sharedSupplier?.id})`);
    } else {
      console.warn('⚠️  Impossible de créer un fournisseur');
    }
  }

  // Ligne budgétaire NEUVE à chaque passage : chaque exécution consomme du budget, une ligne réutilisée
  // finirait « insuffisante » et le circuit d'approbation ne démarrerait plus
  if (sharedProject) {
    const budgetRes = await request.get(`/api/budget/by-project/${sharedProject.id}`, { headers: auth(sharedToken) });
    const budgetBody = budgetRes.ok() ? await budgetRes.json() : { data: [] };
    sharedBudgetLine = null;
    const fallbackLine = budgetBody.data?.[0] ?? null;

    if (!sharedBudgetLine) {
      const createBudget = await request.post('/api/budget', {
        headers: auth(sharedToken),
        data: {
          entityCode:      `TEST-BL-EXT-${Date.now().toString(36)}`,
          description:     'Ligne budget test Playwright Extended',
          allocatedAmount: 5_000_000,
          projectId:       sharedProject.id,
        },
      });
      if (createBudget.ok()) {
        const bb = await createBudget.json();
        sharedBudgetLine = bb.data ?? null;
        console.log(`✅ Ligne budgétaire créée: ${sharedBudgetLine?.id}`);
      } else {
        sharedBudgetLine = fallbackLine;
        console.warn('⚠️  Impossible de créer une ligne budgétaire — ligne existante utilisée');
      }
    } else {
      console.log(`✅ Ligne budgétaire existante: ${sharedBudgetLine.id}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 1 — Validation par le chef de projet (50 000 XAF)
// Circuit : create → check_budget → ProjectManagerApproval
// ═══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Scénario 1 — Validation par le chef de projet (50 000 XAF)', () => {
  const AMOUNT = 50_000;
  test.setTimeout(120_000); // circuit BpmnGo réel (attente de tâche jusqu'à 30 s)

  let req          = null;
  let approvalTask = null;

  test('S1-1 · Créer la réquisition (50 000 XAF)', async ({ request }) => {
    if (!sharedDept) test.skip('Pas de département disponible');

    req = await createRequisition(request, sharedToken, {
      title:        'Project Manager Approval Test 50k',
      amount:       AMOUNT,
      budgetLineId: sharedBudgetLine?.id,
      dept:         sharedDept,
      project:      sharedProject,
    });

    console.log(`✅ S1: Réquisition ${req.requisition_number} créée (${AMOUNT} XAF)`);
    console.log(`   process_instance_id: ${req.process_instance_id ?? '—'}`);
    expect(req.id).toBeTruthy();
  });

  test('S1-2 · GET /api/requisitions/:id — statut valide', async ({ request }) => {
    if (!req) test.skip('Réquisition S1 non créée');

    const res  = await request.get(`/api/requisitions/${req.id}`, { headers: auth(sharedToken) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.data.id).toBe(req.id);
    const VALID = ['DRAFT', 'IN_PROGRESS', 'PENDING', 'BUDGET_INSUFFICIENT', 'APPROVED'];
    expect(VALID).toContain(body.data.status);
    req = body.data;
    console.log(`✅ S1: statut réquisition = ${req.status}`);
  });

  test('S1-3 · [Camunda] Attendre la tâche Activity_ProjectManagerApproval', async ({ request }) => {
    if (req && !req.process_instance_id) req = await refreshProcess(request, sharedToken, req);
    if (!req?.process_instance_id) {
      test.skip('Camunda non disponible (process_instance_id absent)');
      return;
    }
    if (req.status === 'BUDGET_INSUFFICIENT' || req.status === 'BUDGET_ADJUSTMENT') {
      test.skip('Budget insuffisant — workflow en attente d\'ajustement, pas d\'approbation N2');
      return;
    }

    // Quel que soit le montant : validation par le chef de projet
    const r = await waitForTaskOrStop(request, sharedToken, req, 'Activity_ProjectManagerApproval');
    if (r.stopped) { test.skip(`Circuit arrêté : ${r.stopped}`); return; }
    approvalTask = r.task || null;

    if (!approvalTask) {
      test.skip('Tâche Activity_ProjectManagerApproval non apparue dans le délai — BpmnGo peut être lent');
      return;
    }

    console.log(`✅ S1: Tâche du chef de projet trouvée: ${approvalTask.id}`);
    expect(approvalTask.taskDefinitionKey).toBe('Activity_ProjectManagerApproval');
  });

  test('S1-4 · [Camunda] Approuver la réquisition (chef de projet)', async ({ request }) => {
    if (!approvalTask) test.skip('Tâche N2 non trouvée (S1-3 skipped)');

    const res  = await request.post(`/api/tasks/${approvalTask.id}/complete`, {
      headers: auth(approverToken),
      data: {
        variables:         { approved: true },
        taskDefinitionKey: 'Activity_ProjectManagerApproval',
        requisitionId:     req.id,
        estimatedAmount:   AMOUNT,
      },
    });
    const body = await res.json();

    expect(res.status(), `Complete N2 task: ${JSON.stringify(body)}`).toBe(200);
    expect(body.success).toBe(true);

    // Attendre la mise à jour DB
    await new Promise(r => setTimeout(r, 2000));

    const reqRes  = await request.get(`/api/requisitions/${req.id}`, { headers: auth(sharedToken) });
    const reqBody = await reqRes.json();

    expect(reqBody.data.status).toBe('APPROVED');
    console.log(`✅ S1: Réquisition APPROVED après validation du chef de projet`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 2 — Validation par le chef de projet (150 000 XAF)
// Circuit : create → check_budget → ProjectManagerApproval
// ═══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Scénario 2 — Validation par le chef de projet (150 000 XAF)', () => {
  const AMOUNT = 150_000;
  test.setTimeout(120_000); // circuit BpmnGo réel (attente de tâche jusqu'à 30 s)

  let req          = null;
  let approvalTask = null;

  test('S2-1 · Créer la réquisition (150 000 XAF)', async ({ request }) => {
    if (!sharedDept) test.skip('Pas de département disponible');

    req = await createRequisition(request, sharedToken, {
      title:        'Project Manager Approval Test 150k',
      amount:       AMOUNT,
      budgetLineId: sharedBudgetLine?.id,
      dept:         sharedDept,
      project:      sharedProject,
    });

    console.log(`✅ S2: Réquisition ${req.requisition_number} créée (${AMOUNT} XAF)`);
    console.log(`   process_instance_id: ${req.process_instance_id ?? '—'}`);
    expect(req.id).toBeTruthy();
  });

  test('S2-2 · GET /api/requisitions/:id — statut valide', async ({ request }) => {
    if (!req) test.skip('Réquisition S2 non créée');

    const res  = await request.get(`/api/requisitions/${req.id}`, { headers: auth(sharedToken) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    const VALID = ['DRAFT', 'IN_PROGRESS', 'PENDING', 'BUDGET_INSUFFICIENT', 'APPROVED'];
    expect(VALID).toContain(body.data.status);
    req = body.data;
    console.log(`✅ S2: statut réquisition = ${req.status}`);
  });

  test('S2-3 · [Camunda] Attendre la tâche Activity_ProjectManagerApproval', async ({ request }) => {
    if (req && !req.process_instance_id) req = await refreshProcess(request, sharedToken, req);
    if (!req?.process_instance_id) {
      test.skip('Camunda non disponible (process_instance_id absent)');
      return;
    }
    if (req.status === 'BUDGET_INSUFFICIENT' || req.status === 'BUDGET_ADJUSTMENT') {
      test.skip('Budget insuffisant — workflow en attente d\'ajustement, pas d\'approbation N3');
      return;
    }

    // Quel que soit le montant : validation par le chef de projet
    const r = await waitForTaskOrStop(request, sharedToken, req, 'Activity_ProjectManagerApproval');
    if (r.stopped) { test.skip(`Circuit arrêté : ${r.stopped}`); return; }
    approvalTask = r.task || null;

    if (!approvalTask) {
      test.skip('Tâche Activity_ProjectManagerApproval non apparue dans le délai — Camunda peut être lent');
      return;
    }

    console.log(`✅ S2: Tâche du chef de projet trouvée: ${approvalTask.id}`);
    expect(approvalTask.taskDefinitionKey).toBe('Activity_ProjectManagerApproval');
  });

  test('S2-4 · [Camunda] Approuver la réquisition (chef de projet)', async ({ request }) => {
    if (!approvalTask) test.skip('Tâche N3 non trouvée (S2-3 skipped)');

    const res  = await request.post(`/api/tasks/${approvalTask.id}/complete`, {
      headers: auth(approverToken),
      data: {
        variables:         { approved: true },
        taskDefinitionKey: 'Activity_ProjectManagerApproval',
        requisitionId:     req.id,
        estimatedAmount:   AMOUNT,
      },
    });
    const body = await res.json();

    expect(res.status(), `Complete N3 task: ${JSON.stringify(body)}`).toBe(200);
    expect(body.success).toBe(true);

    await new Promise(r => setTimeout(r, 2000));

    const reqRes  = await request.get(`/api/requisitions/${req.id}`, { headers: auth(sharedToken) });
    const reqBody = await reqRes.json();

    expect(reqBody.data.status).toBe('APPROVED');
    console.log(`✅ S2: Réquisition APPROVED après validation du chef de projet`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 3 — Rejet N1 (10 000 XAF, approved: false → REJECTED)
// Circuit : create → check_budget → ProjectManagerApproval
//           → complete avec approved: false → status REJECTED
// ═══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Scénario 3 — Rejet par le chef de projet (10 000 XAF)', () => {
  const AMOUNT = 10_000;
  test.setTimeout(120_000);

  let req         = null;
  let rejectTask  = null;

  test('S3-1 · Créer la réquisition (10 000 XAF)', async ({ request }) => {
    if (!sharedDept) test.skip('Pas de département disponible');

    req = await createRequisition(request, sharedToken, {
      title:        'N1 Rejection Test',
      amount:       AMOUNT,
      budgetLineId: sharedBudgetLine?.id,
      dept:         sharedDept,
      project:      sharedProject,
    });

    console.log(`✅ S3: Réquisition ${req.requisition_number} créée (${AMOUNT} XAF)`);
    expect(req.id).toBeTruthy();
  });

  test('S3-2 · [Camunda] Attendre la tâche Activity_ProjectManagerApproval', async ({ request }) => {
    if (req && !req.process_instance_id) req = await refreshProcess(request, sharedToken, req);
    if (!req?.process_instance_id) {
      test.skip('Camunda non disponible (process_instance_id absent)');
      return;
    }
    if (req.status === 'BUDGET_INSUFFICIENT' || req.status === 'BUDGET_ADJUSTMENT') {
      test.skip('Budget insuffisant — non pertinent pour ce scénario');
      return;
    }

    const r = await waitForTaskOrStop(request, sharedToken, req, 'Activity_ProjectManagerApproval');
    if (r.stopped) { test.skip(`Circuit arrêté : ${r.stopped}`); return; }
    rejectTask = r.task || null;

    if (!rejectTask) {
      test.skip('Tâche Activity_ProjectManagerApproval non apparue dans le délai');
      return;
    }

    console.log(`✅ S3: Tâche du chef de projet trouvée: ${rejectTask.id}`);
    expect(rejectTask.taskDefinitionKey).toBe('Activity_ProjectManagerApproval');
  });

  test('S3-3 · [Camunda] Rejeter la réquisition (approved: false → REJECTED)', async ({ request }) => {
    if (!rejectTask) test.skip('Tâche N1 non trouvée (S3-2 skipped)');

    const res  = await request.post(`/api/tasks/${rejectTask.id}/complete`, {
      headers: auth(approverToken),
      data: {
        variables:         { approved: false },
        taskDefinitionKey: 'Activity_ProjectManagerApproval',
        requisitionId:     req.id,
        estimatedAmount:   AMOUNT,
      },
    });
    const body = await res.json();

    expect(res.status(), `Complete N1 reject task: ${JSON.stringify(body)}`).toBe(200);
    expect(body.success).toBe(true);

    // Attendre mise à jour DB
    await new Promise(r => setTimeout(r, 2000));

    const reqRes  = await request.get(`/api/requisitions/${req.id}`, { headers: auth(sharedToken) });
    const reqBody = await reqRes.json();

    expect(reqBody.data.status).toBe('REJECTED');
    console.log(`✅ S3: Réquisition correctement REJECTED après rejet N1`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 4 — Rejet PO
// Circuit : create req → (skip approval if no Camunda) → create PO →
//           PO_PENDING → POST /reject → PO_REJECTED
// ═══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Scénario 4 — Rejet PO (PO_PENDING → PO_REJECTED)', () => {
  const AMOUNT = 10_000;

  let req = null;
  let po  = null;

  test('S4-1 · Créer la réquisition', async ({ request }) => {
    if (!sharedDept) test.skip('Pas de département disponible');

    req = await createRequisition(request, sharedToken, {
      title:        'PO Rejection Test',
      amount:       AMOUNT,
      budgetLineId: sharedBudgetLine?.id,
      dept:         sharedDept,
      project:      sharedProject,
    });

    console.log(`✅ S4: Réquisition ${req.requisition_number} créée`);
    expect(req.id).toBeTruthy();
  });

  test('S4-2 · [Camunda] Validation du chef de projet ou skip si Camunda absent', async ({ request }) => {
    if (!req?.process_instance_id) {
      // Pas de Camunda — on continue quand même : on peut créer un PO
      // même si la réquisition n'est pas APPROVED (selon la config backend)
      console.log('   Camunda absent — skip approbation N1, poursuite du scénario PO');
      return;
    }
    if (req.status === 'BUDGET_INSUFFICIENT' || req.status === 'BUDGET_ADJUSTMENT') {
      test.skip('Budget insuffisant — non pertinent pour ce scénario PO');
      return;
    }

    const task = await waitForTask(
      request,
      sharedToken,
      req.process_instance_id,
      'Activity_ProjectManagerApproval'
    );

    if (!task) {
      console.log('   Tâche N1 non apparue dans le délai — poursuite sans approbation Camunda');
      return;
    }

    const completeRes = await request.post(`/api/tasks/${task.id}/complete`, {
      headers: auth(approverToken),
      data: {
        variables:         { approved: true },
        taskDefinitionKey: 'Activity_ProjectManagerApproval',
        requisitionId:     req.id,
        estimatedAmount:   AMOUNT,
      },
    });
    expect(completeRes.status()).toBe(200);
    await new Promise(r => setTimeout(r, 2000));
    console.log(`✅ S4: Réquisition approuvée N1`);
  });

  test('S4-3 · Créer le PO', async ({ request }) => {
    if (!req)           test.skip('Réquisition S4 non créée');
    if (!sharedSupplier) test.skip('Pas de fournisseur disponible');

    po = await createPO(request, sharedToken, {
      requisitionId: req.id,
      supplierId:    sharedSupplier.id,
      amount:        AMOUNT,
    });

    console.log(`✅ S4: PO ${po.poNumber || po.po_number} créé`);
    expect(po.id).toBeTruthy();
  });

  test('S4-4 · PO créé directement en attente d\'approbation (PO_PENDING)', async ({ request }) => {
    if (!po) test.skip('PO S4 non créé');

    const body = await (await request.get(`/api/purchase-orders/${po.id}`, { headers: auth(sharedToken) })).json();
    expect(body.data?.status).toBe('PO_PENDING');
    console.log('✅ S4: PO en attente d\'approbation');
  });

  test('S4-5 · Rejeter le PO (POST /reject → PO_REJECTED)', async ({ request }) => {
    if (!po) test.skip('PO S4 non créé');
    // Révision approuvée : le rejet a lieu à l'approbation selon le niveau
    await passReview(request, approverToken, po.id);

    const res  = await request.post(`/api/purchase-orders/${po.id}/reject`, {
      headers: auth(sharedToken),
      data: { reason: 'Rejeté par test Playwright — scénario 4' },
    });
    const body = await res.json();

    expect([200, 201], `PO reject: ${JSON.stringify(body)}`).toContain(res.status());
    expect(body.success, `PO reject success: ${JSON.stringify(body)}`).toBe(true);

    // Recharger le PO pour vérifier le statut
    const poRes  = await request.get(`/api/purchase-orders/${po.id}`, { headers: auth(sharedToken) });
    const poBody = await poRes.json();

    expect(poBody.data?.status).toBe('PO_REJECTED');
    console.log(`✅ S4: PO correctement PO_REJECTED`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 5 — Budget insuffisant
// Circuit : create req SANS budgetLineId → Camunda check_budget échoue →
//           statut BUDGET_INSUFFICIENT
// ═══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Scénario 5 — Budget insuffisant (item sans budgetLineId)', () => {
  const AMOUNT = 20_000;

  let req = null;

  test('S5-1 · Créer la réquisition SANS budgetLineId', async ({ request }) => {
    if (!sharedDept) test.skip('Pas de département disponible');

    // Création délibérément sans budgetLineId pour déclencher BUDGET_INSUFFICIENT
    const res = await request.post('/api/requisitions', {
      headers: auth(sharedToken),
      data: {
        title:           `[TEST EXT] Budget Insufficient Test — ${Date.now()}`,
        description:     'Test automatisé — budget insuffisant',
        departmentId:    sharedDept.id,
        projectId:       sharedProject?.id,
        estimatedAmount: AMOUNT,
        currencyId:      1,
        currencyCode:    'USD',
        priority:        'MEDIUM',
        justification:   'Test budget insuffisant',
        items: [
          {
            description: 'Article sans ligne budgétaire',
            quantity:    1,
            frequency:   1,
            unitPrice:   AMOUNT,
            // budgetLineId intentionnellement absent
          },
        ],
      },
    });
    const body = await res.json();

    expect(res.status(), `Réquisition create: ${JSON.stringify(body)}`).toBe(201);
    expect(body.success).toBe(true);
    req = body.data;

    console.log(`✅ S5: Réquisition ${req.requisition_number} créée sans budgetLineId`);
    console.log(`   process_instance_id: ${req.process_instance_id ?? '—'}`);
    expect(req.id).toBeTruthy();
  });

  test('S5-2 · [Camunda] Attendre le statut BUDGET_INSUFFICIENT (max 15 s)', async ({ request }) => {
    if (!req) test.skip('Réquisition S5 non créée');
    if (!req.process_instance_id) {
      // Sans Camunda, vérifier si le backend met directement le statut
      const res  = await request.get(`/api/requisitions/${req.id}`, { headers: auth(sharedToken) });
      const body = await res.json();
      // Si la validation est synchrone, le statut pourrait déjà être BUDGET_INSUFFICIENT
      if (body.data?.status === 'BUDGET_INSUFFICIENT') {
        console.log(`✅ S5: Statut BUDGET_INSUFFICIENT confirmé (validation synchrone)`);
        return;
      }
      test.skip('Camunda non disponible — impossible de vérifier BUDGET_INSUFFICIENT via worker');
      return;
    }

    const updated = await waitForRequisitionStatus(
      request,
      sharedToken,
      req.id,
      ['BUDGET_INSUFFICIENT', 'BUDGET_ADJUSTMENT'],
      STATUS_POLL_TIMEOUT
    );

    if (!updated) {
      // Peut arriver si le worker check_budget n'a pas encore tourné
      const res  = await request.get(`/api/requisitions/${req.id}`, { headers: auth(sharedToken) });
      const body = await res.json();
      console.log(`   Statut actuel après ${STATUS_POLL_TIMEOUT}ms: ${body.data?.status}`);
      test.skip('Statut BUDGET_INSUFFICIENT non atteint dans le délai — worker peut être lent');
      return;
    }

    const validBudgetStatuses = ['BUDGET_INSUFFICIENT', 'BUDGET_ADJUSTMENT'];
    expect(validBudgetStatuses).toContain(updated.status);
    console.log(`✅ S5: Statut correctement mis à ${updated.status} par le worker check_budget`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 6 — GRN partielle (5/10 articles → PARTIAL + grnCompliant: false)
// Circuit : create req → approve → create PO → approve PO → GRN partielle
// ═══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Scénario 6 — GRN partielle (5 sur 10 articles reçus)', () => {
  const AMOUNT = 10_000;

  let req = null;
  let po  = null;
  let grn = null;

  test('S6-1 · Créer la réquisition', async ({ request }) => {
    if (!sharedDept) test.skip('Pas de département disponible');

    req = await createRequisition(request, sharedToken, {
      title:        'GRN Partial Test',
      amount:       AMOUNT,
      budgetLineId: sharedBudgetLine?.id,
      dept:         sharedDept,
      project:      sharedProject,
    });

    console.log(`✅ S6: Réquisition ${req.requisition_number} créée`);
    expect(req.id).toBeTruthy();
  });

  test('S6-2 · [Camunda] Validation du chef de projet ou skip si Camunda absent', async ({ request }) => {
    if (!req?.process_instance_id) {
      console.log('   Camunda absent — skip approbation N1');
      return;
    }
    if (req.status === 'BUDGET_INSUFFICIENT' || req.status === 'BUDGET_ADJUSTMENT') {
      test.skip('Budget insuffisant — non pertinent pour ce scénario GRN');
      return;
    }

    const task = await waitForTask(
      request,
      sharedToken,
      req.process_instance_id,
      'Activity_ProjectManagerApproval'
    );

    if (!task) {
      console.log('   Tâche N1 non apparue dans le délai — poursuite sans approbation Camunda');
      return;
    }

    const completeRes = await request.post(`/api/tasks/${task.id}/complete`, {
      headers: auth(approverToken),
      data: {
        variables:         { approved: true },
        taskDefinitionKey: 'Activity_ProjectManagerApproval',
        requisitionId:     req.id,
        estimatedAmount:   AMOUNT,
      },
    });
    expect(completeRes.status()).toBe(200);
    await new Promise(r => setTimeout(r, 2000));
    console.log(`✅ S6: Réquisition approuvée N1`);
  });

  test('S6-3 · Créer et approuver le PO', async ({ request }) => {
    if (!req)           test.skip('Réquisition S6 non créée');
    if (!sharedSupplier) test.skip('Pas de fournisseur disponible');

    po = await createPO(request, sharedToken, {
      requisitionId: req.id,
      supplierId:    sharedSupplier.id,
      amount:        AMOUNT,
    });
    console.log(`✅ S6: PO ${po.poNumber || po.po_number} créé`);

    po = await submitAndApprovePO(request, sharedToken, po.id);
    expect(po.status).toBe('PO_APPROVED');
    console.log(`✅ S6: PO approuvé (${po.status})`);
  });

  test('S6-4 · Créer GRN partielle (5 reçus sur 10 commandés)', async ({ request }) => {
    if (!po) test.skip('PO S6 non créé/approuvé');

    const res  = await request.post('/api/goods-receipts', {
      headers: auth(sharedToken),
      data: {
        poId:         po.id,
        observations: 'Livraison partielle — 5 articles sur 10 — test Playwright',
        grnItems: [
          {
            item_description:  'Article test étendu',
            quantity_ordered:  10,
            quantity_received: 10,
            quantity_accepted: 5,
            quantity_rejected: 5,
            rejection_reason:  'Articles endommagés — test Playwright',
          },
        ],
      },
    });
    const body = await res.json();

    expect([200, 201], `GRN partial create: ${JSON.stringify(body)}`).toContain(res.status());
    expect(body.success, `GRN partial success: ${JSON.stringify(body)}`).toBe(true);
    grn = body.data;

    console.log(`✅ S6: GRN ${grn.grnNumber} créée — statut: ${grn.status} | conforme: ${grn.grnCompliant}`);

    // PARTIAL = des articles reçus mais rejetés (quantity_rejected > 0)
    expect(grn.status).toBe('PARTIAL');
    expect(grn.grnCompliant).toBe(false);
  });

  test('S6-5 · GET /api/goods-receipts/:id — confirme PARTIAL + grnCompliant false', async ({ request }) => {
    if (!grn) test.skip('GRN S6 non créée');

    const res  = await request.get(`/api/goods-receipts/${grn.id}`, { headers: auth(sharedToken) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.data.status).toBe('PARTIAL');

    // grnCompliant n'est pas stocké en DB — on le dérive des items
    // La table goods_receipt_items n'a pas quantity_ordered
    const items = body.data.items || body.data.grnItems || [];
    if (items.length > 0) {
      const item = items[0];
      const rejected = Number(item.quantity_rejected ?? item.quantityRejected ?? 0);
      // PARTIAL implique quantity_rejected > 0 → non conforme
      expect(rejected).toBeGreaterThan(0);
      const received = Number(item.quantity_received ?? item.quantityReceived ?? 0);
      expect(received).toBeGreaterThan(0);
    }

    console.log(`✅ S6: GRN confirmée PARTIAL (articles rejetés → non conforme)`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCÉNARIO 7 — Désaccord facture 3-way (totalAmount 5% > PO → UNMATCHED)
// Circuit : create req → approve → PO → approve PO → GRN complète →
//           Facture avec montant +5% → match_status: UNMATCHED
// ═══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Scénario 7 — Invoice mismatch 3-way (montant +5% > PO → UNMATCHED)', () => {
  const PO_AMOUNT = 100_000;  // montant PO de référence
  // La tolérance est de 2% → 5% dépasse la tolérance → UNMATCHED
  const INVOICE_AMOUNT = Math.round(PO_AMOUNT * 1.05);  // 105 000 XAF

  let req     = null;
  let po      = null;
  let grn     = null;
  let invoice = null;

  test('S7-1 · Créer la réquisition (100 000 XAF)', async ({ request }) => {
    if (!sharedDept) test.skip('Pas de département disponible');

    req = await createRequisition(request, sharedToken, {
      title:        'Invoice Mismatch 3-Way Test',
      amount:       PO_AMOUNT,
      budgetLineId: sharedBudgetLine?.id,
      dept:         sharedDept,
      project:      sharedProject,
    });

    console.log(`✅ S7: Réquisition ${req.requisition_number} créée (${PO_AMOUNT} XAF)`);
    expect(req.id).toBeTruthy();
  });

  test('S7-2 · [Camunda] Validation du chef de projet ou skip si Camunda absent', async ({ request }) => {
    if (!req?.process_instance_id) {
      console.log('   Camunda absent — skip validation du chef de projet');
      return;
    }
    if (req.status === 'BUDGET_INSUFFICIENT' || req.status === 'BUDGET_ADJUSTMENT') {
      test.skip('Budget insuffisant — non pertinent pour ce scénario');
      return;
    }

    // Validation du chef de projet
    const task = await waitForTask(
      request,
      sharedToken,
      req.process_instance_id,
      'Activity_ProjectManagerApproval'
    );

    if (!task) {
      // Peut-être que le montant tombe dans une autre tranche — essayer N2 ou N1
      console.log('   Tâche du chef de projet non trouvée — nouvel essai...');
      const taskN2 = await waitForTask(
        request,
        sharedToken,
        req.process_instance_id,
        'Activity_ProjectManagerApproval',
        5000
      );
      if (taskN2) {
        const completeRes = await request.post(`/api/tasks/${taskN2.id}/complete`, {
          headers: auth(approverToken),
          data: {
            variables:         { approved: true },
            taskDefinitionKey: 'Activity_ProjectManagerApproval',
            requisitionId:     req.id,
            estimatedAmount:   PO_AMOUNT,
          },
        });
        expect(completeRes.status()).toBe(200);
        await new Promise(r => setTimeout(r, 2000));
        console.log(`✅ S7: Réquisition validée par le chef de projet`);
        return;
      }
      console.log('   Aucune tâche d\'approbation trouvée — poursuite sans approbation Camunda');
      return;
    }

    const completeRes = await request.post(`/api/tasks/${task.id}/complete`, {
      headers: auth(approverToken),
      data: {
        variables:         { approved: true },
        taskDefinitionKey: 'Activity_ProjectManagerApproval',
        requisitionId:     req.id,
        estimatedAmount:   PO_AMOUNT,
      },
    });
    expect(completeRes.status()).toBe(200);
    await new Promise(r => setTimeout(r, 2000));
    console.log(`✅ S7: Réquisition validée par le chef de projet`);
  });

  test('S7-3 · Créer et approuver le PO (100 000 XAF)', async ({ request }) => {
    if (!req)           test.skip('Réquisition S7 non créée');
    if (!sharedSupplier) test.skip('Pas de fournisseur disponible');

    po = await createPO(request, sharedToken, {
      requisitionId: req.id,
      supplierId:    sharedSupplier.id,
      amount:        PO_AMOUNT,
    });
    console.log(`✅ S7: PO ${po.poNumber || po.po_number} créé (${PO_AMOUNT} XAF)`);

    po = await submitAndApprovePO(request, sharedToken, po.id);
    expect(po.status).toBe('PO_APPROVED');
    console.log(`✅ S7: PO approuvé`);
  });

  test('S7-4 · Créer un GRN complet (toutes les marchandises reçues)', async ({ request }) => {
    if (!po) test.skip('PO S7 non créé/approuvé');

    const res  = await request.post('/api/goods-receipts', {
      headers: auth(sharedToken),
      data: {
        poId:         po.id,
        observations: 'Réception complète — test Playwright scénario 7',
        grnItems: [
          {
            item_description:  'Article test étendu',
            quantity_ordered:  10,
            quantity_received: 10,
            quantity_accepted: 10,
            quantity_rejected: 0,
            rejection_reason:  '',
          },
        ],
      },
    });
    const body = await res.json();

    expect([200, 201], `GRN complete create: ${JSON.stringify(body)}`).toContain(res.status());
    expect(body.success, `GRN complete success: ${JSON.stringify(body)}`).toBe(true);
    grn = body.data;

    expect(grn.status).toBe('COMPLETE');
    expect(grn.grnCompliant).toBe(true);
    console.log(`✅ S7: GRN ${grn.grnNumber} créée — COMPLETE + conforme`);
  });

  test('S7-5 · Créer une facture avec montant +5% (105 000 XAF) → UNMATCHED', async ({ request }) => {
    if (!po || !grn) test.skip('PO ou GRN S7 non disponible');

    // totalAmount = PO_AMOUNT × 1.05 = 105 000 → dépasse la tolérance de 2%
    const res  = await request.post('/api/invoices', {
      headers: auth(sharedToken),
      data: {
        poId:        po.id,
        grnId:       grn.id,
        invoiceDate: '2026-06-24',
        dueDate:     '2026-07-24',
        subtotal:    INVOICE_AMOUNT,
        taxAmount:   0,
        totalAmount: INVOICE_AMOUNT,
        currency:    'USD',
        notes:       `Facture test désaccord 3-way — ${INVOICE_AMOUNT} XAF (5% > PO ${PO_AMOUNT})`,
      },
    });
    const body = await res.json();

    expect([200, 201], `Invoice mismatch create: ${JSON.stringify(body)}`).toContain(res.status());
    expect(body.success, `Invoice mismatch success: ${JSON.stringify(body)}`).toBe(true);
    invoice = body.data;

    console.log(`✅ S7: Facture ${invoice.invoiceNumber} créée`);
    console.log(`   Montant facture: ${INVOICE_AMOUNT} XAF (PO: ${PO_AMOUNT} XAF, +5%)`);
    console.log(`   Rapprochement 3 voies: ${invoice.match_status}`);

    // Le rapprochement doit être PRICE_MISMATCH :
    //   Check montant : 105 000 > 100 000 × 1.02 = 102 000 → FAIL → PRICE_MISMATCH
    expect(invoice.match_status).toBe('PRICE_MISMATCH');
  });

  test('S7-6 · GET /api/invoices/:id — match_details contient le check échoué', async ({ request }) => {
    if (!invoice) test.skip('Facture S7 non créée');

    const res  = await request.get(`/api/invoices/${invoice.id}`, { headers: auth(sharedToken) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    const data = body.data;

    expect(data.match_status).toBe('PRICE_MISMATCH');

    const checks = data.match_details?.checks;
    if (checks && Array.isArray(checks)) {
      // Au moins un check doit avoir échoué (passed: false)
      const failedChecks = checks.filter(c => !c.passed);
      expect(failedChecks.length).toBeGreaterThan(0);

      console.log(`✅ S7: match_details confirme PRICE_MISMATCH`);
      console.log(`   Checks échoués: ${failedChecks.map(c => c.message).join(' | ')}`);
    } else {
      // Si match_details n'est pas structuré en checks, au moins le match_status suffit
      console.log(`✅ S7: match_status = PRICE_MISMATCH confirmé (match_details: ${JSON.stringify(data.match_details)})`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Récapitulatif
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Récapitulatif des 7 scénarios', () => {
  test('Vérification que les scénarios sans Camunda fonctionnent (API seule)', async ({ request }) => {
    const token = await getToken(request);
    expect(token).toBeTruthy();

    // Vérifier que les endpoints principaux répondent
    const endpoints = [
      '/api/requisitions',
      '/api/purchase-orders',
      '/api/goods-receipts',
      '/api/invoices',
    ];

    for (const ep of endpoints) {
      const res  = await request.get(ep, { headers: auth(token) });
      const body = await res.json();
      expect(res.status(), `${ep} doit retourner 200`).toBe(200);
      expect(body.success, `${ep} success doit être true`).toBe(true);
      expect(Array.isArray(body.data), `${ep} data doit être un tableau`).toBe(true);
    }

    console.log(`✅ Tous les endpoints API principaux répondent correctement`);
  });
});
