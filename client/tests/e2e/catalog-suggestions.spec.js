// Suggestions d'articles du catalogue (réquisition, bon de réception…) : la liste s'affiche par-dessus la page,
// entièrement visible et cliquable, même dans un tableau à défilement horizontal.
import { test, expect } from '@playwright/test';

test('Réquisition : la liste des articles suggérés est entièrement visible et cliquable', async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  await page.goto('/requisitions/new');

  // Article du catalogue créé pour le test
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const created = await page.request.post('/api/stock-items', {
    headers: { Authorization: `Bearer ${token}` },
    data: { code: `SUG-${stamp}`, name: `Stylo suggestion ${stamp}`, unit: 'pce' },
  });
  expect(created.status()).toBe(201);

  const input = page.locator('input[name="items.0.description"]');
  await input.fill(`SUG-${stamp}`);
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  const option = list.getByRole('option', { name: new RegExp(`SUG-${stamp}`) });
  await expect(option).toBeVisible();

  // Rien n'est coupé : la liste est hors du tableau (portail) et dans la fenêtre
  expect(await list.evaluate(el => el.parentElement === document.body)).toBe(true);
  const box = await list.boundingBox();
  const viewport = page.viewportSize();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await option.click();
  await expect(input).toHaveValue(`Stylo suggestion ${stamp}`);
  await expect(page.getByText(`SUG-${stamp}`, { exact: true })).toBeVisible(); // pastille de l'article lié
});
