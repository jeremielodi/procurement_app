// Prévision du réapprovisionnement : état, quantité à commander, puis « Réapprovisionner » → réquisition pré-remplie
// avec le dépôt de destination de la ligne ; fiche article (prévision + consommation par mois).
import { test, expect } from '@playwright/test';
import { getToken, auth } from '../api/helpers.js';

test('Prévision : quantité à commander et réquisition de réapprovisionnement', async ({ page, request }) => {
  test.setTimeout(60_000);
  const stamp = Date.now().toString(36).toUpperCase();
  const admin = await getToken(request);
  const H = auth(admin);
  const me = (await (await request.get('/api/auth/profile', { headers: H })).json()).data;
  const locations = (await (await request.get('/api/public/locations')).json()).data;
  const cats = (await (await request.get('/api/public/market-categories')).json()).data;
  const warehouse = (await (await request.post('/api/warehouses', { headers: H, data: { code: `E2E-PL-${stamp}`, name: `Dépôt prévision ${stamp}`, locationId: locations[0].id } })).json()).data;
  const item = (await (await request.post('/api/stock-items', { headers: H, data: { code: `E2E-PL-${stamp}`, name: `Gants (boîte) ${stamp}`, unit: 'pce', categoryId: (cats.find(c => c.is_stockable) || cats[0]).id, leadTimeDays: 30 } })).json()).data;
  expect((await request.post('/api/stock-adjustments', { headers: H, data: { warehouseId: warehouse.id, stockItemId: item.id, quantity: 100, reason: 'FOUND', comment: 'E2E' } })).status()).toBe(201);
  expect((await request.post('/api/stock-issues', { headers: H, data: { warehouseId: warehouse.id, recipientId: me.id, purpose: 'E2E', lines: [{ stockItemId: item.id, quantity: 30 }] } })).status()).toBe(201);

  await page.goto('/stock/planning');
  await page.getByTestId('planning-search').fill(item.code);
  const row = page.getByTestId('planning-row').filter({ hasText: item.code });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await expect(row.getByTestId('planning-status')).toBeVisible();
  // 30 sortis → CMM 30,4 ; stock 70 ≤ minimum (sécurité + délai) : quantité à commander affichée
  const toOrder = Number((await row.getByTestId('planning-to-order').innerText()).replace(/\D/g, ''));
  expect(toOrder).toBeGreaterThan(0);

  await row.locator('input[type="checkbox"]').check();
  await page.getByTestId('planning-restock').click();
  await expect(page).toHaveURL(/\/requisitions\/new/);
  await expect(page.getByTestId('item-destination-warehouse')).toContainText(warehouse.name);
  await expect(page.locator('input[name="items.0.quantity"]')).toHaveValue(String(toOrder));

  // Fiche article : prévision par dépôt et graphique de consommation
  await page.goto(`/stock/items/${item.id}`);
  await expect(page.getByTestId('item-planning')).toContainText(warehouse.name, { timeout: 20_000 });
  await expect(page.getByTestId('item-consumption-chart')).toBeVisible();
});
