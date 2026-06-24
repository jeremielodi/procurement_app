import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

test.describe('API › GRN (Goods Receipt Notes)', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
  });

  test('GET /api/goods-receipts — returns array', async ({ request }) => {
    const res  = await request.get('/api/goods-receipts', { headers: auth(token) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/goods-receipts — 401 without token', async ({ request }) => {
    const res = await request.get('/api/goods-receipts');
    expect(res.status()).toBe(401);
  });

  test('GET /api/goods-receipts/:id — 4xx for non-existent id', async ({ request }) => {
    const res = await request.get('/api/goods-receipts/99999', { headers: auth(token) });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('POST /api/goods-receipts — 400 with empty body', async ({ request }) => {
    const res  = await request.post('/api/goods-receipts', {
      headers: auth(token),
      data: {},
    });
    const body = await res.json();

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    expect(body.success).toBe(false);
  });

  test('POST /api/goods-receipts — 4xx for non-existent PO', async ({ request }) => {
    const res = await request.post('/api/goods-receipts', {
      headers: auth(token),
      data: {
        poId: 'non-existent-po-uuid',
        grnItems: [
          {
            item_description: 'Test item',
            quantity_ordered: 10,
            quantity_received: 10,
            quantity_accepted: 10,
            quantity_rejected: 0,
            rejection_reason: '',
          },
        ],
        observations: 'Test observation',
      },
    });

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('GET /api/purchase-orders/:poId/goods-receipts — 4xx for non-existent PO', async ({ request }) => {
    const res = await request.get('/api/purchase-orders/non-existent/goods-receipts', {
      headers: auth(token),
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });
});
