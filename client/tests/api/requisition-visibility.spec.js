import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Visibilité des réquisitions (migration 30_requisition_visibility.sql) : dans un projet, un utilisateur ne voit que
// les réquisitions qu'il a créées, sauf s'il a sur ce projet un profil autre que « Demandeur » (managers, finance,
// achats, logistique, auditeur, admin…) ou s'il est le chef du projet. Liste, export, fiche (et ses onglets),
// recherche globale ; réquisition non visible = 404.
test.describe.serial('API › Visibilité des réquisitions par projet', () => {
  test.describe.configure({ timeout: 120_000 });
  const stamp = Date.now().toString(36);
  const users = {
    alice: { profileIds: ['prof_requester'] },   // demandeuse sur P
    bob: { profileIds: ['prof_requester'] },     // demandeur sur P
    mgrP: { profileIds: ['prof_manager'] },      // manager N1 sur P
    mgrQ: { profileIds: ['prof_manager'] },      // manager N1 sur Q seulement
    chief: { profileIds: ['prof_requester'] },   // chef du projet P, simple demandeur
  };
  let admin, dept, projectP, projectQ, line, reqAlice, reqBob;
  const H = (token = admin) => auth(token);
  const listOf = async (request, token) => (await (await request.get(`/api/requisitions?search=${stamp}&limit=50`, { headers: H(token) })).json()).data.map(r => r.id).sort();

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    for (const [key, u] of Object.entries(users)) {
      Object.assign(u, { email: `rv.${key}.${stamp}@nowhere.test`, password: 'Secret123' });
      const res = await request.post('/api/users', { headers: H(), data: {
        username: `rv${key}${stamp}`, email: u.email, password: u.password, firstName: key, lastName: stamp, profileIds: u.profileIds,
      } });
      expect(res.status(), await res.text()).toBe(201);
      u.id = (await res.json()).data.id;
    }
    [dept] = (await (await request.get('/api/departments', { headers: H() })).json()).data;
    const mkProject = async (code, data = {}) => {
      const res = await request.post('/api/projects/', { headers: H(), data: { code, name: `Projet ${code}`, ...data } });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data;
    };
    projectP = await mkProject(`RVP-${stamp}`, { projectManagerId: users.chief.id });
    projectQ = await mkProject(`RVQ-${stamp}`);
    for (const [key, project] of [['alice', projectP], ['bob', projectP], ['mgrP', projectP], ['mgrQ', projectQ]]) {
      const res = await request.post('/api/projects/members', { headers: H(), data: { projectId: project.id, userId: users[key].id, role: 'MEMBER' } });
      expect(res.status(), await res.text()).toBe(200);
    }
    line = (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: `RV-L-${stamp}`, description: 'Ligne visibilité', allocatedAmount: 100_000, projectId: projectP.id,
    } })).json()).data;
    for (const u of Object.values(users)) u.token = (await (await request.post('/api/auth/login', { data: { email: u.email, password: u.password } })).json()).data.token;

    const create = async (u, who) => {
      const res = await request.post('/api/requisitions', { headers: H(u.token), data: {
        title: `[TEST VISIBILITE] ${who} ${stamp}`, description: 'x', departmentId: dept.id, projectId: projectP.id, currencyId: 1, currencyCode: 'USD',
        priority: 'MEDIUM', justification: 'x', items: [{ description: 'Article', quantity: 1, frequency: 1, unitPrice: 40, budgetLineId: line.id }],
      } });
      expect(res.status(), await res.text()).toBeLessThan(300);
      return (await res.json()).data;
    };
    reqAlice = await create(users.alice, 'Alice');
    reqBob = await create(users.bob, 'Bob');
  });

  test('Demandeur : seulement ses réquisitions (liste, fiche, onglets, recherche)', async ({ request }) => {
    const { alice } = users;
    expect(await listOf(request, alice.token)).toEqual([reqAlice.id]);
    expect((await request.get(`/api/requisitions/${reqAlice.id}`, { headers: H(alice.token) })).status()).toBe(200);
    for (const path of ['', '/timeline', '/versions', '/revision', '/export/pdf']) {
      expect((await request.get(`/api/requisitions/${reqBob.id}${path}`, { headers: H(alice.token) })).status(), path).toBe(404);
    }
    const search = (await (await request.get(`/api/search?q=${stamp}`, { headers: H(alice.token) })).json()).data;
    expect((search.find(g => g.group === 'requisitions')?.items || []).map(i => i.id)).toEqual([reqAlice.id]);
    // Liste : nom du demandeur renvoyé (colonne « Demandeur »)
    const [row] = (await (await request.get(`/api/requisitions?search=${stamp}`, { headers: H(alice.token) })).json()).data;
    expect([row.first_name, row.last_name]).toEqual(['alice', stamp]);
  });

  test('Profil d\'approbation sur le projet, chef de projet, admin : toutes les réquisitions du projet', async ({ request }) => {
    const both = [reqAlice.id, reqBob.id].sort();
    expect(await listOf(request, users.mgrP.token)).toEqual(both);
    expect((await request.get(`/api/requisitions/${reqBob.id}`, { headers: H(users.mgrP.token) })).status()).toBe(200);
    expect(await listOf(request, users.chief.token)).toEqual(both);
    expect(await listOf(request, admin)).toEqual(both);
  });

  test('Profil d\'approbation sur un autre projet seulement : aucune', async ({ request }) => {
    expect(await listOf(request, users.mgrQ.token)).toEqual([]);
    expect((await request.get(`/api/requisitions/${reqAlice.id}`, { headers: H(users.mgrQ.token) })).status()).toBe(404);
  });
});
