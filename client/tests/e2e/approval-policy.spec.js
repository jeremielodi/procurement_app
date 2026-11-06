// Seuils d'approbation par projet (bons de commande) et chef de projet obligatoire : saisie sur la fiche du projet,
// puis « Validation : <chef de projet> » dans le formulaire de réquisition ; carte des seuils de « Mon entreprise ».
import { test, expect } from '@playwright/test';
import { getToken, getApproverId, auth } from '../api/helpers.js';

test('Projet avec chef de projet et seuils propres → validateur affiché dans le formulaire de réquisition', async ({ page, request }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const approverId = await getApproverId(request); // « Approbateur Tests », chef du projet créé ici
  const code = `E2E-SP-${stamp}`;
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Nouveau projet' }).first().click();
  const form = page.locator('form').filter({ has: page.getByTestId('project-approval-policy') });
  await form.locator('input[placeholder="Ex : PROJ-001"]').fill(code);
  await form.locator('input[type="text"]').nth(1).fill(`Projet seuils ${stamp}`);
  await page.getByTestId('project-approval-policy-custom').check();
  await form.locator('input[name="approvalN1Max"]').fill('1000');
  await form.locator('input[name="approvalN2Max"]').fill('500');
  await expect(page.getByTestId('project-approval-policy')).toContainText('Le seuil N2 doit être supérieur ou égal au seuil N1');
  await form.locator('input[name="approvalN2Max"]').fill('5000');
  await expect(page.getByTestId('project-approval-policy-summary')).toContainText('N1 en dessous de 1');
  // Chef de projet obligatoire (il valide les réquisitions du projet)
  await form.getByTestId('project-manager').selectOption(approverId);
  await form.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByText('Projet créé')).toBeVisible();

  // Politique enregistrée côté serveur
  const admin = await getToken(request);
  const project = (await (await request.get(`/api/projects?search=${code}`, { headers: auth(admin) })).json()).data.find(p => p.code === code);
  expect(project).toBeTruthy();
  const policy = (await (await request.get(`/api/projects/${project.id}/approval-policy`, { headers: auth(admin) })).json()).data;
  expect(policy).toEqual({ n1Max: 1000, n2Max: 5000, source: 'PROJECT' });

  expect(project.project_manager_id).toBe(approverId);

  // Formulaire de réquisition : la réquisition sera validée par le chef de ce projet
  await page.goto('/requisitions/new');
  await page.locator('select').filter({ has: page.locator(`option[value="${project.id}"]`) }).selectOption(project.id);
  await expect(page.getByTestId('expected-approver')).toHaveText('Validation : Approbateur Tests (chef de projet)');
});

test('« Mon entreprise » : carte des seuils d\'approbation', async ({ page }) => {
  await page.goto('/settings/enterprise');
  const card = page.getByTestId('enterprise-approval-policy-card');
  await expect(card).toContainText('Seuils d\'approbation');
  await expect(card).toContainText('N1 en dessous de 25');
});
