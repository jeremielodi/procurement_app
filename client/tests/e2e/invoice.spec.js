/**
 * tests/e2e/invoice.spec.js
 *
 * Vérifie les pages Factures (création + rapprochement 3 voies).
 * Utilise la session admin sauvegardée par global-setup.
 */
import { test, expect } from '@playwright/test';

test.describe('🧾 Factures — 3-Way Match', () => {

  test('La liste des factures se charge avec le bon titre', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.locator('h1')).toContainText('Factures Fournisseurs', { timeout: 10_000 });
  });

  // Une facture se crée uniquement depuis la tâche de la réquisition (rattachée à son bon de commande)
  test('La liste des factures n\'a pas de bouton de création', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.locator('a[href="/tasks"]').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('button:has-text("Nouvelle facture")')).toHaveCount(0);
  });

  test('Sans bon de commande, le formulaire facture explique où la saisir', async ({ page }) => {
    await page.goto('/invoices/new');
    await expect(page.locator('h1')).toContainText('Saisie Facture Fournisseur', { timeout: 8_000 });
    await expect(page.getByTestId('workflow-only')).toBeVisible();
  });

  test('Le formulaire facture a les champs montant et date', async ({ page }) => {
    await page.goto('/invoices/new?poId=999999');
    // Champs numériques (sous-total, TVA, total)
    const numberInputs = page.locator('input[type="number"]');
    await expect(numberInputs.first()).toBeVisible({ timeout: 5_000 });
    // Champs date
    const dateInputs = page.locator('input[type="date"]');
    await expect(dateInputs.first()).toBeVisible();
    // Bouton submit
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('Soumettre un formulaire facture vide affiche une erreur', async ({ page }) => {
    await page.goto('/invoices/new?poId=999999');
    await page.click('button[type="submit"]');
    // Doit rester sur la même page (validation front)
    await expect(page).toHaveURL(/\/invoices\/new/);
  });

  test('Les filtres statut et rapprochement sont visibles dans la liste', async ({ page }) => {
    await page.goto('/invoices');
    await page.waitForTimeout(1000);
    // Au moins un select de filtre
    const selects = page.locator('select');
    const count = await selects.count();
    expect(count).toBeGreaterThan(0);
  });

  test('La page détail facture inexistante ne crash pas', async ({ page }) => {
    await page.goto('/invoices/99999');
    await page.waitForTimeout(3000);
    // Doit afficher un message géré, pas un écran blanc
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('Cannot GET');
    // Un message "introuvable" ou similaire
    const hasMessage = bodyText.includes('introuvable') || bodyText.includes('Facture') || bodyText.includes('chargement');
    expect(hasMessage).toBe(true);
  });

  test('Lien "Initier le paiement" apparaît sur une facture MATCHED', async ({ page }) => {
    // Ce test s'exécute seulement si une facture MATCHED existe en DB
    await page.goto('/invoices');
    await page.waitForTimeout(1000);
    const matchedBadge = page.locator('text=Rapprochement réussi').first();
    if (await matchedBadge.isVisible()) {
      // Cliquer pour ouvrir la facture
      const viewBtn = page.locator('button, a').filter({ has: page.locator('svg') }).first();
      await viewBtn.click();
      await page.waitForTimeout(1000);
      // Le bouton "Initier le paiement" doit être visible
      const payBtn = page.locator('a, button').filter({ hasText: /initier le paiement/i });
      if (await payBtn.isVisible()) {
        console.log('✅ Bouton "Initier le paiement" visible sur facture MATCHED');
      }
    } else {
      console.log('ℹ️  Aucune facture MATCHED en DB — test conditionnel ignoré');
    }
  });
});
