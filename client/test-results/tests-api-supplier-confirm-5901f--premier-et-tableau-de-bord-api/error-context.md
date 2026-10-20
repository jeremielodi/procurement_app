# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\api\supplier-confirmation.spec.js >> API › Confirmation de commande par le fournisseur >> Portail : mes commandes (à confirmer en premier) et tableau de bord
- Location: tests\api\supplier-confirmation.spec.js:54:3

# Error details

```
Error: apiRequestContext.get: socket hang up
Call log:
  - → GET http://127.0.0.1:5000/api/projects
    - user-agent: Playwright/1.61.0 (x64; windows 10.0) node/24.15
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YTkzNTc2LTY5MWMtNDgxNS04ZjY2LTI4YTc1ZjRkMzE5NyIsImVtYWlsIjoiYWRtaW5AcHJvY3VyZW1lbnQuY29tIiwidXNlcm5hbWUiOiJzdXBlcmFkbWluIiwiaWF0IjoxNzkyMTU1MzcyLCJleHAiOjE3OTIyNDE3NzJ9.JkJaBPtByH9AwHmb36WKwX3UrpHUU3-POdmaIRosjy0

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { getToken, getApproverToken, auth, supplierRegistration, firstReferenceIds } from './helpers.js';
  3   | 
  4   | // Confirmation de commande par le fournisseur (étape GoFlow Activity_SupplierConfirmation) :
  5   | // portail fournisseur (mes commandes, détail, PDF, refus motivé puis confirmation), saisie par les achats,
  6   | // cloisonnement entre fournisseurs, droits, suivi du workflow de la réquisition.
  7   | test.describe.serial('API › Confirmation de commande par le fournisseur', () => {
  8   |   const stamp = Date.now().toString(36);
  9   |   const supplierCreds = { email: `conf.sup.${stamp}@nowhere.test`, password: 'Secret123' };
  10  |   const otherCreds = { email: `conf.other.${stamp}@nowhere.test`, password: 'Secret123' };
  11  |   const requesterCreds = { email: `conf.req.${stamp}@nowhere.test`, password: 'Secret123' };
  12  |   let admin, supplierToken, otherToken, requesterToken, supplier, req, poA, poB;
  13  |   const future = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);
  14  |   const json = async (res) => ({ status: res.status(), body: await res.json() });
  15  | 
  16  |   test.beforeAll(async ({ request }) => {
  17  |     admin = await getToken(request);
  18  |     const H = auth(admin);
  19  |     const { locationId, categoryId } = await firstReferenceIds(request);
  20  |     for (const [creds, key] of [[supplierCreds, 'main'], [otherCreds, 'other']]) {
  21  |       const res = await request.post('/api/auth/register-supplier', {
  22  |         multipart: supplierRegistration({ name: `Fournisseur confirmation ${key} ${stamp}`, email: creds.email, password: creds.password, locationIds: [locationId], categoryIds: [categoryId] }),
  23  |       });
  24  |       expect(res.status()).toBe(201);
  25  |       if (key === 'main') supplierToken = (await res.json()).data.token; else otherToken = (await res.json()).data.token;
  26  |     }
  27  |     const created = await request.post('/api/users', { headers: H, data: { username: `confreq${stamp}`, email: requesterCreds.email, password: requesterCreds.password, firstName: 'Req', lastName: stamp, profileIds: ['prof_requester'] } });
  28  |     expect(created.status()).toBe(201);
  29  |     requesterToken = (await (await request.post('/api/auth/login', { data: requesterCreds })).json()).data.token;
  30  | 
  31  |     supplier = (await (await request.get(`/api/suppliers?all=1`, { headers: H })).json()).data
  32  |       .find(s => s.email === supplierCreds.email);
  33  |     expect(supplier?.id).toBeTruthy();
  34  | 
> 35  |     const [depts, projects] = await Promise.all(['/api/departments', '/api/projects'].map(async u => (await (await request.get(u, { headers: H })).json()).data));
      |                                                                                                                            ^ Error: apiRequestContext.get: socket hang up
  36  |     req = (await (await request.post('/api/requisitions', { headers: H, data: {
  37  |       title: `[TEST CONFIRMATION] ${stamp}`, description: 'x', departmentId: depts[0].id, projectId: projects[0]?.id, currencyId: 1, currencyCode: 'USD',
  38  |       priority: 'MEDIUM', justification: 'x', items: [{ description: 'Ramettes de papier', quantity: 10, frequency: 1, unitPrice: 5 }],
  39  |     } })).json()).data;
  40  |     const makePo = async () => {
  41  |       const po = (await (await request.post('/api/purchase-orders', { headers: H, data: {
  42  |         requisitionId: req.id, supplierId: supplier.id, currency: 'USD', totalAmount: 50, deliveryDate: future(20),
  43  |         items: [{ description: 'Ramettes de papier', quantity: 10, unitPrice: 5 }],
  44  |       } })).json()).data;
  45  |       // Approbation par un autre administrateur que le créateur du bon (séparation des tâches)
  46  |       const ok = await request.post(`/api/purchase-orders/${po.id}/approve`, { headers: auth(await getApproverToken(request)), data: { comments: 'ok' } });
  47  |       expect(ok.status()).toBe(200);
  48  |       return (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: H })).json()).data;
  49  |     };
  50  |     poA = await makePo();
  51  |     poB = await makePo();
  52  |   });
  53  | 
  54  |   test('Portail : mes commandes (à confirmer en premier) et tableau de bord', async ({ request }) => {
  55  |     const list = await json(await request.get('/api/supplier-portal/orders', { headers: auth(supplierToken) }));
  56  |     expect(list.status).toBe(200);
  57  |     const mine = list.body.data.filter(o => [poA.id, poB.id].includes(o.id));
  58  |     expect(mine).toHaveLength(2);
  59  |     expect(mine.every(o => o.awaiting_response === true && o.status === 'PO_APPROVED')).toBe(true);
  60  |     const toConfirm = await json(await request.get('/api/supplier-portal/orders?status=TO_CONFIRM', { headers: auth(supplierToken) }));
  61  |     expect(toConfirm.body.data.map(o => o.id)).toEqual(expect.arrayContaining([poA.id, poB.id]));
  62  |     const dash = (await (await request.get('/api/supplier-portal/dashboard', { headers: auth(supplierToken) })).json()).data;
  63  |     expect(dash.stats.ordersToConfirm).toBe(2);
  64  | 
  65  |     const detail = await json(await request.get(`/api/supplier-portal/orders/${poA.id}`, { headers: auth(supplierToken) }));
  66  |     expect(detail.status).toBe(200);
  67  |     expect(detail.body.data.items).toHaveLength(1);
  68  |     expect(detail.body.data.buyer_name).toBeTruthy();
  69  |     const pdf = await request.get(`/api/supplier-portal/orders/${poA.id}/pdf?lang=fr`, { headers: auth(supplierToken) });
  70  |     expect([pdf.status(), pdf.headers()['content-type']]).toEqual([200, 'application/pdf']);
  71  |   });
  72  | 
  73  |   test('Cloisonnement : un autre fournisseur ne voit ni ne confirme la commande', async ({ request }) => {
  74  |     const H = auth(otherToken);
  75  |     expect((await request.get(`/api/supplier-portal/orders/${poA.id}`, { headers: H })).status()).toBe(404);
  76  |     expect((await request.get(`/api/supplier-portal/orders/${poA.id}/pdf`, { headers: H })).status()).toBe(404);
  77  |     expect((await request.post(`/api/supplier-portal/orders/${poA.id}/confirm`, { headers: H, data: {} })).status()).toBe(404);
  78  |     const list = (await (await request.get('/api/supplier-portal/orders', { headers: H })).json()).data;
  79  |     expect(list.some(o => o.id === poA.id)).toBe(false);
  80  |     // Un compte d'entreprise n'a pas accès au portail fournisseur
  81  |     expect((await request.get('/api/supplier-portal/orders', { headers: auth(requesterToken) })).status()).toBe(403);
  82  |   });
  83  | 
  84  |   test('Refus : motif obligatoire, acheteur prévenu, la commande reste à confirmer', async ({ request }) => {
  85  |     const H = auth(supplierToken);
  86  |     expect((await json(await request.post(`/api/supplier-portal/orders/${poA.id}/decline`, { headers: H, data: { comment: '  ' } }))).body.code).toBe('REASON_REQUIRED');
  87  |     const res = await json(await request.post(`/api/supplier-portal/orders/${poA.id}/decline`, { headers: H, data: { comment: 'Rupture de stock' } }));
  88  |     expect(res.status).toBe(200);
  89  |     const po = (await (await request.get(`/api/purchase-orders/${poA.id}`, { headers: auth(admin) })).json()).data;
  90  |     expect([po.status, po.supplier_response, po.supplier_response_source, po.supplier_comment]).toEqual(['PO_APPROVED', 'DECLINED', 'PORTAL', 'Rupture de stock']);
  91  |     const me = (await (await request.get('/api/auth/profile', { headers: auth(admin) })).json()).data;
  92  |     const notes = (await (await request.get(`/api/notifications/${me.id}`, { headers: auth(admin) })).json()).data;
  93  |     expect(notes.some(n => n.title.includes(poA.po_number) && /refus|declin/i.test(n.title))).toBe(true);
  94  |   });
  95  | 
  96  |   test('Confirmation après refus : date passée refusée, puis PO_CONFIRMED ; une seule confirmation', async ({ request }) => {
  97  |     const H = auth(supplierToken);
  98  |     expect((await json(await request.post(`/api/supplier-portal/orders/${poA.id}/confirm`, { headers: H, data: { deliveryDate: '2020-01-01' } }))).body.code).toBe('DATE_IN_PAST');
  99  |     expect((await json(await request.post(`/api/supplier-portal/orders/${poA.id}/confirm`, { headers: H, data: { deliveryDate: '2026-02-31' } }))).body.code).toBe('INVALID_DATE');
  100 |     const ok = await json(await request.post(`/api/supplier-portal/orders/${poA.id}/confirm`, { headers: H, data: { deliveryDate: future(10), reference: 'BL-778', comment: 'Livraison en deux fois possible' } }));
  101 |     expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  102 |     expect(ok.body.data.response).toBe('CONFIRMED');
  103 |     const po = (await (await request.get(`/api/purchase-orders/${poA.id}`, { headers: auth(admin) })).json()).data;
  104 |     expect([po.status, po.supplier_response, po.supplier_reference, new Date(po.confirmed_delivery_date).toLocaleDateString('sv')])
  105 |       .toEqual(['PO_CONFIRMED', 'CONFIRMED', 'BL-778', future(10)]);
  106 |     expect((await json(await request.post(`/api/supplier-portal/orders/${poA.id}/confirm`, { headers: H, data: {} }))).body.code).toBe('ALREADY_CONFIRMED');
  107 |     expect((await json(await request.post(`/api/supplier-portal/orders/${poA.id}/decline`, { headers: H, data: { comment: 'x' } }))).body.code).toBe('ALREADY_CONFIRMED');
  108 |   });
  109 | 
  110 |   test('Achats : enregistrent la confirmation reçue hors portail ; droits', async ({ request }) => {
  111 |     expect((await request.post(`/api/purchase-orders/${poB.id}/supplier-response`, { headers: auth(requesterToken), data: { response: 'CONFIRMED' } })).status()).toBe(403);
  112 |     const res = await json(await request.post(`/api/purchase-orders/${poB.id}/supplier-response`, { headers: auth(admin), data: { response: 'CONFIRMED', deliveryDate: future(5), comment: 'Confirmé par téléphone' } }));
  113 |     expect(res.status, JSON.stringify(res.body)).toBe(200);
  114 |     const po = (await (await request.get(`/api/purchase-orders/${poB.id}`, { headers: auth(admin) })).json()).data;
  115 |     expect([po.status, po.supplier_response_source]).toEqual(['PO_CONFIRMED', 'PROCUREMENT']);
  116 |     const dash = (await (await request.get('/api/supplier-portal/dashboard', { headers: auth(supplierToken) })).json()).data;
  117 |     expect(dash.stats.ordersToConfirm).toBe(0);
  118 |   });
  119 | 
  120 |   test('Suivi du workflow : refus et confirmation visibles dans la réquisition', async ({ request }) => {
  121 |     const timeline = (await (await request.get(`/api/requisitions/${req.id}/timeline?lang=fr`, { headers: auth(admin) })).json()).data;
  122 |     const titles = timeline.events.map(e => e.title);
  123 |     expect(titles).toEqual(expect.arrayContaining([`Commande ${poA.po_number} déclinée par le fournisseur`, `Commande ${poA.po_number} confirmée par le fournisseur`]));
  124 |     expect(timeline.steps.find(s => s.key === 'supplier_confirmation').status).toBe('done');
  125 |   });
  126 | });
  127 | 
```