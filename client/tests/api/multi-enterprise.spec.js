import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Multi-entreprise procureApp : une entreprise ne voit jamais les données d'une autre.
// SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD : identifiants du super admin de la plateforme.
const SUPERADMIN = {
  email: process.env.SUPERADMIN_EMAIL || 'superadmin@procureapp.com',
  password: process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!',
};

test.describe.serial('API › Multi-entreprise', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const other = { code: `T${stamp}`.slice(0, 12), email: `admin.${stamp.toLowerCase()}@example.com`, password: 'Secret123' };
  let superToken, mainToken, otherToken, otherId;

  test.beforeAll(async ({ request }) => {
    mainToken = await getToken(request); // admin de l'entreprise principale
    const res = await request.post('/api/auth/login', { data: SUPERADMIN });
    superToken = (await res.json()).data?.token;
  });

  test('Super admin : crée une entreprise et son administrateur', async ({ request }) => {
    test.skip(!superToken, 'Super admin indisponible');
    const res = await request.post('/api/enterprises', {
      headers: auth(superToken),
      multipart: {
        name: `Entreprise test ${stamp}`, code: other.code, currencyId: '1',
        adminEmail: other.email, adminPassword: other.password, adminFirstName: 'Test',
      },
    });
    const body = await res.json();
    expect(res.status()).toBe(201);
    expect(body.data.admin.email).toBe(other.email);
    otherId = body.data.id;

    const login = await request.post('/api/auth/login', { data: { email: other.email, password: other.password } });
    otherToken = (await login.json()).data.token;
    expect(otherToken).toBeTruthy();
  });

  test('Chaque entreprise ne voit que ses propres listes', async ({ request }) => {
    test.skip(!otherToken);
    for (const url of ['/api/requisitions', '/api/purchase-orders', '/api/projects', '/api/departments', '/api/goods-receipts', '/api/invoices', '/api/payments']) {
      const body = await (await request.get(url, { headers: auth(otherToken) })).json();
      expect(body.data?.length ?? 0, url).toBe(0);
    }
    const users = await (await request.get('/api/users', { headers: auth(otherToken) })).json();
    expect(users.data.map(u => u.email)).toEqual([other.email]);
    const ents = await (await request.get('/api/enterprises', { headers: auth(otherToken) })).json();
    expect(ents.data.map(e => e.code)).toEqual([other.code]);
    const stats = await (await request.get('/api/dashboard/stats', { headers: auth(otherToken) })).json();
    expect(stats.data.requisitions.total).toBe(0);
  });

  test('Accès par identifiant à une donnée d\'une autre entreprise → 404', async ({ request }) => {
    test.skip(!otherToken);
    const reqs = (await (await request.get('/api/requisitions', { headers: auth(mainToken) })).json()).data;
    test.skip(!reqs.length, 'Aucune réquisition dans l\'entreprise principale');
    const id = reqs[0].id;
    for (const url of [`/api/requisitions/${id}`, `/api/requisitions/${id}/timeline`]) {
      expect((await request.get(url, { headers: auth(otherToken) })).status(), url).toBe(404);
    }
    const project = (await (await request.get('/api/projects', { headers: auth(mainToken) })).json()).data[0];
    const create = await request.post('/api/requisitions', {
      headers: auth(otherToken), data: { title: 'x', projectId: project.id, items: [] },
    });
    expect(create.status()).toBe(404);
  });

  test('Données créées rattachées à l\'entreprise du créateur ; codes uniques par entreprise', async ({ request }) => {
    test.skip(!otherToken);
    const mainDept = (await (await request.get('/api/departments', { headers: auth(mainToken) })).json()).data[0];
    const res = await request.post('/api/departments', {
      headers: auth(otherToken), data: { code: mainDept?.code || 'ADM', name: `Dept ${stamp}` },
    });
    expect(res.status()).toBe(201);
    const mine = (await (await request.get('/api/departments', { headers: auth(otherToken) })).json()).data;
    expect(mine.map(d => d.name)).toContain(`Dept ${stamp}`);
    const theirs = (await (await request.get('/api/departments', { headers: auth(mainToken) })).json()).data;
    expect(theirs.map(d => d.name)).not.toContain(`Dept ${stamp}`);
  });

  test('Un admin d\'entreprise ne gère ni les entreprises, ni les rôles, ni le profil super admin', async ({ request }) => {
    test.skip(!otherId);
    expect((await request.put(`/api/enterprises/${otherId}`, { headers: auth(mainToken), multipart: { name: 'Pirate' } })).status()).toBe(403);
    expect((await request.post('/api/enterprises', { headers: auth(mainToken), multipart: { name: 'X', code: 'XX', currencyId: '1' } })).status()).toBe(403);
    expect((await request.put('/api/profiles/prof_manager', { headers: auth(mainToken), data: { name: 'x' } })).status()).toBe(403);
    expect((await request.delete('/api/profiles/prof_manager', { headers: auth(mainToken) })).status()).toBe(403);
    expect((await request.post('/api/users', {
      headers: auth(mainToken), data: { username: 'u', email: `u.${stamp}@example.com`, password: 'Secret123', profileIds: ['prof_superadmin'] },
    })).status()).toBe(403);
  });

  test('Super admin : aucune donnée d\'achat ; suspension d\'une entreprise', async ({ request }) => {
    test.skip(!otherId);
    expect((await request.get('/api/requisitions', { headers: auth(superToken) })).status()).toBe(403);
    const all = await (await request.get('/api/enterprises', { headers: auth(superToken) })).json();
    expect(all.data.length).toBeGreaterThanOrEqual(2);

    await request.patch(`/api/enterprises/${otherId}/active`, { headers: auth(superToken), data: { isActive: false } });
    expect((await request.get('/api/requisitions', { headers: auth(otherToken) })).status()).toBe(403);
    await request.patch(`/api/enterprises/${otherId}/active`, { headers: auth(superToken), data: { isActive: true } });
    expect((await request.get('/api/requisitions', { headers: auth(otherToken) })).status()).toBe(200);
  });
});
