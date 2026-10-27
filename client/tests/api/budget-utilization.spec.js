import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth } from './helpers.js';

// Montant utilisé des lignes budgétaires (migration 43) : bons de commande actifs + dépenses manuelles sans PO.
// Une réquisition seule ne consomme rien ; le PO impute chaque ligne sur la ligne budgétaire de sa ligne de
// réquisition (lien, sinon même désignation) ; un PO rejeté libère son montant ; une dépense ne compte qu'une fois.
test.describe.serial('API › Budget : montant utilisé', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let admin, approver, project, supplier, l1, l2, requisition, po;

  const line = async (request, id) => (await (await request.get(`/api/budget/${id}`, { headers: auth(admin) })).json()).data;
  const used = async (request, id) => Number((await line(request, id)).utilized_amount);

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    approver = await getApproverToken(request);
    [project] = (await (await request.get('/api/projects', { headers: auth(admin) })).json()).data;
    [supplier] = (await (await request.get('/api/suppliers', { headers: auth(admin) })).json()).data;
    const mk = async (code, amount) => (await (await request.post('/api/budget', { headers: auth(admin), data: {
      entityCode: `${code}-${stamp}`, description: `Utilisation ${code}`, allocatedAmount: amount, projectId: project.id,
    } })).json()).data;
    l1 = await mk('UTIL1', 10000);
    l2 = await mk('UTIL2', 5000);
  });

  test('Une réquisition sans bon de commande ne consomme rien', async ({ request }) => {
    const res = await request.post('/api/requisitions', { headers: auth(admin), data: {
      title: `[TEST BUDGET UTILISE] ${stamp}`, description: 'x', projectId: project.id,
      currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'x',
      items: [
        { description: `Papier ${stamp}`, quantity: 2, frequency: 1, unitPrice: 100, budgetLineId: l1.id },
        { description: `Encre ${stamp}`, quantity: 1, frequency: 1, unitPrice: 300, budgetLineId: l2.id },
      ],
    } });
    expect(res.status(), await res.text()).toBe(201);
    requisition = (await (await request.get(`/api/requisitions/${(await res.json()).data.id}`, { headers: auth(admin) })).json()).data;
    expect(await used(request, l1.id)).toBe(0);
    expect(await used(request, l2.id)).toBe(0);
  });

  test('Bon de commande : montant imputé sur chaque ligne', async ({ request }) => {
    const paper = requisition.items.find(i => i.item_description.startsWith('Papier'));
    const created = await request.post('/api/purchase-orders', { headers: auth(admin), data: {
      requisitionId: requisition.id, supplierId: supplier.id, currency: 'USD', totalAmount: 480,
      items: [
        { description: paper.item_description, quantity: 2, unitPrice: 90, requisitionItemId: paper.id }, // lien
        { description: `Encre ${stamp}`, quantity: 1, unitPrice: 300 },                                // même désignation
      ],
    } });
    test.skip(created.status() >= 300, `PO non créé (GoFlow requis ?) : ${await created.text()}`);
    po = (await created.json()).data;

    expect(await used(request, l1.id)).toBe(180);
    expect(await used(request, l2.id)).toBe(300);
    const detail = await line(request, l1.id);
    expect(Number(detail.remaining_amount)).toBe(10000 - 180);
    expect(detail.commitments).toEqual([expect.objectContaining({ id: po.id, requisition_id: requisition.id, amount: 180 })]);
  });

  test('Dépense manuelle sans PO : comptée une seule fois', async ({ request }) => {
    const res = await request.post('/api/budget/expenses', { headers: auth(admin), data: { budgetId: l1.id, amount: 25, description: 'Frais' } });
    expect(res.status(), await res.text()).toBeLessThan(300);
    expect(await used(request, l1.id)).toBe(po ? 205 : 25);
  });

  test('Bon de commande rejeté : montant libéré', async ({ request }) => {
    test.skip(!po, 'PO non créé');
    const res = await request.post(`/api/purchase-orders/${po.id}/reject`, { headers: auth(approver), data: { reason: 'Test budget' } });
    expect(res.status(), await res.text()).toBeLessThan(300);
    expect(await used(request, l1.id)).toBe(25);
    expect(await used(request, l2.id)).toBe(0);
    expect((await line(request, l1.id)).commitments).toEqual([]);
  });
});
