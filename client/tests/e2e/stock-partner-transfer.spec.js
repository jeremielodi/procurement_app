// Transfert vers un partenaire (migration 66), de bout en bout dans le navigateur :
// l'administrateur enregistre une zone de santé et crée le compte de son responsable (mot de passe obligatoire),
// envoie des articles depuis la fiche du partenaire ; le responsable se connecte à son espace, confirme la réception
// avec un manque ; la fiche du bon côté entreprise affiche la quantité reçue et la confirmation venue de l'espace partenaire.
import { test, expect } from '@playwright/test';
import { getToken, auth } from '../api/helpers.js';

test('Transfert vers un partenaire : enregistrer, envoyer, confirmer la réception dans l\'espace partenaire', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36).toUpperCase();
  const managerEmail = `mcz.e2e.${stamp.toLowerCase()}@nowhere.test`;
  const password = 'Secret123';
  const H = auth(await getToken(request));

  // Stock de départ (API) : un dépôt, un article, 20 unités
  const locations = (await (await request.get('/api/public/locations')).json()).data;
  const cats = (await (await request.get('/api/public/market-categories')).json()).data;
  const location = locations.find(l => l.code === 'GOMA') || locations[0];
  const warehouse = (await (await request.post('/api/warehouses', { headers: H, data: { code: `E2E-PT-${stamp}`, name: `Dépôt E2E ${stamp}`, locationId: location.id } })).json()).data;
  const item = (await (await request.post('/api/stock-items', { headers: H, data: { code: `E2E-PT-${stamp}`, name: `Moustiquaires E2E ${stamp}`, unit: 'pce', categoryId: (cats.find(c => c.is_stockable) || cats[0]).id } })).json()).data;
  expect((await request.post('/api/stock-adjustments', { headers: H, data: { warehouseId: warehouse.id, stockItemId: item.id, quantity: 20, reason: 'FOUND', comment: 'E2E' } })).status()).toBe(201);

  // 1. Enregistrer la zone de santé
  await page.goto('/stock/partners');
  await page.getByTestId('partner-new').click();
  await page.getByTestId('partner-code').fill(`ZS-E2E-${stamp}`);
  await page.getByTestId('partner-name').fill(`Zone de santé E2E ${stamp}`);
  await page.getByTestId('partner-partnerType').selectOption('HEALTH_ZONE');
  await page.getByTestId('partner-locationId').selectOption(String(location.id));
  await page.getByTestId('partner-contactName').fill('Jean Mukendi');
  await page.getByTestId('partner-contactTitle').fill('Médecin chef de zone');
  await page.getByTestId('partner-email').fill(managerEmail);
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByTestId('partner-search').fill(stamp);
  const row = page.getByTestId('partner-row').filter({ hasText: `ZS-E2E-${stamp}` });
  await expect(row).toContainText('Zone de santé');
  await expect(row).toContainText('Jean Mukendi');

  // 2. Compte du responsable : mot de passe obligatoire, saisi par l'administrateur (le compte ne dépend pas de l'email)
  await row.getByRole('link', { name: `Zone de santé E2E ${stamp}` }).click();
  await expect(page).toHaveURL(/\/stock\/partners\/[0-9a-f-]{36}$/);
  await page.getByTestId('partner-manager-account').click();
  await page.getByRole('button', { name: 'Créer l\'accès' }).click(); // sans mot de passe : refusé, la fenêtre reste ouverte
  await expect(page.getByText('Saisissez le mot de passe du compte')).toBeVisible();
  await page.getByTestId('account-generate-password').click();
  await expect(page.getByTestId('account-password')).toHaveValue(/^[A-Za-z0-9]{12}$/);
  await page.getByTestId('account-password').fill(password);
  await page.getByRole('button', { name: 'Créer l\'accès' }).click();
  await expect(page.getByTestId('partner-account')).toContainText(managerEmail);
  await expect(page.getByTestId('partner-manager-account')).toHaveCount(0);

  // 3. Envoyer des articles depuis la fiche (type et partenaire repris)
  await page.getByTestId('partner-send').click();
  await expect(page.getByTestId('issue-type-PARTNER')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('issue-warehouse').selectOption(warehouse.id);
  await page.getByPlaceholder('Code ou désignation…').fill(item.code);
  await page.getByRole('option', { name: new RegExp(item.code) }).click();
  await page.getByRole('spinbutton', { name: 'Quantité' }).fill('10');
  await page.getByRole('button', { name: /Enregistrer le transfert/ }).click();
  await expect(page).toHaveURL(/\/stock\/issues\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const issueUrl = new URL(page.url()).pathname;
  const issueId = issueUrl.split('/').pop();
  await expect(page.getByText('Vers un partenaire').first()).toBeVisible();
  await expect(page.getByText('En transit').first()).toBeVisible();
  await expect(page.getByText(`Zone de santé E2E ${stamp}`)).toBeVisible();

  // Le stock du dépôt a déjà diminué
  const balances = (await (await request.get(`/api/stock/balances?warehouseId=${warehouse.id}&stockItemId=${item.id}`, { headers: H })).json()).data;
  expect(balances.reduce((s, b) => s + Number(b.quantity), 0)).toBe(10);

  // 4. Le responsable se connecte à son espace et confirme la réception (8 reçus sur 10)
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const partner = await ctx.newPage();
  try {
    await partner.goto('/login');
    await partner.fill('input[name="email"]', managerEmail);
    await partner.fill('input[name="password"]', password);
    await partner.click('button[type="submit"]');
    await expect(partner).toHaveURL(/\/partner\/transfers$/, { timeout: 15_000 });
    await expect(partner.getByTestId('partner-count-pending')).toContainText('1');
    // Aucun accès au reste de l'application
    await partner.goto('/stock/partners');
    await expect(partner).toHaveURL(/\/partner\/transfers$/);

    await partner.getByTestId('partner-transfer-row').first().getByRole('link').click();
    await expect(partner).toHaveURL(new RegExp(`/partner/transfers/${issueId}$`));
    await partner.getByTestId('receive-lines').locator('input[type="number"]').fill('8');
    await partner.getByPlaceholder(/Commentaire/).fill('2 moustiquaires manquantes');
    await partner.getByTestId('partner-confirm-receipt').click();
    await expect(partner.getByText('Réceptionné avec manque')).toBeVisible({ timeout: 15_000 });
    await expect(partner.getByTestId('partner-confirm-receipt')).toHaveCount(0);

    await partner.goto('/partner/holdings');
    await expect(partner.getByTestId('partner-holding').filter({ hasText: item.code })).toContainText('8');
  } finally {
    await ctx.close();
  }

  // 5. Côté entreprise : quantité reçue, perte en transit, confirmation venue de l'espace partenaire
  await page.goto(issueUrl);
  await expect(page.getByText('Réceptionné avec manque')).toBeVisible();
  await expect(page.getByText('confirmée dans l\'espace partenaire')).toBeVisible();
  await expect(page.getByText('2 moustiquaires manquantes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Annuler le transfert' })).toHaveCount(0);
});
