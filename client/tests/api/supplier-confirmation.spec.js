import { test, expect } from '@playwright/test';
import { getToken, auth, supplierRegistration, firstReferenceIds } from './helpers.js';

// Confirmation de commande par le fournisseur (étape GoFlow Activity_SupplierConfirmation) :
// portail fournisseur (mes commandes, détail, PDF, refus motivé puis confirmation), saisie par les achats,
// cloisonnement entre fournisseurs, droits, suivi du workflow de la réquisition.
test.describe.serial('API › Confirmation de commande par le fournisseur', () => {
  const stamp = Date.now().toString(36);
  const supplierCreds = { email: `conf.sup.${stamp}@nowhere.test`, password: 'Secret123' };
  const otherCreds = { email: `conf.other.${stamp}@nowhere.test`, password: 'Secret123' };
  const requesterCreds = { email: `conf.req.${stamp}@nowhere.test`, password: 'Secret123' };
  let admin, supplierToken, otherToken, requesterToken, supplier, req, poA, poB;
  const future = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);
  const json = async (res) => ({ status: res.status(), body: await res.json() });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const H = auth(admin);
    const { locationId, categoryId } = await firstReferenceIds(request);
    for (const [creds, key] of [[supplierCreds, 'main'], [otherCreds, 'other']]) {
      const res = await request.post('/api/auth/register-supplier', {
        multipart: supplierRegistration({ name: `Fournisseur confirmation ${key} ${stamp}`, email: creds.email, password: creds.password, locationIds: [locationId], categoryIds: [categoryId] }),
      });
      expect(res.status()).toBe(201);
      if (key === 'main') supplierToken = (await res.json()).data.token; else otherToken = (await res.json()).data.token;
    }
    const created = await request.post('/api/users', { headers: H, data: { username: `confreq${stamp}`, email: requesterCreds.email, password: requesterCreds.password, firstName: 'Req', lastName: stamp, profileIds: ['prof_requester'] } });
    expect(created.status()).toBe(201);
    requesterToken = (await (await request.post('/api/auth/login', { data: requesterCreds })).json()).data.token;

    supplier = (await (await request.get(`/api/suppliers?all=1`, { headers: H })).json()).data
      .find(s => s.email === supplierCreds.email);
    expect(supplier?.id).toBeTruthy();

    const [depts, projects] = await Promise.all(['/api/departments', '/api/projects'].map(async u => (await (await request.get(u, { headers: H })).json()).data));
    req = (await (await request.post('/api/requisitions', { headers: H, data: {
      title: `[TEST CONFIRMATION] ${stamp}`, description: 'x', departmentId: depts[0].id, projectId: projects[0]?.id, currencyId: 1, currencyCode: 'USD',
      priority: 'MEDIUM', justification: 'x', items: [{ description: 'Ramettes de papier', quantity: 10, frequency: 1, unitPrice: 5 }],
    } })).json()).data;
    const makePo = async () => {
      const po = (await (await request.post('/api/purchase-orders', { headers: H, data: {
        requisitionId: req.id, supplierId: supplier.id, currency: 'USD', totalAmount: 50, deliveryDate: future(20),
        items: [{ description: 'Ramettes de papier', quantity: 10, unitPrice: 5 }],
      } })).json()).data;
      const ok = await request.post(`/api/purchase-orders/${po.id}/approve`, { headers: H, data: { comments: 'ok' } });
      expect(ok.status()).toBe(200);
      return (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: H })).json()).data;
    };
    poA = await makePo();
    poB = await makePo();
  });

  test('Portail : mes commandes (à confirmer en premier) et tableau de bord', async ({ request }) => {
    const list = await json(await request.get('/api/supplier-portal/orders', { headers: auth(supplierToken) }));
    expect(list.status).toBe(200);
    const mine = list.body.data.filter(o => [poA.id, poB.id].includes(o.id));
    expect(mine).toHaveLength(2);
    expect(mine.every(o => o.awaiting_response === true && o.status === 'PO_APPROVED')).toBe(true);
    const toConfirm = await json(await request.get('/api/supplier-portal/orders?status=TO_CONFIRM', { headers: auth(supplierToken) }));
    expect(toConfirm.body.data.map(o => o.id)).toEqual(expect.arrayContaining([poA.id, poB.id]));
    const dash = (await (await request.get('/api/supplier-portal/dashboard', { headers: auth(supplierToken) })).json()).data;
    expect(dash.stats.ordersToConfirm).toBe(2);

    const detail = await json(await request.get(`/api/supplier-portal/orders/${poA.id}`, { headers: auth(supplierToken) }));
    expect(detail.status).toBe(200);
    expect(detail.body.data.items).toHaveLength(1);
    expect(detail.body.data.buyer_name).toBeTruthy();
    const pdf = await request.get(`/api/supplier-portal/orders/${poA.id}/pdf?lang=fr`, { headers: auth(supplierToken) });
    expect([pdf.status(), pdf.headers()['content-type']]).toEqual([200, 'application/pdf']);
  });

  test('Cloisonnement : un autre fournisseur ne voit ni ne confirme la commande', async ({ request }) => {
    const H = auth(otherToken);
    expect((await request.get(`/api/supplier-portal/orders/${poA.id}`, { headers: H })).status()).toBe(404);
    expect((await request.get(`/api/supplier-portal/orders/${poA.id}/pdf`, { headers: H })).status()).toBe(404);
    expect((await request.post(`/api/supplier-portal/orders/${poA.id}/confirm`, { headers: H, data: {} })).status()).toBe(404);
    const list = (await (await request.get('/api/supplier-portal/orders', { headers: H })).json()).data;
    expect(list.some(o => o.id === poA.id)).toBe(false);
    // Un compte d'entreprise n'a pas accès au portail fournisseur
    expect((await request.get('/api/supplier-portal/orders', { headers: auth(requesterToken) })).status()).toBe(403);
  });

  test('Refus : motif obligatoire, acheteur prévenu, la commande reste à confirmer', async ({ request }) => {
    const H = auth(supplierToken);
    expect((await json(await request.post(`/api/supplier-portal/orders/${poA.id}/decline`, { headers: H, data: { comment: '  ' } }))).body.code).toBe('REASON_REQUIRED');
    const res = await json(await request.post(`/api/supplier-portal/orders/${poA.id}/decline`, { headers: H, data: { comment: 'Rupture de stock' } }));
    expect(res.status).toBe(200);
    const po = (await (await request.get(`/api/purchase-orders/${poA.id}`, { headers: auth(admin) })).json()).data;
    expect([po.status, po.supplier_response, po.supplier_response_source, po.supplier_comment]).toEqual(['PO_APPROVED', 'DECLINED', 'PORTAL', 'Rupture de stock']);
    const me = (await (await request.get('/api/auth/profile', { headers: auth(admin) })).json()).data;
    const notes = (await (await request.get(`/api/notifications/${me.id}`, { headers: auth(admin) })).json()).data;
    expect(notes.some(n => n.title.includes(poA.po_number) && /refus|declin/i.test(n.title))).toBe(true);
  });

  test('Confirmation après refus : date passée refusée, puis PO_CONFIRMED ; une seule confirmation', async ({ request }) => {
    const H = auth(supplierToken);
    expect((await json(await request.post(`/api/supplier-portal/orders/${poA.id}/confirm`, { headers: H, data: { deliveryDate: '2020-01-01' } }))).body.code).toBe('DATE_IN_PAST');
    expect((await json(await request.post(`/api/supplier-portal/orders/${poA.id}/confirm`, { headers: H, data: { deliveryDate: '2026-02-31' } }))).body.code).toBe('INVALID_DATE');
    const ok = await json(await request.post(`/api/supplier-portal/orders/${poA.id}/confirm`, { headers: H, data: { deliveryDate: future(10), reference: 'BL-778', comment: 'Livraison en deux fois possible' } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.response).toBe('CONFIRMED');
    const po = (await (await request.get(`/api/purchase-orders/${poA.id}`, { headers: auth(admin) })).json()).data;
    expect([po.status, po.supplier_response, po.supplier_reference, new Date(po.confirmed_delivery_date).toLocaleDateString('sv')])
      .toEqual(['PO_CONFIRMED', 'CONFIRMED', 'BL-778', future(10)]);
    expect((await json(await request.post(`/api/supplier-portal/orders/${poA.id}/confirm`, { headers: H, data: {} }))).body.code).toBe('ALREADY_CONFIRMED');
    expect((await json(await request.post(`/api/supplier-portal/orders/${poA.id}/decline`, { headers: H, data: { comment: 'x' } }))).body.code).toBe('ALREADY_CONFIRMED');
  });

  test('Achats : enregistrent la confirmation reçue hors portail ; droits', async ({ request }) => {
    expect((await request.post(`/api/purchase-orders/${poB.id}/supplier-response`, { headers: auth(requesterToken), data: { response: 'CONFIRMED' } })).status()).toBe(403);
    const res = await json(await request.post(`/api/purchase-orders/${poB.id}/supplier-response`, { headers: auth(admin), data: { response: 'CONFIRMED', deliveryDate: future(5), comment: 'Confirmé par téléphone' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const po = (await (await request.get(`/api/purchase-orders/${poB.id}`, { headers: auth(admin) })).json()).data;
    expect([po.status, po.supplier_response_source]).toEqual(['PO_CONFIRMED', 'PROCUREMENT']);
    const dash = (await (await request.get('/api/supplier-portal/dashboard', { headers: auth(supplierToken) })).json()).data;
    expect(dash.stats.ordersToConfirm).toBe(0);
  });

  test('Suivi du workflow : refus et confirmation visibles dans la réquisition', async ({ request }) => {
    const timeline = (await (await request.get(`/api/requisitions/${req.id}/timeline?lang=fr`, { headers: auth(admin) })).json()).data;
    const titles = timeline.events.map(e => e.title);
    expect(titles).toEqual(expect.arrayContaining([`Commande ${poA.po_number} déclinée par le fournisseur`, `Commande ${poA.po_number} confirmée par le fournisseur`]));
    expect(timeline.steps.find(s => s.key === 'supplier_confirmation').status).toBe('done');
  });
});
