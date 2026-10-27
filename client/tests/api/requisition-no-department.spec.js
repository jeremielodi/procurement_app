import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Département facultatif sur une réquisition : création sans département (absent, vide ou null), fiche, liste et PDF.
test.describe.serial('API › Réquisition sans département', () => {
  const stamp = Date.now().toString(36);
  let admin, project, line;
  const created = [];

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    [project] = (await (await request.get('/api/projects', { headers: auth(admin) })).json()).data;
    const res = await request.post('/api/budget', { headers: auth(admin), data: {
      entityCode: `NODEP-${stamp}`.toUpperCase(), description: 'Sans département', allocatedAmount: 100000, projectId: project.id,
    } });
    line = (await res.json()).data;
  });

  test.afterAll(async ({ request }) => {
    for (const id of created) await request.delete(`/api/requisitions/${id}`, { headers: auth(admin) });
    if (line?.id) await request.delete(`/api/budget/${line.id}`, { headers: auth(admin) });
  });

  for (const [label, departmentId] of [['absent', undefined], ['vide', ''], ['null', null]]) {
    test(`Création avec département ${label}`, async ({ request }) => {
      const res = await request.post('/api/requisitions', { headers: auth(admin), data: {
        title: `[TEST SANS DEPT] ${label} ${stamp}`, description: 'x', ...(departmentId !== undefined && { departmentId }),
        projectId: project.id, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'x',
        items: [{ description: 'Article', quantity: 1, frequency: 1, unitPrice: 40, budgetLineId: line.id }],
      } });
      expect(res.status(), await res.text()).toBeLessThan(300);
      const id = (await res.json()).data.id;
      created.push(id);

      const req = (await (await request.get(`/api/requisitions/${id}`, { headers: auth(admin) })).json()).data;
      expect(req.department_id).toBeNull();
    });
  }

  test('Liste et PDF', async ({ request }) => {
    const list = await (await request.get(`/api/requisitions?search=${encodeURIComponent(`[TEST SANS DEPT]`)}&limit=50`, { headers: auth(admin) })).json();
    expect(list.data.filter(r => created.includes(r.id))).toHaveLength(created.length);
    const pdf = await request.get(`/api/requisitions/${created[0]}/export/pdf?lang=fr`, { headers: auth(admin) });
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
  });
});
