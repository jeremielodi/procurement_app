import { test, expect } from '@playwright/test';
import { TEST_CREDS, getToken, auth } from './helpers.js';

// N'utilise jamais l'email d'un vrai compte pour /forgot-password : il changerait son mot de passe
test.describe('API › Mot de passe', () => {
  test('POST /api/auth/forgot-password — email invalide → 400', async ({ request }) => {
    const res = await request.post('/api/auth/forgot-password', { data: { email: 'pas-un-email' } });
    expect(res.status()).toBe(400);
  });

  test('POST /api/auth/forgot-password — email inconnu → même réponse générique (pas d\'énumération)', async ({ request }) => {
    const res = await request.post('/api/auth/forgot-password', { data: { email: `inconnu-${Date.now()}@nowhere.test` } });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/Si un compte actif/);
  });

  test('POST /api/auth/change-password — 401 sans token', async ({ request }) => {
    const res = await request.post('/api/auth/change-password', { data: { oldPassword: 'x', newPassword: 'yyyyyyyy' } });
    expect(res.status()).toBe(401);
  });

  test('POST /api/auth/change-password — ancien mot de passe faux → 400 (pas 401)', async ({ request }) => {
    const token = await getToken(request);
    const res = await request.post('/api/auth/change-password', {
      headers: auth(token), data: { oldPassword: 'mauvais-mot-de-passe', newPassword: 'NouveauMdp123!' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/auth/change-password — nouveau mot de passe trop court → 400', async ({ request }) => {
    const token = await getToken(request);
    const res = await request.post('/api/auth/change-password', {
      headers: auth(token), data: { oldPassword: TEST_CREDS.password, newPassword: 'court' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/auth/change-password — changement puis retour à l\'ancien', async ({ request }) => {
    const token = await getToken(request);
    const temp = 'TempMdp-' + Date.now();
    const res = await request.post('/api/auth/change-password', {
      headers: auth(token), data: { oldPassword: TEST_CREDS.password, newPassword: temp },
    });
    expect(res.status()).toBe(200);
    try {
      const login = await request.post('/api/auth/login', { data: { email: TEST_CREDS.email, password: temp } });
      expect(login.status()).toBe(200);
    } finally {
      const back = await request.post('/api/auth/change-password', {
        headers: auth(token), data: { oldPassword: temp, newPassword: TEST_CREDS.password },
      });
      expect(back.status()).toBe(200);
    }
  });
});
