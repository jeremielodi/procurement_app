import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Fournisseurs : fiche, création (champs snake_case du formulaire), modification, évaluations, suppression
test.describe.serial('API › Fournisseurs', () => {
  const stamp = Date.now().toString(36);
  let token, supplierId;

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
  });

  test('Création depuis le formulaire : champs conservés, fiche renvoyée avec son id', async ({ request }) => {
    const res = await request.post('/api/suppliers', {
      headers: auth(token),
      data: { name: `ZZ Fournisseur ${stamp}`, tax_id: 'NIF-TEST', registration_number: 'RCCM-TEST', email: `zz.${stamp}@example.com`, status: 'ACTIVE' },
    });
    const body = await res.json();
    expect(res.status()).toBe(201);
    expect(body.data.id).toBeTruthy();
    expect(body.data.tax_id).toBe('NIF-TEST');
    expect(body.data.registration_number).toBe('RCCM-TEST');
    supplierId = body.data.id;
  });

  test('Liste complète (?all=1) inclut le nouveau fournisseur non préqualifié', async ({ request }) => {
    const all = (await (await request.get('/api/suppliers?all=1', { headers: auth(token) })).json()).data;
    expect(all.some(s => s.id === supplierId)).toBe(true);
    const prequalified = (await (await request.get('/api/suppliers', { headers: auth(token) })).json()).data;
    expect(prequalified.some(s => s.id === supplierId)).toBe(false);
  });

  test('Modification, évaluation et préqualification', async ({ request }) => {
    const up = await request.put(`/api/suppliers/${supplierId}`, { headers: auth(token), data: { phone: '+243810000000' } });
    expect((await up.json()).data.phone).toBe('+243810000000');

    expect((await request.post(`/api/suppliers/${supplierId}/evaluations`, { headers: auth(token), data: { rating: 9 } })).status()).toBe(400);
    const ev = await request.post(`/api/suppliers/${supplierId}/evaluations`, { headers: auth(token), data: { rating: 4, comment: 'OK' } });
    expect(ev.status()).toBe(201);
    expect(parseFloat((await ev.json()).data.rating)).toBe(4);
    const list = (await (await request.get(`/api/suppliers/${supplierId}/evaluations`, { headers: auth(token) })).json()).data;
    expect(list).toHaveLength(1);

    const pq = await request.post(`/api/suppliers/${supplierId}/prequalify`, { headers: auth(token), data: {} });
    expect((await pq.json()).data.prequalified).toBe(true);
  });

  test('Commandes filtrées par fournisseur (supplier_id)', async ({ request }) => {
    const pos = (await (await request.get('/api/purchase-orders?supplier_id=999999', { headers: auth(token) })).json()).data;
    expect(pos).toHaveLength(0);
  });

  test('Suppression : refusée si historique, acceptée sinon', async ({ request }) => {
    const withPo = (await (await request.get('/api/purchase-orders?limit=1', { headers: auth(token) })).json()).data[0];
    if (withPo?.supplier_id) {
      expect((await request.delete(`/api/suppliers/${withPo.supplier_id}`, { headers: auth(token) })).status()).toBe(400);
    }
    expect((await request.delete(`/api/suppliers/${supplierId}`, { headers: auth(token) })).status()).toBe(200);
    expect((await request.get(`/api/suppliers/${supplierId}`, { headers: auth(token) })).status()).toBe(404);
  });
});
