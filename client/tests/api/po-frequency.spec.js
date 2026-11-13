import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth } from './helpers.js';

// Fréquence des lignes de réquisition : le bon de commande reprend quantité × fréquence (même total, même prix
// unitaire). Le serveur refuse une quantité commandée supérieure à quantité × fréquence (cumul des bons actifs,
// bons rejetés exclus) et un article d'une autre réquisition. Les lignes du PO exposent l'origine (2 × 12).
test.describe.serial('API › Bon de commande : fréquence de la réquisition', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let admin, approver, project, supplier, requisition, monthly, once, po;

  const createPo = (request, items) => request.post('/api/purchase-orders', { headers: auth(admin), data: {
    requisitionId: requisition.id, supplierId: supplier.id, currency: 'USD',
    totalAmount: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0), items,
  } });
  const line = (item, quantity) => ({ description: item.item_description, quantity, unitPrice: Number(item.unit_price), requisitionItemId: item.id });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    approver = await getApproverToken(request);
    [project] = (await (await request.get('/api/projects', { headers: auth(admin) })).json()).data;
    [supplier] = (await (await request.get('/api/suppliers', { headers: auth(admin) })).json()).data;
    const res = await request.post('/api/requisitions', { headers: auth(admin), data: { submit: true,
      title: `[TEST FREQUENCE PO] ${stamp}`, description: 'x', projectId: project.id,
      currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'x',
      items: [
        { description: `Location mensuelle ${stamp}`, quantity: 2, frequency: 12, unitPrice: 100 },
        { description: `Papier ${stamp}`, quantity: 3, frequency: 1, unitPrice: 50 },
      ],
    } });
    expect(res.status(), await res.text()).toBe(201);
    requisition = (await (await request.get(`/api/requisitions/${(await res.json()).data.id}`, { headers: auth(admin) })).json()).data;
    monthly = requisition.items.find(i => i.item_description.startsWith('Location'));
    once = requisition.items.find(i => i.item_description.startsWith('Papier'));
  });

  test('Le total de la réquisition tient compte de la fréquence', () => {
    expect(Number(monthly.total_amount)).toBe(2400);
    expect(Number(requisition.estimated_amount)).toBe(2550);
  });

  test('Quantité supérieure à quantité × fréquence : refusée', async ({ request }) => {
    const res = await createPo(request, [line(monthly, 25), line(once, 3)]);
    test.skip(res.status() === 409, `Réquisition non active (BpmnGo requis ?) : ${await res.text()}`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('ITEM_QUANTITY_EXCEEDS_REQUISITION');
    expect(body.details).toMatchObject({ allowed: 24, ordered: 0, remaining: 24, quantity: 25 });
  });

  test('Article d\'une autre réquisition : refusé', async ({ request }) => {
    const res = await createPo(request, [{ ...line(once, 1), requisitionItemId: 2147483000 }]);
    test.skip(res.status() === 409, 'Réquisition non active');
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('ITEM_NOT_IN_REQUISITION');
  });

  test('Quantité × fréquence : bon de commande créé, origine exposée', async ({ request }) => {
    const res = await createPo(request, [line(monthly, 24), line(once, 3)]);
    test.skip(res.status() === 409, 'Réquisition non active');
    expect(res.status(), await res.text()).toBe(201);
    po = (await res.json()).data;
    const detail = (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: auth(admin) })).json()).data;
    const rent = detail.items.find(i => i.requisition_item_id === monthly.id);
    expect(rent).toMatchObject({ quantity: 24, requisition_quantity: 2, requisition_frequency: 12 });
    expect(Number(rent.total_amount)).toBe(2400);
    expect(Number(detail.total_amount)).toBe(2550);
    const pdf = await request.get(`/api/purchase-orders/${po.id}/pdf`, { headers: auth(admin) });
    expect(pdf.status()).toBe(200);
  });

  test('Cumul des bons actifs : plus rien à commander', async ({ request }) => {
    test.skip(!po, 'PO non créé');
    const res = await createPo(request, [line(monthly, 1)]);
    expect(res.status()).toBe(400);
    expect((await res.json()).details).toMatchObject({ ordered: 24, remaining: 0 });
  });

  test('Bon rejeté : la quantité redevient disponible', async ({ request }) => {
    test.skip(!po, 'PO non créé');
    const rejected = await request.post(`/api/purchase-orders/${po.id}/reject`, { headers: auth(approver), data: { reason: 'Test fréquence' } });
    expect(rejected.status(), await rejected.text()).toBeLessThan(300);
    const res = await createPo(request, [line(monthly, 24)]);
    expect(res.status(), await res.text()).toBe(201);
  });
});
