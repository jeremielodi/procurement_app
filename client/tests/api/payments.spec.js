import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

test.describe('API › Payments', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
  });

  test('GET /api/payments — returns array', async ({ request }) => {
    const res  = await request.get('/api/payments', { headers: auth(token) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/payments — 401 without token', async ({ request }) => {
    const res = await request.get('/api/payments');
    expect(res.status()).toBe(401);
  });

  test('GET /api/payments/:id — 4xx for non-existent id', async ({ request }) => {
    const res = await request.get('/api/payments/99999', { headers: auth(token) });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('POST /api/payments — 400 with empty body', async ({ request }) => {
    const res  = await request.post('/api/payments', {
      headers: auth(token),
      data: {},
    });
    const body = await res.json();

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    expect(body.success).toBe(false);
  });

  test('POST /api/payments — 400 when amount is missing', async ({ request }) => {
    const res = await request.post('/api/payments', {
      headers: auth(token),
      data: {
        paymentDate: '2026-06-23',
        paymentMethod: 'BANK_TRANSFER',
        currency: 'XAF',
      },
    });

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('POST /api/payments — 4xx with non-existent invoice', async ({ request }) => {
    const res = await request.post('/api/payments', {
      headers: auth(token),
      data: {
        invoiceId: 99999,
        paymentDate: '2026-06-23',
        amount: 100000,
        currency: 'XAF',
        paymentMethod: 'BANK_TRANSFER',
        reference: 'TEST-REF-001',
      },
    });

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('POST /api/payments/:id/approve — 4xx for non-existent payment', async ({ request }) => {
    const res = await request.post('/api/payments/99999/approve', {
      headers: auth(token),
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });
});
