import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

test.describe('API › Invoices', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
  });

  test('GET /api/invoices — returns array', async ({ request }) => {
    const res  = await request.get('/api/invoices', { headers: auth(token) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/invoices — 401 without token', async ({ request }) => {
    const res = await request.get('/api/invoices');
    expect(res.status()).toBe(401);
  });

  test('GET /api/invoices/:id — 4xx for non-existent id', async ({ request }) => {
    const res = await request.get('/api/invoices/99999', { headers: auth(token) });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('POST /api/invoices — 400 with empty body', async ({ request }) => {
    const res  = await request.post('/api/invoices', {
      headers: auth(token),
      data: {},
    });
    const body = await res.json();

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    expect(body.success).toBe(false);
  });

  test('POST /api/invoices — 4xx with non-existent PO', async ({ request }) => {
    const res = await request.post('/api/invoices', {
      headers: auth(token),
      data: {
        poId: 'non-existent-uuid',
        invoiceDate: '2026-06-23',
        dueDate: '2026-07-23',
        subtotal: 100000,
        taxAmount: 18000,
        totalAmount: 118000,
        currency: 'XAF',
      },
    });

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('POST /api/invoices/:id/match — 4xx for non-existent invoice', async ({ request }) => {
    const res = await request.post('/api/invoices/99999/match', {
      headers: auth(token),
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('POST /api/invoices/:id/approve — 4xx for non-existent invoice', async ({ request }) => {
    const res = await request.post('/api/invoices/99999/approve', {
      headers: auth(token),
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });
});
