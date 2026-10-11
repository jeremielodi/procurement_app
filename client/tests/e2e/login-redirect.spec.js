/**
 * tests/e2e/login-redirect.spec.js
 * Lien reçu par email vers une page de l'application : sans session, connexion puis retour à CETTE page
 * (/login?redirect=…) ; une adresse externe dans ?redirect= n'est jamais suivie.
 */
import { test, expect } from '@playwright/test';

const EMAIL = 'admin@procurement.com';
const PASSWORD = 'Admin123!';

async function signIn(page) {
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
}

test.describe('🔗 Retour à la page demandée après connexion', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // visiteur sans session (undefined hériterait de la session du projet)

  test('Lien profond sans session → connexion → page demandée (avec ses paramètres)', async ({ page }) => {
    const target = '/purchase-orders?status=PO_PENDING';
    await page.goto(target);
    await page.waitForURL(/\/login\?redirect=/, { timeout: 10_000 });
    expect(decodeURIComponent(new URL(page.url()).searchParams.get('redirect'))).toBe(target);
    await expect(page.getByTestId('login-redirect-hint')).toBeVisible();
    await signIn(page);
    await page.waitForURL(url => url.pathname === '/purchase-orders' && url.search === '?status=PO_PENDING', { timeout: 15_000 });
  });

  test('Adresse externe dans ?redirect= ignorée → accueil du compte', async ({ page }) => {
    await page.goto('/login?redirect=' + encodeURIComponent('https://example.com/piege'));
    await expect(page.getByTestId('login-redirect-hint')).toHaveCount(0);
    await signIn(page);
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await page.goto('/login?redirect=' + encodeURIComponent('//example.com'));
    await page.waitForURL('**/dashboard', { timeout: 10_000 }); // déjà connecté : accueil, jamais l'autre site
  });
});

test.describe('🔗 Déjà connecté', () => {
  test('/login?redirect= avec une session ouverte → directement la page demandée', async ({ page }) => {
    await page.goto('/login?redirect=' + encodeURIComponent('/suppliers'));
    await page.waitForURL(url => url.pathname === '/suppliers', { timeout: 10_000 });
  });
});
