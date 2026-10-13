// Bon de commande : tous les fournisseurs actifs sont proposés, préqualifiés en tête ;
// un fournisseur non préqualifié (ex. inscrit sur le portail) reste choisissable, avec un avertissement.
import { test, expect } from '@playwright/test';

test('Bon de commande : fournisseurs préqualifiés puis non préqualifiés, avertissement', async ({ page }) => {
  await page.goto('/requisitions');
  const href = await page.locator('table tbody a[href^="/requisitions/"]').first().getAttribute('href');
  const requisitionId = href.split('/')[2];
  await page.goto(`/purchase-orders/${requisitionId}/e2e-task`);

  const select = page.locator('select[required]').first();
  await expect(select.locator('optgroup[label="Préqualifiés par votre entreprise"] option').first()).toBeAttached();
  const others = select.locator('optgroup[label="Non préqualifiés"] option');
  await expect(others.first()).toBeAttached();

  const prequalified = select.locator('optgroup[label="Préqualifiés par votre entreprise"] option').first();
  await select.selectOption(await prequalified.getAttribute('value'));
  await expect(page.getByTestId('po-supplier-not-prequalified')).toHaveCount(0);
  await select.selectOption(await others.first().getAttribute('value'));
  await expect(page.getByTestId('po-supplier-not-prequalified')).toContainText('pas encore préqualifié');

  // Recherche dans la liste : saisie d'une partie du nom → seul ce fournisseur reste, choisi au clic
  const name = (await prequalified.textContent()).trim();
  await select.locator('xpath=following-sibling::button').click();
  await page.getByRole('textbox', { name: 'Rechercher dans la liste' }).fill(name.slice(0, 12));
  await page.getByRole('option', { name, exact: true }).first().click();
  await expect(select.locator('option:checked')).toHaveText(name);
});
