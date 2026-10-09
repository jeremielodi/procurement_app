import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Recherche globale (GET /api/search?q=) : groupes selon les permissions, liens vers les fiches, caractères
// spéciaux neutralisés, comptes fournisseurs exclus.
test.describe.serial('API › Recherche globale', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const logistic = { email: `gs.log.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  let admin, logToken, item, requisition;
  const search = async (request, token, q) => {
    const res = await request.get(`/api/search?q=${encodeURIComponent(q)}`, { headers: auth(token) });
    return { status: res.status(), groups: (await res.json()).data };
  };

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const H = auth(admin);
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    item = (await (await request.post('/api/stock-items', { headers: H, data: { code: `GS-${stamp}`, name: `Article recherche ${stamp}`, unit: 'pc', categoryId: cats.find(c => c.code === 'FUEL').id } })).json()).data;
    const [dept] = (await (await request.get('/api/departments', { headers: H })).json()).data;
    const [project] = (await (await request.get('/api/projects', { headers: H })).json()).data;
    requisition = (await (await request.post('/api/requisitions', { headers: H, data: {
      title: `Recherche globale ${stamp}`, description: 'x', departmentId: dept.id, projectId: project?.id, currencyId: 1, currencyCode: 'USD',
      priority: 'LOW', justification: 'x', items: [{ description: 'x', quantity: 1, frequency: 1, unitPrice: 1 }],
    } })).json()).data;
    const created = await request.post('/api/users', { headers: H, data: { username: `gslog${stamp}`, email: logistic.email, password: logistic.password, firstName: 'Gs', lastName: stamp, profileIds: ['prof_logistic'] } });
    expect(created.status()).toBe(201);
    logToken = (await (await request.post('/api/auth/login', { data: logistic })).json()).data.token;
  });

  test('Par titre, numéro et code : lien vers la fiche', async ({ request }) => {
    const byTitle = await search(request, admin, `Recherche globale ${stamp}`);
    expect(byTitle.status).toBe(200);
    const reqs = byTitle.groups.find(g => g.group === 'requisitions');
    expect(reqs.items.map(i => i.link)).toContain(`/requisitions/${requisition.id}`);

    const number = (await (await request.get(`/api/requisitions/${requisition.id}`, { headers: auth(admin) })).json()).data.requisition_number;
    const byNumber = await search(request, admin, number);
    expect(byNumber.groups.find(g => g.group === 'requisitions').items[0]).toMatchObject({ label: number, link: `/requisitions/${requisition.id}` });

    const byCode = await search(request, admin, `gs-${stamp.toLowerCase()}`);
    expect(byCode.groups.find(g => g.group === 'stockItems').items).toEqual([expect.objectContaining({ label: item.code, link: `/stock/items/${item.id}` })]);
  });

  test('Moins de 2 caractères : rien ; « % » et « _ » sont des caractères ordinaires', async ({ request }) => {
    expect((await search(request, admin, 'R')).groups).toEqual([]);
    expect((await search(request, admin, `%_%${stamp}_%`)).groups).toEqual([]);
  });

  test('Permissions : la logistique ne voit que ses groupes ; un compte sans token est refusé', async ({ request }) => {
    const res = await search(request, logToken, `GS-${stamp}`);
    expect(res.status).toBe(200);
    const groups = res.groups.map(g => g.group);
    expect(groups).toContain('stockItems');
    expect(groups).not.toContain('tenders');
    expect((await request.get('/api/search?q=abc')).status()).toBe(401);
  });
});
