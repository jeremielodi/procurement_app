import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Import du catalogue de stock (Excel / CSV) avec stock initial facultatif :
// modèle téléchargeable (xlsx / csv, FR / EN), aperçu sans écriture, confirmation (articles + mouvements OPENING),
// erreurs par ligne, nouvel import sans doublement du stock, propriétés figées, droits et accès aux dépôts.
test.describe.serial('API › Import des articles de stock', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const logistic = { email: `imp.logistic.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const requester = { email: `imp.requester.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  let admin, logisticToken, requesterToken, w1, w2;
  const code = (s) => `IMP${stamp}-${s}`.slice(0, 50);

  const csvFile = (rows, name = 'import.csv') => ({
    file: { name, mimeType: 'text/csv', buffer: Buffer.from('﻿' + rows.map(r => r.join(';')).join('\r\n'), 'utf8') },
  });
  const HEAD = ['Code', 'Désignation', 'Unité', 'Catégorie', 'Stockable', 'Suivi par lot', 'Suivi de péremption', 'Suivi par n° de série',
    'Stock minimum', 'Code dépôt', 'Quantité initiale', 'Coût unitaire', 'Devise', 'N° de lot', 'Date de péremption'];
  const post = (request, rows, { token = admin, confirm = false } = {}) => request.post('/api/stock-items/import', {
    headers: auth(token), multipart: { ...csvFile(rows), ...(confirm ? { confirm: '1' } : {}) },
  });
  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const byCode = async (request, c) => (await (await request.get(`/api/stock-items?search=${c}&all=1`, { headers: auth(admin) })).json()).data.find(i => i.code === c);

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const goma = locations.find(l => l.code === 'GOMA') || locations[0];
    const mk = async (c, name) => (await (await request.post('/api/warehouses', { headers: auth(admin), data: { code: c, name, locationId: goma.id } })).json()).data;
    w1 = await mk(`IM1-${stamp}`.slice(0, 30), 'Dépôt import 1');
    w2 = await mk(`IM2-${stamp}`.slice(0, 30), 'Dépôt import 2');
    for (const [account, profile] of [[logistic, 'prof_logistic'], [requester, 'prof_requester']]) {
      const created = await request.post('/api/users', { headers: auth(admin), data: {
        username: account.email.split('@')[0], email: account.email, password: account.password, firstName: 'Imp', lastName: profile, profileIds: [profile],
      } });
      expect(created.status()).toBe(201);
      if (profile === 'prof_logistic') {
        const id = (await created.json()).data.id;
        await request.put(`/api/warehouses/${w1.id}/users`, { headers: auth(admin), data: { userIds: [id] } });
      }
    }
    logisticToken = (await (await request.post('/api/auth/login', { data: logistic })).json()).data.token;
    requesterToken = (await (await request.post('/api/auth/login', { data: requester })).json()).data.token;
  });

  test('Modèle Excel et CSV, dans la langue demandée', async ({ request }) => {
    const xlsx = await request.get('/api/stock-items/import/template?format=xlsx&lang=fr', { headers: auth(admin) });
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
    const buf = await xlsx.body();
    expect(buf.slice(0, 2).toString()).toBe('PK');

    const fr = await request.get('/api/stock-items/import/template?format=csv&lang=fr', { headers: auth(admin) });
    const frText = (await fr.body()).toString('utf8');
    expect(frText.charCodeAt(0)).toBe(0xFEFF);
    expect(frText).toContain('Code;Désignation;Unité;Catégorie');
    expect(frText).toContain('EX-PARACETAMOL');
    const en = (await (await request.get('/api/stock-items/import/template?format=csv&lang=en', { headers: auth(admin) })).body()).toString('utf8');
    expect(en).toContain('Code;Name;Unit;Category');

    expect((await request.get('/api/stock-items/import/template', { headers: auth(requesterToken) })).status()).toBe(403);
  });

  test('Le modèle Excel téléchargé est importable tel quel (aperçu)', async ({ request }) => {
    const buffer = await (await request.get('/api/stock-items/import/template?format=xlsx&lang=fr', { headers: auth(admin) })).body();
    const r = await json(await request.post('/api/stock-items/import', {
      headers: auth(admin), multipart: { file: { name: 'modele.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer } },
    }));
    expect(r.status).toBe(200);
    expect(r.body.data.items.map(i => i.code)).toEqual(['EX-PAPER-A4', 'EX-PARACETAMOL', 'EX-LAPTOP']);
    // Exemples déjà importés par un passage précédent : seul « stock déjà présent » est possible
    expect(r.body.data.errors.every(e => e.code === 'OPENING_EXISTS')).toBe(true);
    const drug = r.body.data.openings.find(o => o.code === 'EX-PARACETAMOL');
    if (drug) expect(drug).toMatchObject({ lotNumber: 'L2026-01', expiryDate: '2027-06-30', quantity: 30 });
  });

  test('Aperçu : erreurs par ligne, rien n\'est écrit', async ({ request }) => {
    const rows = [
      HEAD,
      [code('PAPER'), 'Papier A4', 'rame', 'OFFICE_SUPPLIES', '', '', '', '', '10', w1.code, '100', '4,50', '', '', ''],
      [code('DRUG'), 'Paracétamol', 'boîte', '', 'oui', 'oui', 'oui', 'non', '', w1.code, '30', '2', 'USD', 'LOT-A', '30/06/2027'],
      [code('DRUG'), '', '', '', '', '', '', '', '', w2.code, '20', '2', 'USD', 'LOT-B', '2027-12-31'],
      [code('BADCAT'), 'Article', 'pce', 'CATEGORIE-INEXISTANTE', '', '', '', '', '', '', '', '', '', '', ''],
      [code('NONAME'), '', 'pce', '', '', '', '', '', '', '', '', '', '', '', ''],
      [code('SERVICE'), 'Prestation', 'jour', '', 'non', '', '', '', '', w1.code, '5', '', '', '', ''],
      [code('LAPTOP'), 'Ordinateur', 'pce', '', 'oui', 'non', 'non', 'oui', '', w1.code, '3', '', '', '', ''],
      [code('BADDATE'), 'Vaccin', 'dose', '', 'oui', 'oui', 'oui', '', '', w1.code, '5', '', '', 'V1', '31/02/2027'],
      [code('NOWH'), 'Gants', 'paire', '', '', '', '', '', '', 'DEPOT-INCONNU', '5', '', '', '', ''],
      [code('PAPER'), '', '', '', '', '', '', '', '', w1.code, '50', '', '', '', ''],
      [code('BOOL'), 'Test', 'pce', '', 'peut-être', '', '', '', '', '', '', '', '', '', ''],
    ];
    const r = await json(await post(request, rows));
    expect(r.status).toBe(200);
    const { items, openings, errors, summary } = r.body.data;
    expect(errors.map(e => [e.line, e.code])).toEqual([
      [5, 'CATEGORY_UNKNOWN'], [6, 'NAME_REQUIRED'], [7, 'NOT_STOCKABLE'], [8, 'SERIAL_ITEM'], [9, 'DATE_INVALID'],
      [10, 'WAREHOUSE_UNKNOWN'], [11, 'DUPLICATE_OPENING'], [12, 'BOOL_INVALID'],
    ]);
    expect(items.map(i => [i.code, i.action])).toEqual([
      [code('PAPER'), 'CREATE'], [code('DRUG'), 'CREATE'], [code('SERVICE'), 'CREATE'], [code('LAPTOP'), 'CREATE'],
      [code('BADDATE'), 'CREATE'], [code('NOWH'), 'CREATE'],
    ]);
    expect(items.find(i => i.code === code('PAPER')).stockable).toBe(true); // catégorie « Fournitures de bureau » stockable
    expect(openings.map(o => [o.code, o.warehouse.code, o.quantity, o.unitCost, o.lotNumber, o.expiryDate])).toEqual([
      [code('PAPER'), w1.code, 100, 4.5, null, null],
      [code('DRUG'), w1.code, 30, 2, 'LOT-A', '2027-06-30'],
      [code('DRUG'), w2.code, 20, 2, 'LOT-B', '2027-12-31'],
    ]);
    expect(openings[0].currency).toBeTruthy(); // devise de l'entreprise par défaut
    expect(summary).toMatchObject({ totalLines: 11, create: 6, openings: 3, errors: 8 });
    expect(await byCode(request, code('PAPER'))).toBeUndefined();
  });

  test('Confirmation : articles créés, stock initial (OPENING) avec lots, coût et audit', async ({ request }) => {
    const rows = [
      HEAD,
      [code('PAPER'), 'Papier A4', 'rame', 'fournitures de bureau', '', '', '', '', '10', w1.code, '100', '4,50', '', '', ''],
      [code('DRUG'), 'Paracétamol', 'boîte', '', 'oui', 'oui', 'oui', 'non', '', w1.code, '30', '2', 'USD', 'LOT-A', '30/06/2027'],
      [code('DRUG'), '', '', '', '', '', '', '', '', w2.code, '20', '2', 'USD', 'LOT-B', '2027-12-31'],
      [code('LAPTOP'), 'Ordinateur', 'pce', '', 'oui', 'non', 'non', 'oui', '', '', '', '', '', '', ''],
      [code('NONAME'), '', 'pce', '', '', '', '', '', '', '', '', '', '', '', ''],
    ];
    const r = await json(await post(request, rows, { confirm: true }));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ created: 3, updated: 0, openings: 3, openingQuantity: 150, skipped: 1 });

    const drug = await byCode(request, code('DRUG'));
    expect(drug).toMatchObject({ is_stockable: true, track_lots: true, track_expiry: true, unit: 'boîte' });
    expect(Number(drug.stock_quantity)).toBe(50);
    const mv = (await (await request.get(`/api/stock/movements?stockItemId=${drug.id}`, { headers: auth(admin) })).json()).data;
    expect(mv.map(m => [m.movement_type, Number(m.quantity), m.lot_number]).sort()).toEqual([['OPENING', 20, 'LOT-B'], ['OPENING', 30, 'LOT-A']]);
    const laptop = await byCode(request, code('LAPTOP'));
    expect(laptop.track_serials).toBe(true);
    expect(Number(laptop.stock_quantity)).toBe(0);

    const paper = await byCode(request, code('PAPER'));
    const valuation = (await (await request.get(`/api/stock/valuation?warehouseId=${w1.id}`, { headers: auth(admin) })).json()).data;
    expect(valuation.items.find(i => i.id === paper.id || i.code === paper.code)).toMatchObject({ quantity: 100, average_cost: 4.5 });

    const logs = (await (await request.get('/api/audit-logs?action=STOCK_ITEMS_IMPORTED', { headers: auth(admin) })).json()).data;
    expect(logs[0].new_value).toMatchObject({ created: 3, openings: 3 });
  });

  test('Nouvel import : mise à jour des cellules remplies, stock jamais doublé, propriétés figées', async ({ request }) => {
    const rows = [
      HEAD,
      [code('PAPER'), 'Papier A4 recyclé', '', '', '', '', '', '', '15', w1.code, '100', '', '', '', ''],
      [code('PAPER'), '', '', '', '', '', '', '', '', w2.code, '40', '', '', '', ''],
      [code('DRUG'), '', 'carton', '', '', '', '', '', '', '', '', '', '', '', ''],
      [code('LAPTOP'), 'Ordinateur', 'pce', '', '', '', '', '', '', '', '', '', '', '', ''],
    ];
    const preview = (await json(await post(request, rows))).body.data;
    expect(preview.errors.map(e => [e.line, e.code])).toEqual([[2, 'OPENING_EXISTS'], [4, 'LOCKED_FIELDS']]);
    expect(preview.items.map(i => [i.code, i.action, i.changed])).toEqual([
      [code('PAPER'), 'UPDATE', ['name', 'min_quantity']], [code('LAPTOP'), 'UNCHANGED', []],
    ]);
    // L'article de la ligne 2 est valide (seul son stock initial est refusé) : la ligne 3 (autre dépôt) passe
    expect(preview.openings.map(o => [o.code, o.warehouse.code, o.quantity])).toEqual([[code('PAPER'), w2.code, 40]]);

    const r = await json(await post(request, rows, { confirm: true }));
    expect(r.body.data).toMatchObject({ created: 0, updated: 1, unchanged: 1, openings: 1 });
    const paper = await byCode(request, code('PAPER'));
    expect(paper).toMatchObject({ name: 'Papier A4 recyclé' });
    expect(Number(paper.min_quantity)).toBe(15);
    expect(Number(paper.stock_quantity)).toBe(140);
  });

  test('Droits : demandeur refusé ; logistique limitée à ses dépôts', async ({ request }) => {
    const rows = [HEAD, [code('GLOVES'), 'Gants', 'paire', '', '', '', '', '', '', w2.code, '10', '', '', '', '']];
    expect((await post(request, rows, { token: requesterToken })).status()).toBe(403);
    const r = await json(await post(request, rows, { token: logisticToken }));
    expect(r.body.data.errors.map(e => e.code)).toEqual(['WAREHOUSE_FORBIDDEN']);
    const ok = await json(await post(request, [HEAD, [code('GLOVES'), 'Gants', 'paire', '', '', '', '', '', '', w1.code, '10', '', '', '', '']], { token: logisticToken, confirm: true }));
    expect(ok.body.data).toMatchObject({ created: 1, openings: 1 });
  });

  test('Fichier invalide : format, colonne Code absente, aucune ligne valide', async ({ request }) => {
    const bad = await request.post('/api/stock-items/import', { headers: auth(admin), multipart: { file: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') } } });
    expect(bad.status()).toBe(400);
    const noCode = await json(await post(request, [['Nom', 'Unité'], ['A', 'pce']]));
    expect(noCode.body.code).toBe('MISSING_COLUMNS');
    const nothing = await json(await post(request, [HEAD, [code('X'), '', '', '', '', '', '', '', '', '', '', '', '', '', '']], { confirm: true }));
    expect(nothing.status).toBe(400);
    expect(nothing.body.code).toBe('NOTHING_TO_IMPORT');
  });
});
