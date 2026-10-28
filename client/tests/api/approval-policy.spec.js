import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth } from './helpers.js';

// Seuils d'approbation par projet (migration 26_approval_policies.sql) : politique du projet, sinon de l'entreprise,
// sinon 25 000 / 100 000. Le niveau est calculé par check_budget (variable approvalLevel lue par le BPMN) et
// enregistré sur la réquisition avec la politique appliquée. BpmnGo requis pour les circuits (sinon ignorés).
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const WAIT = 45_000;
const KEYS = { N1: 'Activity_ValidationN1_Manager', N2: 'Activity_ValidationN2_Finance', N3: 'Activity_ValidationN3_DG' };

test.describe.serial('API › Seuils d\'approbation par projet', () => {
  test.describe.configure({ timeout: 180_000 });
  const stamp = Date.now().toString(36);
  let admin, approver, dept, projectA, projectB, lines = {};
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const lastAudit = async (request, query) => (await (await request.get(`/api/audit-logs?limit=5&${query}`, { headers: H() })).json()).data;

  async function requisition(request, project, amount, title) {
    return (await (await request.post('/api/requisitions', { headers: H(), data: {
      title: `[TEST SEUILS] ${title} ${stamp}`, description: 'x', departmentId: dept.id, projectId: project.id, currencyId: 1, currencyCode: 'USD',
      priority: 'MEDIUM', justification: 'x', items: [{ description: 'Article', quantity: 1, frequency: 1, unitPrice: amount, budgetLineId: lines[project.id] }],
    } })).json()).data;
  }
  /** Première étape d'approbation ouverte de la réquisition, ou null */
  async function approvalTask(request, req) {
    const start = Date.now();
    while (Date.now() - start < WAIT) {
      const r = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data;
      if (r?.process_instance_id) {
        const tasks = (await (await request.get(`/api/tasks/process/${r.process_instance_id}`, { headers: H() })).json()).data || [];
        const found = tasks.find(tk => tk.status !== 'COMPLETED' && Object.values(KEYS).includes(tk.taskDefinitionKey));
        if (found) return { task: found, requisition: r };
      }
      await sleep(1500);
    }
    return null;
  }

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    approver = await getApproverToken(request);
    [dept] = (await (await request.get('/api/departments', { headers: H() })).json()).data;
    const mk = async (code, extra = {}) => {
      const res = await request.post('/api/projects/', { headers: H(), data: { code, name: `Projet ${code}`, ...extra } });
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

  test('2 000 sur le projet A (N1 < 1 000, N2 < 5 000) → N2 : Manager niveau 2 (Finance ne l\'approuve plus) ; une seule approbation', async ({ request }) => {
    const req = await requisition(request, projectA, 2000, 'N2');
    const found = await approvalTask(request, req);
    test.skip(!found, 'BpmnGo indisponible');
    expect(found.task.taskDefinitionKey).toBe(KEYS.N2);
    expect(found.requisition.approval_level).toBe('N2');
    expect(found.requisition.approval_policy).toMatchObject({ n1Max: 1000, n2Max: 5000, source: 'PROJECT' });
    const timeline = (await (await request.get(`/api/requisitions/${req.id}/timeline`, { headers: H() })).json()).data;
    const event = timeline.events.find(e => e.title.startsWith("Niveau d'approbation : N2"));
    expect(event?.details?.[0]).toContain('Politique du projet');
    expect(event?.title).toContain('Manager niveau 2');

    // Groupe BpmnGo manager_n2 (migration 27) : un compte Finance ne peut plus prendre l'approbation N2,
    // un « Manager niveau 2 » si (profils valables sur tous les projets pour ce test)
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
    const asFinance = ((await (await request.get(`/api/tasks/process/${found.requisition.process_instance_id}`, { headers: auth(financeToken) })).json()).data || []).find(tk => tk.id === found.task.id);
    expect([found.task.candidateGroup, asFinance?.canClaim]).toEqual(['manager_n2', false]);
    expect((await request.post(`/api/tasks/${found.task.id}/claim`, { headers: auth(financeToken) })).status()).toBe(403);
    expect((await request.post(`/api/tasks/${found.task.id}/claim`, { headers: auth(managerN2Token) })).status()).toBe(200);
    expect((await request.post(`/api/tasks/${found.task.id}/unclaim`, { headers: auth(managerN2Token) })).status()).toBe(200);

    const ok = await json(await request.post(`/api/tasks/${found.task.id}/complete`, { headers: auth(approver), data: { variables: { approved: true } } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data;
    expect(after.status).toBe('APPROVED');
  });

  test('6 000 sur le projet A → N3 ; même montant sur le projet B (défaut) → N1', async ({ request }) => {
    const [n3, n1] = await Promise.all([requisition(request, projectA, 6000, 'N3'), requisition(request, projectB, 6000, 'défaut N1')]);
    const [a, b] = await Promise.all([approvalTask(request, n3), approvalTask(request, n1)]);
    test.skip(!a || !b, 'BpmnGo indisponible');
    expect([a.task.taskDefinitionKey, b.task.taskDefinitionKey]).toEqual([KEYS.N3, KEYS.N1]);
    expect(b.requisition.approval_policy.source).toBe('DEFAULT');
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

    const req = await requisition(request, projectB, 600, 'entreprise N3');
    const found = await approvalTask(request, req);
    test.skip(!found, 'BpmnGo indisponible');
    expect(found.task.taskDefinitionKey).toBe(KEYS.N3); // 600 ≥ 500 et pas de niveau N2
    expect(found.requisition.approval_policy).toMatchObject({ n1Max: 500, n2Max: 500, source: 'ENTERPRISE' });

    const reset = await json(await request.put('/api/enterprises/current/approval-policy', { headers: H(), data: { n1Max: null, n2Max: null } }));
    expect(reset.body.data.effective.source).toBe('DEFAULT');
  });
});
