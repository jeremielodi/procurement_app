// Questions aux fournisseurs dans un appel d'offres — écrans :
//  - création de l'AO : liste de choix notée + Oui / Non, publication, questions sur la fiche
//  - portail fournisseur : réponse obligatoire contrôlée, envoi de l'offre avec les réponses
//  - fiche après la clôture : tableau des réponses et note technique
// Réquisition préparée par l'API.
import { test, expect } from '@playwright/test';
import { auth, supplierRegistration, firstReferenceIds } from '../api/helpers.js';

test('Questions aux fournisseurs : création, réponse sur le portail, note technique', async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  await page.goto('/tenders');
  const H = auth(await page.evaluate(() => localStorage.getItem('token')));
  const api = page.request;

  const { locationId, categoryId } = await firstReferenceIds(api);
  const reg = await api.post('/api/auth/register-supplier', { multipart: supplierRegistration({
    name: `E2E Questions ${stamp}`, email: `e2e.questions.${stamp}@example.com`, locationIds: [locationId], categoryIds: [categoryId],
  }) });
  expect(reg.status()).toBe(201);
  const supplierToken = (await reg.json()).data.token;

  const projects = await api.get('/api/projects', { headers: H }).then(r => r.json()).then(b => b.data || []);
  const line = (await (await api.post('/api/budget', { headers: H, data: {
    entityCode: `BL-E2E-AOQ-${stamp}`, description: 'e2e', allocatedAmount: 1000000, projectId: projects[0].id,
  } })).json()).data;
  const req = (await (await api.post('/api/requisitions', { headers: H, data: { submit: true,
    title: `[E2E AO QUESTIONS] ${stamp}`, description: 'e2e', projectId: projects[0].id,
    estimatedAmount: 30000, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'e2e',
    items: [{ description: 'Imprimante réseau', quantity: 2, frequency: 1, unitPrice: 15000, budgetLineId: line?.id ?? line }],
  } })).json()).data;

  // ---- Création de l'AO avec deux questions ----
  await page.goto(`/tenders/new?requisitionId=${req.id}`);
  await page.fill('#tenderNumber', `AO-E2E-Q-${stamp}`);
  await page.getByTestId('add-question').click();
  let card = page.getByTestId('question-card').nth(0);
  await card.getByTestId('question-label').fill('Garantie proposée');
  await card.getByTestId('question-type').selectOption('CHOICE');
  await card.getByTestId('option-label').nth(0).fill('24 mois');
  await card.getByTestId('option-score').nth(0).fill('10');
  await card.getByTestId('option-label').nth(1).fill('12 mois');
  await card.getByTestId('option-score').nth(1).fill('5');
  await card.getByTestId('add-option').click();
  await card.getByTestId('option-label').nth(2).fill('Aucune');
  await expect(page.getByTestId('questions-total-points')).toContainText('10 points');

  await page.getByTestId('add-question').click();
  card = page.getByTestId('question-card').nth(1);
  await card.getByTestId('question-label').fill('Service après-vente à Kinshasa ?');
  await card.getByTestId('question-type').selectOption('YES_NO');

  await page.getByRole('button', { name: /Publier/ }).click();
  await expect(page).toHaveURL(/\/tenders\/\d+$/);
  const tenderId = page.url().match(/\/tenders\/(\d+)$/)[1];
  await expect(page.getByTestId('tender-questions-list').locator('li')).toHaveCount(2);

  // ---- Portail fournisseur ----
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: 'token', value: supplierToken }] }] } });
  const sp = await ctx.newPage();
  await sp.goto(`/supplier/tenders/${tenderId}`);
  await expect(sp.getByTestId('supplier-question')).toHaveCount(2);
  await sp.getByLabel('Prix Imprimante réseau').fill('14000');
  await sp.fill('#deliveryDays', '10');
  await sp.getByRole('button', { name: /Soumettre/ }).click();
  await expect(sp.getByText('Répondez à la question « Garantie proposée »').first()).toBeVisible(); // obligatoire, contrôlée avant l'envoi

  const questions = sp.getByTestId('supplier-question');
  await questions.nth(0).locator('select').selectOption({ label: '12 mois' });
  await questions.nth(1).getByLabel('Oui').check();
  await sp.getByRole('button', { name: /Soumettre/ }).click();
  await expect(sp.getByText(/Dernière soumission/)).toBeVisible();
  await ctx.close();

  // ---- Fiche après la clôture ----
  expect((await api.post(`/api/tenders/${tenderId}/close`, { headers: H })).status()).toBe(200);
  await page.reload();
  const table = page.getByTestId('answers-table');
  await expect(table).toContainText('12 mois');
  await expect(table).toContainText('5 / 10 pt');
  await expect(page.getByTestId('technical-score')).toHaveText('50 %');

  await api.post(`/api/tenders/${tenderId}/cancel`, { headers: H });
});
