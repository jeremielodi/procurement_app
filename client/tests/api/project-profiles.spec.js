import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Profils BPMN liés au projet (migration 24_project_profiles.sql) :
//  - un profil de workflow (manager, finance, requester…) ne s'exerce que sur les projets où il est attribué au
//    membre (fiche du projet), ou partout avec « Tous les projets » (fiche de l'utilisateur)
//  - contrôlé par le serveur : création de réquisition, formulaires (facture…), tâches GoFlow (liste, prise en charge)
//  - refus 403 NOT_ON_PROJECT tracé (PROJECT_ACCESS_DENIED) ; membres et profils tracés dans le journal d'audit
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const WAIT = 40_000;

test.describe.serial('API › Profils liés au projet', () => {
  test.describe.configure({ timeout: 120_000 });
  const stamp = Date.now().toString(36);
  const users = {
    finance: { email: `pp.finance.${stamp}@nowhere.test`, password: 'Secret123', profileIds: ['prof_finance'] },
    requester: { email: `pp.requester.${stamp}@nowhere.test`, password: 'Secret123', profileIds: ['prof_requester'] },
    manager: { email: `pp.manager.${stamp}@nowhere.test`, password: 'Secret123', profileIds: ['prof_manager'] },
  };
  let admin, dept, projectA, projectB, lineA, lineB, reqB, poB;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const tokenOf = async (request, u) => (await (await request.post('/api/auth/login', { data: u })).json()).data.token;
  const members = async (request, projectId) => (await (await request.get(`/api/projects/${projectId}/members`, { headers: H() })).json()).data;
  const lastAudit = async (request, query) => (await (await request.get(`/api/audit-logs?limit=5&${query}`, { headers: H() })).json()).data;
  const requisition = (projectId, budgetLineId, title) => ({
    title: `[TEST PROFILS PROJET] ${title} ${stamp}`, description: 'x', departmentId: dept.id, projectId, currencyId: 1, currencyCode: 'USD',
    priority: 'MEDIUM', justification: 'x', items: [{ description: 'Article', quantity: 1, frequency: 1, unitPrice: 40, budgetLineId }],
  });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    for (const [key, u] of Object.entries(users)) {
      const res = await request.post('/api/users', { headers: H(), data: {
        username: `pp${key}${stamp}`, email: u.email, password: u.password, firstName: key, lastName: stamp, profileIds: u.profileIds,
      } });
      expect(res.status(), await res.text()).toBe(201);
      u.id = (await res.json()).data.id;
    }
    [dept] = (await (await request.get('/api/departments', { headers: H() })).json()).data;
    const mkProject = async (code) => {
      const res = await request.post('/api/projects/', { headers: H(), data: { code, name: `Projet ${code}` } });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data;
    };
    projectA = await mkProject(`PPA-${stamp}`);
    projectB = await mkProject(`PPB-${stamp}`);
    const mkLine = async (project, code) => (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: code, description: `Ligne ${code}`, allocatedAmount: 100_000, projectId: project.id,
    } })).json()).data;
    lineA = await mkLine(projectA, `PPA-L-${stamp}`);
    lineB = await mkLine(projectB, `PPB-L-${stamp}`);
    expect(lineA?.id && lineB?.id).toBeTruthy();
  });

  test('Membre ajouté : ses profils de workflow sont activés sur le projet ; doublon et profil non détenu refusés', async ({ request }) => {
    const add = await json(await request.post('/api/projects/members', { headers: H(), data: { projectId: projectA.id, userId: users.finance.id, role: 'MEMBER' } }));
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body.data.profileIds).toEqual(['prof_finance']);

    const member = (await members(request, projectA.id)).find(m => m.id === users.finance.id);
    expect(member.profiles).toEqual([expect.objectContaining({ id: 'prof_finance', assigned: true, allProjects: false })]);

    const again = await json(await request.post('/api/projects/members', { headers: H(), data: { projectId: projectA.id, userId: users.finance.id } }));
    expect([again.status, again.body.code]).toEqual([409, 'ALREADY_MEMBER']);
    const invalid = await json(await request.put(`/api/projects/${projectA.id}/members/${users.finance.id}/profiles`, { headers: H(), data: { profileIds: ['prof_dg'] } }));
    expect([invalid.status, invalid.body.code]).toEqual([400, 'INVALID_PROFILE']);

    const logged = await lastAudit(request, `action=PROJECT_MEMBER_ADDED&entityType=project&entityRef=${projectA.id}`);
    expect(logged[0]?.new_value?.profileIds).toEqual(['prof_finance']);
    // Fiche utilisateur : projets et profils exercés
    const detail = (await (await request.get(`/api/users/${users.finance.id}`, { headers: H() })).json()).data;
    expect(detail.projects.map(p => [p.id, p.profile_ids])).toEqual([[projectA.id, ['prof_finance']]]);
  });

  test('Réquisition : seulement sur un projet où le demandeur a le profil (liste filtrée, refus tracé)', async ({ request }) => {
    expect((await request.post('/api/projects/members', { headers: H(), data: { projectId: projectA.id, userId: users.requester.id } })).status()).toBe(200);
    const token = await tokenOf(request, users.requester);

    const offered = (await (await request.get('/api/projects?is_active=true&forRequisition=1', { headers: auth(token) })).json()).data.map(p => p.id);
    expect(offered).toContain(projectA.id);
    expect(offered).not.toContain(projectB.id);

    const refused = await json(await request.post('/api/requisitions', { headers: auth(token), data: requisition(projectB.id, lineB.id, 'refusée') }));
    expect([refused.status, refused.body.code]).toEqual([403, 'NOT_ON_PROJECT']);
    const logged = await lastAudit(request, `action=PROJECT_ACCESS_DENIED&entityType=project&entityRef=${projectB.id}`);
    expect(logged[0]?.new_value?.permission).toBe('CREATE_REQUISITIONS');

    const ok = await json(await request.post('/api/requisitions', { headers: auth(token), data: requisition(projectA.id, lineA.id, 'acceptée') }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  test('Formulaire (facture) : refusé hors du projet, accepté une fois le profil attribué sur le projet', async ({ request }) => {
    reqB = (await (await request.post('/api/requisitions', { headers: H(), data: requisition(projectB.id, lineB.id, 'projet B') })).json()).data;
    const supplier = (await (await request.post('/api/suppliers', { headers: H(), data: {
      name: `PP Fournisseur ${stamp}`, email: `pp.supplier.${stamp}@nowhere.test`, status: 'ACTIVE', prequalified: true,
    } })).json()).data;
    poB = (await (await request.post('/api/purchase-orders', { headers: H(), data: {
      requisitionId: reqB.id, supplierId: supplier.id, currency: 'USD', totalAmount: 40, items: [{ description: 'Article', quantity: 1, unitPrice: 40 }],
    } })).json()).data;
    expect(poB?.id).toBeTruthy();

    const token = await tokenOf(request, users.finance);
    const invoice = { poId: poB.id, supplierInvoiceNumber: `PP-${stamp}`, invoiceDate: new Date().toISOString().slice(0, 10), totalAmount: 40 };
    const refused = await json(await request.post('/api/invoices', { headers: auth(token), data: invoice }));
    expect([refused.status, refused.body.code]).toEqual([403, 'NOT_ON_PROJECT']);

    // Profil attribué sur le projet B : le contrôle de projet passe (le bon n'étant pas approuvé, la facture reste refusée pour cette raison)
    expect((await request.post('/api/projects/members', { headers: H(), data: { projectId: projectB.id, userId: users.finance.id, profileIds: ['prof_finance'] } })).status()).toBe(200);
    const allowed = await json(await request.post('/api/invoices', { headers: auth(token), data: invoice }));
    expect(allowed.body.code).not.toBe('NOT_ON_PROJECT');
    expect(allowed.status).not.toBe(403);

    // Profil retiré du projet B (le membre reste) : de nouveau refusé, changement tracé avec l'avant / après
    const off = await json(await request.put(`/api/projects/${projectB.id}/members/${users.finance.id}/profiles`, { headers: H(), data: { profileIds: [] } }));
    expect(off.status).toBe(200);
    expect((await json(await request.post('/api/invoices', { headers: auth(token), data: invoice }))).body.code).toBe('NOT_ON_PROJECT');
    const logged = await lastAudit(request, `action=PROJECT_MEMBER_PROFILES_CHANGED&entityType=project&entityRef=${projectB.id}`);
    expect([logged[0]?.old_value?.profileIds, logged[0]?.new_value?.profileIds]).toEqual([['prof_finance'], []]);
  });

  test('« Tous les projets » sur la fiche utilisateur : profil valable partout ; profil retiré de la fiche → retiré des projets', async ({ request }) => {
    const update = (data) => request.put(`/api/users/${users.finance.id}`, { headers: H(), data: { firstName: 'finance', lastName: stamp, ...data } });
    expect((await update({ profileIds: ['prof_finance'], allProjectsProfileIds: ['prof_finance'] })).status()).toBe(200);
    const token = await tokenOf(request, users.finance);
    const invoice = { poId: poB.id, supplierInvoiceNumber: `PP2-${stamp}`, invoiceDate: new Date().toISOString().slice(0, 10), totalAmount: 40 };
    expect((await json(await request.post('/api/invoices', { headers: auth(token), data: invoice }))).body.code).not.toBe('NOT_ON_PROJECT');
    const listed = (await (await request.get('/api/users?search=' + encodeURIComponent(users.finance.email), { headers: H() })).json()).data;
    expect((listed.users || listed).find(u => u.id === users.finance.id)?.all_projects_profile_ids).toEqual(['prof_finance']);

    // Mise à jour sans allProjectsProfileIds : la case est conservée
    expect((await update({ profileIds: ['prof_finance'] })).status()).toBe(200);
    const kept = (await (await request.get(`/api/users/${users.finance.id}`, { headers: H() })).json()).data;
    expect(kept.profiles.find(p => p.id === 'prof_finance')?.all_projects).toBe(true);

    // Profil retiré de la fiche : plus aucun profil sur le projet A
    expect((await update({ profileIds: ['prof_requester'], allProjectsProfileIds: [] })).status()).toBe(200);
    const member = (await members(request, projectA.id)).find(m => m.id === users.finance.id);
    expect(member.profiles.map(p => p.id)).toEqual(['prof_requester']);
    expect(member.profiles[0].assigned).toBe(false);
  });

  test('Tâche GoFlow : un manager d\'un autre projet ne peut pas la prendre ; une fois le profil attribué sur le projet, oui', async ({ request }) => {
    const req = (await (await request.post('/api/requisitions', { headers: H(), data: requisition(projectA.id, lineA.id, 'tâche N1') })).json()).data;
    expect(req?.id).toBeTruthy();
    // Manager membre du projet B uniquement
    expect((await request.post('/api/projects/members', { headers: H(), data: { projectId: projectB.id, userId: users.manager.id } })).status()).toBe(200);
    const token = await tokenOf(request, users.manager);

    let task, processId;
    const start = Date.now();
    while (Date.now() - start < WAIT) {
      processId = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data?.process_instance_id;
      if (processId) {
        const tasks = (await (await request.get(`/api/tasks/process/${processId}`, { headers: auth(token) })).json()).data || [];
        task = tasks.find(tk => tk.status !== 'COMPLETED' && tk.taskDefinitionKey === 'Activity_ValidationN1_Manager');
        if (task) break;
      }
      await sleep(1500);
    }
    test.skip(!task, 'GoFlow indisponible');
    expect([task.canClaim, task.blockedReason]).toEqual([false, 'NOT_ON_PROJECT']);
    // Absente de « Mes tâches »
    const mine = (await (await request.get('/api/tasks/user', { headers: auth(token) })).json()).data || [];
    expect(mine.some(tk => tk.id === task.id)).toBe(false);
    const claim = await json(await request.post(`/api/tasks/${task.id}/claim`, { headers: auth(token) }));
    expect([claim.status, claim.body.code]).toEqual([403, 'NOT_ON_PROJECT']);
    const complete = await json(await request.post(`/api/tasks/${task.id}/complete`, { headers: auth(token), data: { variables: { approved: true } } }));
    expect([complete.status, complete.body.code]).toEqual([403, 'NOT_ON_PROJECT']);

    // Manager attribué sur le projet A
    expect((await request.post('/api/projects/members', { headers: H(), data: { projectId: projectA.id, userId: users.manager.id } })).status()).toBe(200);
    const after = ((await (await request.get(`/api/tasks/process/${processId}`, { headers: auth(token) })).json()).data || []).find(tk => tk.id === task.id);
    expect([after.canClaim, after.blockedReason]).toEqual([true, null]);
    expect(((await (await request.get('/api/tasks/user', { headers: auth(token) })).json()).data || []).some(tk => tk.id === task.id)).toBe(true);
    const ok = await json(await request.post(`/api/tasks/${task.id}/claim`, { headers: auth(token) }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await request.post(`/api/tasks/${task.id}/unclaim`, { headers: auth(token) })).status()).toBe(200);
  });
});
