// Demande au magasin : création dans le formulaire, « Servir » depuis la fiche → bon de sortie pré-rempli (reste à servir),
// la demande passe « Servie » et cite le bon ; le bon cite la demande.
import { test, expect } from '@playwright/test';
import { getToken, auth } from '../api/helpers.js';

test('Demande au magasin : demander, servir, suivre', async ({ page, request }) => {
  test.setTimeout(90_000);
  const stamp = Date.now().toString(36).toUpperCase();
  const admin = await getToken(request);
  const H = auth(admin);
  const before = (await (await request.get('/api/enterprises/current/stock-requests', { headers: H })).json()).data?.validationRequired;
  await request.put('/api/enterprises/current/stock-requests', { headers: H, data: { validationRequired: false } });
  try {
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    const warehouse = (await (await request.post('/api/warehouses', { headers: H, data: { code: `E2E-DM-${stamp}`, name: `Magasin E2E ${stamp}`, locationId: locations[0].id } })).json()).data;
    const item = (await (await request.post('/api/stock-items', { headers: H, data: { code: `E2E-DM-${stamp}`, name: `Stylos E2E ${stamp}`, unit: 'pce', categoryId: (cats.find(c => c.is_stockable) || cats[0]).id } })).json()).data;
    expect((await request.post('/api/stock-adjustments', { headers: H, data: { warehouseId: warehouse.id, stockItemId: item.id, quantity: 20, reason: 'FOUND', comment: 'E2E' } })).status()).toBe(201);

    await page.goto('/stock/requests/new');
    await page.getByTestId('request-warehouse').selectOption(warehouse.id);
    await page.getByTestId('request-purpose').fill('Fournitures E2E');
    await page.getByTestId('request-item-search').fill(item.code);
    await page.locator('li', { hasText: item.name }).first().click();
    await page.getByTestId('request-quantity').fill('5');
    await page.getByTestId('request-submit').click();

    await expect(page).toHaveURL(/\/stock\/requests\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByTestId('request-status')).toHaveText('À servir');
    await expect(page.getByTestId('request-remaining')).toHaveText('5');

    await page.getByTestId('request-serve').click();
    await expect(page.getByTestId('issue-from-request')).toBeVisible();
    await expect(page.getByTestId('issue-request-remaining')).toContainText('5');
    await page.getByRole('button', { name: /Enregistrer la sortie/ }).click();

    await expect(page.getByTestId('issue-request-link')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('issue-request-link').click();
    await expect(page.getByTestId('request-status')).toHaveText('Servie');
    await expect(page.getByText('Bons de sortie')).toBeVisible();
  } finally {
    await request.put('/api/enterprises/current/stock-requests', { headers: H, data: { validationRequired: !!before } });
  }
});
