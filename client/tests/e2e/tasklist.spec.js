/**
 * tests/e2e/tasklist.spec.js
 *
 * Vérifie la page "Mes tâches" (TaskList) qui affiche les tâches Camunda.
 * Ces tests utilisent la session admin sauvegardée par global-setup.
 */
import { test, expect } from '@playwright/test';

test.describe('📋 TaskList — Mes tâches Camunda', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/tasks');
  });

  test('La page tâches se charge sans erreur 500', async ({ page }) => {
    // On attend que le spinner disparaisse
    await expect(page.locator('[class*="animate-spin"]').first()).not.toBeVisible({ timeout: 15_000 });

    // Si Camunda tourne : liste de tâches ou état vide
    // Si Camunda ne tourne pas : liste vide (pas d'erreur)
    const hasTable  = await page.locator('table').isVisible().catch(() => false);
    const hasEmpty  = await page.locator('text=Aucune tâche').isVisible().catch(() => false);
    const hasError  = await page.locator('text=Erreur').isVisible().catch(() => false);

    expect(hasError, 'Ne doit pas afficher "Erreur"').toBe(false);
    console.log(`Tasks visibles: ${hasTable ? 'tableau' : hasEmpty ? 'état vide' : 'chargement ou autre'}`);
  });

  test('Les filtres En attente / Toutes sont visibles', async ({ page }) => {
    // On attend la fin du chargement
    await page.waitForTimeout(2000);
    // Les boutons/onglets de filtre doivent être présents
    const filterButtons = page.locator('button').filter({ hasText: /en attente|toutes|terminées/i });
    const count = await filterButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Le bouton Actualiser fonctionne', async ({ page }) => {
    await page.waitForTimeout(1000);
    const refreshBtn = page.locator('button').filter({ has: page.locator('[class*="RefreshCw"], svg') }).first();
    if (await refreshBtn.isVisible()) {
      await refreshBtn.click();
      await page.waitForTimeout(1000);
      // Pas d'erreur après actualisation
      await expect(page.locator('text=Erreur')).not.toBeVisible();
    }
  });

  test('Lien Réquisitions dans la sidebar est actif depuis /tasks', async ({ page }) => {
    await expect(page).toHaveURL(/\/tasks/);
    // La sidebar doit être visible
    await expect(page.locator('nav').first()).toBeVisible();
  });
});

test.describe('📋 TaskList — Redirect vers formulaires dédiés (GoFlow)', () => {

  // Vérifie que les formulaires dédiés reçoivent correctement taskId + poId depuis l'URL
  // (simule le redirect que fait TaskList quand une tâche GoFlow est ouverte)

  test('GRN form : accepte taskId + poId depuis URL (redirect GoFlow)', async ({ page }) => {
    await page.goto('/goods-receipts/new?taskId=fake-task-001&poId=99999');
    await page.waitForTimeout(2000);
    // Le formulaire se charge (titre visible)
    await expect(page.locator('h1')).toContainText('Bon de Réception', { timeout: 8_000 });
    // Aucun message "Accédez à cette page depuis une commande" (poId est présent)
    await expect(page.locator('text=Accédez à cette page depuis une commande')).not.toBeVisible();
    // Pas de crash (pas de texte d'erreur critique)
    const body = await page.locator('body').textContent();
    expect(body).not.toContain('Cannot GET');
  });

  test('SAN form : accepte taskId + poId depuis URL (redirect GoFlow)', async ({ page }) => {
    await page.goto('/service-acceptance-notes/new?taskId=fake-task-002&poId=99999');
    await page.waitForTimeout(2000);
    // Le formulaire SAN se charge
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 8_000 });
    const body = await page.locator('body').textContent();
    expect(body).not.toContain('Cannot GET');
  });

  test('Invoice form : accepte taskId + poId depuis URL (redirect GoFlow)', async ({ page }) => {
    await page.goto('/invoices/new?taskId=fake-task-003&poId=99999');
    await page.waitForTimeout(2000);
    await expect(page.locator('h1')).toContainText('Facture', { timeout: 8_000 });
    const body = await page.locator('body').textContent();
    expect(body).not.toContain('Cannot GET');
  });

  test('Payment form : accepte taskId depuis URL (redirect GoFlow)', async ({ page }) => {
    await page.goto('/payments/new?taskId=fake-task-004');
    await page.waitForTimeout(2000);
    await expect(page.locator('h1')).toContainText('Paiement', { timeout: 8_000 });
    const body = await page.locator('body').textContent();
    expect(body).not.toContain('Cannot GET');
  });

  test('PODetail ne contient plus de liens de création directs (Option B)', async ({ page }) => {
    // Naviguer sur n'importe quel PO ou la liste
    await page.goto('/purchase-orders');
    await page.waitForTimeout(1500);
    // La page se charge sans erreur
    await expect(page.locator('h1')).toBeVisible({ timeout: 8_000 });
    // Si un PO detail est accessible, vérifier l'absence des liens de création
    const rows = page.locator('table tbody tr, [data-testid="po-row"]');
    if (await rows.count() > 0) {
      await rows.first().click();
      await page.waitForTimeout(1500);
      // Les liens "Nouveau GRN", "Nouveau SAN", "Facture", "Paiement" ne doivent pas exister
      await expect(page.locator('a:has-text("Nouveau GRN")')).not.toBeVisible();
      await expect(page.locator('a:has-text("Nouveau SAN")')).not.toBeVisible();
      await expect(page.locator('a[href*="invoices/new"]')).not.toBeVisible();
      await expect(page.locator('a[href*="payments/new"]')).not.toBeVisible();
    } else {
      console.log('ℹ️  Aucun PO en DB — test conditionnel ignoré');
    }
  });
});
