import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Fichiers uploadés (pièces jointes, logos) via le stockage (MinIO ou disque)
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SUPERADMIN = {
  email: process.env.SUPERADMIN_EMAIL || 'superadmin@procureapp.com',
  password: process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!',
};

test.describe.serial('API › Pièces jointes & stockage', () => {
  const stamp = Date.now().toString(36);
  let token, requisitionId, attachment;

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
    const reqs = (await (await request.get('/api/requisitions', { headers: auth(token) })).json()).data;
    requisitionId = reqs[0]?.id;
  });

  test('Upload (multiple) → liste → téléchargement identique', async ({ request }) => {
    test.skip(!requisitionId, 'Aucune réquisition');
    const up = await request.post('/api/upload/multiple', {
      headers: auth(token),
      multipart: { entity_type: 'requisition', entity_id: requisitionId, files: { name: `devis-${stamp}.pdf`, mimeType: 'application/pdf', buffer: PDF } },
    });
    expect(up.status()).toBe(200);
    attachment = (await up.json()).data[0];

    const list = await (await request.get(`/api/upload/requisition/${requisitionId}`, { headers: auth(token) })).json();
    expect(list.data.some(a => a.id === attachment.id)).toBe(true);

    const dl = await request.get(`/api/upload/download/file/${attachment.id}`, { headers: auth(token) });
    expect(dl.status()).toBe(200);
    expect(dl.headers()['content-type']).toContain('application/pdf');
    expect(Buffer.compare(await dl.body(), PDF)).toBe(0);
  });

  test('Upload (simple) fonctionne aussi', async ({ request }) => {
    test.skip(!requisitionId);
    const up = await request.post('/api/upload', {
      headers: auth(token),
      multipart: { entity_type: 'requisition', entity_id: requisitionId, file: { name: `bc-${stamp}.pdf`, mimeType: 'application/pdf', buffer: PDF } },
    });
    expect(up.status()).toBe(200);
    const id = (await up.json()).data.id;
    expect((await request.delete(`/api/upload/${id}`, { headers: auth(token) })).status()).toBe(200);
  });

  test('Type refusé → 400', async ({ request }) => {
    test.skip(!requisitionId);
    const up = await request.post('/api/upload', {
      headers: auth(token),
      multipart: { entity_type: 'requisition', entity_id: requisitionId, file: { name: 'script.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') } },
    });
    expect(up.status()).toBe(400);
  });

  test('Le fichier n\'est plus accessible directement par son chemin (sans API)', async ({ request }) => {
    test.skip(!attachment);
    const res = await request.get(`/${attachment.file_path || ''}`);
    expect(res.headers()['content-type'] || '').not.toContain('application/pdf');
  });

  test('Une autre entreprise ne peut ni lire ni ajouter de pièce jointe', async ({ request }) => {
    test.skip(!attachment);
    const sa = (await (await request.post('/api/auth/login', { data: SUPERADMIN })).json()).data?.token;
    test.skip(!sa, 'Super admin indisponible');
    const email = `att.${stamp}@example.com`;
    await request.post('/api/enterprises', {
      headers: auth(sa),
      multipart: { name: `Ent fichiers ${stamp}`, code: `F${stamp}`.slice(0, 12).toUpperCase(), currencyId: '1', adminEmail: email, adminPassword: 'Secret123' },
    });
    const other = (await (await request.post('/api/auth/login', { data: { email, password: 'Secret123' } })).json()).data.token;

    expect((await request.get(`/api/upload/download/file/${attachment.id}`, { headers: auth(other) })).status()).toBe(404);
    expect((await request.get(`/api/upload/requisition/${requisitionId}`, { headers: auth(other) })).status()).toBe(404);
    expect((await request.delete(`/api/upload/${attachment.id}`, { headers: auth(other) })).status()).toBe(404);
    const up = await request.post('/api/upload', {
      headers: auth(other),
      multipart: { entity_type: 'requisition', entity_id: requisitionId, file: { name: 'x.pdf', mimeType: 'application/pdf', buffer: PDF } },
    });
    expect(up.status()).toBe(404);
  });

  test('Suppression → le fichier n\'est plus téléchargeable', async ({ request }) => {
    test.skip(!attachment);
    expect((await request.delete(`/api/upload/${attachment.id}`, { headers: auth(token) })).status()).toBe(200);
    expect((await request.get(`/api/upload/download/file/${attachment.id}`, { headers: auth(token) })).status()).toBe(404);
  });

  test('Logo fournisseur : stocké puis servi par l\'API publique', async ({ request }) => {
    const reg = await request.post('/api/auth/register-supplier', {
      multipart: { name: `Logo SARL ${stamp}`, contactName: 'L O', email: `logo.${stamp}@example.com`, password: 'Secret123', logo: { name: 'logo.png', mimeType: 'image/png', buffer: PNG } },
    });
    expect(reg.status()).toBe(201);
    const supplierToken = (await reg.json()).data.token;
    const me = (await (await request.get('/api/supplier-portal/me', { headers: auth(supplierToken) })).json()).data;
    const logo = await request.get(`/api/public/suppliers/${me.id}/logo`);
    expect(logo.status()).toBe(200);
    expect(logo.headers()['content-type']).toContain('image/png');
    expect(Buffer.compare(await logo.body(), PNG)).toBe(0);
  });
});
