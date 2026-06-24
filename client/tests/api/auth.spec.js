import { test, expect } from '@playwright/test';
import { TEST_CREDS, getToken } from './helpers.js';

test.describe('API › Auth', () => {
  test('POST /api/auth/login — valid credentials returns token', async ({ request }) => {
    const res  = await request.post('/api/auth/login', { data: TEST_CREDS });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.email).toBe(TEST_CREDS.email);
  });

  test('POST /api/auth/login — wrong password returns 401', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: TEST_CREDS.email, password: 'bad-password' },
    });

    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test('POST /api/auth/login — unknown email returns 401', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'nobody@nowhere.com', password: 'test' },
    });

    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/profile — returns user with valid token', async ({ request }) => {
    const token = await getToken(request);
    const res   = await request.get('/api/auth/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body  = await res.json();

    expect(res.status()).toBe(200);
    expect(body.data.email).toBe(TEST_CREDS.email);
  });

  test('GET /api/auth/profile — 401 without token', async ({ request }) => {
    const res = await request.get('/api/auth/profile');
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/profile — 401 with invalid token', async ({ request }) => {
    const res = await request.get('/api/auth/profile', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status()).toBe(401);
  });
});
