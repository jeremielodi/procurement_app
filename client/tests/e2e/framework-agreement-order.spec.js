// Commande sur accord-cadre dans le navigateur (requiert BpmnGo) : l'agent achats choisit « Commande sur accord-cadre »
// et le contrat dans la fenêtre de méthode ; le formulaire du bon de commande impose le fournisseur et les prix du
// bordereau et signale une ligne hors bordereau ; le bon créé renvoie au contrat.
import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, getApproverId, auth, pmApproval, waitForProcessTask, PDF_BUFFER } from '../api/helpers.js';

test('Commande sur accord-cadre : méthode, bon de commande aux prix du contrat', async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36).toUpperCase();
  const admin = await getToken(request);
  const approver = await getApproverToken(request);
  const H = auth(admin);
  const year = new Date().getFullYear();

  const dgEmail = `e2eacodg.${stamp.toLowerCase()}@procurement.com`;
  await request.post('/api/users', { headers: H, data: { username: `e2eacodg${stamp}`, email: dgEmail, password: 'Secret123!', firstName: 'DG', lastName: stamp, profileIds: ['prof_dg'] } });
  const dg = (await (await request.post('/api/auth/login', { data: { email: dgEmail, password: 'Secret123!' } })).json()).data.token;
  const project = (await (await request.post('/api/projects/', { headers: H, data: { code: `E2E-ACO-${stamp}`, name: `Projet E2E commandes AC ${stamp}`, projectManagerId: await getApproverId(request) } })).json()).data;
  const supplier = (await (await request.post('/api/suppliers', { headers: H, data: { name: `E2E ACO Fournisseur ${stamp}`, email: `e2e.aco.${stamp.toLowerCase()}@nowhere.test`, status: 'ACTIVE', prequalified: true } })).json()).data;
  const agreement = (await (await request.post('/api/framework-agreements', { headers: H, data: {
    title: `Papeterie ${stamp}`, supplierId: supplier.id, startDate: `${year}-01-01`, endDate: `${year + 1}-12-31`, ceilingAmount: 5000, currencyId: 1,
    projectIds: [project.id], allowOffList: false, items: [{ description: 'Rame A4', unitPrice: 5 }],
  } })).json()).data;
  await request.post('/api/upload', { headers: H, multipart: { entity_type: 'framework_agreement', entity_id: agreement.id, file: { name: 'contrat.pdf', mimeType: 'application/pdf', buffer: PDF_BUFFER } } });
  await request.post(`/api/framework-agreements/${agreement.id}/submit`, { headers: H });
  await request.post(`/api/framework-agreements/${agreement.id}/decision`, { headers: auth(approver), data: { decision: 'APPROVE' } });
  expect((await (await request.post(`/api/framework-agreements/${agreement.id}/decision`, { headers: auth(dg), data: { decision: 'APPROVE' } })).json()).data.status).toBe('ACTIVE');

  const line = (await (await request.post('/api/budget', { headers: H, data: { entityCode: `E2E-ACO-${stamp}`, description: 'E2E', allocatedAmount: 100000, projectId: project.id } })).json()).data;
  const requisition = (await (await request.post('/api/requisitions', { headers: H, data: { submit: true,
    title: `[E2E AC] ${stamp}`, description: 'E2E', projectId: project.id, estimatedAmount: 240, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'E2E',
    items: [{ description: 'Rame A4', quantity: 40, frequency: 1, unitPrice: 4, budgetLineId: line.id }, { description: 'Agrafeuse', quantity: 2, frequency: 1, unitPrice: 40, budgetLineId: line.id }],
  } })).json()).data;
  const pmStep = await waitForProcessTask(request, admin, requisition.id, 'Activity_ProjectManagerApproval');
  test.skip(!pmStep, 'BpmnGo indisponible');
  await request.post(`/api/tasks/${pmStep.task.id}/complete`, { headers: auth(approver), data: { variables: await pmApproval(request, { comment: 'OK' }) } });
  const methodStep = await waitForProcessTask(request, admin, requisition.id, 'Activity_DetermineType');
  await request.post(`/api/tasks/${methodStep.task.id}/claim`, { headers: H, data: {} });

  // Fenêtre « Méthode d'achat » : accord-cadre proposé, contrat choisi
  await page.goto(`/requisitions/${requisition.id}/tasks`);
  await page.getByTestId('task-process').first().click();
  await page.getByTestId('method-FRAMEWORK_AGREEMENT').check();
  await expect(page.getByTestId('method-multi-supplier')).toBeDisabled();
  await page.locator('select[data-testid=method-framework-agreement]').selectOption(agreement.id, { force: true });
  await expect(page.getByTestId('method-agreement-info')).toContainText(`Papeterie ${stamp}`);
  await page.getByRole('button', { name: 'Valider', exact: true }).last().click();

  // Étape suivante : directement « Créer le bon de commande »
  const create = await waitForProcessTask(request, admin, requisition.id, 'Activity_CreatePO');
  expect(create).toBeTruthy();
  await page.goto(`/purchase-orders/${requisition.id}/${create.task.id}`);
  await expect(page.getByTestId('po-agreement-banner')).toContainText(agreement.agreementNumber);
  await expect(page.locator('select').first()).toHaveValue(String(supplier.id));
  const prices = page.getByTestId('po-item-price');
  await expect(prices.first()).toHaveValue('5'); // prix du bordereau (4 sur la réquisition)
  await expect(page.getByTestId('po-item-off-list')).toHaveCount(1); // agrafeuse hors bordereau, refusée
  await expect(page.getByTestId('po-agreement-off-list-warning')).toBeVisible();

  // Ligne hors bordereau retirée → bon créé sur le contrat
  await page.locator('tbody tr').nth(1).getByRole('button').click();
  await page.getByRole('button', { name: 'Créer le bon de commande' }).click();
  await expect(page).toHaveURL(/\/purchase-orders\/\d+/, { timeout: 15_000 });
  await expect(page.getByTestId('po-framework-agreement')).toContainText(agreement.agreementNumber);
});
