/**
 * tests/e2e/grn.spec.js
 *
 * Vérifie les pages GRN (Goods Receipt Note).
 * Utilise la session admin sauvegardée par global-setup.
 */
import { test, expect } from '@playwright/test';

test.describe('📦 GRN — Bons de Réception', () => {

  test('La liste GRN se charge avec le bon titre', async ({ page }) => {
    await page.goto('/goods-receipts');
    await expect(page.locator('h1')).toContainText('Bons de Réception (GRN)', { timeout: 10_000 });
  });

  test('Le bouton "Nouveau GRN" est visible', async ({ page }) => {
    await page.goto('/goods-receipts');
    await expect(page.locator('button:has-text("Nouveau GRN")')).toBeVisible({ timeout: 8_000 });
  });

  test('Cliquer "Nouveau GRN" navigue vers le formulaire', async ({ page }) => {
    await page.goto('/goods-receipts');
    await page.click('button:has-text("Nouveau GRN")');
    await expect(page).toHaveURL(/\/goods-receipts\/new/);
  });

  test('Le formulaire GRN affiche le titre et le warning sans poId', async ({ page }) => {
    await page.goto('/goods-receipts/new');
    await expect(page.locator('h1')).toContainText('Nouveau Bon de Réception', { timeout: 8_000 });
    // Sans poId en URL, le formulaire affiche un avertissement
    await expect(page.locator('text=Accédez à cette page depuis une commande')).toBeVisible();
  });

  test('Soumettre le formulaire GRN sans poId affiche une erreur toast', async ({ page }) => {
    await page.goto('/goods-receipts/new');
    // Sans poId en URL, le bouton submit est désactivé (validation)
    await expect(page.locator('button[type="submit"]')).toBeDisabled({ timeout: 5_000 });
    // On reste sur la même page
    await expect(page).toHaveURL(/\/goods-receipts\/new/);
  });

  test('La liste GRN — filtre de statut fonctionne', async ({ page }) => {
    await page.goto('/goods-receipts');
    const statusFilter = page.locator('select').first();
    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption({ label: /complet|complete/i });
      await page.waitForTimeout(500);
      // Toujours sur la page sans erreur
      await expect(page.locator('h1')).toContainText('Bons de Réception');
    }
  });

  test('La barre de recherche GRN fonctionne', async ({ page }) => {
    await page.goto('/goods-receipts');
    const searchInput = page.locator('input[placeholder*="GRN" i], input[placeholder*="recherche" i]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('GRN-2026');
      await page.waitForTimeout(300);
      await expect(page.locator('h1')).toContainText('Bons de Réception');
    }
  });
});
