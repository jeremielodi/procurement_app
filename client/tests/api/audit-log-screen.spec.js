import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Écran « Journal d'audit » : GET /api/audit-logs (filtres, synthèse) et /export (Excel, lui-même tracé).
// Admin d'entreprise : son entreprise seulement ; super admin : toute la plateforme ; autres profils : 403.
const SUPERADMIN = {
  email: process.env.SUPERADMIN_EMAIL || 'superadmin@procureapp.com',
  password: process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!',
};

test.describe.serial('API › Journal d\'audit (consultation)', () => {
  const stamp = Date.now().toString(36);
  const unknownEmail = `inconnu.audit.${stamp}@example.com`;
  let admin, superToken;

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    superToken = (await (await request.post('/api/auth/login', { data: SUPERADMIN })).json()).data?.token;
    // Un échec de connexion sur un email inconnu : événement sans entreprise
    await request.post('/api/auth/login', { data: { email: unknownEmail, password: 'Mauvais123!' } });
  });

  test('401 sans token ; 403 sans VIEW_AUDIT_LOGS', async ({ request }) => {
    expect((await request.get('/api/audit-logs')).status()).toBe(401);
    // Un compte demandeur créé pour l'occasion
    const email = `req.audit.${stamp}@example.com`;
    const created = await request.post('/api/users', {
      headers: auth(admin),
      data: { username: `req_audit_${stamp}`, email, password: 'Secret123', firstName: 'Req', lastName: 'Audit', profileIds: ['prof_requester'] },
    });
    expect(created.status(), await created.text()).toBe(201);
    const token = (await (await request.post('/api/auth/login', { data: { email, password: 'Secret123' } })).json()).data.token;
    expect((await request.get('/api/audit-logs', { headers: auth(token) })).status()).toBe(403);
  });

  test('Admin d\'entreprise : son entreprise uniquement, filtres et synthèse', async ({ request }) => {
    const res = await request.get('/api/audit-logs?limit=20', { headers: auth(admin) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.pagination.total).toBeGreaterThanOrEqual(body.data.length);
    expect(body.actions).toContain('LOGIN_SUCCESS');
    expect(body.enterprises).toBeUndefined();
    expect([...new Set(body.data.map(r => r.enterprise_id))]).toHaveLength(1);
    expect(body.data[0].enterprise_id).toBeTruthy();
    // L'échec sur un email inconnu (sans entreprise) n'est pas visible
    const search = await (await request.get(`/api/audit-logs?q=${encodeURIComponent(unknownEmail)}`, { headers: auth(admin) })).json();
    expect(search.data).toHaveLength(0);

    // Filtre par action et par groupe
    const created = await (await request.get('/api/audit-logs?action=USER_CREATED&q=req.audit.' + stamp, { headers: auth(admin) })).json();
    expect(created.data.map(r => [r.action, r.target_email])).toEqual([['USER_CREATED', `req.audit.${stamp}@example.com`]]);
    const auth2 = await (await request.get('/api/audit-logs?actions=LOGIN_SUCCESS,LOGOUT&limit=5', { headers: auth(admin) })).json();
    expect(auth2.data.every(r => ['LOGIN_SUCCESS', 'LOGOUT'].includes(r.action))).toBe(true);
    // Synthèse : nombre par action sur la période
    expect(created.summary.find(s => s.action === 'USER_CREATED')?.count).toBeGreaterThanOrEqual(1);
    // Période sans événement
    const old = await (await request.get('/api/audit-logs?to=2000-01-01', { headers: auth(admin) })).json();
    expect(old.pagination.total).toBe(0);
    // Action inconnue ignorée (pas d'erreur SQL)
    expect((await request.get('/api/audit-logs?action=DROP%20TABLE', { headers: auth(admin) })).status()).toBe(200);
  });

  test('Super admin : toute la plateforme, événements sans entreprise, filtre entreprise', async ({ request }) => {
    test.skip(!superToken, 'Super admin indisponible');
    const body = await (await request.get(`/api/audit-logs?q=${encodeURIComponent(unknownEmail)}`, { headers: auth(superToken) })).json();
    expect(body.data.map(r => [r.action, r.new_value?.reason, r.enterprise_id])).toEqual([['LOGIN_FAILED', 'UNKNOWN_EMAIL', null]]);
    expect(Array.isArray(body.enterprises)).toBe(true);
    const none = await (await request.get('/api/audit-logs?enterpriseId=none&limit=5', { headers: auth(superToken) })).json();
    expect(none.data.every(r => r.enterprise_id === null)).toBe(true);
    const failures = await (await request.get('/api/audit-logs?failuresOnly=1&limit=10', { headers: auth(superToken) })).json();
    expect(failures.data.length).toBeGreaterThan(0);
    expect(failures.data.every(r => ['LOGIN_FAILED', 'LOGIN_BLOCKED', 'PASSWORD_CHANGE_FAILED', 'PASSWORD_RESET_INVALID_LINK'].includes(r.action))).toBe(true);
  });

  test('Export Excel : fichier xlsx, l\'export est lui-même tracé', async ({ request }) => {
    const res = await request.get('/api/audit-logs/export?actions=USER_CREATED&lang=fr', { headers: auth(admin) });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('spreadsheetml');
    const buf = await res.body();
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const traced = await (await request.get('/api/audit-logs?action=AUDIT_LOG_EXPORTED&limit=1', { headers: auth(admin) })).json();
    expect(traced.data[0].new_value.filters).toEqual({ actions: 'USER_CREATED' });
  });
});
