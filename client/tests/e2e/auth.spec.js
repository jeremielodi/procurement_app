/**
 * tests/e2e/auth.spec.js
 * Tests E2E — Authentification (sans état de session pré-sauvegardé)
 */
import { test, expect } from '@playwright/test';

const EMAIL    = 'admin@procurement.com';
const PASSWORD = 'Admin123!';

// Ces tests ne dépendent pas du global-setup (pas de storageState)
test.use({ storageState: undefined });

test.describe('🔐 Authentification', () => {

  test('Login avec identifiants valides → redirect /dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText('Procurement System');

    await page.fill('input[name="email"]',    EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('Login avec mauvais mot de passe → reste sur /login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]',    EMAIL);
    await page.fill('input[name="password"]', 'mauvais-mot-de-passe');
    await page.click('button[type="submit"]');

    // Le bouton doit repasser en état normal (non-loading)
    await expect(page.locator('button[type="submit"]')).not.toContainText('Connexion...', { timeout: 5_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('Route protégée sans session → redirect /login', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  });

  test('Déconnexion via sidebar → retour sur /login', async ({ page }) => {
    // Login d'abord
    await page.goto('/login');
    await page.fill('input[name="email"]',    EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    // Ouvrir le menu profil et se déconnecter
    await page.click('button:has-text("Mon compte")');
    await page.click('button:has-text("Déconnexion")');

    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});
