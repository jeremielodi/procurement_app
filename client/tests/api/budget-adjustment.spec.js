import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Budget insuffisant → ajustement → nouvelle vérification sur la MÊME réquisition (BPMN : Gateway_BudgetAdjustmentDecision).
// Nécessite GoFlow avec la version du BPMN contenant la boucle ; sans GoFlow les tests du circuit sont ignorés.
const WAIT = 40_000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test.describe.serial('API › Ajustement budgétaire', () => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const outsider = { email: `badj.out.${stamp}@nowhere.test`, password: 'Secret123' };
  let admin, outsiderToken, project, dept, smallLine, bigLine, reqRetry, reqAbandon;

  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const getReq = async (request, id) => (await (await request.get(`/api/requisitions/${id}`, { headers: H() })).json()).data;
  const tasksOf = async (request, req) => {
    const body = await (await request.get(`/api/tasks/process/${req.process_instance_id}`, { headers: H() })).json();
    return (body.data || body.tasks || []).filter(tk => tk.status !== 'COMPLETED');
  };
  /** Attend un statut (et, si demandé, la tâche GoFlow correspondante) */
  async function waitFor(request, req, { status, taskKey }) {
    const start = Date.now();
    while (Date.now() - start < WAIT) {
      const current = await getReq(request, req.id);
      const okStatus = !status || current.status === status;
      const okTask = !taskKey || (current.process_instance_id && (await tasksOf(request, current)).some(tk => tk.taskDefinitionKey === taskKey));
      if (okStatus && okTask) return current;
      await sleep(1500);
    }
    return null;
  }
  async function createRequisition(request, amount) {
    const res = await request.post('/api/requisitions', { headers: H(), data: {
      title: `[TEST AJUSTEMENT] ${stamp} ${amount}`, description: 'x', departmentId: dept.id, projectId: project.id,
      currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'x',
      items: [{ description: 'Article test ajustement', quantity: 1, frequency: 1, unitPrice: amount, budgetLineId: smallLine.id }],
    } });
    expect(res.status()).toBe(201);
    return (await res.json()).data;
  }

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    [dept] = (await (await request.get('/api/departments', { headers: H() })).json()).data;
    [project] = (await (await request.get('/api/projects', { headers: H() })).json()).data;
    const line = async (code, amount) => (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: code, description: `Ligne test ajustement ${code}`, allocatedAmount: amount, projectId: project.id,
    } })).json()).data;
    smallLine = await line(`BADJ-S-${stamp}`, 100);
    bigLine = await line(`BADJ-B-${stamp}`, 1_000_000);
    expect(smallLine?.id && bigLine?.id).toBeTruthy();
    const created = await request.post('/api/users', { headers: H(), data: { username: `badjout${stamp}`, email: outsider.email, password: outsider.password, firstName: 'Out', lastName: stamp, profileIds: ['prof_logistic'] } });
    expect(created.status()).toBe(201);
    outsiderToken = (await (await request.post('/api/auth/login', { data: outsider })).json()).data.token;
  });

  test('Budget insuffisant : la réquisition attend l\'ajustement (tâche du demandeur), le processus continue', async ({ request }) => {
    reqRetry = await createRequisition(request, 5_000);
    const waited = await waitFor(request, reqRetry, { status: 'BUDGET_INSUFFICIENT', taskKey: 'Activity_BudgetAdjustment' });
    test.skip(!waited, 'GoFlow (avec le BPMN à jour) indisponible');
    reqRetry = waited;
    const summary = await json(await request.get(`/api/requisitions/${reqRetry.id}/budget-adjustment`, { headers: H() }));
    expect(summary.status).toBe(200);
    expect(summary.body.data.lines).toEqual([expect.objectContaining({ budgetLineId: smallLine.id, requested: 5000, available: 100, ok: false })]);
    expect(summary.body.data.taskId).toBeTruthy();
    expect(summary.body.data.canAct).toBe(true);
  });

  test('Contrôles : relance refusée tant que le budget manque ; autre utilisateur interdit ; ligne d\'un autre projet refusée', async ({ request }) => {
    test.skip(reqRetry?.status !== 'BUDGET_INSUFFICIENT', 'étape précédente ignorée');
    const retry = await json(await request.post(`/api/requisitions/${reqRetry.id}/budget-adjustment`, { headers: H(), data: { decision: 'RETRY' } }));
    expect([retry.status, retry.body.code]).toEqual([409, 'STILL_INSUFFICIENT']);
    const out = await json(await request.post(`/api/requisitions/${reqRetry.id}/budget-adjustment`, { headers: auth(outsiderToken), data: { decision: 'ABANDON' } }));
    expect(out.status).toBe(403);
    const item = (await (await request.get(`/api/requisitions/${reqRetry.id}/budget-adjustment`, { headers: H() })).json()).data.items[0];
    const bogus = await json(await request.patch(`/api/requisitions/${reqRetry.id}/budget-lines`, { headers: H(), data: { changes: [{ itemId: item.id, budgetLineId: '00000000-0000-0000-0000-000000000000' }] } }));
    expect([bogus.status, bogus.body.code]).toEqual([400, 'BUDGET_LINE_INVALID']);
  });

  test('Changement de ligne puis relance : même réquisition, circuit d\'approbation repris', async ({ request }) => {
    test.skip(reqRetry?.status !== 'BUDGET_INSUFFICIENT', 'étape précédente ignorée');
    const item = (await (await request.get(`/api/requisitions/${reqRetry.id}/budget-adjustment`, { headers: H() })).json()).data.items[0];
    const changed = await json(await request.patch(`/api/requisitions/${reqRetry.id}/budget-lines`, { headers: H(), data: { changes: [{ itemId: item.id, budgetLineId: bigLine.id }] } }));
    expect(changed.status).toBe(200);
    expect((await (await request.get(`/api/requisitions/${reqRetry.id}/budget-adjustment`, { headers: H() })).json()).data.allOk).toBe(true);

    const retry = await json(await request.post(`/api/requisitions/${reqRetry.id}/budget-adjustment`, { headers: H(), data: { decision: 'RETRY', comment: 'Ligne changée' } }));
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.data.taskCompleted).toBe(true);
    // Nouvelle vérification OK → statut repris, approbation N1 (5 000 < 25 000) sur le MÊME processus
    const resumed = await waitFor(request, reqRetry, { status: 'IN_PROGRESS', taskKey: 'Activity_ValidationN1_Manager' });
    expect(resumed, 'la réquisition doit repartir vers l\'approbation N1').toBeTruthy();
    expect(resumed.process_instance_id).toBe(reqRetry.process_instance_id);
    const timeline = (await (await request.get(`/api/requisitions/${reqRetry.id}/timeline?lang=fr`, { headers: H() })).json()).data;
    expect(timeline.events.map(e => e.title)).toContain('Budget ajusté : nouvelle vérification demandée');
  });

  test('Abandon : réquisition annulée, plus aucune tâche', async ({ request }) => {
    reqAbandon = await createRequisition(request, 7_000);
    const waited = await waitFor(request, reqAbandon, { status: 'BUDGET_INSUFFICIENT', taskKey: 'Activity_BudgetAdjustment' });
    test.skip(!waited, 'GoFlow (avec le BPMN à jour) indisponible');
    const res = await json(await request.post(`/api/requisitions/${reqAbandon.id}/budget-adjustment`, { headers: H(), data: { decision: 'ABANDON', comment: 'Plus nécessaire' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await getReq(request, reqAbandon.id);
    expect(after.status).toBe('CANCELLED');
    await sleep(3000);
    expect(await tasksOf(request, after)).toHaveLength(0);
    const again = await json(await request.post(`/api/requisitions/${reqAbandon.id}/budget-adjustment`, { headers: H(), data: { decision: 'RETRY' } }));
    expect([again.status, again.body.code]).toEqual([409, 'NOT_BUDGET_INSUFFICIENT']);
  });
});
