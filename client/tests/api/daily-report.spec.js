import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Rapport quotidien des réquisitions (migration 22) : option de l'entreprise, destinataires (administrateurs et
// managers actifs), exemple immédiat à l'administrateur. L'envoi de minuit (DailyRequisitionReportService.tick,
// un seul envoi par jour) n'est pas déclenché ici. N'envoie jamais d'email réel (SMTP du backend de test).
test.describe.serial('API › Rapport quotidien des réquisitions', () => {
  const stamp = Date.now().toString(36);
  const requester = { email: `dr.req.${stamp}@nowhere.test`, password: 'Secret123' };
  let admin, requesterToken, initial;
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    initial = (await (await request.get('/api/enterprises/current/daily-report', { headers: auth(admin) })).json()).data;
    const created = await request.post('/api/users', { headers: auth(admin), data: {
      username: `drreq${stamp}`, email: requester.email, password: requester.password, firstName: 'Req', lastName: stamp, profileIds: ['prof_requester'],
    } });
    expect(created.status()).toBe(201);
    requesterToken = (await (await request.post('/api/auth/login', { data: requester })).json()).data.token;
  });

  test.afterAll(async ({ request }) => {
    // Remet l'option dans son état initial
    if (initial) await request.put('/api/enterprises/current/daily-report', { headers: auth(admin), data: { enabled: initial.enabled } });
  });

  test('Réservé à l\'administrateur d\'entreprise', async ({ request }) => {
    expect((await request.get('/api/enterprises/current/daily-report')).status()).toBe(401);
    expect((await request.get('/api/enterprises/current/daily-report', { headers: auth(requesterToken) })).status()).toBe(403);
    expect((await request.put('/api/enterprises/current/daily-report', { headers: auth(requesterToken), data: { enabled: true } })).status()).toBe(403);
  });

  test('Activation, destinataires (administrateurs / managers, avec leur langue) et journal d\'audit', async ({ request }) => {
    const on = await json(await request.put('/api/enterprises/current/daily-report', { headers: auth(admin), data: { enabled: true } }));
    expect(on.status).toBe(200);
    expect(on.body.data.enabled).toBe(true);
    expect(on.body.data.latestPerProject).toBe(20);
    const recipients = on.body.data.recipients;
    expect(recipients.some(r => r.email === 'admin@procurement.com' && r.role === 'ADMIN')).toBe(true);
    expect(recipients.every(r => ['ADMIN', 'MANAGER'].includes(r.role) && /^[a-z]{2}$/.test(r.language))).toBe(true);
    expect(recipients.some(r => r.email === requester.email)).toBe(false); // un demandeur ne le reçoit pas
    const off = await json(await request.put('/api/enterprises/current/daily-report', { headers: auth(admin), data: { enabled: false } }));
    expect(off.body.data.enabled).toBe(false);
    const logs = (await (await request.get('/api/audit-logs?action=ENTERPRISE_UPDATED&limit=5', { headers: auth(admin) })).json()).data;
    expect(logs.some(l => l.new_value?.daily_report_enabled === false && l.old_value?.daily_report_enabled === true)).toBe(true);
  });

  test('Exemple immédiat envoyé à l\'administrateur', async ({ request }) => {
    const res = await json(await request.post('/api/enterprises/current/daily-report/test', { headers: auth(admin), data: {} }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([res.body.data.recipients, res.body.data.sent]).toEqual([1, 1]);
  });
});
