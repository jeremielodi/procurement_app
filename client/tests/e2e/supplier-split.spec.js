// Réquisition répartie entre plusieurs fournisseurs — écrans :
//  - fenêtre « Déterminer la méthode d'achat » : case « Répartir entre plusieurs fournisseurs » (désactivée pour un AO)
//  - page « Répartition par fournisseur » : un fournisseur par article, pro-forma par fournisseur, validation
//  - onglet tâches : une étape « Créer le bon de commande » par part, libellé de la part ; fiche : répartition
//  - centre d'aide : rubrique « Méthode d'achat » › « Répartir entre plusieurs fournisseurs »
// Requiert GoFlow (sinon le test s'ignore).
import { test, expect } from '@playwright/test';
import { getApproverToken, auth, PDF_BUFFER } from '../api/helpers.js';

const ITEMS = ['Ramettes A4', 'Classeurs', 'Stylos', 'Cartouches', 'Agrafeuses'];

async function api(page) {
  await page.goto('/requisitions');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  return { token, H: auth(token) };
}

async function openTasks(page, H, pid) {
  const res = await page.request.get(`/api/tasks/process/${pid}`, { headers: H });
  return res.ok() ? ((await res.json()).data || []).filter(t => t.status !== 'COMPLETED') : [];
}

async function waitForTask(page, H, pid, key, count = 1) {
  let tasks = [];
  await expect.poll(async () => {
    tasks = (await openTasks(page, H, pid)).filter(t => t.taskDefinitionKey === key);
    return tasks.length;
  }, { timeout: 60_000, intervals: [2000] }).toBeGreaterThanOrEqual(count);
  return tasks;
}

test('Répartition de 5 articles entre 3 fournisseurs depuis l\'onglet tâches', async ({ page }) => {
  test.setTimeout(180_000);
  const { H } = await api(page);
  const [depts, projects, suppliers] = await Promise.all([
    page.request.get('/api/departments', { headers: H }).then(r => r.json()).then(b => b.data || []),
    page.request.get('/api/projects', { headers: H }).then(r => r.json()).then(b => b.data || []),
    page.request.get('/api/suppliers', { headers: H, params: { forPurchaseOrder: 1 } }).then(r => r.json()).then(b => b.data || []),
  ]);
  test.skip(suppliers.length < 3, 'Il faut au moins trois fournisseurs actifs');
  const line = (await (await page.request.post('/api/budget', { headers: H, data: {
    entityCode: `BL-SPLIT-E2E-${Date.now()}`, description: 'Ligne e2e répartition', allocatedAmount: 1000000, projectId: projects[0].id,
  } })).json()).data;
  const created = await page.request.post('/api/requisitions', { headers: H, data: {
    title: `[E2E REPARTITION] ${Date.now()}`, description: 'Répartition', departmentId: depts[0].id, projectId: projects[0].id,
    estimatedAmount: 4500, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'Test e2e',
    items: ITEMS.map(description => ({ description, quantity: 1, frequency: 1, unitPrice: 900, budgetLineId: line?.id ?? line })),
  } });
  expect(created.status()).toBe(201);
  let req = (await created.json()).data;
  await expect.poll(async () => {
    req = (await (await page.request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data;
    return req.process_instance_id || null;
  }, { timeout: 15_000 }).toBeTruthy().catch(() => {});
  test.skip(!req.process_instance_id, 'GoFlow indisponible');

  const approver = auth(await getApproverToken(page.request));
  const [n1] = await waitForTask(page, H, req.process_instance_id, 'Activity_ValidationN1_Manager');
  expect((await page.request.post(`/api/tasks/${n1.id}/complete`, { headers: approver, data: { variables: { approved: true } } })).status()).toBe(200);
  await waitForTask(page, H, req.process_instance_id, 'Activity_DetermineType');

  // Fenêtre de la méthode : case de répartition, désactivée pour un appel d'offres
  await page.goto(`/requisitions/${req.id}/tasks`);
  const methodCard = page.locator('div.p-6', { hasText: 'Déterminer la méthode d\'achat' }).first();
  await methodCard.getByRole('button', { name: 'Prendre en charge' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Confirmer|Prendre en charge/ }).last().click();
  await methodCard.getByRole('button', { name: /Traiter/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Appel d'offres/).check();
  await expect(dialog.getByTestId('method-multi-supplier')).toBeDisabled();
  await dialog.getByLabel('Achat direct').check();
  await dialog.getByTestId('method-multi-supplier').check();
  await dialog.getByRole('button', { name: /Valider|Terminer|Compléter/ }).last().click();

  // Page de répartition : 1 / 2 / 2
  const [allocation] = await waitForTask(page, H, req.process_instance_id, 'Activity_AllocateSuppliers');
  await page.goto(`/requisitions/${req.id}/allocation?taskId=${allocation.id}`);
  await expect(page.getByTestId('split-item-row')).toHaveCount(5);
  const selects = page.getByTestId('split-item-supplier');
  const plan = [0, 1, 1, 2, 2];
  for (const [i, s] of plan.entries()) await selects.nth(i).selectOption(String(suppliers[s].id));
  await expect(page.getByTestId('split-unassigned')).toHaveCount(0);
  await expect(page.getByTestId('split-lot')).toHaveCount(3);
  const files = page.getByTestId('split-lot-proforma');
  for (let i = 0; i < 3; i++) await files.nth(i).setInputFiles({ name: `proforma-${i}.pdf`, mimeType: 'application/pdf', buffer: PDF_BUFFER });
  await page.getByTestId('split-submit').click();
  await expect(page).toHaveURL(new RegExp(`/requisitions/${req.id}/tasks`));

  // Une étape « Créer le bon de commande » par part, avec le fournisseur
  await waitForTask(page, H, req.process_instance_id, 'Activity_CreatePO', 3);
  await page.reload();
  const lotLabels = page.getByTestId('task-lot');
  await expect(lotLabels).toHaveCount(3);
  for (const s of suppliers.slice(0, 3)) await expect(lotLabels.filter({ hasText: s.name })).toHaveCount(1);

  // Fiche de la réquisition : répartition par fournisseur
  await page.goto(`/requisitions/${req.id}`);
  await expect(page.getByTestId('supplier-lots-panel')).toBeVisible();
  await expect(page.getByTestId('supplier-lot-row')).toHaveCount(3);
});

test('Centre d\'aide : répartition entre plusieurs fournisseurs', async ({ page }) => {
  await page.goto('/requisitions');
  await page.getByRole('button', { name: /aide|guide/i }).first().click();
  // Le panneau s'ouvre sur la rubrique de l'écran (Réquisitions) : passer par le sommaire
  const help = page.getByRole('dialog', { name: 'Guide d\'utilisation' });
  await help.getByRole('button', { name: 'Sommaire' }).click();
  await help.getByRole('button', { name: /Méthode d'achat/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Répartir entre plusieurs fournisseurs' })).toBeVisible();
});
