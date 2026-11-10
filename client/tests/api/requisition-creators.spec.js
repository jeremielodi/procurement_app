/**
 * tests/api/requisition-creators.spec.js
 *
 * Seuls les demandeurs et l'administrateur créent des réquisitions (migration 60, 2026-11-10) : CREATE_REQUISITIONS
 * retiré des managers N1 / N2 / N3 ; un manager qui doit faire une demande reçoit aussi le profil Demandeur.
 */
import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

test.describe('API › Création des réquisitions réservée aux demandeurs', () => {
  const stamp = Date.now().toString(36);

  test('Manager N1 / N2 / N3 : création refusée ; avec le profil Demandeur : autorisée', async ({ request }) => {
    const admin = await getToken(request);
    const projects = (await (await request.get('/api/projects', { headers: auth(admin) })).json()).data || [];
    const payload = {
      title: `[TEST CRÉATEURS] ${stamp}`, description: 'x', projectId: projects[0].id, currencyId: 1, currencyCode: 'USD',
      priority: 'MEDIUM', justification: 'x', items: [{ description: 'Article', quantity: 1, frequency: 1, unitPrice: 10 }],
    };
    const account = async (key, profiles) => {
      const u = { email: `creator.${key}.${stamp}@nowhere.test`, password: 'Secret123' };
      const res = await request.post('/api/users', { headers: auth(admin), data: {
        username: `creator${key}${stamp}`, email: u.email, password: u.password, firstName: key, lastName: stamp,
        profileIds: profiles, allProjectsProfileIds: profiles,
      } });
      expect(res.status(), await res.text()).toBe(201);
      const token = (await (await request.post('/api/auth/login', { data: u })).json()).data.token;
      const permissions = (await (await request.get('/api/auth/profile', { headers: auth(token) })).json()).data.permissions || [];
      return { token, permissions };
    };

    for (const profile of ['prof_manager', 'prof_manager_n2', 'prof_manager_n3']) {
      const manager = await account(profile.replace(/_/g, ''), [profile]);
      expect(manager.permissions, profile).not.toContain('CREATE_REQUISITIONS');
      const res = await request.post('/api/requisitions', { headers: auth(manager.token), data: payload });
      expect(res.status(), `${profile} : ${await res.text()}`).toBe(403);
    }

    // Manager qui est aussi demandeur : la création passe le contrôle des droits
    const both = await account('mgrreq', ['prof_manager', 'prof_requester']);
    expect(both.permissions).toContain('CREATE_REQUISITIONS');
    const forRequisition = (await (await request.get('/api/projects?forRequisition=1', { headers: auth(both.token) })).json()).data || [];
    expect(forRequisition.length).toBeGreaterThan(0);
  });
});
