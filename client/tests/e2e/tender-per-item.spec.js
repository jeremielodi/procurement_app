// Appel d'offres attribué par article — écrans :
//  - fiche de l'AO : mode « Par article », colonne « Attribuer à » (meilleur prix proposé d'office)
//  - « Attribuer par article » : récapitulatif par fournisseur, puis colonne « Attribué à »
// Données préparées par l'API (fournisseurs inscrits, AO publié « par article », offres, clôture).
import { test, expect } from '@playwright/test';
import { auth, supplierRegistration, firstReferenceIds } from '../api/helpers.js';

test('Attribution par article depuis la fiche de l\'appel d\'offres', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  await page.goto('/tenders');
  const H = auth(await page.evaluate(() => localStorage.getItem('token')));
  const api = page.request;

  const { locationId, categoryId } = await firstReferenceIds(api);
  const suppliers = [];
  for (const n of [1, 2]) {
    const res = await api.post('/api/auth/register-supplier', { multipart: supplierRegistration({
      name: `E2E Lot ${n} ${stamp}`, email: `e2e.lot${n}.${stamp}@example.com`, locationIds: [locationId], categoryIds: [categoryId],
    }) });
    expect(res.status()).toBe(201);
    suppliers.push((await res.json()).data.token);
  }
  const [depts, projects] = await Promise.all([
    api.get('/api/departments', { headers: H }).then(r => r.json()).then(b => b.data || []),
    api.get('/api/projects', { headers: H }).then(r => r.json()).then(b => b.data || []),
  ]);
  const line = (await (await api.post('/api/budget', { headers: H, data: {
    entityCode: `BL-E2E-AOLOT-${stamp}`, description: 'e2e', allocatedAmount: 1000000, projectId: projects[0].id,
  } })).json()).data;
  const req = (await (await api.post('/api/requisitions', { headers: H, data: {
    title: `[E2E AO PAR ARTICLE] ${stamp}`, description: 'e2e', departmentId: depts[0].id, projectId: projects[0].id,
    estimatedAmount: 36000, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'e2e',
    items: ['Groupe électrogène', 'Panneaux solaires'].map(description => ({ description, quantity: 1, frequency: 1, unitPrice: 18000, budgetLineId: line?.id ?? line })),
  } })).json()).data;
  const items = (await (await api.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data.items;

  const tender = (await (await api.post('/api/tenders', { headers: H, data: {
    requisitionId: req.id, tenderNumber: `AO-E2E-LOT-${stamp}`, title: 'Énergie',
    startDate: new Date(Date.now() - 60_000).toISOString(), endDate: new Date(Date.now() + 3_600_000).toISOString(),
    maxDeliveryDays: 30, awardMode: 'PER_ITEM',
  } })).json()).data;
  // Fournisseur 1 : moins cher sur l'article 1 ; fournisseur 2 : moins cher sur l'article 2
  const bids = [[[items[0].id, 15000], [items[1].id, 17000]], [[items[0].id, 16000], [items[1].id, 14000]]];
  for (const [i, lines] of bids.entries()) {
    const res = await api.put(`/api/supplier-portal/tenders/${tender.id}/submission`, { headers: auth(suppliers[i]), data: {
      deliveryDays: 10, items: lines.map(([requisitionItemId, unitPrice]) => ({ requisitionItemId, unitPrice })),
    } });
    expect(res.status()).toBe(200);
  }
  expect((await api.post(`/api/tenders/${tender.id}/close`, { headers: H })).status()).toBe(200);

  await page.goto(`/tenders/${tender.id}`);
  await expect(page.getByTestId('tender-award-mode')).toHaveText('Par article (plusieurs fournisseurs possibles)');
  const selects = page.getByTestId('per-item-award');
  await expect(selects).toHaveCount(2);
  await expect(selects.nth(0)).toHaveValue(/\d+/);
  await expect(selects.nth(0).locator('option:checked')).toContainText(`E2E Lot 1 ${stamp}`);
  await expect(selects.nth(1).locator('option:checked')).toContainText(`E2E Lot 2 ${stamp}`);

  await page.getByTestId('per-item-award-open').click();
  const summary = page.getByTestId('per-item-summary');
  await expect(summary.locator('li')).toHaveCount(2);
  await expect(summary).toContainText('2 fournisseurs retenus');
  await page.getByRole('button', { name: 'Confirmer l\'attribution' }).click();

  await expect(page.getByTestId('tender-status')).toHaveText('Attribué');
  await expect(page.getByTestId('per-item-awarded')).toHaveText([`E2E Lot 1 ${stamp}`, `E2E Lot 2 ${stamp}`]);
});
