import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Flux complet : inscription fournisseur → appel d'offres → soumission → modification
// → clôture → comparatif Excel → PDF fournisseur → annulation (libère la réquisition)
test.describe.serial('API › Portail fournisseur & appels d\'offres', () => {
  const stamp = Date.now();
  const supplierCreds = { email: `supplier.${stamp}@example.com`, password: 'Secret123' };
  let adminToken, supplierToken, requisitionId, items, tenderId;

  test.beforeAll(async ({ request }) => {
    adminToken = await getToken(request);
  });

  test('POST /api/auth/register-supplier — crée un compte fournisseur', async ({ request }) => {
    const res = await request.post('/api/auth/register-supplier', {
      multipart: {
        name: `Fournisseur Test ${stamp}`,
        contactName: 'Jean Test',
        email: supplierCreds.email,
        password: supplierCreds.password,
        logo: { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') },
      },
    });
    const body = await res.json();
    expect(res.status()).toBe(201);
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.profiles.map(p => p.id)).toContain('prof_supplier');
    supplierToken = body.data.token;
  });

  test('POST /api/auth/register-supplier — 409 email déjà utilisé', async ({ request }) => {
    const res = await request.post('/api/auth/register-supplier', {
      multipart: { name: 'X', contactName: 'Y', ...supplierCreds },
    });
    expect(res.status()).toBe(409);
  });

  test('POST /api/auth/register-supplier — 400 logo SVG refusé', async ({ request }) => {
    const res = await request.post('/api/auth/register-supplier', {
      multipart: {
        name: 'X', contactName: 'Y', email: `svg.${stamp}@example.com`, password: 'Secret123',
        logo: { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
      },
    });
    expect(res.status()).toBe(400);
  });

  test('Fournisseur — pas d\'accès aux données internes', async ({ request }) => {
    for (const url of ['/api/tenders', '/api/dashboard', '/api/enterprises/default', '/api/requisitions', '/api/suppliers', '/api/tasks/user']) {
      const res = await request.get(url, { headers: auth(supplierToken) });
      expect(res.status(), url).toBe(403);
    }
    const admin = await (await request.get('/api/auth/profile', { headers: auth(adminToken) })).json();
    const other = await request.get(`/api/notifications/${admin.data.id}`, { headers: auth(supplierToken) });
    expect(other.status()).toBe(403);
  });

  test('GET /api/supplier-portal/dashboard — tableau de bord fournisseur', async ({ request }) => {
    const me = await (await request.get('/api/auth/profile', { headers: auth(supplierToken) })).json();
    const own = await request.get(`/api/notifications/${me.data.id}`, { headers: auth(supplierToken) });
    expect(own.status()).toBe(200);

    const res = await request.get('/api/supplier-portal/dashboard', { headers: auth(supplierToken) });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(body.data.supplier.supplier_code).toMatch(/^SUP-/);
    expect(body.data.stats).toHaveProperty('openTenders');
    expect(Array.isArray(body.data.toDo)).toBe(true);
  });

  test('POST /api/tenders — crée un appel d\'offres lié à une réquisition', async ({ request }) => {
    const list = await (await request.get('/api/requisitions?limit=100', { headers: auth(adminToken) })).json();
    for (const r of list.data) {
      const existing = await (await request.get(`/api/tenders/by-requisition/${r.id}`, { headers: auth(adminToken) })).json();
      if (existing.data) continue;
      const detail = await (await request.get(`/api/requisitions/${r.id}`, { headers: auth(adminToken) })).json();
      if (detail.data.items?.length) { requisitionId = r.id; items = detail.data.items; break; }
    }
    test.skip(!requisitionId, 'Aucune réquisition libre avec des items');

    const payload = {
      requisitionId,
      title: 'AO de test',
      startDate: new Date(Date.now() - 60_000).toISOString(),
      endDate: new Date(Date.now() + 3_600_000).toISOString(),
      maxDeliveryDays: 30,
    };
    const missing = await request.post('/api/tenders', { headers: auth(adminToken), data: payload });
    expect(missing.status()).toBe(400); // numéro obligatoire

    const res = await request.post('/api/tenders', {
      headers: auth(adminToken), data: { ...payload, tenderNumber: `AO-TEST-${stamp}` },
    });
    const body = await res.json();
    expect(res.status()).toBe(201);
    expect(body.data.requisition_id).toBe(requisitionId);
    tenderId = body.data.id;

    const dup = await request.post('/api/tenders', {
      headers: auth(adminToken), data: { ...payload, tenderNumber: `AO-TEST-${stamp}-B` },
    });
    expect(dup.status()).toBe(409); // un seul AO actif par réquisition
  });

  test('Fournisseur — voit l\'AO, soumet puis modifie son offre', async ({ request }) => {
    test.skip(!tenderId);
    const list = await (await request.get('/api/supplier-portal/tenders', { headers: auth(supplierToken) })).json();
    expect(list.data.some(t => t.id === tenderId)).toBe(true);

    const tooSlow = await request.put(`/api/supplier-portal/tenders/${tenderId}/submission`, {
      headers: auth(supplierToken),
      data: { deliveryDays: 31, items: [{ requisitionItemId: items[0].id, unitPrice: 10 }] },
    });
    expect(tooSlow.status()).toBe(400);

    const lines = items.map(i => ({ requisitionItemId: i.id, unitPrice: 10 }));
    const first = await request.put(`/api/supplier-portal/tenders/${tenderId}/submission`, {
      headers: auth(supplierToken), data: { deliveryDays: 20, items: lines },
    });
    expect(first.status()).toBe(200);

    const second = await request.put(`/api/supplier-portal/tenders/${tenderId}/submission`, {
      headers: auth(supplierToken), data: { deliveryDays: 10, items: lines.map(l => ({ ...l, unitPrice: 8 })) },
    });
    const body = await second.json();
    expect(body.data.delivery_days).toBe(10);
    expect(body.data.items.every(i => parseFloat(i.unit_price) === 8)).toBe(true);
  });

  test('GET PDF de l\'offre fournisseur', async ({ request }) => {
    test.skip(!tenderId);
    const res = await request.get(`/api/supplier-portal/tenders/${tenderId}/submission/pdf`, { headers: auth(supplierToken) });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
  });

  test('Offres scellées avant clôture : ni prix, ni Excel', async ({ request }) => {
    test.skip(!tenderId);
    const body = await (await request.get(`/api/tenders/${tenderId}`, { headers: auth(adminToken) })).json();
    expect(body.data.sealed).toBe(true);
    expect(body.data.submissions).toHaveLength(1);
    expect(body.data.submissions[0].total_amount).toBeUndefined();
    expect(body.data.submissions[0].items).toBeUndefined();

    const xlsx = await request.get(`/api/tenders/${tenderId}/export/excel`, { headers: auth(adminToken) });
    expect(xlsx.status()).toBe(400);
  });

  test('Clôture → prix dévoilés, soumission refusée, comparatif Excel disponible', async ({ request }) => {
    test.skip(!tenderId);
    const close = await request.post(`/api/tenders/${tenderId}/close`, { headers: auth(adminToken) });
    expect(close.status()).toBe(200);

    const late = await request.put(`/api/supplier-portal/tenders/${tenderId}/submission`, {
      headers: auth(supplierToken), data: { deliveryDays: 5, items: [{ requisitionItemId: items[0].id, unitPrice: 1 }] },
    });
    expect(late.status()).toBe(400);

    const body = await (await request.get(`/api/tenders/${tenderId}`, { headers: auth(adminToken) })).json();
    expect(body.data.sealed).toBe(false);
    expect(parseFloat(body.data.submissions[0].total_amount)).toBeGreaterThan(0);

    // Prix dévoilés : plus de prolongation possible
    const extend = await request.put(`/api/tenders/${tenderId}`, {
      headers: auth(adminToken),
      data: {
        title: 'AO de test', startDate: new Date(Date.now() - 60_000).toISOString(),
        endDate: new Date(Date.now() + 3_600_000).toISOString(), maxDeliveryDays: 30,
      },
    });
    expect(extend.status()).toBe(400);

    const xlsx = await request.get(`/api/tenders/${tenderId}/export/excel`, { headers: auth(adminToken) });
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
  });

  test.afterAll(async ({ request }) => {
    // Libère la réquisition pour les prochains runs
    if (tenderId) await request.post(`/api/tenders/${tenderId}/cancel`, { headers: auth(adminToken) });
  });
});
