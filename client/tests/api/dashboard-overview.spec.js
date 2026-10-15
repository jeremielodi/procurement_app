import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Tableau de bord selon le profil : GET /api/dashboard/overview (DashboardOverviewService).
// Le serveur ne calcule et ne renvoie que les volets autorisés : opérations (tous), pilotage (admin, DG, management,
// auditeur), finance (MANAGE_BUDGET / AUDIT_ACCESS), contrôle (AUDIT_ACCESS / VIEW_AUDIT_LOGS).
// « Qui bloque ? » (GET /dashboard/pending-tasks) est réservé au volet pilotage.
test.describe.serial('API › Tableau de bord selon le profil', () => {
  const stamp = Date.now().toString(36);
  let admin;

  async function userToken(request, profileIds, prefix) {
    const email = `${prefix}.dash.${stamp}@example.com`;
    const created = await request.post('/api/users', {
      headers: auth(admin),
      data: { username: `${prefix}_dash_${stamp}`, email, password: 'Secret123', firstName: 'Dash', lastName: prefix, profileIds, allProjectsProfileIds: profileIds },
    });
    expect(created.status(), await created.text()).toBe(201);
    return (await (await request.post('/api/auth/login', { data: { email, password: 'Secret123' } })).json()).data.token;
  }

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
  });

  test('401 sans token ; 400 période inconnue', async ({ request }) => {
    expect((await request.get('/api/dashboard/overview')).status()).toBe(401);
    const res = await request.get('/api/dashboard/overview?period=decade', { headers: auth(admin) });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('INVALID_PERIOD');
  });

  test('Admin : les quatre volets, indicateurs cohérents', async ({ request }) => {
    for (const period of ['week', 'month', 'quarter', 'year']) {
      const res = await request.get(`/api/dashboard/overview?period=${period}`, { headers: auth(admin) });
      expect(res.status(), await res.text()).toBe(200);
      const d = (await res.json()).data;
      expect(d.period).toBe(period);
      expect(d.thresholds).toEqual({ lateDays: 2, blockedDays: 7 });
      expect(d.access).toEqual({ operations: true, steering: true, finance: true, control: true });

      // Opérations : en retard ≤ à traiter, bloquées ≤ en retard, au plus 10 lignes, les plus anciennes d'abord
      const ops = d.operations;
      expect(ops.late).toBeLessThanOrEqual(ops.total);
      expect(ops.blocked).toBeLessThanOrEqual(ops.late);
      expect(ops.tasks.length).toBeLessThanOrEqual(10);
      const ages = ops.tasks.map(tk => tk.ageDays);
      expect(ages).toEqual([...ages].sort((a, b) => b - a));
      for (const tk of ops.tasks) expect(tk.lateDays).toBe(Math.max(0, tk.ageDays - 2));

      // Pilotage
      const s = d.steering;
      expect(s.completion.closed).toBe(s.completion.completed + s.completion.rejected + s.completion.cancelled);
      expect(s.conversion.converted).toBeLessThanOrEqual(s.conversion.approved);
      expect(s.suppliers.top.length).toBeLessThanOrEqual(5);
      if (s.cycle.count) expect(s.cycle.medianDays).toBeGreaterThanOrEqual(0);
      expect(s.tasks.late).toBeLessThanOrEqual(s.tasks.total);
      expect(s).not.toHaveProperty('stepDurations');

      // Finance : budget consommé = payé / alloué
      const b = d.finance.budget;
      if (b.allocated > 0) expect(b.rate).toBeCloseTo((b.paid / b.allocated) * 100, 0);

      // Contrôle : taux = (rejets + renvois) / décisions
      const dec = d.control.decisions;
      expect(dec.decisions).toBe(dec.steps.reduce((n, st) => n + st.decisions, 0));
      expect(d.control.blocked.byAction.map(a => a.action)).toContain('SOD_VIOLATION_BLOCKED');
    }
  });

  test('Filtre projet : chaque tâche appartient au projet choisi', async ({ request }) => {
    const all = (await (await request.get('/api/dashboard/overview?period=year', { headers: auth(admin) })).json()).data;
    const projectId = all.operations.tasks[0]?.projectId;
    test.skip(!projectId, 'aucune tâche en attente');
    const d = (await (await request.get(`/api/dashboard/overview?period=year&projectId=${projectId}`, { headers: auth(admin) })).json()).data;
    expect(d.projectId).toBe(projectId);
    expect(d.operations.tasks.every(tk => tk.projectId === projectId)).toBe(true);
    // Projet inexistant : aucune donnée (un projet d'une autre entreprise est refusé par tenantGuard, cf. multi-enterprise)
    const unknown = await request.get('/api/dashboard/overview?projectId=00000000-0000-0000-0000-000000000001', { headers: auth(admin) });
    expect(unknown.status()).toBe(200);
    const empty = (await unknown.json()).data;
    expect(empty.operations.total).toBe(0);
    expect(empty.steering.completion.submitted).toBe(0);
  });

  test('Demandeur : volet opérations seulement, « Qui bloque ? » refusé', async ({ request }) => {
    const token = await userToken(request, ['prof_requester'], 'req');
    const d = (await (await request.get('/api/dashboard/overview', { headers: auth(token) })).json()).data;
    expect(d.access).toEqual({ operations: true, steering: false, finance: false, control: false });
    expect(d.steering).toBeNull();
    expect(d.finance).toBeNull();
    expect(d.control).toBeNull();
    expect(d.operations.total).toBe(0); // compte neuf : aucune tâche
    expect((await request.get('/api/dashboard/pending-tasks', { headers: auth(token) })).status()).toBe(403);
    // Ancien endpoint : plus d'alertes budgétaires sans accès au budget
    const legacy = (await (await request.get('/api/dashboard', { headers: auth(token) })).json()).data;
    expect(legacy.alerts.budgetAlerts).toEqual([]);
  });

  test('Finance : volet finance sans pilotage ni contrôle', async ({ request }) => {
    const token = await userToken(request, ['prof_finance'], 'fin');
    const d = (await (await request.get('/api/dashboard/overview', { headers: auth(token) })).json()).data;
    expect(d.access).toEqual({ operations: true, steering: false, finance: true, control: false });
    expect(d.finance.budget).toHaveProperty('paid');
    expect(d.steering).toBeNull();
  });

  test('Auditeur : pilotage, finance et contrôle', async ({ request }) => {
    const token = await userToken(request, ['prof_auditor'], 'aud');
    const d = (await (await request.get('/api/dashboard/overview', { headers: auth(token) })).json()).data;
    expect(d.access).toEqual({ operations: true, steering: true, finance: true, control: true });
    expect((await request.get('/api/dashboard/pending-tasks', { headers: auth(token) })).status()).toBe(200);
  });
});
