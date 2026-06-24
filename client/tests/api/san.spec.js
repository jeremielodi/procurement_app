import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

test.describe('API › SAN (Service Acceptance Notes)', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
  });

  test('GET /api/service-acceptance-notes — returns array', async ({ request }) => {
    const res  = await request.get('/api/service-acceptance-notes', { headers: auth(token) });
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/service-acceptance-notes — 401 without token', async ({ request }) => {
    const res = await request.get('/api/service-acceptance-notes');
    expect(res.status()).toBe(401);
  });

  test('GET /api/service-acceptance-notes/:id — 4xx for non-existent id', async ({ request }) => {
    const res = await request.get('/api/service-acceptance-notes/99999', { headers: auth(token) });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('POST /api/service-acceptance-notes — 400 with empty body', async ({ request }) => {
    const res  = await request.post('/api/service-acceptance-notes', {
      headers: auth(token),
      data: {},
    });
    const body = await res.json();

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    expect(body.success).toBe(false);
  });

  test('POST /api/service-acceptance-notes — 400 when serviceAccepted missing', async ({ request }) => {
    const res = await request.post('/api/service-acceptance-notes', {
      headers: auth(token),
      data: { poId: 1 },
    });
    const body = await res.json();

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    expect(body.success).toBe(false);
  });

  test('POST /api/service-acceptance-notes — 4xx for non-existent PO', async ({ request }) => {
    const res = await request.post('/api/service-acceptance-notes', {
      headers: auth(token),
      data: { poId: 99999, serviceAccepted: true, comments: 'Test' },
    });

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('GET /api/purchase-orders/:poId/service-acceptance-notes — 4xx for non-existent PO', async ({ request }) => {
    const res = await request.get('/api/purchase-orders/99999/service-acceptance-notes', {
      headers: auth(token),
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });
});
