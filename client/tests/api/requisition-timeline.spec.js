import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

test.describe('API › Réquisitions — suivi du workflow', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
  });

  test('GET /api/requisitions/:id/timeline — étapes du cycle complet et historique en français', async ({ request }) => {
    const list = await (await request.get('/api/requisitions', { headers: auth(token) })).json();
    test.skip(!list.data?.length, 'Aucune réquisition en base');

    const res = await request.get(`/api/requisitions/${list.data[0].id}/timeline`, { headers: auth(token) });
    const body = await res.json();
    expect(res.status()).toBe(200);

    const { steps, events, progress } = body.data;
    expect(steps.map(s => s.key)).toEqual([
      'created', 'budget', 'approval', 'method', 'sourcing', 'po', 'po_approval',
      'supplier_confirmation', 'grn', 'san', 'invoice', 'payment',
    ]);
    for (const s of steps) expect(['done', 'current', 'pending', 'failed', 'skipped']).toContain(s.status);
    expect(steps.filter(s => s.status === 'current').length).toBeLessThanOrEqual(1);
    expect(progress.total).toBe(12);

    // Lisible : pas de codes techniques ni de JSON brut
    for (const e of events) {
      expect(e.title).not.toMatch(/^TASK_|^Activity_|PROCESS_START/);
      for (const d of e.details) expect(d).not.toMatch(/^\{|next_element|user_vars/);
    }
  });

  test('Avancement de la liste cohérent avec le suivi du workflow', async ({ request }) => {
    const list = await (await request.get('/api/requisitions?limit=100', { headers: auth(token) })).json();
    for (const r of list.data) {
      const t = await (await request.get(`/api/requisitions/${r.id}/timeline`, { headers: auth(token) })).json();
      expect(t.data.progress.finished, r.requisition_number).toBe(r.progress_status === 'COMPLETED');
    }
  });

  test('GET /api/requisitions/:id/timeline — 404', async ({ request }) => {
    const res = await request.get('/api/requisitions/00000000-0000-0000-0000-000000000000/timeline', { headers: auth(token) });
    expect(res.status()).toBe(404);
  });
});
