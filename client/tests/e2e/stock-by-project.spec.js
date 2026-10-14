// État du stock par projet : colonne « Projet (financement) » et filtre par projet / « Sans projet » de « État du stock ».
import { test, expect } from '@playwright/test';
import { getToken, auth } from '../api/helpers.js';

test('État du stock : répartition et filtre par projet', async ({ page, request }) => {
  test.setTimeout(60_000); // données créées par l'API + premier chargement de l'écran en fin de campagne
  const stamp = Date.now().toString(36).toUpperCase();
  const admin = await getToken(request);
  const H = auth(admin);
  const locations = (await (await request.get('/api/public/locations')).json()).data;
  const cats = (await (await request.get('/api/public/market-categories')).json()).data;
  const project = (await (await request.post('/api/projects/', { headers: H, data: { code: `E2E-SP-${stamp}`, name: `Projet stock ${stamp}` } })).json()).data;
  const warehouse = (await (await request.post('/api/warehouses', { headers: H, data: { code: `E2E-SP-${stamp}`, name: `Dépôt E2E ${stamp}`, locationId: locations[0].id } })).json()).data;
  const item = (await (await request.post('/api/stock-items', { headers: H, data: { code: `E2E-SP-${stamp}`, name: 'Huile (bidon 5 L)', unit: 'bidon', categoryId: (cats.find(c => c.is_stockable) || cats[0]).id } })).json()).data;
  for (const [quantity, projectId] of [[7, project.id], [3, undefined]]) {
    const res = await request.post('/api/stock-adjustments', { headers: H, data: { warehouseId: warehouse.id, stockItemId: item.id, quantity, reason: 'FOUND', comment: 'E2E', projectId } });
    expect(res.status()).toBe(201);
  }

  await page.goto(`/stock?search=E2E-SP-${stamp}`);
  const cells = page.getByTestId('balance-project');
  await expect(cells).toHaveCount(2, { timeout: 20_000 });
  await expect(cells.filter({ hasText: project.code })).toHaveCount(1);
  await expect(cells.filter({ hasText: 'Sans projet' })).toHaveCount(1);

  await page.getByTestId('overview-project-filter').selectOption(project.id);
  await expect(cells).toHaveCount(1);
  await expect(page.getByRole('row').filter({ has: cells })).toContainText('7');
  await page.getByTestId('overview-project-filter').selectOption('none');
  await expect(cells).toHaveCount(1);
  await expect(cells).toHaveText('Sans projet');
});
