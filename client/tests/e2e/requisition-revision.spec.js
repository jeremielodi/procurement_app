// Correction d'une réquisition côté demandeur : bandeau « À corriger » avec le motif, formulaire de correction
// pré-rempli, « Soumettre à nouveau » → version 2 et changements dans l'onglet « Versions » ; retrait avant prise en
// charge de l'approbation. La session e2e (admin@procurement.com) est le demandeur ; l'approbateur agit par l'API.
import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth } from '../api/helpers.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function setup(request) {
  const admin = await getToken(request);
  const approver = await getApproverToken(request);
  const H = auth(admin);
  const stamp = Date.now().toString(36);
  const [dept] = (await (await request.get('/api/departments', { headers: H })).json()).data;
  const [project] = (await (await request.get('/api/projects', { headers: H })).json()).data;
  const line = (await (await request.post('/api/budget', { headers: H, data: {
    entityCode: `E2E-REV-${stamp}`, description: 'Ligne e2e correction', allocatedAmount: 1_000_000, projectId: project.id,
  } })).json()).data;
  const req = (await (await request.post('/api/requisitions', { headers: H, data: {
    title: `[E2E CORRECTION] ${stamp}`, description: 'x', departmentId: dept.id, projectId: project.id, currencyId: 1, currencyCode: 'USD',
    priority: 'MEDIUM', justification: 'x', items: [{ description: 'Cartouches', quantity: 2, frequency: 1, unitPrice: 50, budgetLineId: line.id }],
  } })).json()).data;
  // Tâche d'approbation N1 (BpmnGo)
  let task = null;
  for (let i = 0; i < 30 && !task; i++) {
    const r = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data;
    if (r?.process_instance_id) {
      const tasks = (await (await request.get(`/api/tasks/process/${r.process_instance_id}`, { headers: H })).json()).data || [];
      task = tasks.find(tk => tk.status !== 'COMPLETED' && tk.taskDefinitionKey === 'Activity_ValidationN1_Manager') || null;
    }
    if (!task) await sleep(1500);
  }
  return { admin, approver, req, task };
}

test('Renvoyée pour correction : motif affiché, correction puis nouvelle soumission (version 2)', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { approver, req, task } = await setup(request);
  test.skip(!task, 'BpmnGo indisponible');
  const done = await request.post(`/api/tasks/${task.id}/complete`, { headers: auth(approver), data: {
    variables: { returnedForCorrection: true, comment: 'Précisez la référence des cartouches' },
  } });
  expect(done.status()).toBe(200);

  await page.goto(`/requisitions/${req.id}`);
  const banner = page.getByTestId('revision-banner');
  await expect(banner).toContainText('Votre réquisition est à corriger', { timeout: 15_000 });
  await expect(banner).toContainText('Précisez la référence des cartouches');
  await page.getByTestId('revision-edit').click();

  await expect(page.getByRole('heading', { name: new RegExp(`Corriger la réquisition ${req.requisitionNumber || ''}`) })).toBeVisible();
  await expect(page.getByTestId('revision-form-reason')).toContainText('Précisez la référence des cartouches');
  const description = page.locator('input[name="items.0.description"]');
  await expect(description).toHaveValue('Cartouches');
  await description.fill('Cartouches HP 305 noir');
  await page.locator('input[name="items.0.quantity"]').fill('4');
  await page.getByTestId('resubmit-comment').fill('Référence ajoutée, quantité doublée');
  await page.getByTestId('revision-resubmit').click();

  await expect(page).toHaveURL(new RegExp(`/requisitions/${req.id}$`));
  await expect(page.getByTestId('revision-banner')).toHaveCount(0);
  await page.getByTestId('tab-versions').click();
  const versions = page.getByTestId('requisition-versions');
  await expect(versions).toContainText('Version 2');
  await expect(versions).toContainText('Référence ajoutée, quantité doublée');
  await expect(versions).toContainText('Cartouches HP 305 noir');
  await expect(versions).toContainText('Renvoyée pour correction');
});

test('Retrait par le demandeur avant prise en charge de l\'approbation', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { req, task } = await setup(request);
  test.skip(!task, 'BpmnGo indisponible');
  await page.goto(`/requisitions/${req.id}`);
  await page.getByTestId('revision-withdraw').click();
  await page.getByTestId('revision-reason').fill('Je dois ajouter un article');
  await page.getByRole('button', { name: 'Retirer pour corriger' }).last().click();
  const banner = page.getByTestId('revision-banner');
  await expect(banner).toContainText('Votre réquisition est à corriger', { timeout: 15_000 });
  await expect(banner).toContainText('Je dois ajouter un article');
});
