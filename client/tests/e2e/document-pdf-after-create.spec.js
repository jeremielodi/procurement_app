// Après la création d'une réquisition ou d'un bon de commande, le formulaire ouvre la fiche avec ?pdf=1 : le PDF
// s'affiche d'office dans la fenêtre ; à la fermeture, le paramètre est retiré (pas de réouverture au rafraîchissement).
import { test, expect } from '@playwright/test';

async function checkPdfOpensThenCloses(page, path) {
  await page.goto(`${path}?pdf=1`);
  const frame = page.locator('iframe[src^="blob:"]');
  await expect(frame).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('pdf-viewer-close').click();
  await expect(frame).toHaveCount(0);
  await expect(page).toHaveURL(url => url.pathname === path && !url.searchParams.has('pdf'));

  // Sans le paramètre : fiche seule
  await page.reload();
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('iframe[src^="blob:"]')).toHaveCount(0);
}

test('Réquisition : PDF ouvert d\'office après la création (?pdf=1)', async ({ page }) => {
  await page.goto('/requisitions');
  const href = await page.locator('table tbody a[href^="/requisitions/"]').first().getAttribute('href');
  await checkPdfOpensThenCloses(page, href.split('?')[0]);
});

test('Bon de commande : PDF ouvert d\'office après la création (?pdf=1)', async ({ page }) => {
  await page.goto('/purchase-orders');
  const href = await page.locator('table tbody a[href^="/purchase-orders/"]').first().getAttribute('href');
  await checkPdfOpensThenCloses(page, href.split('?')[0]);
});

test('Réquisition créée depuis le formulaire : fiche ouverte avec le PDF affiché', async ({ page }) => {
  await page.goto('/requisitions/new');
  await page.locator('input[name="title"]').fill(`[E2E PDF] Réquisition ${Date.now()}`);
  const project = page.getByTestId('requisition-project');
  await expect(project.locator('option:not([value=""])').first()).toBeAttached();
  await project.selectOption(await project.locator('option:not([value=""])').first().getAttribute('value'));

  await page.locator('input[name="items.0.description"]').fill('Location véhicule');
  await page.getByTestId('item-unit').first().fill('jour');
  await page.locator('input[name="items.0.unitPrice"]').fill('110');
  await page.getByPlaceholder('Sélectionner ligne budgétaire').first().click();
  await page.locator('tr.cursor-pointer').first().click();

  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/requisitions\/[0-9a-f-]{36}\?pdf=1$/, { timeout: 30_000 });
  await expect(page.locator('iframe[src^="blob:"]')).toBeVisible({ timeout: 30_000 });

  // Nettoyage
  const id = new URL(page.url()).pathname.split('/')[2];
  const token = await page.evaluate(() => localStorage.getItem('token'));
  await page.request.delete(`/api/requisitions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
});
