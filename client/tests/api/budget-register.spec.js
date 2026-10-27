import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Registre budgétaire : liste paginée (GET /budget?page=), sources de financement, export Excel réimportable,
// modèle et import Excel / CSV (aperçu puis confirmation) — BudgetRegisterService.
test.describe.serial('API › Registre budgétaire (liste, export, import)', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const codeA = `IMP-A-${stamp}`;
  const codeB = `IMP-B-${stamp}`;
  let admin, project, createdIds = [];

  const csv = (rows) => Buffer.from('﻿' + rows.map(r => r.join(';')).join('\r\n') + '\r\n', 'utf8');
  const upload = (request, buffer, { confirm = false, name = 'budget.csv', token = admin } = {}) => request.post('/api/budget/import', {
    headers: auth(token),
    multipart: { file: { name, mimeType: name.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer }, ...(confirm ? { confirm: '1' } : {}) },
  });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const projects = (await (await request.get('/api/projects', { headers: auth(admin) })).json()).data;
    project = projects.find(p => p.code);
    expect(project, 'au moins un projet avec un code').toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    for (const id of createdIds) await request.delete(`/api/budget/${id}`, { headers: auth(admin) });
  });

  test('Modèle xlsx / csv', async ({ request }) => {
    const xlsx = await request.get('/api/budget/import/template?format=xlsx', { headers: auth(admin) });
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
    expect((await xlsx.body()).subarray(0, 2).toString()).toBe('PK'); // archive xlsx
    // Le modèle se relit : 2 lignes d'exemple (projet existant) prêtes à créer, aucune erreur
    const tpl = (await (await upload(request, await xlsx.body(), { name: 'modele.xlsx' })).json()).data;
    expect(tpl.summary.errors).toBe(0);
    expect(tpl.lines.map(l => l.entityCode)).toEqual(['EX-6110', 'EX-6230']);
    const en = await request.get('/api/budget/import/template?format=csv&lang=en', { headers: auth(admin) });
    expect((await en.text()).split('\r\n')[0]).toContain('Line code');
  });

  test('Aperçu : création, erreurs par ligne, rien n\'est écrit', async ({ request }) => {
    const res = await upload(request, csv([
      ['ID', 'Code projet', 'Code ligne', 'Description', 'Source de financement', 'Montant alloué', 'Active'],
      ['', project.code, codeA, 'Ligne importée A', 'EU', '1 500,50', 'Oui'],
      ['', project.code, codeB.toLowerCase(), 'Ligne importée B', 'USAID', '2000', ''],
      ['', 'PRJ-INCONNU-XYZ', 'X1', '', '', '10', ''],
      ['', project.code, codeA, 'même code : nouvelle ligne', '', '5', ''],
      ['', project.code, `IMP-C-${stamp}`, '', '', '', ''],
      ['', project.code, `IMP-D-${stamp}`, '', '', '-3', 'peut-être'],
      ['00000000-0000-4000-8000-000000000000', project.code, 'X2', '', '', '10', ''],
    ]));
    expect(res.status(), await res.text()).toBe(200);
    const { lines, errors, summary } = (await res.json()).data;
    expect(summary).toMatchObject({ totalLines: 7, create: 3, update: 0, errors: 5, allocatedChange: 3505.5 });
    expect(lines.map(l => [l.entityCode, l.action, l.allocated])).toEqual([[codeA, 'CREATE', 1500.5], [codeB, 'CREATE', 2000], [codeA, 'CREATE', 5]]);
    expect(errors.map(e => [e.line, e.code])).toEqual([
      [4, 'PROJECT_UNKNOWN'], [6, 'AMOUNT_REQUIRED'], [7, 'AMOUNT_INVALID'], [7, 'BOOL_INVALID'], [8, 'LINE_ID_UNKNOWN'],
    ]);
    const list = (await (await request.get(`/api/budget?page=1&search=${stamp}`, { headers: auth(admin) })).json());
    expect(list.pagination.total).toBe(0);
  });

  test('Confirmation : lignes créées, mise à jour par ID des seules cellules remplies, codes en double', async ({ request }) => {
    const rows = [
      ['Code projet', 'Code ligne', 'Description', 'Source de financement', 'Code activité', 'Montant alloué', 'Active'],
      [project.code, codeA, 'Ligne importée A', 'EU', 'A1.1', '1500.50', 'Oui'],
      [project.code, codeB, 'Ligne importée B', 'USAID', '', '2000', 'Non'],
      ['PRJ-INCONNU-XYZ', 'X1', '', '', '', '10', ''],
    ];
    const res = await upload(request, csv(rows), { confirm: true });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).data).toMatchObject({ created: 2, updated: 0, skipped: 1 });

    const list = await (await request.get(`/api/budget?page=1&limit=10&search=${stamp}&sort=code`, { headers: auth(admin) })).json();
    expect(list.pagination.total).toBe(2);
    expect(list.data.map(b => [b.entity_code, b.allocated_amount, b.funding_source, b.activity_code, b.is_active, b.project_code]))
      .toEqual([[codeA, 1500.5, 'EU', 'A1.1', true, project.code], [codeB, 2000, 'USAID', null, false, project.code]]);
    expect(list.totals.allocated).toBe(3500.5);
    const [lineA, lineB] = list.data;
    createdIds = list.data.map(b => b.id);

    // Avec ID : seule la cellule remplie change (description vide = inchangée) ; ligne identique = inchangée ;
    // sans ID : nouvelle ligne, même avec un code déjà utilisé dans le projet
    const update = await upload(request, csv([
      ['ID', 'Code ligne', 'Code projet', 'Montant alloué', 'Description'],
      [lineA.id, codeA, project.code, '1800', ''],
      [lineB.id, codeB, project.code, '2000', 'Ligne importée B'],
      ['', codeA, project.code, '500', 'Deuxième ligne A'],
    ]));
    const preview = (await update.json()).data;
    expect(preview.summary).toMatchObject({ create: 1, update: 1, unchanged: 1, allocatedChange: 799.5 });
    expect(preview.lines[0].changed).toEqual(['allocated_amount']);

    // Même ID deux fois : refusé
    const twice = (await (await upload(request, csv([['ID', 'Montant alloué'], [lineA.id, '1700'], [lineA.id, '1600']]))).json()).data;
    expect(twice.errors.map(e => [e.line, e.code])).toEqual([[3, 'DUPLICATE_ID']]);

    expect((await upload(request, csv([
      ['ID', 'Code ligne', 'Code projet', 'Montant alloué', 'Description'],
      [lineA.id, '', '', '1800', ''],
      ['', codeA, project.code, '500', 'Deuxième ligne A'],
    ]), { confirm: true })).status()).toBe(200);
    const after = (await (await request.get(`/api/budget/${lineA.id}`, { headers: auth(admin) })).json()).data;
    expect(Number(after.allocated_amount)).toBe(1800);
    expect(after.description).toBe('Ligne importée A');
    expect(after.activity_code).toBe('A1.1');
    expect(after.project_id).toBe(project.id); // projet vide = inchangé pour une ligne existante

    const all = await (await request.get(`/api/budget?page=1&limit=10&search=${stamp}&sort=code`, { headers: auth(admin) })).json();
    expect(all.data.filter(b => b.entity_code === codeA && b.project_code === project.code)).toHaveLength(2);
    createdIds = all.data.map(b => b.id);

    // Rien à écrire → 400 NOTHING_TO_IMPORT
    const nothing = await upload(request, csv([['ID', 'Montant alloué'], [lineA.id, '1800']]), { confirm: true });
    expect(nothing.status()).toBe(400);
    expect((await nothing.json()).code).toBe('NOTHING_TO_IMPORT');

    // Journal d'audit
    const logs = await (await request.get('/api/audit-logs?action=BUDGET_LINES_IMPORTED&limit=5', { headers: auth(admin) })).json();
    expect(logs.data[0].new_value.created + logs.data[0].new_value.updated).toBeGreaterThan(0);
  });

  test('Export Excel filtré, réimportable tel quel', async ({ request }) => {
    const res = await request.get(`/api/budget/export?search=${stamp}`, { headers: auth(admin) });
    expect(res.status()).toBe(200);
    const buffer = await res.body();
    expect(res.headers()['content-disposition']).toContain('registre_budgetaire');
    // Réimport du fichier exporté : aucune modification
    const again = await upload(request, buffer, { name: 'registre.xlsx' });
    expect((await again.json()).data.summary).toMatchObject({ create: 0, update: 0, unchanged: 3, errors: 0 });
  });

  test('Liste : filtres, sources, tri, accès', async ({ request }) => {
    const sources = (await (await request.get('/api/budget/funding-sources', { headers: auth(admin) })).json()).data;
    expect(sources).toEqual(expect.arrayContaining(['EU', 'USAID']));
    const eu = await (await request.get(`/api/budget?page=1&search=${stamp}&fundingSource=EU`, { headers: auth(admin) })).json();
    expect(eu.data.map(b => b.entity_code)).toEqual([codeA]);
    const inactive = await (await request.get(`/api/budget?page=1&search=${stamp}&status=inactive`, { headers: auth(admin) })).json();
    expect(inactive.data.map(b => b.entity_code)).toEqual([codeB]);
    const byAmount = await (await request.get(`/api/budget?page=1&search=${stamp}&sort=allocated&order=desc`, { headers: auth(admin) })).json();
    expect(byAmount.data.map(b => b.entity_code)).toEqual([codeB, codeA, codeA]);
    const paged = await (await request.get(`/api/budget?page=2&limit=1&search=${stamp}&sort=code`, { headers: auth(admin) })).json();
    expect(paged.data.map(b => b.entity_code)).toEqual([codeA]);
    expect(paged.pagination).toMatchObject({ page: 2, limit: 1, total: 3, pages: 3 });

    // Demandeur : ni export ni import
    const email = `req.budget.${stamp.toLowerCase()}@example.com`;
    const created = await request.post('/api/users', {
      headers: auth(admin),
      data: { username: `req_budget_${stamp}`, email, password: 'Secret123', firstName: 'Req', lastName: 'Budget', profileIds: ['prof_requester'] },
    });
    expect(created.status()).toBe(201);
    const token = (await (await request.post('/api/auth/login', { data: { email, password: 'Secret123' } })).json()).data.token;
    expect((await request.get('/api/budget/export', { headers: auth(token) })).status()).toBe(403);
    expect((await upload(request, csv([['Code ligne'], ['X']]), { token })).status()).toBe(403);
  });
});
