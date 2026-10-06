import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Libération d'une tâche GoFlow (POST /api/tasks/:id/unclaim)
// Les cas avec une vraie tâche (propriétaire / admin / collègue) nécessitent GoFlow : vérifiés hors suite
test.describe('API › Tâches › libération', () => {
  test('401 sans authentification', async ({ request }) => {
    expect((await request.post('/api/tasks/inconnue/unclaim')).status()).toBe(401);
  });

  test('tâche inconnue (ou d\'une autre entreprise) → 404', async ({ request }) => {
    const token = await getToken(request);
    const res = await request.post(`/api/tasks/inconnue-${Date.now()}/unclaim`, { headers: auth(token) });
    expect(res.status()).toBe(404);
  });
});
