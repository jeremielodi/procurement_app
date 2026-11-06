/**
 * tests/api/project-manager-approval.spec.js
 *
 * Circuit du 2026-11-06 (migration 51, BPMN EN + FR) :
 *   - le chef du projet (budget holder, projects.project_manager_id) valide seul la réquisition
 *     (Activity_ProjectManagerApproval) — ni l'administrateur ni un manager ;
 *   - projet + chef de projet obligatoires, le chef de projet ne peut pas être le demandeur ;
 *   - les niveaux N1 / N2 / N3 portent sur le bon de commande (montant + seuils du projet) : Activity_POApprovalN1/2/3,
 *     seul un manager du niveau approuve ou rejette (403 NOT_APPROVAL_LEVEL sinon) ;
 *   - avant ce niveau, révision du bon (Activity_POReview, profil prof_po_reviewer, migration 52) : approuver ou rejeter.
 * Les étapes BpmnGo s'ignorent si BpmnGo est indisponible.
 */
import { test, expect } from '@playwright/test';
import {
  getToken, getApproverToken, getApproverId, auth, PM_APPROVAL, PO_LEVEL_TASKS,
  waitForProcessTask, openProcessTasks, requisitionToPurchaseOrder, PO_REVIEW,
} from './helpers.js';

test.describe.serial('API › Validation par le chef de projet, N1 / N2 / N3 sur le bon de commande', () => {
  test.describe.configure({ timeout: 240_000 });
  const stamp = Date.now().toString(36);
  let admin, approver, approverId, project, line, other, managerN1, managerN2, reviewer, req;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });

  /** Compte jetable de l'entreprise avec ces profils (tous les projets) → { id, token } */
  async function user(request, key, profiles) {
    const u = { email: `pm.${key}.${stamp}@nowhere.test`, password: 'Secret123' };
    const res = await request.post('/api/users', { headers: H(), data: {
      username: `pm${key}${stamp}`, email: u.email, password: u.password, firstName: key, lastName: stamp,
      profileIds: profiles, allProjectsProfileIds: profiles.filter(p => p !== 'prof_admin'),
    } });
    expect(res.status(), await res.text()).toBe(201);
    const login = (await (await request.post('/api/auth/login', { data: u })).json()).data;
    return { id: login.user.id, token: login.token };
  }

  const newRequisition = (request, amount, projectId = project.id, token = admin) => request.post('/api/requisitions', { headers: auth(token), data: {
    title: `[TEST CHEF DE PROJET] ${amount} ${stamp}`, description: 'x', projectId, currencyId: 1, currencyCode: 'USD',
    priority: 'MEDIUM', justification: 'x', items: [{ description: 'Article', quantity: 1, frequency: 1, unitPrice: amount, budgetLineId: line }],
  } });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    approver = await getApproverToken(request);
    approverId = await getApproverId(request);
    [other, managerN1, managerN2, reviewer] = await Promise.all([
      user(request, 'adm', ['prof_admin']),
      user(request, 'mn1', ['prof_manager']),
      user(request, 'mn2', ['prof_manager_n2']),
      user(request, 'rev', ['prof_po_reviewer']),
    ]);
  });

  test('Projet : chef de projet obligatoire et contrôlé, changement tracé', async ({ request }) => {
    const missing = await json(await request.post('/api/projects', { headers: H(), data: { code: `PMX-${stamp}`, name: 'Sans chef' } }));
    expect([missing.status, missing.body.code]).toEqual([400, 'PROJECT_MANAGER_REQUIRED']);
    const unknown = await json(await request.post('/api/projects', { headers: H(), data: {
      code: `PMY-${stamp}`, name: 'Chef inconnu', projectManagerId: '00000000-0000-0000-0000-000000000001',
    } }));
    expect([unknown.status, unknown.body.code]).toEqual([400, 'PROJECT_MANAGER_INVALID']);

    // Seuils propres : N1 en dessous de 1 000, N2 en dessous de 5 000
    const created = await json(await request.post('/api/projects', { headers: H(), data: {
      code: `PM-${stamp}`, name: `Projet chef ${stamp}`, projectManagerId: other.id, approvalN1Max: 1000, approvalN2Max: 5000,
    } }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    project = created.body.data;

    // PUT sans projectManagerId : inchangé (avant : effacé) ; vide : refusé ; changement → audit avant / après
    expect((await request.put(`/api/projects/${project.id}`, { headers: H(), data: { name: project.name } })).status()).toBe(200);
    expect((await (await request.get(`/api/projects/${project.id}`, { headers: H() })).json()).data.project_manager_id).toBe(other.id);
    const empty = await json(await request.put(`/api/projects/${project.id}`, { headers: H(), data: { name: project.name, projectManagerId: '' } }));
    expect([empty.status, empty.body.code]).toEqual([400, 'PROJECT_MANAGER_REQUIRED']);
    expect((await request.put(`/api/projects/${project.id}`, { headers: H(), data: { name: project.name, projectManagerId: approverId } })).status()).toBe(200);
    const logged = (await (await request.get(`/api/audit-logs?limit=5&action=PROJECT_MANAGER_CHANGED&entityType=project&entityRef=${project.id}`, { headers: H() })).json()).data;
    expect(logged[0]?.old_value?.projectManager).toContain(`pm.adm.${stamp}`);
    expect(logged[0]?.new_value?.projectManager).toContain('approver.tests@procurement.com');

    line = (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: `PM-${stamp}-L`, description: 'Ligne chef de projet', allocatedAmount: 1_000_000, projectId: project.id,
    } })).json()).data.id;
  });

  test('Réquisition : projet obligatoire, le chef de projet ne valide pas sa propre demande', async ({ request }) => {
    const noProject = await json(await newRequisition(request, 100, null));
    expect([noProject.status, noProject.body.code]).toEqual([400, 'PROJECT_REQUIRED']);
    // Le chef de projet (l'approbateur) demande sur son propre projet → refusé
    const own = await json(await newRequisition(request, 100, project.id, approver));
    expect([own.status, own.body.code]).toEqual([409, 'REQUESTER_IS_PROJECT_MANAGER']);
  });

  test('Validation de la réquisition : le chef de projet seul (ni un autre administrateur)', async ({ request }) => {
    const created = await json(await newRequisition(request, 2000));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const found = await waitForProcessTask(request, admin, created.body.data.id, PM_APPROVAL);
    test.skip(!found, 'BpmnGo indisponible');
    req = found.requisition;
    expect(found.task.candidateGroup).toBe('project_manager');
    // Plus de niveau sur la réquisition (il porte sur le bon de commande)
    expect(req.approval_level).toBeNull();

    // Un autre administrateur voit l'étape mais ne peut ni la prendre ni la terminer
    const asOther = (await openProcessTasks(request, other.token, req.process_instance_id)).find(t => t.id === found.task.id);
    expect([asOther?.canClaim, asOther?.canComplete, asOther?.blockedReason]).toEqual([false, false, 'NOT_PROJECT_MANAGER']);
    const claim = await json(await request.post(`/api/tasks/${found.task.id}/claim`, { headers: auth(other.token) }));
    expect([claim.status, claim.body.code]).toEqual([403, 'NOT_PROJECT_MANAGER']);
    const done = await json(await request.post(`/api/tasks/${found.task.id}/complete`, { headers: auth(other.token), data: { variables: { approved: true } } }));
    expect([done.status, done.body.code]).toEqual([403, 'NOT_PROJECT_MANAGER']);

    // Le chef de projet : peut la prendre et la terminer
    const asPm = (await openProcessTasks(request, approver, req.process_instance_id)).find(t => t.id === found.task.id);
    expect(asPm?.canClaim).toBe(true);
    const noDecision = await json(await request.post(`/api/tasks/${found.task.id}/complete`, { headers: auth(approver), data: { variables: {} } }));
    expect([noDecision.status, noDecision.body.code]).toEqual([400, 'DECISION_REQUIRED']);

    // Suivi du workflow : étape en attente du chef de projet
    const timeline = (await (await request.get(`/api/requisitions/${req.id}/timeline`, { headers: H() })).json()).data;
    expect(timeline.events.some(e => e.pending && e.title.includes('Validation du chef de projet'))).toBe(true);
  });

  test('Bon de commande de 2 000 (projet : N1 < 1 000, N2 < 5 000) → N2 ; un Manager N1 est refusé', async ({ request }) => {
    test.skip(!req, 'BpmnGo indisponible');
    const flow = await requisitionToPurchaseOrder(request, { admin, approver, requisitionId: req.id, amount: 2000 });
    expect(flow?.task?.taskDefinitionKey).toBe(PO_LEVEL_TASKS.N2);
    expect(flow.task.candidateGroup).toBe('manager_n2');
    const after = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data;
    expect(after.status).not.toBe('REJECTED');

    const po = (await (await request.get(`/api/purchase-orders/${flow.po.id}`, { headers: auth(managerN1.token) })).json()).data;
    expect(po.approval_level).toBe('N2');
    expect(po.approval_policy).toMatchObject({ n1Max: 1000, n2Max: 5000, source: 'PROJECT' });
    expect(po.can_approve_level).toBe(false);

    const wrong = await json(await request.post(`/api/purchase-orders/${flow.po.id}/approve`, { headers: auth(managerN1.token), data: { comments: 'non' } }));
    expect([wrong.status, wrong.body.code]).toEqual([403, 'NOT_APPROVAL_LEVEL']);
    const wrongReject = await json(await request.post(`/api/purchase-orders/${flow.po.id}/reject`, { headers: auth(managerN1.token), data: { reason: 'non' } }));
    expect([wrongReject.status, wrongReject.body.code]).toEqual([403, 'NOT_APPROVAL_LEVEL']);

    const asN2 = (await (await request.get(`/api/purchase-orders/${flow.po.id}`, { headers: auth(managerN2.token) })).json()).data;
    expect(asN2.can_approve_level).toBe(true);
    const ok = await json(await request.post(`/api/purchase-orders/${flow.po.id}/approve`, { headers: auth(managerN2.token), data: { comments: 'OK N2' } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.camundaTaskCompleted).toBe(true);
    expect(await waitForProcessTask(request, admin, req.id, 'Activity_SupplierConfirmation')).toBeTruthy();

    const timeline = (await (await request.get(`/api/requisitions/${req.id}/timeline`, { headers: H() })).json()).data;
    expect(timeline.steps.find(s => s.key === 'approval').status).toBe('done');
    expect(timeline.steps.find(s => s.key === 'po_approval').status).toBe('done');
  });

  test('Révision du bon : réviseur du projet, motif au rejet, pas d\'approbation de niveau avant ; rejet = bon rejeté', async ({ request }) => {
    test.skip(!req, 'BpmnGo indisponible');
    const created = await json(await newRequisition(request, 3000));
    const flow = await requisitionToPurchaseOrder(request, { admin, approver, requisitionId: created.body.data.id, amount: 3000, review: false });
    expect(flow?.task?.taskDefinitionKey).toBe(PO_REVIEW);
    expect(flow.task.candidateGroup).toBe('po_reviewer');
    const poId = flow.po.id;
    const review = (token, data) => request.post(`/api/purchase-orders/${poId}/review`, { headers: auth(token), data }).then(json);

    // Fiche du bon : en révision, réviseur désigné ; le manager N2 n'approuve pas encore
    const asReviewer = (await (await request.get(`/api/purchase-orders/${poId}`, { headers: auth(reviewer.token) })).json()).data;
    expect([asReviewer.review_pending, asReviewer.can_review]).toEqual([true, true]);
    const early = await json(await request.post(`/api/purchase-orders/${poId}/approve`, { headers: auth(managerN2.token), data: {} }));
    expect([early.status, early.body.code]).toEqual([409, 'PO_IN_REVIEW']);
    // Contrôles : décision, motif, profil, séparation des tâches (créateur du bon = demandeur)
    expect((await review(reviewer.token, {})).body.code).toBe('REVIEW_DECISION_REQUIRED');
    expect((await review(reviewer.token, { decision: 'REJECT' })).body.code).toBe('REVIEW_REASON_REQUIRED');
    const notReviewer = await review(managerN1.token, { decision: 'APPROVE' });
    expect(notReviewer.status).toBe(403); // manager N1 : pas de permission REVIEW_PURCHASE_ORDERS
    const self = await review(admin, { decision: 'APPROVE' });
    expect([self.status, self.body.code]).toEqual([403, 'SELF_APPROVAL']);
    // La complétion générique de l'étape est refusée : uniquement depuis la fiche du bon
    const generic = await json(await request.post(`/api/tasks/${flow.task.id}/complete`, { headers: auth(reviewer.token), data: { variables: { poReviewed: true } } }));
    expect([generic.status, generic.body.code]).toEqual([400, 'FORM_REQUIRED']);

    // Rejet par le réviseur : bon rejeté, plus aucune étape de ce bon
    const rejected = await review(reviewer.token, { decision: 'REJECT', comment: 'Prix non conforme' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const po = (await (await request.get(`/api/purchase-orders/${poId}`, { headers: H() })).json()).data;
    expect([po.status, po.review_decision, po.review_comment, po.reviewed_by]).toEqual(['PO_REJECTED', 'REJECTED', 'Prix non conforme', reviewer.id]);
    await expect.poll(async () => (await openProcessTasks(request, admin, flow.requisition.process_instance_id))
      .some(t => [PO_REVIEW, ...Object.values(PO_LEVEL_TASKS)].includes(t.taskDefinitionKey)), { timeout: 30_000 }).toBe(false);
    const again = await review(reviewer.token, { decision: 'APPROVE' });
    expect([again.status, again.body.code]).toEqual([409, 'NOT_IN_REVIEW']);
    const timeline = (await (await request.get(`/api/requisitions/${created.body.data.id}/timeline`, { headers: H() })).json()).data;
    expect(timeline.steps.find(s => s.key === 'po_review')?.status).toBe('failed');
  });

  test('Révision approuvée par le réviseur → approbation selon le niveau', async ({ request }) => {
    test.skip(!req, 'BpmnGo indisponible');
    const created = await json(await newRequisition(request, 800));
    const flow = await requisitionToPurchaseOrder(request, { admin, approver, requisitionId: created.body.data.id, amount: 800, review: false });
    const ok = await json(await request.post(`/api/purchase-orders/${flow.po.id}/review`, { headers: auth(reviewer.token), data: { decision: 'APPROVE' } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await waitForProcessTask(request, admin, created.body.data.id, PO_LEVEL_TASKS.N1)).toBeTruthy();
    const timeline = (await (await request.get(`/api/requisitions/${created.body.data.id}/timeline`, { headers: H() })).json()).data;
    const step = timeline.steps.find(s => s.key === 'po_review');
    expect(step?.status).toBe('done');
    expect(step?.info).toContain('Révisé par rev');
  });

  test('Montant du bon : 500 → N1, 6 000 → N3 (seuils du projet)', async ({ request }) => {
    test.skip(!req, 'BpmnGo indisponible');
    for (const [amount, level] of [[500, 'N1'], [6000, 'N3']]) {
      const created = await json(await newRequisition(request, amount));
      const flow = await requisitionToPurchaseOrder(request, { admin, approver, requisitionId: created.body.data.id, amount });
      expect([amount, flow?.task?.taskDefinitionKey]).toEqual([amount, PO_LEVEL_TASKS[level]]);
      // Rejet par un administrateur (autre que le créateur) : la part s'arrête, comme avant
      if (level === 'N3') {
        const rej = await json(await request.post(`/api/purchase-orders/${flow.po.id}/reject`, { headers: auth(other.token), data: { reason: 'Trop cher' } }));
        expect(rej.status, JSON.stringify(rej.body)).toBe(200);
      }
    }
  });

  test('Projet dont le chef de projet est désactivé : réquisition refusée', async ({ request }) => {
    const chief = await user(request, 'chief', ['prof_requester']);
    const p = (await (await request.post('/api/projects', { headers: H(), data: { code: `PMZ-${stamp}`, name: 'Chef parti', projectManagerId: chief.id } })).json()).data;
    expect((await request.patch(`/api/users/${chief.id}/toggle-active`, { headers: H(), data: {} })).status()).toBe(200);
    const res = await json(await newRequisition(request, 100, p.id));
    expect([res.status, res.body.code]).toEqual([409, 'PROJECT_MANAGER_MISSING']);
    // Remise en état : les autres tests prennent souvent le premier projet de la liste
    expect((await request.put(`/api/projects/${p.id}`, { headers: H(), data: { name: p.name, projectManagerId: approverId } })).status()).toBe(200);
  });
});
