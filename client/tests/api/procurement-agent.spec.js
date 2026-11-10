/**
 * tests/api/procurement-agent.spec.js
 *
 * Agent achats désigné à la validation (migration 58, 2026-11-10) :
 *   - en approuvant la réquisition, le chef de projet choisit l'agent achats (obligatoire), parmi les utilisateurs
 *     actifs ayant le profil Achats SUR LE PROJET — 400 PROCUREMENT_AGENT_REQUIRED / PROCUREMENT_AGENT_INVALID ;
 *   - les étapes achats de la réquisition lui sont réservées (les autres agents : NOT_PROCUREMENT_AGENT, absentes de
 *     « Mes tâches »), ainsi que les routes du bon de commande et de l'appel d'offres ; l'administrateur garde la main ;
 *   - le chef de projet ou l'administrateur le remplace (PUT /requisitions/:id/procurement-agent) : étapes prises par
 *     l'ancien agent libérées, audit, suivi du workflow.
 * Les étapes BpmnGo s'ignorent si BpmnGo est indisponible.
 */
import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, getApproverId, auth, PM_APPROVAL, waitForProcessTask, openProcessTasks } from './helpers.js';

test.describe.serial('API › Agent achats désigné à la validation', () => {
  test.describe.configure({ timeout: 240_000 });
  const stamp = Date.now().toString(36);
  let admin, approver, approverId, project, line, agentA, agentB, outsider, logistic, req;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });

  /** Compte jetable de l'entreprise avec ces profils (tous les projets sauf si everywhere = false) → { id, token } */
  async function user(request, key, profiles, everywhere = true) {
    const u = { email: `pa.${key}.${stamp}@nowhere.test`, password: 'Secret123' };
    const res = await request.post('/api/users', { headers: H(), data: {
      username: `pa${key}${stamp}`, email: u.email, password: u.password, firstName: key, lastName: stamp,
      profileIds: profiles, allProjectsProfileIds: everywhere ? profiles : [],
    } });
    expect(res.status(), await res.text()).toBe(201);
    const login = (await (await request.post('/api/auth/login', { data: u })).json()).data;
    return { id: login.user.id, token: login.token };
  }

  const agentState = async (request, token) =>
    json(await request.get(`/api/requisitions/${req.id}/procurement-agent`, { headers: auth(token) }));

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    approver = await getApproverToken(request);
    approverId = await getApproverId(request);
    [agentA, agentB, outsider, logistic] = await Promise.all([
      user(request, 'agta', ['prof_procurement']),
      user(request, 'agtb', ['prof_procurement']),
      user(request, 'out', ['prof_procurement'], false), // profil Achats, mais sur aucun projet
      user(request, 'log', ['prof_logistic']),
    ]);
    const created = await json(await request.post('/api/projects', { headers: H(), data: {
      code: `PA-${stamp}`, name: `Projet agent achats ${stamp}`, projectManagerId: approverId,
    } }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    project = created.body.data;
    line = (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: `PA-${stamp}-L`, description: 'Ligne agent achats', allocatedAmount: 1_000_000, projectId: project.id,
    } })).json()).data.id;
  });

  test('Validation : agent achats obligatoire, choisi parmi les agents Achats du projet', async ({ request }) => {
    const created = await json(await request.post('/api/requisitions', { headers: H(), data: {
      title: `[TEST AGENT ACHATS] ${stamp}`, description: 'x', projectId: project.id, currencyId: 1, currencyCode: 'USD',
      priority: 'MEDIUM', justification: 'x', items: [{ description: 'Article', quantity: 1, frequency: 1, unitPrice: 300, budgetLineId: line }],
    } }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const found = await waitForProcessTask(request, admin, created.body.data.id, PM_APPROVAL);
    test.skip(!found, 'BpmnGo indisponible');
    req = found.requisition;

    // Candidats proposés au chef de projet : profil Achats sur le projet seulement
    const state = await agentState(request, approver);
    expect(state.status).toBe(200);
    const ids = state.body.data.candidates.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining([agentA.id, agentB.id]));
    expect(ids).not.toContain(outsider.id);
    expect(ids).not.toContain(logistic.id);
    expect(state.body.data.agent).toBeNull();

    const complete = (variables) => request.post(`/api/tasks/${found.task.id}/complete`, { headers: auth(approver), data: { variables } });
    const missing = await json(await complete({ approved: true, comment: 'OK' }));
    expect([missing.status, missing.body.code]).toEqual([400, 'PROCUREMENT_AGENT_REQUIRED']);
    for (const wrong of [outsider.id, logistic.id, '00000000-0000-0000-0000-000000000001', 'pas-un-uuid']) {
      const invalid = await json(await complete({ approved: true, procurementAgentId: wrong }));
      expect([invalid.status, invalid.body.code], wrong).toEqual([400, 'PROCUREMENT_AGENT_INVALID']);
    }
    const ok = await json(await complete({ approved: true, procurementAgentId: agentA.id, comment: 'Validé par le chef de projet' }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    // Commentaire sous un nom propre à l'étape dans BpmnGo (plus de « comment » écrasé à chaque étape)
    const vars = (await (await request.get(`/api/workflow/process/${req.process_instance_id}/variables`, { headers: H() })).json()).data || {};
    expect(vars.pmApprovalComment).toBe('Validé par le chef de projet');
    expect(vars.comment).toBeUndefined();
    const approval = (await (await request.get(`/api/requisitions/${req.id}/timeline?lang=fr`, { headers: H() })).json()).data.events
      .find(e => (e.details || []).some(d => d.includes('Validé par le chef de projet')));
    expect(approval, 'commentaire affiché dans le suivi du workflow').toBeTruthy();

    const after = (await agentState(request, admin)).body.data;
    expect([after.agent?.id, after.eligible, after.canChange, after.assignedBy?.id]).toEqual([agentA.id, true, true, approverId]);
    const logged = (await (await request.get(`/api/audit-logs?limit=5&action=PROCUREMENT_AGENT_ASSIGNED&entityType=requisition&entityRef=${req.id}`, { headers: H() })).json()).data;
    expect(logged[0]?.new_value?.procurementAgent).toContain(`pa.agta.${stamp}`);
  });

  test('Étapes achats réservées à l\'agent désigné (l\'administrateur garde la main)', async ({ request }) => {
    test.skip(!req, 'BpmnGo indisponible');
    const method = await waitForProcessTask(request, admin, req.id, 'Activity_DetermineType');
    expect(method, 'étape méthode d\'achat').toBeTruthy();
    const taskId = method.task.id;

    // Autre agent Achats du projet : bloqué, absente de « Mes tâches »
    const asB = (await openProcessTasks(request, agentB.token, req.process_instance_id)).find(t => t.id === taskId);
    expect([asB?.canClaim, asB?.canComplete, asB?.blockedReason]).toEqual([false, false, 'NOT_PROCUREMENT_AGENT']);
    const mineB = (await (await request.get('/api/tasks/user', { headers: auth(agentB.token) })).json()).data || [];
    expect(mineB.some(t => t.id === taskId)).toBe(false);
    const claimB = await json(await request.post(`/api/tasks/${taskId}/claim`, { headers: auth(agentB.token) }));
    expect([claimB.status, claimB.body.code]).toEqual([403, 'NOT_PROCUREMENT_AGENT']);
    const doneB = await json(await request.post(`/api/tasks/${taskId}/complete`, { headers: auth(agentB.token), data: { variables: { procurementMethod: 'SOLE_SOURCE', justification: 'x' } } }));
    expect([doneB.status, doneB.body.code]).toEqual([403, 'NOT_PROCUREMENT_AGENT']);

    // Agent désigné : dans « Mes tâches », peut la prendre
    const mineA = (await (await request.get('/api/tasks/user', { headers: auth(agentA.token) })).json()).data || [];
    expect(mineA.find(t => t.id === taskId)?.canClaim).toBe(true);
    expect((await request.post(`/api/tasks/${taskId}/claim`, { headers: auth(agentA.token) })).status()).toBe(200);

    // Administrateur : non bloqué
    const asAdmin = (await openProcessTasks(request, admin, req.process_instance_id)).find(t => t.id === taskId);
    expect(asAdmin?.blockedReason).toBeNull();

    // Bon de commande et appel d'offres : réservés à l'agent désigné (contrôle avant le contrôleur)
    const po = await json(await request.post('/api/purchase-orders', { headers: auth(agentB.token), data: { requisitionId: req.id } }));
    expect([po.status, po.body.code]).toEqual([403, 'NOT_PROCUREMENT_AGENT']);
    const tender = await json(await request.post('/api/tenders', { headers: auth(agentB.token), data: { requisitionId: req.id } }));
    expect([tender.status, tender.body.code]).toEqual([403, 'NOT_PROCUREMENT_AGENT']);
  });

  test('Remplacement par le chef de projet : étape libérée, nouvel agent, trace', async ({ request }) => {
    test.skip(!req, 'BpmnGo indisponible');
    const put = (token, agentId) => request.put(`/api/requisitions/${req.id}/procurement-agent`, { headers: auth(token), data: { agentId } });

    // Ni un agent achats, ni le demandeur sans être administrateur
    expect((await agentState(request, agentB.token)).body.data.canChange).toBe(false);
    const byAgent = await json(await put(agentB.token, agentB.id));
    expect([byAgent.status, byAgent.body.code]).toEqual([403, 'NOT_ALLOWED']);
    const invalid = await json(await put(approver, outsider.id));
    expect([invalid.status, invalid.body.code]).toEqual([400, 'PROCUREMENT_AGENT_INVALID']);
    const missing = await json(await put(approver, ''));
    expect([missing.status, missing.body.code]).toEqual([400, 'PROCUREMENT_AGENT_REQUIRED']);

    const ok = await json(await put(approver, agentB.id));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toEqual({ changed: true, released: 1 });
    expect((await agentState(request, admin)).body.data.agent?.id).toBe(agentB.id);

    // L'étape prise par l'ancien agent est libérée ; le nouvel agent la traite, l'ancien est bloqué
    const method = await waitForProcessTask(request, admin, req.id, 'Activity_DetermineType');
    expect(method.task.assignee).toBeFalsy();
    const asA = (await openProcessTasks(request, agentA.token, req.process_instance_id)).find(t => t.id === method.task.id);
    expect(asA?.blockedReason).toBe('NOT_PROCUREMENT_AGENT');
    expect((await request.post(`/api/tasks/${method.task.id}/claim`, { headers: auth(agentB.token) })).status()).toBe(200);
    const done = await json(await request.post(`/api/tasks/${method.task.id}/complete`, { headers: auth(agentB.token), data: {
      variables: { procurementMethod: 'SOLE_SOURCE', justification: 'Fournisseur unique (test)' },
    } }));
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    // Étape suivante (source unique) : toujours réservée au nouvel agent
    const sole = await waitForProcessTask(request, admin, req.id, 'Activity_SoleSource');
    const soleAsA = (await openProcessTasks(request, agentA.token, req.process_instance_id)).find(t => t.id === sole.task.id);
    expect(soleAsA?.blockedReason).toBe('NOT_PROCUREMENT_AGENT');

    // Audit avant / après, suivi du workflow
    const logged = (await (await request.get(`/api/audit-logs?limit=5&action=PROCUREMENT_AGENT_CHANGED&entityType=requisition&entityRef=${req.id}`, { headers: H() })).json()).data;
    expect(logged[0]?.old_value?.procurementAgent).toContain(`pa.agta.${stamp}`);
    expect(logged[0]?.new_value?.procurementAgent).toContain(`pa.agtb.${stamp}`);
    const timeline = (await (await request.get(`/api/requisitions/${req.id}/timeline?lang=fr`, { headers: H() })).json()).data;
    const titles = timeline.events.map(e => e.title);
    expect(titles).toContain(`Agent achats désigné : agta ${stamp}`);
    expect(titles).toContain(`Agent achats remplacé : agtb ${stamp}`);
  });
});
