import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

test.describe('API › Purchase Orders', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
  });

  test('GET /api/purchase-orders — returns array', async ({ request }) => {
    const res  = await request.get('/api/purchase-orders', { headers: auth(token) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/purchase-orders — 401 without token', async ({ request }) => {
    const res = await request.get('/api/purchase-orders');
    expect(res.status()).toBe(401);
  });

  test('GET /api/purchase-orders/:id — 4xx for non-existent id', async ({ request }) => {
    const res = await request.get('/api/purchase-orders/999999', {
      headers: auth(token),
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('GET /api/requisitions — returns array', async ({ request }) => {
    const res  = await request.get('/api/requisitions', { headers: auth(token) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/suppliers — returns array', async ({ request }) => {
    const res  = await request.get('/api/suppliers', { headers: auth(token) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
