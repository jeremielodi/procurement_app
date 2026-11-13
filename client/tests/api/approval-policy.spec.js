import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, getApproverId, auth, PO_LEVEL_TASKS, requisitionToPurchaseOrder } from './helpers.js';

// Seuils d'approbation par projet (migration 26_approval_policies.sql) : politique du projet, sinon de l'entreprise,
// sinon 25 000 / 100 000. Depuis le 2026-11-06 (migration 51) ils portent sur le BON DE COMMANDE : niveau calculé à
// la création du bon (variable poApprovalLevel lue par le BPMN) et enregistré sur le bon avec la politique appliquée ;
// la réquisition est validée par le chef de projet. BpmnGo requis pour les circuits (sinon ignorés).
const KEYS = PO_LEVEL_TASKS;

test.describe.serial('API › Seuils d\'approbation par projet (bon de commande)', () => {
  test.describe.configure({ timeout: 240_000 });
  const stamp = Date.now().toString(36);
  let admin, approver, dept, projectA, projectB, lines = {};
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const lastAudit = async (request, query) => (await (await request.get(`/api/audit-logs?limit=5&${query}`, { headers: H() })).json()).data;

  async function requisition(request, project, amount, title) {
    return (await (await request.post('/api/requisitions', { headers: H(), data: { submit: true,
      title: `[TEST SEUILS] ${title} ${stamp}`, description: 'x', departmentId: dept.id, projectId: project.id, currencyId: 1, currencyCode: 'USD',
      priority: 'MEDIUM', justification: 'x', items: [{ description: 'Article', quantity: 1, frequency: 1, unitPrice: amount, budgetLineId: lines[project.id] }],
    } })).json()).data;
  }
  /** Réquisition validée par le chef de projet puis bon de commande du même montant → { po, task } ou null */
  const order = async (request, project, amount, title) =>
    requisitionToPurchaseOrder(request, { admin, approver, requisitionId: (await requisition(request, project, amount, title)).id, amount });
  const poOf = async (request, flow) => (await (await request.get(`/api/purchase-orders/${flow.po.id}`, { headers: H() })).json()).data;

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    approver = await getApproverToken(request);
    [dept] = (await (await request.get('/api/departments', { headers: H() })).json()).data;
    const mk = async (code, extra = {}) => {
      const res = await request.post('/api/projects/', { headers: H(), data: { code, name: `Projet ${code}`, projectManagerId: await getApproverId(request), ...extra } });
      expect(res.status(), await res.text()).toBe(201);
      const project = (await res.json()).data;
      lines[project.id] = (await (await request.post('/api/budget', { headers: H(), data: {
        entityCode: `${code}-L`, description: `Ligne ${code}`, allocatedAmount: 1_000_000, projectId: project.id,
      } })).json()).data.id;
      return project;
    };
    projectA = await mk(`SA-${stamp}`, { approvalN1Max: 1000, approvalN2Max: 5000 });
    projectB = await mk(`SB-${stamp}`);
  });

  test.afterAll(async ({ request }) => {
    // Politique de l'entreprise remise par défaut (les autres tests attendent 25 000 / 100 000)
    await request.put('/api/enterprises/current/approval-policy', { headers: auth(admin), data: { n1Max: null, n2Max: null } });
  });

  test('Politique du projet : contrôles, effective, tracée', async ({ request }) => {
    const policy = (await (await request.get(`/api/projects/${projectA.id}/approval-policy`, { headers: H() })).json()).data;
    expect(policy).toEqual({ n1Max: 1000, n2Max: 5000, source: 'PROJECT' });
    const inherited = (await (await request.get(`/api/projects/${projectB.id}/approval-policy`, { headers: H() })).json()).data;
    expect(inherited).toEqual({ n1Max: 25000, n2Max: 100000, source: 'DEFAULT' });

    for (const data of [{ approvalN1Max: 5000, approvalN2Max: 1000 }, { approvalN1Max: 1000, approvalN2Max: null }, { approvalN1Max: -5, approvalN2Max: 10 }]) {
      const bad = await json(await request.put(`/api/projects/${projectA.id}`, { headers: H(), data: { name: projectA.name, ...data } }));
      expect([bad.status, bad.body.code], JSON.stringify(data)).toEqual([400, 'APPROVAL_POLICY_INVALID']);
    }
    // Modification tracée (avant / après), puis retour à la politique de départ
    expect((await request.put(`/api/projects/${projectA.id}`, { headers: H(), data: { name: projectA.name, approvalN1Max: 2000, approvalN2Max: 8000 } })).status()).toBe(200);
    const logged = await lastAudit(request, `action=APPROVAL_POLICY_CHANGED&entityType=project&entityRef=${projectA.id}`);
    expect([logged[0]?.old_value, logged[0]?.new_value]).toEqual([{ n1Max: 1000, n2Max: 5000 }, expect.objectContaining({ n1Max: 2000, n2Max: 8000 })]);
    expect((await request.put(`/api/projects/${projectA.id}`, { headers: H(), data: { name: projectA.name, approvalN1Max: 1000, approvalN2Max: 5000 } })).status()).toBe(200);
    // Sans les champs : politique inchangée
    expect((await request.put(`/api/projects/${projectA.id}`, { headers: H(), data: { name: projectA.name } })).status()).toBe(200);
    expect((await (await request.get(`/api/projects/${projectA.id}/approval-policy`, { headers: H() })).json()).data.source).toBe('PROJECT');
  });

  test('Bon de 2 000 sur le projet A (N1 < 1 000, N2 < 5 000) → N2 : Manager niveau 2 (pas Finance)', async ({ request }) => {
    const flow = await order(request, projectA, 2000, 'N2');
    test.skip(!flow, 'BpmnGo indisponible');
    expect(flow.task.taskDefinitionKey).toBe(KEYS.N2);
    const po = await poOf(request, flow);
    expect(po.approval_level).toBe('N2');
    expect(po.approval_policy).toMatchObject({ n1Max: 1000, n2Max: 5000, source: 'PROJECT' });
    const timeline = (await (await request.get(`/api/requisitions/${flow.requisition.id}/timeline`, { headers: H() })).json()).data;
    expect(timeline.steps.find(s => s.key === 'po_approval').info).toContain('niveau N2 (Manager niveau 2)');

    // Groupe BpmnGo manager_n2 : un compte Finance ne peut pas prendre l'approbation N2, un « Manager niveau 2 » si
    const mk = async (key, profile) => {
      const u = { email: `ap.${key}.${stamp}@nowhere.test`, password: 'Secret123' };
      const res = await request.post('/api/users', { headers: H(), data: {
        username: `ap${key}${stamp}`, email: u.email, password: u.password, firstName: key, lastName: stamp,
        profileIds: [profile], allProjectsProfileIds: [profile],
      } });
      expect(res.status(), await res.text()).toBe(201);
      return (await (await request.post('/api/auth/login', { data: u })).json()).data.token;
    };
    const [financeToken, managerN2Token] = await Promise.all([mk('fin', 'prof_finance'), mk('mn2', 'prof_manager_n2')]);
    const asFinance = ((await (await request.get(`/api/tasks/process/${flow.requisition.process_instance_id}`, { headers: auth(financeToken) })).json()).data || []).find(tk => tk.id === flow.task.id);
    expect([flow.task.candidateGroup, asFinance?.canClaim]).toEqual(['manager_n2', false]);
    expect((await request.post(`/api/tasks/${flow.task.id}/claim`, { headers: auth(financeToken) })).status()).toBe(403);
    expect((await request.post(`/api/tasks/${flow.task.id}/claim`, { headers: auth(managerN2Token) })).status()).toBe(200);
    expect((await request.post(`/api/tasks/${flow.task.id}/unclaim`, { headers: auth(managerN2Token) })).status()).toBe(200);

    const ok = await json(await request.post(`/api/purchase-orders/${flow.po.id}/approve`, { headers: auth(managerN2Token), data: { comments: 'OK' } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await poOf(request, flow)).status).toBe('PO_APPROVED');
  });

  test('Bon de 6 000 sur le projet A → N3 ; même montant sur le projet B (défaut) → N1', async ({ request }) => {
    // L'un après l'autre : deux bons créés en même temps peuvent recevoir le même numéro
    const a = await order(request, projectA, 6000, 'N3');
    const b = await order(request, projectB, 6000, 'défaut N1');
    test.skip(!a || !b, 'BpmnGo indisponible');
    expect([a.task.taskDefinitionKey, b.task.taskDefinitionKey]).toEqual([KEYS.N3, KEYS.N1]);
    expect((await poOf(request, b)).approval_policy.source).toBe('DEFAULT');
  });

  test('Politique de l\'entreprise reprise par un projet sans politique ; N1 = N2 : pas de niveau N2', async ({ request }) => {
    const bad = await json(await request.put('/api/enterprises/current/approval-policy', { headers: H(), data: { n1Max: 900, n2Max: 100 } }));
    expect([bad.status, bad.body.code]).toEqual([400, 'APPROVAL_POLICY_INVALID']);
    const set = await json(await request.put('/api/enterprises/current/approval-policy', { headers: H(), data: { n1Max: 500, n2Max: 500 } }));
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.data.effective).toEqual({ n1Max: 500, n2Max: 500, source: 'ENTERPRISE' });
    expect((await (await request.get(`/api/projects/${projectB.id}/approval-policy`, { headers: H() })).json()).data.source).toBe('ENTERPRISE');
    // Le projet A garde sa propre politique
    expect((await (await request.get(`/api/projects/${projectA.id}/approval-policy`, { headers: H() })).json()).data.source).toBe('PROJECT');

    const flow = await order(request, projectB, 600, 'entreprise N3');
    test.skip(!flow, 'BpmnGo indisponible');
    expect(flow.task.taskDefinitionKey).toBe(KEYS.N3); // 600 ≥ 500 et pas de niveau N2
    expect((await poOf(request, flow)).approval_policy).toMatchObject({ n1Max: 500, n2Max: 500, source: 'ENTERPRISE' });

    const reset = await json(await request.put('/api/enterprises/current/approval-policy', { headers: H(), data: { n1Max: null, n2Max: null } }));
    expect(reset.body.data.effective.source).toBe('DEFAULT');
  });
});
