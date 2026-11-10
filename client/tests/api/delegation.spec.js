/**
 * tests/api/delegation.spec.js
 *
 * Intérim du chef de projet pendant son absence (migration 53) : délégation par personne, datée, déclarée par le chef
 * ou l'administrateur. Pendant la période, l'intérimaire ET le titulaire valident les réquisitions des projets du chef,
 * y compris une validation que le chef avait déjà prise en charge ; trace « par intérim de ». Étapes BpmnGo ignorées
 * si BpmnGo est indisponible.
 */
import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth, PM_APPROVAL, waitForProcessTask, openProcessTasks, getProcurementAgentId } from './helpers.js';

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test.describe.serial('API › Intérim du chef de projet', () => {
  test.describe.configure({ timeout: 180_000 });
  const stamp = Date.now().toString(36);
  let admin, approver, chief, interim, other, project, line, req, delegation;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });

  async function user(request, key, profiles = ['prof_requester']) {
    const u = { email: `dl.${key}.${stamp}@nowhere.test`, password: 'Secret123' };
    const res = await request.post('/api/users', { headers: H(), data: {
      username: `dl${key}${stamp}`, email: u.email, password: u.password, firstName: key, lastName: stamp, profileIds: profiles,
    } });
    expect(res.status(), await res.text()).toBe(201);
    const login = (await (await request.post('/api/auth/login', { data: u })).json()).data;
    return { id: login.user.id, token: login.token };
  }

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    approver = await getApproverToken(request);
    [chief, interim, other] = await Promise.all([user(request, 'chief'), user(request, 'interim'), user(request, 'other')]);
    project = (await (await request.post('/api/projects', { headers: H(), data: { code: `DL-${stamp}`, name: `Projet intérim ${stamp}`, projectManagerId: chief.id } })).json()).data;
    line = (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: `DL-${stamp}-L`, description: 'Ligne intérim', allocatedAmount: 1_000_000, projectId: project.id,
    } })).json()).data.id;
  });

  test('Réquisition en attente du chef, qu\'il prend en charge avant son congé ; l\'intérimaire ne voit encore rien', async ({ request }) => {
    const created = await json(await request.post('/api/requisitions', { headers: H(), data: {
      title: `[TEST INTERIM] ${stamp}`, description: 'x', projectId: project.id, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM',
      justification: 'x', items: [{ description: 'Article', quantity: 1, frequency: 1, unitPrice: 500, budgetLineId: line }],
    } }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const found = await waitForProcessTask(request, admin, created.body.data.id, PM_APPROVAL);
    test.skip(!found, 'BpmnGo indisponible');
    req = found.requisition;
    expect((await request.post(`/api/tasks/${found.task.id}/claim`, { headers: auth(chief.token) })).status()).toBe(200);
    // Avant l'intérim : réquisition invisible et étape non traitable pour l'intérimaire
    expect((await request.get(`/api/requisitions/${req.id}`, { headers: auth(interim.token) })).status()).toBe(404);
  });

  test('Déclaration : contrôles, par le chef lui-même', async ({ request }) => {
    const self = await json(await request.post('/api/delegations', { headers: auth(chief.token), data: { delegateId: chief.id, startDate: day(0), endDate: day(5) } }));
    expect([self.status, self.body.code]).toEqual([400, 'DELEGATE_SELF']);
    const dates = await json(await request.post('/api/delegations', { headers: auth(chief.token), data: { delegateId: interim.id, startDate: day(5), endDate: day(1) } }));
    expect([dates.status, dates.body.code]).toEqual([400, 'DATES_INVALID']);
    // Un simple utilisateur ne déclare pas l'absence d'un autre
    const forOther = await json(await request.post('/api/delegations', { headers: auth(other.token), data: { delegatorId: chief.id, delegateId: interim.id, startDate: day(0), endDate: day(5) } }));
    expect([forOther.status, forOther.body.code]).toEqual([403, 'NOT_ALLOWED']);
    // Réservé aux chefs de projet (même déclaré par l'administrateur) ; carte masquée (canDelegate)
    const notPm = await json(await request.post('/api/delegations', { headers: auth(other.token), data: { delegateId: interim.id, startDate: day(0), endDate: day(5) } }));
    expect([notPm.status, notPm.body.code]).toEqual([400, 'NOT_PROJECT_MANAGER']);
    const notPmByAdmin = await json(await request.post('/api/delegations', { headers: H(), data: { delegatorId: other.id, delegateId: interim.id, startDate: day(0), endDate: day(5) } }));
    expect([notPmByAdmin.status, notPmByAdmin.body.code]).toEqual([400, 'NOT_PROJECT_MANAGER']);
    expect((await (await request.get('/api/delegations', { headers: auth(other.token) })).json()).canDelegate).toBe(false);
    expect((await (await request.get('/api/delegations', { headers: auth(chief.token) })).json()).canDelegate).toBe(true);

    const ok = await json(await request.post('/api/delegations', { headers: auth(chief.token), data: { delegateId: interim.id, startDate: day(0), endDate: day(5), reason: 'Congé annuel' } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    delegation = ok.body.data;
    expect([delegation.active, delegation.project_count]).toEqual([true, 1]);
    const overlap = await json(await request.post('/api/delegations', { headers: H(), data: { delegatorId: chief.id, delegateId: other.id, startDate: day(3), endDate: day(8) } }));
    expect([overlap.status, overlap.body.code]).toEqual([409, 'DELEGATION_OVERLAP']);
    // Visible par l'intérimaire (reçue) et par l'administrateur (fiche de l'utilisateur)
    const mine = (await (await request.get('/api/delegations?current=1', { headers: auth(interim.token) })).json()).data;
    expect(mine.map(d => d.id)).toContain(delegation.id);
    const audit = (await (await request.get(`/api/audit-logs?limit=5&action=DELEGATION_CREATED&entityType=delegation&entityRef=${delegation.id}`, { headers: H() })).json()).data;
    expect(audit[0]?.new_value?.delegate).toBe(`dl.interim.${stamp}@nowhere.test`);
  });

  test('Pendant l\'intérim : l\'intérimaire voit et valide la réquisition prise en charge par le chef — « par intérim de »', async ({ request }) => {
    test.skip(!req, 'BpmnGo indisponible');
    expect((await request.get(`/api/requisitions/${req.id}`, { headers: auth(interim.token) })).status()).toBe(200);
    const task = (await openProcessTasks(request, interim.token, req.process_instance_id)).find(t => t.taskDefinitionKey === PM_APPROVAL);
    expect([task?.assignee, task?.canComplete, task?.blockedReason]).toEqual([`dl.chief.${stamp}@nowhere.test`, true, null]);
    // Un tiers sans délégation reste refusé
    const third = await json(await request.post(`/api/tasks/${task.id}/complete`, { headers: auth(other.token), data: { variables: { approved: true } } }));
    expect(third.status).toBe(403);

    const done = await json(await request.post(`/api/tasks/${task.id}/complete`, { headers: auth(interim.token), data: { variables: { approved: true, procurementAgentId: await getProcurementAgentId(request), comment: 'OK en intérim' } } }));
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data.status).toBe('APPROVED');
    const timeline = (await (await request.get(`/api/requisitions/${req.id}/timeline?lang=fr`, { headers: H() })).json()).data;
    const event = timeline.events.find(e => (e.details || []).some(d => d.startsWith('Par intérim de')));
    expect(event?.details).toContain(`Par intérim de chief ${stamp} (chef de projet)`);
    expect(event?.actor).toContain('interim');
  });

  test('Fin anticipée : l\'intérimaire perd l\'accès ; fin déjà faite refusée', async ({ request }) => {
    const notAllowed = await json(await request.post(`/api/delegations/${delegation.id}/end`, { headers: auth(other.token) }));
    expect(notAllowed.status).toBe(403);
    const ended = await json(await request.post(`/api/delegations/${delegation.id}/end`, { headers: auth(chief.token) }));
    expect([ended.status, ended.body.data?.active]).toEqual([200, false]);
    const again = await json(await request.post(`/api/delegations/${delegation.id}/end`, { headers: H() }));
    expect([again.status, again.body.code]).toEqual([409, 'ALREADY_ENDED']);
    if (req) expect((await request.get(`/api/requisitions/${req.id}`, { headers: auth(interim.token) })).status()).toBe(404);
  });
});
