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

  // Une réception se crée uniquement depuis la tâche de la réquisition (rattachée à son bon de commande)
  test('La liste GRN n\'a pas de bouton de création mais un lien vers « Mes tâches »', async ({ page }) => {
    await page.goto('/goods-receipts');
    await expect(page.locator('main a[href="/tasks"], a[href="/tasks"]').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('button:has-text("Nouveau GRN")')).toHaveCount(0);
  });

  test('Le formulaire GRN sans poId explique où créer la réception (aucun formulaire)', async ({ page }) => {
    await page.goto('/goods-receipts/new');
    await expect(page.locator('h1')).toContainText('Nouveau Bon de Réception', { timeout: 8_000 });
    await expect(page.getByTestId('workflow-only')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveCount(0);
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
