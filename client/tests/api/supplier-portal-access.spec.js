import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Accès au portail pour un fournisseur saisi à la main : POST /suppliers/:id/portal-access (MANAGE_SUPPLIERS)
// → compte prof_supplier à l'email de la fiche + identifiants par email ; rien n'est créé si l'email ne part pas
// (502 EMAIL_FAILED : le test accepte les deux issues selon le SMTP de l'environnement).
test.describe.serial('API › Accès au portail d\'un fournisseur saisi à la main', () => {
  const stamp = Date.now().toString(36);
  let admin;
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const createSupplier = async (request, data) => {
    const res = await request.post('/api/suppliers', { headers: auth(admin), data: {
      name: `Portail ${stamp} ${data.suffix}`, status: 'ACTIVE', bankName: 'Banque', bankAccount: '0001', ...data,
    } });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).data;
  };
  const grant = (request, id, token = admin) => request.post(`/api/suppliers/${id}/portal-access`, { headers: auth(token), data: { language: 'fr' } });
  const detail = async (request, id) => (await (await request.get(`/api/suppliers/${id}`, { headers: auth(admin) })).json()).data;

  test.beforeAll(async ({ request }) => { admin = await getToken(request); });

  test('Création du compte, puis refus d\'un second accès', async ({ request }) => {
    const supplier = await createSupplier(request, { suffix: 'ok', email: `portal.${stamp}@nowhere.test` });
    expect((await detail(request, supplier.id)).portal_account).toBeNull();

    const res = await json(await grant(request, supplier.id));
    if (res.status === 502) {
      // SMTP indisponible : aucun compte, fournisseur inchangé
      expect(res.body.code).toBe('EMAIL_FAILED');
      expect((await detail(request, supplier.id)).portal_account).toBeNull();
      test.info().annotations.push({ type: 'note', description: 'SMTP indisponible : chemin EMAIL_FAILED vérifié' });
      return;
    }
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ email: `portal.${stamp}@nowhere.test`, is_active: true });

    const after = await detail(request, supplier.id);
    expect(after.portal_account).toMatchObject({ email: `portal.${stamp}@nowhere.test`, is_active: true, last_login: null });

    const again = await json(await grant(request, supplier.id));
    expect([again.status, again.body.code]).toEqual([409, 'ALREADY_HAS_ACCOUNT']);

    const logs = await (await request.get('/api/audit-logs?action=SUPPLIER_PORTAL_ACCESS_GRANTED&limit=5', { headers: auth(admin) })).json();
    expect(logs.data.some(l => l.new_value?.email === `portal.${stamp}@nowhere.test`)).toBe(true);
  });

  test('Refus : sans email, email déjà utilisé, fournisseur inactif, sans permission', async ({ request }) => {
    const noEmail = await createSupplier(request, { suffix: 'sans-email' });
    const r1 = await json(await grant(request, noEmail.id));
    expect([r1.status, r1.body.code]).toEqual([400, 'EMAIL_REQUIRED']);

    const taken = await createSupplier(request, { suffix: 'pris', email: 'ADMIN@procurement.com' });
    const r2 = await json(await grant(request, taken.id));
    expect([r2.status, r2.body.code]).toEqual([409, 'EMAIL_IN_USE']);

    const inactive = await createSupplier(request, { suffix: 'inactif', email: `inactive.${stamp}@nowhere.test`, status: 'INACTIVE' });
    const r3 = await json(await grant(request, inactive.id));
    expect([r3.status, r3.body.code]).toEqual([409, 'SUPPLIER_INACTIVE']);

    // Demandeur : pas de MANAGE_SUPPLIERS
    const user = { email: `portal.req.${stamp}@nowhere.test`, password: 'Secret123' };
    expect((await request.post('/api/users', { headers: auth(admin), data: {
      username: `portalreq${stamp}`, ...user, firstName: 'Req', lastName: stamp, profileIds: ['prof_requester'],
    } })).status()).toBe(201);
    const token = (await (await request.post('/api/auth/login', { data: user })).json()).data.token;
    expect((await grant(request, inactive.id, token)).status()).toBe(403);

    expect((await json(await grant(request, 999999999))).status).toBe(404);

    for (const s of [noEmail, taken, inactive]) await request.delete(`/api/suppliers/${s.id}`, { headers: auth(admin) });
  });
});
