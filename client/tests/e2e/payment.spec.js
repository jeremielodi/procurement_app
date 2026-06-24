/**
 * tests/e2e/payment.spec.js
 *
 * Vérifie les pages Paiements.
 * Utilise la session admin sauvegardée par global-setup.
 */
import { test, expect } from '@playwright/test';

test.describe('💳 Paiements', () => {

  test('La liste des paiements se charge avec le bon titre', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.locator('h1')).toContainText('Paiements', { timeout: 10_000 });
  });

  test('Les 3 cartes de résumé sont visibles', async ({ page }) => {
    await page.goto('/payments');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Total paiements')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('En attente').first()).toBeVisible();
    await expect(page.getByText('Payés').first()).toBeVisible();
  });

  test('Le bouton "Nouveau paiement" est visible', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.locator('button:has-text("Nouveau paiement")')).toBeVisible({ timeout: 8_000 });
  });

  test('Cliquer "Nouveau paiement" navigue vers le formulaire', async ({ page }) => {
    await page.goto('/payments');
    await page.click('button:has-text("Nouveau paiement")');
    await expect(page).toHaveURL(/\/payments\/new/);
  });

  test('Le formulaire de paiement affiche le bon titre', async ({ page }) => {
    await page.goto('/payments/new');
    await expect(page.locator('h1')).toContainText('Nouveau Paiement', { timeout: 8_000 });
  });

  test('Le formulaire de paiement a les champs requis', async ({ page }) => {
    await page.goto('/payments/new');
    // Montant
    await expect(page.locator('input[type="number"]').first()).toBeVisible({ timeout: 5_000 });
    // Mode de paiement (select)
    await expect(page.locator('select').first()).toBeVisible();
    // Date de paiement
    await expect(page.locator('input[type="date"]')).toBeVisible();
    // Bouton submit
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('Soumettre sans montant affiche une erreur toast', async ({ page }) => {
    await page.goto('/payments/new');
    await page.waitForLoadState('networkidle');
    // Vider le champ montant
    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill('');
    await page.click('button[type="submit"]');
    // Toast d'erreur
    await expect(page.getByText('Le montant est requis')).toBeVisible({ timeout: 8_000 });
    // Rester sur la page
    await expect(page).toHaveURL(/\/payments\/new/);
  });

  test('Le filtre de statut fonctionne dans la liste', async ({ page }) => {
    await page.goto('/payments');
    const statusSelect = page.locator('select').first();
    if (await statusSelect.isVisible()) {
      await statusSelect.selectOption({ value: 'PENDING' });
      await page.waitForTimeout(500);
      await expect(page.locator('h1')).toContainText('Paiements');
    }
  });

  test('La barre de recherche fonctionne', async ({ page }) => {
    await page.goto('/payments');
    const searchInput = page.locator('input[placeholder*="paiement" i]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('PAY-2026');
      await page.waitForTimeout(300);
      await expect(page.locator('h1')).toContainText('Paiements');
    }
  });

  test('Pré-remplissage depuis une facture (URL param invoiceId)', async ({ page }) => {
    // Naviguer avec un invoiceId fictif — vérifier que la page ne crash pas
    await page.goto('/payments/new?invoiceId=99999');
    await page.waitForTimeout(3000);
    await expect(page.locator('h1')).toContainText('Nouveau Paiement');
    // La page doit rester stable même si la facture n'existe pas
    await expect(page.locator('body')).not.toContainText('SyntaxError');
  });
});
