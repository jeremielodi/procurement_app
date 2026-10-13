// Import des articles de stock depuis l'écran « Articles » : modèles Excel / CSV téléchargeables,
// aperçu (créations, stock initial, erreurs par ligne), confirmation → articles visibles dans la liste.
import { test, expect } from '@playwright/test';

test.describe('Stock › Import des articles (Excel / CSV)', () => {
  test('Modèles, aperçu puis import', async ({ page }) => {
    const stamp = Date.now().toString(36).toUpperCase();
    await page.goto('/stock/items');
    await page.getByTestId('item-import').click();
    await expect(page.getByRole('heading', { name: 'Importer des articles (Excel / CSV)' })).toBeVisible();

    // Modèles téléchargeables
    for (const [testId, ext] of [['stock-import-template-xlsx', 'xlsx'], ['stock-import-template-csv', 'csv']]) {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
      expect(download.suggestedFilename()).toBe(`modele_import_articles_stock.${ext}`);
    }

    // Fichier : un article valide (sans stock initial), une ligne en erreur
    const csv = [
      'Code;Désignation;Unité;Catégorie',
      `E2E-${stamp};Cartouche d'encre E2E;pce;OFFICE_SUPPLIES`,
      `E2E-${stamp}-BAD;;pce;`,
    ].join('\r\n');
    await page.getByTestId('stock-import-file').setInputFiles({ name: 'articles.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + csv, 'utf8') });

    await expect(page.getByTestId('stock-import-summary')).toContainText('1 article à créer');
    await expect(page.getByTestId('stock-import-errors')).toContainText('Ligne 3 : désignation obligatoire pour un nouvel article');
    await expect(page.getByTestId('stock-import-items')).toContainText(`E2E-${stamp}`);

    await page.getByRole('button', { name: 'Importer (1 élément)' }).click();
    await expect(page.getByText(/Import terminé : 1 article\(s\) créé\(s\)/)).toBeVisible();
    await page.getByPlaceholder('Rechercher par code ou désignation…').fill(`E2E-${stamp}`);
    await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: `E2E-${stamp}`, exact: true }) })).toContainText("Cartouche d'encre E2E");
  });
});

test('Réquisitions : « Département » en avant-dernière colonne', async ({ page }) => {
  await page.goto('/requisitions');
  await expect(page.locator('table thead th').last()).toBeVisible();
  const headers = (await page.locator('table thead th').allInnerTexts()).map(h => h.trim().toLowerCase());
  expect(headers[headers.length - 2]).toBe('département');
  expect(headers[headers.length - 1]).toBe('actions');
});
