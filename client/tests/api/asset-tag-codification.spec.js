import { test, expect } from '@playwright/test';
import { getToken, getApproverId, auth } from './helpers.js';

// Codification des n° d'inventaire (migration 57) : ORGANISATION-PROJET-CATÉGORIE-ANNÉE-NNN (ex. IMA-MIHR-LAP-2026-001)
//  - préfixe d'organisation de l'entreprise (vide = ancienne codification <code initial>-AAAA-NNNNN) ;
//  - projet : segment propre à l'équipement, sinon code initial inventaire du projet de financement ;
//  - catégorie : code de l'article ; année : année d'acquisition, sinon année d'enregistrement ;
//  - séquence sur 3 chiffres par organisation × projet × catégorie × année ;
//  - recodification par fichier (ancien n° gardé dans les notes).
test.describe.serial('API › Codification des n° d\'inventaire', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const year = new Date().getFullYear();
  let admin, initialOrg, wh, laptop, plain, project;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const csv = (header, rows) => ({ file: { name: 'f.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + [header, ...rows].map(r => r.join(';')).join('\r\n'), 'utf8') } });
  const UNIT_HEAD = ['Code article', 'N° de série', "N° d'inventaire", 'Code dépôt', 'Code projet', 'Segment projet (TAG)', "Date d'acquisition"];
  const importUnits = (request, rows) => request.post('/api/stock-units/import', { headers: H(), multipart: { ...csv(UNIT_HEAD, rows), confirm: '1' } }).then(json);
  const RETAG_HEAD = ['Code article', 'N° de série', "Date d'acquisition", 'Segment projet (TAG)'];
  const retag = (request, rows, confirm = true) => request.post('/api/stock-units/retag', { headers: H(), multipart: { ...csv(RETAG_HEAD, rows), ...(confirm ? { confirm: '1' } : {}) } }).then(json);
  const tagsOf = async (request, itemId) => Object.fromEntries((await (await request.get(`/api/stock-units?stockItemId=${itemId}&limit=500`, { headers: H() })).json()).data.map(u => [u.serial_number, u]));
  const setOrg = (request, org) => request.put('/api/enterprises/current/asset-tags', { headers: H(), data: { org } }).then(json);

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    initialOrg = (await (await request.get('/api/enterprises/current/asset-tags', { headers: H() })).json()).data?.org ?? null;
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    const category = (cats.find(c => c.is_stockable) || cats[0]).id;
    wh = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `TG-${stamp}`, name: `Dépôt TAG ${stamp}`, locationId: locations[0].id } })).json()).data;
    laptop = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `TG-LAP-${stamp}`, name: 'Laptop TAG', unit: 'pce', categoryId: category, trackSerials: true, assetCategory: 'lap' } })).json()).data;
    plain = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `TG-NOCAT-${stamp}`, name: 'Sans catégorie TAG', unit: 'pce', categoryId: category, trackSerials: true } })).json()).data;
    project = (await (await request.post('/api/projects/', { headers: H(), data: { code: `TG-${stamp}`, name: `Projet TAG ${stamp}`, projectManagerId: await getApproverId(request), inventoryPrefix: `P${stamp}` } })).json()).data;
    await request.post('/api/budget', { headers: H(), data: { entityCode: `TG-${stamp}`, description: 'TAG', allocatedAmount: 1000, projectId: project.id } });
    expect(wh?.id && laptop?.id && plain?.id && project?.id).toBeTruthy();
    expect(laptop.asset_category).toBe('LAP');
  });

  test.afterAll(async ({ request }) => { await setOrg(request, initialOrg); });

  test('Réglage : préfixe d\'organisation et catégorie de l\'article contrôlés', async ({ request }) => {
    const bad = await setOrg(request, 'I@');
    expect([bad.status, bad.body.code]).toEqual([400, 'ASSET_TAG_ORG_INVALID']);
    const ok = await setOrg(request, 'ima');
    expect(ok.body.data).toMatchObject({ org: 'IMA', example: `IMA-MIHR-LAP-${year}-001` });
    expect(ok.body.data.categories).toEqual(expect.arrayContaining(['VEH', 'MOT', 'TAB', 'LAP', 'MON', 'IMP', 'PRO', 'GEN', 'REF', 'CLM', 'COM', 'UPS', 'CAM', 'TEL', 'SCO']));
    const badCat = await json(await request.put(`/api/stock-items/${plain.id}`, { headers: H(), data: { assetCategory: 'L' } }));
    expect([badCat.status, badCat.body.code]).toEqual([400, 'ASSET_CATEGORY_INVALID']);
  });

  test('Nouveaux équipements : IMA-<projet>-<catégorie>-<année d\'acquisition>-NNN, séquence par projet × catégorie × année', async ({ request }) => {
    const r = await importUnits(request, [
      [laptop.code, `A1${stamp}`, '', wh.code, project.code, '', '2024-05-10'],
      [laptop.code, `A2${stamp}`, '', wh.code, project.code, '', '2024'],
      [laptop.code, `A3${stamp}`, '', wh.code, project.code, '', '15/03/2021'],
      [laptop.code, `A4${stamp}`, '', wh.code, project.code, `X${stamp}`, '2024'],
      [laptop.code, `A5${stamp}`, '', wh.code, project.code, '', ''],
      [laptop.code, `A6${stamp}`, `MON-TAG-${stamp}`, wh.code, project.code, '', '2024'],
      [laptop.code, `A7${stamp}`, '', wh.code, project.code, 'mauvais segment', ''],
      [laptop.code, `A8${stamp}`, '', wh.code, project.code, '', '31/02/2024'],
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(Object.fromEntries(r.body.data.errors.map(e => [e.line, e.code]))).toEqual({ 8: 'TAG_PROJECT_INVALID', 9: 'DATE_INVALID' });
    const u = await tagsOf(request, laptop.id);
    const P = `P${stamp}`;
    expect(u[`A1${stamp}`].asset_tag).toBe(`IMA-${P}-LAP-2024-001`);
    expect(u[`A2${stamp}`].asset_tag).toBe(`IMA-${P}-LAP-2024-002`);
    expect(u[`A3${stamp}`].asset_tag).toBe(`IMA-${P}-LAP-2021-001`);
    expect(u[`A4${stamp}`].asset_tag).toBe(`IMA-X${stamp}-LAP-2024-001`);
    expect(u[`A5${stamp}`].asset_tag).toBe(`IMA-${P}-LAP-${year}-001`);
    expect(u[`A6${stamp}`].asset_tag).toBe(`MON-TAG-${stamp}`); // n° saisi : gardé tel quel
    expect(u[`A1${stamp}`]).toMatchObject({ acquisition_date: '2024-05-10', tag_project_code: null });
    expect(u[`A4${stamp}`].tag_project_code).toBe(`X${stamp}`);
    // Saisie classique « Enregistrer le parc existant » : même codification (année d'enregistrement)
    const reg = await json(await request.post('/api/stock-units/register', { headers: H(), data: { stockItemId: laptop.id, warehouseId: wh.id, projectId: project.id, units: [{ serialNumber: `R1${stamp}` }] } }));
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    expect((await tagsOf(request, laptop.id))[`R1${stamp}`].asset_tag).toBe(`IMA-${P}-LAP-${year}-002`);
  });

  test('Recodification par fichier : nouveau n°, ancien gardé dans les notes ; contrôles', async ({ request }) => {
    const preview = await retag(request, [
      [laptop.code, `A6${stamp}`, '2019', `R${stamp}`],
      [laptop.code, `A6${stamp}`, '2019', `R${stamp}`],      // en double
      [laptop.code, `INCONNU${stamp}`, '2019', ''],
      [plain.code, `Z1${stamp}`, '2019', ''],                // article inconnu de la recherche (aucun équipement) : introuvable
    ], false);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data.summary).toMatchObject({ units: 1, errors: 3 });
    expect(Object.fromEntries(preview.body.data.errors.map(e => [e.line, e.code]))).toEqual({ 3: 'SERIAL_DUPLICATE', 4: 'UNIT_NOT_FOUND', 5: 'UNIT_NOT_FOUND' });
    expect(preview.body.data.units[0]).toMatchObject({ oldTag: `MON-TAG-${stamp}`, pattern: `IMA-R${stamp}-LAP-2019-NNN` });

    const done = await retag(request, [[laptop.code, `A6${stamp}`, '2019', `R${stamp}`], [laptop.code, `A1${stamp}`, '', '']]);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.changes).toEqual([
      expect.objectContaining({ serial: `A6${stamp}`, oldTag: `MON-TAG-${stamp}`, newTag: `IMA-R${stamp}-LAP-2019-001` }),
      expect.objectContaining({ serial: `A1${stamp}`, oldTag: `IMA-P${stamp}-LAP-2024-001`, newTag: `IMA-P${stamp}-LAP-2024-003` }),
    ]);
    const unit = (await tagsOf(request, laptop.id))[`A6${stamp}`];
    const detail = (await (await request.get(`/api/stock-units/${unit.id}`, { headers: H() })).json()).data;
    expect(detail.notes).toContain(`Ancien n° d'inventaire : MON-TAG-${stamp}`);
    expect(detail).toMatchObject({ acquisition_date: '2019-01-01', tag_project_code: `R${stamp}` });

    // Article sans catégorie TAG : refusé
    await importUnits(request, [[plain.code, `Z1${stamp}`, '', wh.code, '', '', '']]);
    const noCat = await retag(request, [[plain.code, `Z1${stamp}`, '', '']], false);
    expect(noCat.body.data.errors[0].code).toBe('ITEM_CATEGORY_MISSING');
  });

  test('Fiche de l\'équipement : année et segment modifiables, n° vidé = recalculé', async ({ request }) => {
    const unit = (await tagsOf(request, laptop.id))[`A5${stamp}`];
    const up = await json(await request.put(`/api/stock-units/${unit.id}`, { headers: H(), data: { acquisitionDate: '2018-07-01', tagProjectCode: `F${stamp}`, assetTag: '' } }));
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect((await tagsOf(request, laptop.id))[`A5${stamp}`].asset_tag).toBe(`IMA-F${stamp}-LAP-2018-001`);
    const bad = await json(await request.put(`/api/stock-units/${unit.id}`, { headers: H(), data: { tagProjectCode: 'a b' } }));
    expect([bad.status, bad.body.code]).toEqual([400, 'TAG_PROJECT_INVALID']);
  });

  test('Import du catalogue : colonne « Catégorie TAG »', async ({ request }) => {
    const res = await json(await request.post('/api/stock-items/import', { headers: H(), multipart: { ...csv(['Code', 'Catégorie TAG'], [[plain.code, 'sco'], [laptop.code, 'X']]), confirm: '1' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.errors.map(e => e.code)).toEqual(['ASSET_CATEGORY_INVALID']);
    const item = (await (await request.get(`/api/stock-items/${plain.id}`, { headers: H() })).json()).data;
    expect(item.asset_category).toBe('SCO');
  });

  test('Sans préfixe d\'organisation : ancienne codification ; recodification refusée', async ({ request }) => {
    await setOrg(request, '');
    await importUnits(request, [[laptop.code, `B1${stamp}`, '', wh.code, project.code, '', '2020']]);
    expect((await tagsOf(request, laptop.id))[`B1${stamp}`].asset_tag).toMatch(new RegExp(`^P${stamp}-${year}-\\d{5}$`));
    const r = await retag(request, [[laptop.code, `B1${stamp}`, '2020', '']], false);
    expect([r.status, r.body.code]).toEqual([409, 'ASSET_TAG_ORG_REQUIRED']);
  });
});
