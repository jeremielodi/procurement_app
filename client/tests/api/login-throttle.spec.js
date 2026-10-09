import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Anti force brute (utils/loginThrottle.js) : 5 échecs pour un même compte depuis une même IP → 429,
// le mot de passe n'est plus vérifié ; un autre compte depuis la même IP n'est pas touché ; une connexion
// réussie avant le seuil remet le compteur à zéro. Comptes jetables : le compte admin des autres tests n'est jamais bloqué.
test.describe.serial('API › Connexion › limitation des tentatives', () => {
  const stamp = Date.now().toString(36);
  const account = { email: `throttle.${stamp}@nowhere.test`, password: 'Secret123' };
  const other = { email: `throttle.other.${stamp}@nowhere.test`, password: 'Secret123' };
  const login = (request, email, password) => request.post('/api/auth/login', { data: { email, password } });

  test.beforeAll(async ({ request }) => {
    const H = auth(await getToken(request));
    for (const a of [account, other]) {
      const res = await request.post('/api/users', { headers: H, data: { username: a.email.split('@')[0], email: a.email, password: a.password, firstName: 'Throttle', lastName: stamp, profileIds: ['prof_requester'] } });
      expect(res.status()).toBe(201);
    }
  });

  test('Connexion réussie avant le seuil : le compteur repart à zéro', async ({ request }) => {
    for (let i = 0; i < 4; i++) expect((await login(request, other.email, 'mauvais')).status()).toBe(401);
    expect((await login(request, other.email, other.password)).status()).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login(request, other.email, 'mauvais')).status()).toBe(401);
    expect((await login(request, other.email, other.password)).status()).toBe(200);
  });

  test('5 échecs → 429 TOO_MANY_ATTEMPTS, même avec le bon mot de passe', async ({ request }) => {
    for (let i = 0; i < 5; i++) expect((await login(request, account.email, `faux-${i}`)).status()).toBe(401);
    const blocked = await login(request, account.email, account.password);
    expect(blocked.status()).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(Number(blocked.headers()['retry-after'])).toBe(body.retryAfter);
    expect(body.data).toBeUndefined(); // aucun token
  });

  test('Casse de l\'email ignorée ; un autre compte depuis la même IP reste utilisable', async ({ request }) => {
    expect((await login(request, account.email.toUpperCase(), account.password)).status()).toBe(429);
    expect((await login(request, other.email, other.password)).status()).toBe(200);
  });

  test('Email inconnu : même comportement (pas d\'énumération des comptes)', async ({ request }) => {
    const ghost = `ghost.${stamp}@nowhere.test`;
    for (let i = 0; i < 5; i++) expect((await login(request, ghost, 'x')).status()).toBe(401);
    expect((await login(request, ghost, 'x')).status()).toBe(429);
  });
});
