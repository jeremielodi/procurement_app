import { test, expect } from '@playwright/test';
import { getToken, auth, supplierRegistration, firstReferenceIds, PDF_BUFFER } from './helpers.js';

// Préqualification des fournisseurs :
// référentiels (super admin) → inscription avec documents → préqualification par catégorie
// → liste / export → appel d'offres réservé aux préqualifiés d'une catégorie et d'une localisation
const SUPERADMIN = {
  email: process.env.SUPERADMIN_EMAIL || 'superadmin@procureapp.com',
  password: process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!',
};

test.describe.serial('API › Préqualification des fournisseurs', () => {
  const stamp = Date.now();
  const company = { email: `preq.company.${stamp}@example.com`, password: 'Secret123' };
  const person = { email: `preq.person.${stamp}@example.com`, password: 'Secret123' };
  let adminToken, superToken, companyToken, personToken;
  let ref, companyId, personId, tenderId, requisitionId;

  test.beforeAll(async ({ request }) => {
    adminToken = await getToken(request);
    superToken = (await (await request.post('/api/auth/login', { data: SUPERADMIN })).json()).data?.token;
    ref = await firstReferenceIds(request);
  });

  test('Référentiels publics : localisations et catégories initiales', async ({ request }) => {
    expect(ref.locations.map(l => l.name)).toEqual(expect.arrayContaining(['Bunia', 'Goma', 'Kisangani']));
    expect(ref.categories.map(c => c.name)).toEqual(expect.arrayContaining(['Carburant', 'Fournitures de bureau']));
  });

  test('Super admin : gère les localisations ; un admin d\'entreprise ne peut pas', async ({ request }) => {
    test.skip(!superToken, 'Super admin indisponible');
    const name = `Localité test ${stamp}`;
    const created = await request.post('/api/locations', { headers: auth(superToken), data: { name, province: 'Test' } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).data.id;
    expect((await request.post('/api/locations', { headers: auth(superToken), data: { name: name.toUpperCase() } })).status()).toBe(409);
    expect((await request.put(`/api/locations/${id}`, { headers: auth(superToken), data: { isActive: false } })).status()).toBe(200);
    const pub = (await (await request.get('/api/public/locations')).json()).data;
    expect(pub.map(l => l.id)).not.toContain(id); // inactive : absente de l'inscription
    expect((await request.delete(`/api/locations/${id}`, { headers: auth(superToken) })).status()).toBe(200);

    expect((await request.post('/api/locations', { headers: auth(adminToken), data: { name: 'Pirate' } })).status()).toBe(403);
    expect((await request.post('/api/market-categories', { headers: auth(adminToken), data: { name: 'Pirate' } })).status()).toBe(403);
  });

  test('Inscription entreprise : identifiants obligatoires, documents facultatifs', async ({ request }) => {
    const full = supplierRegistration({
      name: `Préqual SARL ${stamp}`, ...company, locationIds: [ref.locationId], categoryIds: [ref.categoryId],
    });
    const { idNat, ...noIdNat } = full;
    const bad = await request.post('/api/auth/register-supplier', { multipart: noIdNat });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).message).toContain('ID Nat');

    // Sans aucun document : accepté (documents facultatifs), puis préqualifiable
    const { doc_ID_CARD, doc_RCCM, doc_TAX, doc_ID_NAT, doc_RIB, ...noDocs } = full;
    const bare = await request.post('/api/auth/register-supplier', {
      multipart: { ...noDocs, name: `Sans docs ${stamp}`, email: `nodocs.${stamp}@example.com` },
    });
    expect(bare.status()).toBe(201);
    const bareMe = (await (await request.get('/api/supplier-portal/me', { headers: auth((await bare.json()).data.token) })).json()).data;
    expect(bareMe.documents).toEqual([]);
    expect(bareMe.missing_documents).toHaveLength(5);
    const approveBare = await request.put(`/api/suppliers/${bareMe.id}/prequalification`, {
      headers: auth(adminToken), data: { categoryId: ref.categoryId, status: 'APPROVED' },
    });
    expect(approveBare.status()).toBe(200);

    const noCategory = await request.post('/api/auth/register-supplier', {
      multipart: { ...full, categoryIds: '[]', email: `nocat.${stamp}@example.com` },
    });
    expect(noCategory.status()).toBe(400);

    const notPdf = await request.post('/api/auth/register-supplier', {
      multipart: { ...full, email: `notpdf.${stamp}@example.com`, doc_RCCM: { name: 'rccm.png', mimeType: 'image/png', buffer: Buffer.from('x') } },
    });
    expect(notPdf.status()).toBe(400);

    const res = await request.post('/api/auth/register-supplier', { multipart: full });
    expect(res.status()).toBe(201);
    companyToken = (await res.json()).data.token;
  });

  test('Inscription personne physique : pièce d\'identité + RIB suffisent', async ({ request }) => {
    const res = await request.post('/api/auth/register-supplier', {
      multipart: supplierRegistration({
        type: 'INDIVIDUAL', name: `Jean Individu ${stamp}`, ...person,
        locationIds: [ref.locations[1].id], categoryIds: [ref.categoryId],
      }),
    });
    expect(res.status()).toBe(201);
    personToken = (await res.json()).data.token;
  });

  test('Fournisseur : profil complet et accès à ses documents', async ({ request }) => {
    const me = (await (await request.get('/api/supplier-portal/me', { headers: auth(companyToken) })).json()).data;
    companyId = me.id;
    expect(me.supplier_code).toMatch(/^SUP-/);
    expect(me.supplier_type).toBe('COMPANY');
    expect(me.id_nat).toBe('01-93-N12345X');
    expect(me.documents.map(d => d.doc_type).sort()).toEqual(['ID_CARD', 'ID_NAT', 'RCCM', 'RIB', 'TAX']);
    expect(me.missing_documents).toEqual([]);
    expect(me.locations.map(l => l.id)).toEqual([ref.locationId]);

    const file = await request.get(`/api/supplier-portal/me/documents/${me.documents[0].id}/file`, { headers: auth(companyToken) });
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toContain('application/pdf');

    // Remplacement d'un document + ajout d'une localisation depuis le profil
    const upd = await request.put('/api/supplier-portal/me', {
      headers: auth(companyToken),
      multipart: {
        locationIds: JSON.stringify([ref.locationId, ref.locations[2].id]),
        doc_RIB: { name: 'nouveau-rib.pdf', mimeType: 'application/pdf', buffer: PDF_BUFFER },
      },
    });
    expect(upd.status()).toBe(200);
    const after = (await upd.json()).data;
    expect(after.locations).toHaveLength(2);
    expect(after.documents.find(d => d.doc_type === 'RIB').file_name).toBe('nouveau-rib.pdf');

    personId = (await (await request.get('/api/supplier-portal/me', { headers: auth(personToken) })).json()).data.id;
  });

  test('Acheteur : fiche avec documents ; préqualification par catégorie', async ({ request }) => {
    const sup = (await (await request.get(`/api/suppliers/${companyId}`, { headers: auth(adminToken) })).json()).data;
    expect(sup.documents).toHaveLength(5);
    expect(sup.prequalification.map(p => p.category_id)).toEqual([ref.categoryId]);
    expect(sup.prequalification[0].status).toBeNull(); // en attente

    const doc = await request.get(`/api/suppliers/${companyId}/documents/${sup.documents[0].id}/file`, { headers: auth(adminToken) });
    expect(doc.status()).toBe(200);
    // Document d'un autre fournisseur : introuvable
    expect((await request.get(`/api/suppliers/${personId}/documents/${sup.documents[0].id}/file`, { headers: auth(adminToken) })).status()).toBe(404);

    const otherCategory = ref.categories.find(c => c.id !== ref.categoryId).id;
    const undeclared = await request.put(`/api/suppliers/${companyId}/prequalification`, {
      headers: auth(adminToken), data: { categoryId: otherCategory, status: 'APPROVED' },
    });
    expect(undeclared.status()).toBe(400);

    const rejectNoReason = await request.put(`/api/suppliers/${personId}/prequalification`, {
      headers: auth(adminToken), data: { categoryId: ref.categoryId, status: 'REJECTED' },
    });
    expect(rejectNoReason.status()).toBe(400);

    const ok = await request.put(`/api/suppliers/${companyId}/prequalification`, {
      headers: auth(adminToken), data: { categoryId: ref.categoryId, status: 'APPROVED', comment: 'Dossier complet' },
    });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).data[0].status).toBe('APPROVED');
  });

  test('Liste des préqualifiés : filtres et export Excel', async ({ request }) => {
    const all = (await (await request.get(`/api/suppliers/prequalified?categoryId=${ref.categoryId}`, { headers: auth(adminToken) })).json()).data;
    expect(all.map(r => r.id)).toContain(companyId);
    expect(all.map(r => r.id)).not.toContain(personId); // pas encore préqualifié

    const otherLoc = ref.locations.find(l => ![ref.locationId, ref.locations[2].id].includes(l.id)).id;
    const byLoc = (await (await request.get(`/api/suppliers/prequalified?locationId=${otherLoc}`, { headers: auth(adminToken) })).json()).data;
    expect(byLoc.map(r => r.id)).not.toContain(companyId);

    const xlsx = await request.get(`/api/suppliers/prequalified/export?categoryId=${ref.categoryId}`, { headers: auth(adminToken) });
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
  });

  test('Appel d\'offres réservé aux préqualifiés : visible et ouvert aux seuls éligibles', async ({ request }) => {
    const list = await (await request.get('/api/requisitions?limit=100', { headers: auth(adminToken) })).json();
    for (const r of list.data) {
      const existing = await (await request.get(`/api/tenders/by-requisition/${r.id}`, { headers: auth(adminToken) })).json();
      if (existing.data) continue;
      const detail = await (await request.get(`/api/requisitions/${r.id}`, { headers: auth(adminToken) })).json();
      if (detail.data.items?.length) { requisitionId = r.id; break; }
    }
    test.skip(!requisitionId, 'Aucune réquisition libre avec des items');

    const payload = {
      requisitionId, title: 'AO préqualifiés', tenderNumber: `AO-PREQ-${stamp}`, audience: 'PREQUALIFIED',
      startDate: new Date(Date.now() - 60_000).toISOString(),
      endDate: new Date(Date.now() + 3_600_000).toISOString(), maxDeliveryDays: 30,
    };
    expect((await request.post('/api/tenders', { headers: auth(adminToken), data: payload })).status()).toBe(400); // catégorie requise

    const count = await (await request.get(
      `/api/tenders/eligible-count?audience=PREQUALIFIED&categoryId=${ref.categoryId}&locationId=${ref.locationId}`,
      { headers: auth(adminToken) })).json();
    expect(count.data.count).toBeGreaterThanOrEqual(1);

    const res = await request.post('/api/tenders', {
      headers: auth(adminToken), data: { ...payload, categoryId: ref.categoryId, locationId: ref.locationId },
    });
    expect(res.status()).toBe(201);
    tenderId = (await res.json()).data.id;

    const detail = (await (await request.get(`/api/tenders/${tenderId}`, { headers: auth(adminToken) })).json()).data;
    expect(detail.audience).toBe('PREQUALIFIED');
    expect(detail.category_name).toBeTruthy();

    // Préqualifié + localisation desservie : voit l'AO
    const mine = (await (await request.get('/api/supplier-portal/tenders', { headers: auth(companyToken) })).json()).data;
    expect(mine.some(t => t.id === tenderId)).toBe(true);
    const one = await request.get(`/api/supplier-portal/tenders/${tenderId}`, { headers: auth(companyToken) });
    expect(one.status()).toBe(200);

    // Non préqualifié : ne le voit pas, ne peut pas soumettre
    const theirs = (await (await request.get('/api/supplier-portal/tenders', { headers: auth(personToken) })).json()).data;
    expect(theirs.some(t => t.id === tenderId)).toBe(false);
    expect((await request.get(`/api/supplier-portal/tenders/${tenderId}`, { headers: auth(personToken) })).status()).toBe(404);
    const submit = await request.put(`/api/supplier-portal/tenders/${tenderId}/submission`, {
      headers: auth(personToken), data: { deliveryDays: 10, items: [] },
    });
    expect(submit.status()).toBe(403);
  });

  test.afterAll(async ({ request }) => {
    if (tenderId) await request.post(`/api/tenders/${tenderId}/cancel`, { headers: auth(adminToken) });
  });
});
