import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Journal d'audit : la déconnexion est signalée au serveur (POST /api/auth/logout → audit_logs LOGOUT).
// Le contenu de audit_logs (connexions, mots de passe, utilisateurs) est vérifié directement en base hors suite.
test.describe('API › Audit › déconnexion', () => {
  test('401 sans token', async ({ request }) => {
    expect((await request.post('/api/auth/logout')).status()).toBe(401);
  });

  test('200 avec un token (corps vide ou {})', async ({ request }) => {
    const token = await getToken(request);
    expect((await request.post('/api/auth/logout', { headers: auth(token) })).status()).toBe(200);
    expect((await request.post('/api/auth/logout', { headers: auth(token), data: {} })).status()).toBe(200);
  });
});
