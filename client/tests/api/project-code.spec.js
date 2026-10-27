import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Code de projet modifiable : PUT /projects/:id { code } — normalisé en majuscules, obligatoire, 20 caractères au plus,
// unique dans l'entreprise (sans tenir compte de la casse) ; les données liées suivent (rattachées par l'identifiant) ;
// changement tracé PROJECT_CODE_CHANGED.
test.describe.serial('API › Code de projet modifiable', () => {
  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  let admin, a, b, budgetId;
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const get = async (request, id) => (await (await request.get(`/api/projects/${id}`, { headers: auth(admin) })).json()).data;
  const put = (request, id, data) => request.put(`/api/projects/${id}`, { headers: auth(admin), data });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const mk = async (code) => {
      const res = await request.post('/api/projects', { headers: auth(admin), data: { code, name: `Projet ${code}` } });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data;
    };
    a = await mk(`PCA-${stamp}`);
    b = await mk(`PCB-${stamp}`);
    const line = await request.post('/api/budget', { headers: auth(admin), data: { entityCode: `PC-${stamp}`, allocatedAmount: 100, projectId: a.id } });
    budgetId = (await line.json()).data.id;
  });

  test.afterAll(async ({ request }) => {
    if (budgetId) await request.delete(`/api/budget/${budgetId}`, { headers: auth(admin) });
    for (const p of [a, b]) if (p) await request.delete(`/api/projects/${p.id}`, { headers: auth(admin) });
  });

  test('Modification du code : normalisé, données liées conservées, audit', async ({ request }) => {
    const res = await json(await put(request, a.id, { code: `  pcn-${stamp.toLowerCase()} `, name: `Projet A ${stamp}` }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await get(request, a.id);
    expect(after.code).toBe(`PCN-${stamp}`);
    expect(after.name).toBe(`Projet A ${stamp}`);

    // La ligne budgétaire suit le projet (identifiant) et affiche le nouveau code
    const line = (await (await request.get(`/api/budget/${budgetId}`, { headers: auth(admin) })).json()).data;
    expect(line.project_code).toBe(`PCN-${stamp}`);

    const logs = await (await request.get('/api/audit-logs?action=PROJECT_CODE_CHANGED&limit=5', { headers: auth(admin) })).json();
    const log = logs.data.find(l => l.new_value?.code === `PCN-${stamp}`);
    expect(log?.old_value?.code).toBe(`PCA-${stamp}`);

    // Code absent = inchangé ; même code = pas de nouvelle trace
    expect((await put(request, a.id, { name: `Projet A2 ${stamp}` })).status()).toBe(200);
    expect((await get(request, a.id)).code).toBe(`PCN-${stamp}`);
  });

  test('Refus : code vide, trop long, déjà utilisé (casse ignorée)', async ({ request }) => {
    const empty = await json(await put(request, a.id, { code: '   ', name: 'x' }));
    expect([empty.status, empty.body.code]).toEqual([400, 'PROJECT_CODE_REQUIRED']);
    const long = await json(await put(request, a.id, { code: 'X'.repeat(21), name: 'x' }));
    expect([long.status, long.body.code]).toEqual([400, 'PROJECT_CODE_TOO_LONG']);
    const dup = await json(await put(request, a.id, { code: `pcb-${stamp.toLowerCase()}`, name: 'x' }));
    expect([dup.status, dup.body.code]).toEqual([409, 'PROJECT_CODE_EXISTS']);
    expect((await get(request, a.id)).code).toBe(`PCN-${stamp}`);

    // À la création aussi
    const created = await json(await request.post('/api/projects', { headers: auth(admin), data: { code: `PCB-${stamp}`, name: 'Doublon' } }));
    expect([created.status, created.body.code]).toEqual([409, 'PROJECT_CODE_EXISTS']);
  });
});
