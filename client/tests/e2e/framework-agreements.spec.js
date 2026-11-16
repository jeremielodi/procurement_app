// Accord-cadre de bout en bout dans le navigateur : l'administrateur saisit le contrat (projet, bordereau, contrat signé)
// et le soumet ; le chef de projet le retrouve depuis « Mes tâches » et le valide ; le directeur général l'active.
import { test, expect } from '@playwright/test';
import { getToken, auth } from '../api/helpers.js';

test('Accord-cadre : saisie, validation par le chef de projet puis le DG', async ({ page, browser, request, baseURL }) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36).toUpperCase();
  const H = auth(await getToken(request));
  const password = 'Secret123!';
  const mkUser = async (prefix, firstName, profileIds) => {
    const email = `${prefix}.${stamp.toLowerCase()}@procurement.com`;
    const r = await request.post('/api/users', { headers: H, data: { username: `${prefix}${stamp}`, email, password, firstName, lastName: stamp, profileIds } });
    expect(r.status(), await r.text()).toBe(201);
    return { id: (await r.json()).data.id, email };
  };
  const pm = await mkUser('e2eacpm', 'Chef', ['prof_requester']);
  const dg = await mkUser('e2eacdg', 'Directeur', ['prof_dg']);
  const project = (await (await request.post('/api/projects/', { headers: H, data: { code: `E2E-AC-${stamp}`, name: `Projet E2E AC ${stamp}`, projectManagerId: pm.id } })).json()).data;
  const supplier = (await (await request.post('/api/suppliers', { headers: H, data: { name: `E2E AC Fournisseur ${stamp}`, email: `e2e.ac.${stamp.toLowerCase()}@nowhere.test`, status: 'ACTIVE', prequalified: true } })).json()).data;

  // 1. Saisie par l'administrateur (session de la configuration e2e)
  await page.goto('/framework-agreements/new');
  await page.fill('[data-testid=agreement-title]', `Papeterie E2E ${stamp}`);
  await page.locator('select[data-testid=agreement-supplier]').selectOption(String(supplier.id), { force: true });
  await page.fill('[data-testid=agreement-reference]', `CTR-${stamp}`);
  await page.fill('[data-testid=agreement-ceiling]', '5000');
  await page.locator('select[data-testid=agreement-project-add]').selectOption(project.id, { force: true });
  await expect(page.getByTestId('agreement-projects')).toContainText(`E2E-AC-${stamp}`);
  await page.fill('[data-testid=agreement-item-description]', 'Rame de papier A4');
  await page.fill('[data-testid=agreement-item-price]', '6.5');
  await page.fill('[data-testid=agreement-item-max]', '500');
  await page.setInputFiles('[data-testid=agreement-file]', { name: 'contrat.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.click('[data-testid=agreement-save]');
  await expect(page.getByTestId('agreement-submit')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('agreement-attachments')).toContainText('contrat.pdf');
  await page.click('[data-testid=agreement-submit]');
  await page.getByRole('button', { name: 'Soumettre à validation' }).last().click();
  await expect(page.getByTestId('agreement-status').first()).toHaveText('En validation');
  await expect(page.getByTestId('agreement-step-PROJECT_MANAGER')).toContainText(`E2E-AC-${stamp}`);
  const detailUrl = page.url();

  const login = async (user) => {
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const p = await ctx.newPage();
    await p.goto('/login');
    await p.fill('input[name="email"]', user.email);
    await p.fill('input[name="password"]', password);
    await p.click('button[type="submit"]');
    await expect(p).not.toHaveURL(/\/login/, { timeout: 15_000 });
    return { ctx, p };
  };

  // 2. Chef de projet : bandeau de « Mes tâches » → onglet « À valider » → validation
  const chef = await login(pm);
  await chef.p.goto('/tasks');
  await chef.p.getByTestId('tasks-agreements-to-validate').click();
  await expect(chef.p).toHaveURL(/scope=toValidate/);
  await chef.p.getByRole('link', { name: /^AC-/ }).first().click();
  await chef.p.click('[data-testid=agreement-approve]');
  await chef.p.fill('[data-testid=agreement-dialog-reason]', 'Prix conformes au marché');
  await chef.p.getByRole('button', { name: 'Valider' }).last().click();
  await expect(chef.p.getByTestId('agreement-step-DG')).toContainText('en attente');
  await chef.ctx.close();

  // 3. Directeur général : activation
  const director = await login(dg);
  await director.p.goto(new URL(detailUrl).pathname);
  await director.p.click('[data-testid=agreement-approve]');
  await director.p.getByRole('button', { name: 'Valider' }).last().click();
  await expect(director.p.getByTestId('agreement-status').first()).toHaveText('Actif');
  await expect(director.p.getByTestId('agreement-activated')).toContainText('Directeur');
  await expect(director.p.getByTestId('agreement-history')).toContainText('Prix conformes au marché');
  await director.ctx.close();
});
