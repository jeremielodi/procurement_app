import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Liste des réquisitions : la recherche filtre la liste ET le total de la pagination
test.describe('API › Réquisitions › recherche', () => {
  let token, all;

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
    all = await (await request.get('/api/requisitions?limit=5', { headers: auth(token) })).json();
  });

  test('recherche par n° de réquisition → la réquisition trouvée, total cohérent', async ({ request }) => {
    test.skip(!all.data?.length, 'Aucune réquisition en base');
    const target = all.data[0];
    const res = await request.get(`/api/requisitions?search=${encodeURIComponent(target.requisition_number.toLowerCase())}`, { headers: auth(token) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.map(r => r.id)).toContain(target.id);
    // Un n° de réquisition est unique : peu de résultats, et le total compte les résultats filtrés
    expect(body.pagination.total).toBe(body.data.length);
    expect(body.pagination.total).toBeLessThan(all.pagination.total + 1);
  });

  test('recherche sans résultat → liste vide et total 0 (le total suit les filtres)', async ({ request }) => {
    const res = await request.get(`/api/requisitions?search=${encodeURIComponent(`introuvable-${Date.now()}`)}`, { headers: auth(token) });
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.pages).toBe(0);
  });

  test('% et _ sont cherchés littéralement', async ({ request }) => {
    const body = await (await request.get('/api/requisitions?search=%25%25%25', { headers: auth(token) })).json();
    expect(body.pagination.total).toBe(0);
  });
});
