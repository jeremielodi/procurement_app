import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Réquisition créée en brouillon (migration 67_requisition_drafts.sql) : aucun processus BpmnGo à la création ;
// le demandeur seul la modifie, la supprime et la soumet (POST /requisitions/:id/submit → démarrage du circuit).
// Un brouillon n'est visible que de son demandeur et des administrateurs.
test.describe.serial('API › Réquisition en brouillon', () => {
  test.describe.configure({ timeout: 120_000 });
  const stamp = Date.now().toString(36);
  const users = {
    requester: { profileIds: ['prof_requester'] },
    manager: { profileIds: ['prof_manager'] }, // voit les réquisitions du projet, pas les brouillons
    chief: { profileIds: ['prof_requester'] }, // chef du projet
  };
  let admin, project, line, draft, other;
  const H = (token = admin) => auth(token);
  const body = (title, unitPrice = 40) => ({
    title: `[TEST BROUILLON] ${title} ${stamp}`, description: 'x', projectId: project.id, currencyId: 1, currencyCode: 'USD',
    priority: 'MEDIUM', justification: 'x', items: [{ description: 'Article', quantity: 2, frequency: 1, unitPrice, budgetLineId: line.id }],
  });
  const listIds = async (request, token) => (await (await request.get(`/api/requisitions?search=${stamp}&limit=50`, { headers: H(token) })).json()).data.map(r => r.id);

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    for (const [key, u] of Object.entries(users)) {
      Object.assign(u, { email: `rd.${key}.${stamp}@nowhere.test`, password: 'Secret123' });
      const res = await request.post('/api/users', { headers: H(), data: {
        username: `rd${key}${stamp}`, email: u.email, password: u.password, firstName: key, lastName: stamp, profileIds: u.profileIds,
      } });
      expect(res.status(), await res.text()).toBe(201);
      u.id = (await res.json()).data.id;
    }
    const res = await request.post('/api/projects/', { headers: H(), data: { code: `RD-${stamp}`, name: `Projet brouillon ${stamp}`, projectManagerId: users.chief.id } });
    expect(res.status(), await res.text()).toBe(201);
    project = (await res.json()).data;
    for (const key of ['requester', 'manager']) {
      const m = await request.post('/api/projects/members', { headers: H(), data: { projectId: project.id, userId: users[key].id, role: 'MEMBER' } });
      expect(m.status(), await m.text()).toBe(200);
    }
    line = (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: `RD-L-${stamp}`, description: 'Ligne brouillon', allocatedAmount: 100_000, projectId: project.id,
    } })).json()).data;
    for (const u of Object.values(users)) u.token = (await (await request.post('/api/auth/login', { data: { email: u.email, password: u.password } })).json()).data.token;
  });

  test('Création = brouillon, sans processus BpmnGo', async ({ request }) => {
    const res = await request.post('/api/requisitions', { headers: H(users.requester.token), data: body('A') });
    expect(res.status(), await res.text()).toBe(201);
    draft = (await res.json()).data;
    expect(draft.status).toBe('DRAFT');
    const r = (await (await request.get(`/api/requisitions/${draft.id}`, { headers: H(users.requester.token) })).json()).data;
    expect(r.status).toBe('DRAFT');
    expect(r.process_instance_id).toBeNull();

    const state = (await (await request.get(`/api/requisitions/${draft.id}/revision`, { headers: H(users.requester.token) })).json()).data;
    expect(state).toMatchObject({ isDraft: true, canEdit: true, canSubmit: true, canDelete: true });
    const timeline = (await (await request.get(`/api/requisitions/${draft.id}/timeline`, { headers: H(users.requester.token) })).json()).data;
    expect(timeline.steps[0]).toMatchObject({ key: 'created', status: 'current' });
  });

  test('Visible du demandeur et de l\'administrateur seulement', async ({ request }) => {
    expect(await listIds(request, users.requester.token)).toContain(draft.id);
    expect(await listIds(request, admin)).toContain(draft.id);
    for (const key of ['manager', 'chief']) {
      expect(await listIds(request, users[key].token), key).not.toContain(draft.id);
      expect((await request.get(`/api/requisitions/${draft.id}`, { headers: H(users[key].token) })).status(), key).toBe(404);
    }
    const state = (await (await request.get(`/api/requisitions/${draft.id}/revision`, { headers: H(admin) })).json()).data;
    expect(state).toMatchObject({ isDraft: true, canEdit: false, canSubmit: false });
  });

  test('Modification par le demandeur seul', async ({ request }) => {
    const ok = await request.put(`/api/requisitions/${draft.id}`, { headers: H(users.requester.token), data: body('A modifié', 50) });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).data.estimatedAmount).toBe(100);
    const r = (await (await request.get(`/api/requisitions/${draft.id}`, { headers: H(users.requester.token) })).json()).data;
    expect(r.title).toContain('A modifié');
    expect(r.status).toBe('DRAFT');

    const refused = await request.put(`/api/requisitions/${draft.id}`, { headers: H(admin), data: body('Admin') });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).code).toBe('NOT_REQUESTER');
  });

  test('Soumission par une autre personne refusée', async ({ request }) => {
    const res = await request.post(`/api/requisitions/${draft.id}/submit`, { headers: H(admin), data: {} });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('NOT_REQUESTER');
  });

  test('Suppression de son propre brouillon par le demandeur', async ({ request }) => {
    other = (await (await request.post('/api/requisitions', { headers: H(users.requester.token), data: body('B') })).json()).data;
    expect((await request.delete(`/api/requisitions/${other.id}`, { headers: H(users.manager.token) })).status()).toBe(404);
    const res = await request.delete(`/api/requisitions/${other.id}`, { headers: H(users.requester.token) });
    expect(res.status(), await res.text()).toBe(200);
    expect((await request.get(`/api/requisitions/${other.id}`, { headers: H(admin) })).status()).toBe(404);
  });

  test('Soumission par le demandeur → circuit BpmnGo', async ({ request }) => {
    const res = await request.post(`/api/requisitions/${draft.id}/submit`, { headers: H(users.requester.token), data: {} });
    if (res.status() === 502) {
      // BpmnGo injoignable : la réquisition reste un brouillon
      const r = (await (await request.get(`/api/requisitions/${draft.id}`, { headers: H(users.requester.token) })).json()).data;
      expect(r.status).toBe('DRAFT');
      test.skip(true, 'BpmnGo injoignable');
    }
    expect(res.status(), await res.text()).toBe(200);
    const data = (await res.json()).data;
    expect(data.status).toBe('IN_PROGRESS');
    expect(data.processInstanceId).toBeTruthy();

    // Le chef de projet et le manager la voient désormais
    expect(await listIds(request, users.chief.token)).toContain(draft.id);
    expect(await listIds(request, users.manager.token)).toContain(draft.id);

    const again = await request.post(`/api/requisitions/${draft.id}/submit`, { headers: H(users.requester.token), data: {} });
    expect(again.status()).toBe(409);
    expect((await again.json()).code).toBe('NOT_DRAFT');
    const edit = await request.put(`/api/requisitions/${draft.id}`, { headers: H(users.requester.token), data: body('Trop tard') });
    expect(edit.status()).toBe(409);
    expect((await edit.json()).code).toBe('NOT_EDITABLE');
    const state = (await (await request.get(`/api/requisitions/${draft.id}/revision`, { headers: H(users.requester.token) })).json()).data;
    expect(state).toMatchObject({ isDraft: false, canSubmit: false, canDelete: false });

    const versions = (await (await request.get(`/api/requisitions/${draft.id}/versions`, { headers: H(users.requester.token) })).json()).data;
    expect(versions.versions).toHaveLength(1);
    expect(versions.versions[0].amount).toBe(100);
  });

  test('Création et soumission en un appel ({ submit: true })', async ({ request }) => {
    const res = await request.post('/api/requisitions', { headers: H(users.requester.token), data: { ...body('C'), submit: true } });
    expect(res.status(), await res.text()).toBe(201);
    const json = await res.json();
    if (json.submitError) {
      expect(json.submitError.code).toBe('BPMNGO_ERROR');
      expect(json.data.status).toBe('DRAFT');
    } else {
      expect(json.data.status).toBe('IN_PROGRESS');
    }
  });
});
