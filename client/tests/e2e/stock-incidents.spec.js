// Rapport d'incident : l'employé signale le vol d'un ordinateur depuis « Mes articles reçus », le chef de projet le valide
// (responsabilité engagée) ; l'ordinateur ne figure plus dans les détentions de l'employé.
import { test, expect } from '@playwright/test';
import { getToken, auth } from '../api/helpers.js';

test('Rapport d\'incident : déclaration par l\'employé, validation par le chef de projet', async ({ browser, request, baseURL }) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36).toUpperCase();
  const H = auth(await getToken(request));
  const json = async (r) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
  const locations = (await (await request.get('/api/public/locations')).json()).data;
  const cats = (await (await request.get('/api/public/market-categories')).json()).data;
  const wh = (await (await request.post('/api/warehouses', { headers: H, data: { code: `E2E-IN-${stamp}`, name: `Magasin E2E incidents ${stamp}`, locationId: locations[0].id } })).json()).data;
  const laptop = (await (await request.post('/api/stock-items', { headers: H, data: { code: `E2E-IN-${stamp}`, name: `Portable E2E ${stamp}`, unit: 'pce', categoryId: (cats.find(c => c.is_stockable) || cats[0]).id, trackSerials: true } })).json()).data;
  const password = 'Secret123!';
  const mkUser = async (prefix, firstName) => {
    const email = `${prefix}.${stamp.toLowerCase()}@procurement.com`;
    const r = await json(await request.post('/api/users', { headers: H, data: { username: `${prefix}${stamp}`, email, password, firstName, lastName: stamp, profileIds: ['prof_requester'] } }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { id: r.body.data.id, email, name: `${firstName} ${stamp}` };
  };
  const employee = await mkUser('e2einemp', 'Employe');
  const pm = await mkUser('e2einpm', 'Chef');
  const project = (await (await request.post('/api/projects/', { headers: H, data: { code: `E2E-IN-${stamp}`, name: `Projet E2E incidents ${stamp}`, projectManagerId: pm.id } })).json()).data;
  await request.post('/api/budget', { headers: H, data: { entityCode: `E2E-IN-${stamp}`, description: 'E2E incidents', allocatedAmount: 1000, projectId: project.id } });
  const serial = `E2E-SN-${stamp}`;
  expect((await json(await request.post('/api/stock-units/register', { headers: H, data: { stockItemId: laptop.id, warehouseId: wh.id, projectId: project.id, units: [{ serialNumber: serial }] } }))).status).toBe(201);
  const unitId = (await (await request.get(`/api/stock-units?stockItemId=${laptop.id}`, { headers: H })).json()).data[0].id;
  const issued = await json(await request.post('/api/stock-issues', { headers: H, data: { warehouseId: wh.id, destinationType: 'USER', recipientId: employee.id, purpose: 'Dotation', lines: [{ stockItemId: laptop.id, unitIds: [unitId] }] } }));
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);

  const login = async (user) => {
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.fill('input[name="email"]', user.email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    return { ctx, page };
  };

  // 1. L'employé signale le vol depuis « Mes articles reçus »
  const emp = await login(employee);
  let incidentUrl;
  try {
    const page = emp.page;
    await page.goto('/my-items');
    await page.getByTestId('holding-report-incident').first().click();
    await expect(page).toHaveURL(/\/stock\/incidents\/new\?lineId=/);
    await page.getByTestId('incident-type-STOLEN').click();
    await page.getByTestId('incident-place').fill('Marché de Goma');
    await page.getByTestId('incident-circumstances').fill('Sac volé au marché, plainte déposée le jour même.');
    await page.getByTestId('incident-police').fill(`PV-${stamp}`);
    await expect(page.getByTestId('incident-holding').first().locator('input[type="checkbox"]')).toBeChecked();
    await page.getByTestId('incident-submit').click();
    await expect(page).toHaveURL(/\/stock\/incidents\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    incidentUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId('incident-status')).toHaveText('En attente de validation');
    await expect(page.getByTestId('incident-awaiting')).toContainText(pm.name);
    await expect(page.getByTestId('incident-validate')).toHaveCount(0);
    await page.goto('/my-items');
    await expect(page.getByTestId('holding-incident-pending')).toBeVisible();
  } finally { await emp.ctx.close(); }

  // 2. Le chef de projet valide : responsabilité engagée
  const chef = await login(pm);
  try {
    const page = chef.page;
    await page.goto('/stock/incidents?scope=toValidate');
    await page.getByTestId('incident-row').filter({ hasText: employee.name }).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`${incidentUrl}$`));
    await page.getByTestId('incident-validate').click();
    await page.getByTestId('incident-liable-yes').check();
    await page.getByTestId('incident-dialog-reason').fill('Sac laissé sans surveillance');
    await page.getByRole('button', { name: 'Valider', exact: true }).last().click();
    await expect(page.getByTestId('incident-status')).toHaveText('Validé', { timeout: 15_000 });
    await expect(page.getByTestId('incident-decision')).toContainText('engagée');
  } finally { await chef.ctx.close(); }

  // 3. L'ordinateur n'est plus détenu : perdu
  const unit = (await (await request.get(`/api/stock-units/${unitId}`, { headers: H })).json()).data;
  expect(unit).toMatchObject({ status: 'LOST', holder_id: null });
});
