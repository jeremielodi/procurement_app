# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\api\daily-report.spec.js >> API › Rapport quotidien des réquisitions >> Exemple immédiat envoyé à l'administrateur
- Location: tests\api\daily-report.spec.js:49:3

# Error details

```
Error: {"success":false,"code":"EMAIL_FAILED","data":{"recipients":1,"sent":0,"failed":1,"skipped":0}}

expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 502
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { getToken, auth } from './helpers.js';
  3  | 
  4  | // Rapport quotidien des réquisitions (migration 22) : option de l'entreprise, destinataires (administrateurs et
  5  | // managers actifs), exemple immédiat à l'administrateur. L'envoi de minuit (DailyRequisitionReportService.tick,
  6  | // un seul envoi par jour) n'est pas déclenché ici. N'envoie jamais d'email réel (SMTP du backend de test).
  7  | test.describe.serial('API › Rapport quotidien des réquisitions', () => {
  8  |   const stamp = Date.now().toString(36);
  9  |   const requester = { email: `dr.req.${stamp}@nowhere.test`, password: 'Secret123' };
  10 |   let admin, requesterToken, initial;
  11 |   const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  12 | 
  13 |   test.beforeAll(async ({ request }) => {
  14 |     admin = await getToken(request);
  15 |     initial = (await (await request.get('/api/enterprises/current/daily-report', { headers: auth(admin) })).json()).data;
  16 |     const created = await request.post('/api/users', { headers: auth(admin), data: {
  17 |       username: `drreq${stamp}`, email: requester.email, password: requester.password, firstName: 'Req', lastName: stamp, profileIds: ['prof_requester'],
  18 |     } });
  19 |     expect(created.status()).toBe(201);
  20 |     requesterToken = (await (await request.post('/api/auth/login', { data: requester })).json()).data.token;
  21 |   });
  22 | 
  23 |   test.afterAll(async ({ request }) => {
  24 |     // Remet l'option dans son état initial
  25 |     if (initial) await request.put('/api/enterprises/current/daily-report', { headers: auth(admin), data: { enabled: initial.enabled } });
  26 |   });
  27 | 
  28 |   test('Réservé à l\'administrateur d\'entreprise', async ({ request }) => {
  29 |     expect((await request.get('/api/enterprises/current/daily-report')).status()).toBe(401);
  30 |     expect((await request.get('/api/enterprises/current/daily-report', { headers: auth(requesterToken) })).status()).toBe(403);
  31 |     expect((await request.put('/api/enterprises/current/daily-report', { headers: auth(requesterToken), data: { enabled: true } })).status()).toBe(403);
  32 |   });
  33 | 
  34 |   test('Activation, destinataires (administrateurs / managers, avec leur langue) et journal d\'audit', async ({ request }) => {
  35 |     const on = await json(await request.put('/api/enterprises/current/daily-report', { headers: auth(admin), data: { enabled: true } }));
  36 |     expect(on.status).toBe(200);
  37 |     expect(on.body.data.enabled).toBe(true);
  38 |     expect(on.body.data.latestPerProject).toBe(20);
  39 |     const recipients = on.body.data.recipients;
  40 |     expect(recipients.some(r => r.email === 'admin@procurement.com' && r.role === 'ADMIN')).toBe(true);
  41 |     expect(recipients.every(r => ['ADMIN', 'MANAGER'].includes(r.role) && /^[a-z]{2}$/.test(r.language))).toBe(true);
  42 |     expect(recipients.some(r => r.email === requester.email)).toBe(false); // un demandeur ne le reçoit pas
  43 |     const off = await json(await request.put('/api/enterprises/current/daily-report', { headers: auth(admin), data: { enabled: false } }));
  44 |     expect(off.body.data.enabled).toBe(false);
  45 |     const logs = (await (await request.get('/api/audit-logs?action=ENTERPRISE_UPDATED&limit=5', { headers: auth(admin) })).json()).data;
  46 |     expect(logs.some(l => l.new_value?.daily_report_enabled === false && l.old_value?.daily_report_enabled === true)).toBe(true);
  47 |   });
  48 | 
  49 |   test('Exemple immédiat envoyé à l\'administrateur', async ({ request }) => {
  50 |     const res = await json(await request.post('/api/enterprises/current/daily-report/test', { headers: auth(admin), data: {} }));
> 51 |     expect(res.status, JSON.stringify(res.body)).toBe(200);
     |                                                  ^ Error: {"success":false,"code":"EMAIL_FAILED","data":{"recipients":1,"sent":0,"failed":1,"skipped":0}}
  52 |     expect([res.body.data.recipients, res.body.data.sent]).toEqual([1, 1]);
  53 |   });
  54 | 
  55 |   test('Planificateur actif sur le serveur ; envoi immédiat à tous enregistré dans le suivi du jour', async ({ request }) => {
  56 |     const st = (await (await request.get('/api/enterprises/current/daily-report', { headers: auth(admin) })).json()).data;
  57 |     expect(st.scheduler.running).toBe(true);
  58 |     expect(st.scheduler.disabled).toBe(false);
  59 |     expect(st.scheduler.nextRunDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  60 |     const res = await json(await request.post('/api/enterprises/current/daily-report/send-now', { headers: auth(admin), data: {} }));
  61 |     expect(res.status, JSON.stringify(res.body)).toBe(200);
  62 |     expect(res.body.data.sent).toBeGreaterThan(0);
  63 |     expect(res.body.data.status.lastRun.sent).toBeGreaterThanOrEqual(res.body.data.sent);
  64 |     expect((await request.post('/api/enterprises/current/daily-report/send-now', { headers: auth(requesterToken), data: {} })).status()).toBe(403);
  65 |   });
  66 | });
  67 | 
```