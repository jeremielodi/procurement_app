// Aide à la saisie des n° de série : note dans la fiche article quand le suivi par n° de série est coché,
// format + exemple + compteur dans « Enregistrer le parc existant » (même bloc que la réception GRN).
import { test, expect } from '@playwright/test';

test('Fiche article : explication affichée quand on coche « suivi par n° de série »', async ({ page }) => {
  await page.goto('/stock/items');
  await page.getByTestId('item-new').click();
  await expect(page.getByTestId('serials-item-hint')).toHaveCount(0);
  await page.getByLabel(/Équipement suivi par n° de série/).check();
  await expect(page.getByTestId('serials-item-hint')).toContainText('un n° de série sera demandé pour chaque unité acceptée');
  await page.getByLabel(/Équipement suivi par n° de série/).uncheck();
  await expect(page.getByTestId('serials-item-hint')).toHaveCount(0);
});

test('Parc existant : format, exemple et nombre de n° saisis', async ({ page }) => {
  await page.goto('/stock/equipment');
  await page.getByTestId('register-units').click();
  const help = page.getByTestId('serials-help');
  await expect(help).toContainText('Comment saisir les n° de série');
  await expect(help).toContainText('n° de série ; n° d\'inventaire');
  await expect(help).toContainText('5CD1234XYZ ; INV-0042');
  await page.getByLabel('N° de série').fill('SN-A ; INV-1\nSN-B\n');
  await expect(page.getByTestId('serials-count')).toHaveText('2 saisi(s)');
});
