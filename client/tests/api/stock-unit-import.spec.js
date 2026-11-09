import { test, expect } from '@playwright/test';
import { getToken, getApproverId, auth } from './helpers.js';

// Import du parc existant (Excel / CSV) — services/StockUnitImportService :
//  - équipement à n° de série : une ligne = une unité (n° de série obligatoire, unique ; n° d'inventaire facultatif, unique
//    dans l'entreprise, sinon attribué ; état Bon / Endommagé ; projet, coût, notes) → unité « en stock » + OPENING ;
//  - article sans n° de série : quantités additionnées par article × dépôt ; refusé s'il a déjà du stock dans le dépôt ;
//  - aperçu sans écriture, confirmation = une transaction, une seule opération de stock (MVG-…) ; modèle xlsx / csv.
test.describe.serial('API › Import du parc existant', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let admin, wh, other, laptop, fan, lotItem, project;
  const HEAD = ['Code article', 'N° de série', "N° d'inventaire", 'Code dépôt', 'Quantité', 'Code projet', 'État', 'Coût unitaire', 'Devise', 'Notes'];
  const file = (rows) => ({ file: { name: 'parc.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + [HEAD, ...rows].map(r => r.join(';')).join('\r\n'), 'utf8') } });
  const post = (request, rows, { confirm = false, token = admin } = {}) => request.post('/api/stock-units/import', {
    headers: auth(token), multipart: { ...file(rows), ...(confirm ? { confirm: '1' } : {}) },
  });
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const H = auth(admin);
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    const category = (cats.find(c => c.is_stockable) || cats[0]).id;
    const mkWh = async (c) => (await (await request.post('/api/warehouses', { headers: H, data: { code: c, name: `Dépôt ${c}`, locationId: locations[0].id } })).json()).data;
    wh = await mkWh(`PU-${stamp}`.slice(0, 30));
    other = await mkWh(`PU2-${stamp}`.slice(0, 30));
    const mkItem = async (code, extra) => (await (await request.post('/api/stock-items', { headers: H, data: { code, name: `Article ${code}`, unit: 'pce', categoryId: category, ...extra } })).json()).data;
    laptop = await mkItem(`PU-LAP-${stamp}`, { trackSerials: true });
    fan = await mkItem(`PU-FAN-${stamp}`, {});
    lotItem = await mkItem(`PU-LOT-${stamp}`, { trackLots: true });
    project = (await (await request.post('/api/projects/', { headers: H, data: { code: `PU-${stamp}`, name: `Projet parc ${stamp}`, projectManagerId: await getApproverId(request) } })).json()).data;
    await request.post('/api/budget', { headers: H, data: { entityCode: `PU-${stamp}`, description: 'Parc', allocatedAmount: 1000, projectId: project.id } });
    expect(wh?.id && other?.id && laptop?.id && fan?.id && lotItem?.id && project?.id).toBeTruthy();
  });

  const SN = (n) => `SN${stamp}${n}`;
  const TAG = (n) => `TAG-${stamp}-${n}`;

  test('Modèle xlsx / csv téléchargeable', async ({ request }) => {
    for (const format of ['xlsx', 'csv']) {
      const res = await request.get(`/api/stock-units/import/template?format=${format}&lang=fr`, { headers: auth(admin) });
      expect(res.status()).toBe(200);
      expect((await res.body()).length).toBeGreaterThan(100);
    }
    const csv = (await (await request.get('/api/stock-units/import/template?format=csv&lang=en', { headers: auth(admin) })).body()).toString('utf8');
    expect(csv).toContain('Serial number');
  });

  test('Aperçu : contrôles par ligne, rien n\'est écrit', async ({ request }) => {
    const r = await json(await post(request, [
      [laptop.code, SN(1), TAG(1), wh.code, '', project.code, 'Bon', '1450', 'USD', 'Détenteur : Jean'],
      [laptop.code, SN(2), '', wh.code, '', '', 'Mauvais', '', '', ''],
      [laptop.code, SN(1), '', wh.code, '', '', '', '', '', ''],            // n° de série en double dans le fichier
      [laptop.code, '', '', wh.code, '', '', '', '', '', ''],               // n° de série manquant
      [laptop.code, SN(3), TAG(1), wh.code, '', '', '', '', '', ''],        // n° d'inventaire en double
      [laptop.code, SN(4), '', wh.code, '2', '', '', '', '', ''],           // quantité ≠ 1
      [fan.code, '', '', wh.code, '4', project.code, '', '45', '', ''],
      [fan.code, '', '', wh.code, '', project.code, '', '45', '', ''],      // additionné à la ligne précédente (1 par défaut)
      [fan.code, 'X1', '', wh.code, '', '', '', '', '', ''],                // n° de série sur un article sans suivi
      [lotItem.code, '', '', wh.code, '3', '', '', '', '', ''],             // suivi par lot : pas ici
      ['INCONNU-XYZ', 'A', '', wh.code, '', '', '', '', '', ''],
      [laptop.code, SN(5), '', 'DEPOT-INCONNU', '', '', '', '', '', ''],
      [laptop.code, SN(6), '', wh.code, '', 'PRJ-INCONNU', '', '', '', ''],
      [laptop.code, SN(7), '', wh.code, '', '', 'Cassé ?', '', '', ''],
    ]));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d.summary).toMatchObject({ totalLines: 14, units: 2, openings: 1, openingQuantity: 5, damaged: 1, autoTags: 1 });
    const codes = Object.fromEntries(d.errors.map(e => [e.line, e.code]));
    expect(codes).toMatchObject({
      4: 'SERIAL_DUPLICATE', 5: 'SERIAL_REQUIRED', 6: 'TAG_DUPLICATE', 7: 'QUANTITY_SERIAL', 10: 'SERIAL_NOT_TRACKED',
      11: 'ITEM_LOTS', 12: 'ITEM_UNKNOWN', 13: 'WAREHOUSE_UNKNOWN', 14: 'PROJECT_UNKNOWN', 15: 'CONDITION_INVALID',
    });
    expect(d.openings[0]).toMatchObject({ code: fan.code, quantity: 5, lines: [8, 9], unitCost: 45 });
    const units = (await (await request.get(`/api/stock-units?stockItemId=${laptop.id}`, { headers: auth(admin) })).json()).data;
    expect(units).toHaveLength(0);
  });

  let groupNumber;
  test('Confirmation : unités en stock (état, n° d\'inventaire, projet, notes), quantités, une seule opération', async ({ request }) => {
    const r = await json(await post(request, [
      [laptop.code, SN(1), TAG(1), wh.code, '', project.code, 'Bon', '1450', 'USD', 'Détenteur : Jean'],
      [laptop.code, SN(2), '', wh.code, '', '', 'Endommagé', '', '', ''],
      [fan.code, '', '', wh.code, '4', project.code, '', '45', '', ''],
      [fan.code, '', '', wh.code, '', project.code, '', '45', '', ''],
      ['INCONNU-XYZ', 'A', '', wh.code, '', '', '', '', '', ''],
    ], { confirm: true }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ units: 2, openings: 1, openingQuantity: 5, damaged: 1, skipped: 1 });
    groupNumber = r.body.data.groupNumber;
    expect(groupNumber).toMatch(/^MVG-/);

    const units = (await (await request.get(`/api/stock-units?stockItemId=${laptop.id}`, { headers: auth(admin) })).json()).data;
    const bySerial = Object.fromEntries(units.map(u => [u.serial_number, u]));
    expect(bySerial[SN(1)]).toMatchObject({ asset_tag: TAG(1), status: 'IN_STOCK', condition: 'GOOD', project_code: project.code });
    expect(bySerial[SN(2)]).toMatchObject({ status: 'IN_STOCK', condition: 'DAMAGED' });
    expect(bySerial[SN(2)].asset_tag).toBeTruthy(); // attribué automatiquement
    const detail = (await (await request.get(`/api/stock-units/${bySerial[SN(1)].id}`, { headers: auth(admin) })).json()).data;
    expect(detail.notes).toBe('Détenteur : Jean');

    const balances = (await (await request.get(`/api/stock/balances?warehouseId=${wh.id}`, { headers: auth(admin) })).json()).data;
    const qty = (itemId) => balances.filter(b => b.stock_item_id === itemId).reduce((s, b) => s + Number(b.quantity), 0);
    expect(qty(laptop.id)).toBe(2);
    expect(qty(fan.id)).toBe(5);
    expect(balances.find(b => b.stock_item_id === fan.id).project_id).toBe(project.id);

    const groups = (await (await request.get(`/api/stock/movement-groups?search=${groupNumber}`, { headers: auth(admin) })).json()).data;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ movement_count: 3, source_type: 'IMPORT' });
  });

  test('Nouvel import : n° de série / d\'inventaire déjà enregistrés et stock déjà présent refusés', async ({ request }) => {
    const r = await json(await post(request, [
      [laptop.code, SN(1), '', wh.code, '', '', '', '', '', ''],
      [laptop.code, SN(8), TAG(1), wh.code, '', '', '', '', '', ''],
      [fan.code, '', '', wh.code, '2', '', '', '', '', ''],
      [fan.code, '', '', other.code, '2', '', '', '', '', ''],              // autre dépôt : accepté
      [laptop.code, SN(9), '', other.code, '', '', '', '', '', ''],         // nouvel équipement : accepté
    ]));
    const codes = Object.fromEntries(r.body.data.errors.map(e => [e.line, e.code]));
    expect(codes).toEqual({ 2: 'SERIAL_EXISTS', 3: 'TAG_EXISTS', 4: 'OPENING_EXISTS' });
    expect(r.body.data.summary).toMatchObject({ units: 1, openings: 1 });
    const nothing = await json(await post(request, [[laptop.code, SN(1), '', wh.code, '', '', '', '', '', '']], { confirm: true }));
    expect([nothing.status, nothing.body.code]).toEqual([400, 'NOTHING_TO_IMPORT']);
  });

  test('Gros fichier (reçu en plusieurs morceaux) : toujours cloisonné par entreprise et importé', async ({ request }) => {
    // Avant la correction de tabularImport.uploadHandler, le contexte d'entreprise était perdu au-delà d'un morceau
    // de flux : aperçu non cloisonné et confirmation refusée (« Réservé aux utilisateurs d'une entreprise »)
    const note = 'x'.repeat(180);
    const rows = Array.from({ length: 900 }, (_, i) => [laptop.code, `BIG${stamp}${i}`, '', other.code, '', '', '', '', '', note]);
    const preview = await json(await post(request, rows));
    expect(preview.status, JSON.stringify(preview.body).slice(0, 300)).toBe(200);
    expect(preview.body.data.summary).toMatchObject({ units: 900, errors: 0 });
    const done = await json(await post(request, rows, { confirm: true }));
    expect(done.status, JSON.stringify(done.body).slice(0, 300)).toBe(200);
    expect(done.body.data.units).toBe(900);
  });

  test('Fichier : colonnes obligatoires, format, droits', async ({ request }) => {
    const noCols = await request.post('/api/stock-units/import', { headers: auth(admin), multipart: { file: { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('A;B\r\n1;2', 'utf8') } } });
    expect([noCols.status(), (await noCols.json()).code]).toEqual([400, 'MISSING_COLUMNS']);
    const bad = await request.post('/api/stock-units/import', { headers: auth(admin), multipart: { file: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') } } });
    expect(bad.status()).toBe(400);
    const anonymous = await request.post('/api/stock-units/import', { multipart: file([]) });
    expect(anonymous.status()).toBe(401);
  });
});
