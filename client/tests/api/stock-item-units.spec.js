import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Catalogue de stock et unités de mesure (migration 49) : stock_items.unit_id = unité du référentiel de la plateforme
// (obligatoire, Pièce par défaut) ; stock_items.unit = son abréviation, tenue par trigger. API : unitId, ou texte
// (abréviation, code, nom, traduction, abréviations usuelles L / kg / m…) ; inconnue → 400 UNIT_INVALID. Import du
// catalogue : UNIT_UNKNOWN. Réquisition : l'article du catalogue apporte son unité. Unité utilisée : non supprimable.
const SUPERADMIN = {
  email: process.env.SUPERADMIN_EMAIL || 'superadmin@procureapp.com',
  password: process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!',
};

test.describe.serial('API › Catalogue de stock — unités du référentiel', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let admin, superToken, units, byCode, category, fuel, custom;

  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const createItem = (request, data) => request.post('/api/stock-items', { headers: H(), data: { categoryId: category.id, ...data } });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    superToken = (await (await request.post('/api/auth/login', { data: SUPERADMIN })).json()).data?.token;
    units = (await (await request.get('/api/units', { headers: H() })).json()).data;
    byCode = Object.fromEntries(units.map(u => [u.code, u]));
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    category = cats.find(c => c.code === 'FUEL') || cats.find(c => c.is_stockable) || cats[0];
  });

  test('Unités ajoutées pour le catalogue', async () => {
    for (const code of ['CARTON', 'REAM', 'TONNE', 'SQ_METER', 'CU_METER', 'KIT', 'PAIR', 'NIGHT', 'JERRYCAN', 'DAY', 'DOSE']) {
      expect(byCode[code], code).toBeTruthy();
    }
  });

  test('Création : texte résolu dans le référentiel, abréviation recopiée', async ({ request }) => {
    let r = await json(await createItem(request, { code: `UF-${stamp}`, name: 'Gasoil unités', unit: 'L' }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    fuel = r.body.data;
    expect(fuel.unit_id).toBe(byCode.LITER.id);
    expect(fuel.unit).toBe(byCode.LITER.abbr);
    expect(fuel.unit_name).toBe('Litre');

    for (const [text, code] of [['kg', 'KG'], ['Boîte', 'BOX'], ['ream', 'REAM'], ['PIECE', 'PIECE']]) {
      r = await json(await createItem(request, { code: `U${code}-${stamp}`, name: `Article ${text}`, unit: text }));
      expect(r.status, text).toBe(201);
      expect(r.body.data.unit_id, text).toBe(byCode[code].id);
    }
    // Par id ; sans unité → Pièce
    r = await json(await createItem(request, { code: `UID-${stamp}`, name: 'Par id', unitId: byCode.CARTON.id }));
    expect(r.body.data).toMatchObject({ unit_id: byCode.CARTON.id, unit: 'ctn' });
    r = await json(await createItem(request, { code: `UNONE-${stamp}`, name: 'Sans unité' }));
    expect(r.body.data.unit_id).toBe(byCode.PIECE.id);
  });

  test('Unité inconnue ou désactivée refusée', async ({ request }) => {
    for (const data of [{ unit: `zz-${stamp}` }, { unitId: 99999999 }, { unit: '' }]) {
      const r = await json(await createItem(request, { code: `UBAD-${stamp}`, name: 'x', ...data }));
      expect(r.status, JSON.stringify(data)).toBe(400);
      expect(r.body.code).toBe('UNIT_INVALID');
    }
  });

  test('Modification, autocomplétion et lien avec la réquisition', async ({ request }) => {
    let r = await json(await request.put(`/api/stock-items/${fuel.id}`, { headers: H(), data: { unitId: byCode.JERRYCAN.id } }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ unit_id: byCode.JERRYCAN.id, unit: 'bidon' });
    r = await json(await request.put(`/api/stock-items/${fuel.id}`, { headers: H(), data: { unit: 'Litre' } }));
    expect(r.body.data.unit_id).toBe(byCode.LITER.id);

    const found = (await (await request.get(`/api/stock-items/search?q=${fuel.code}`, { headers: H() })).json()).data;
    expect(found.find(i => i.id === fuel.id).unit_id).toBe(byCode.LITER.id);

    // Import d'articles de réquisition : code seul → unité de l'article
    const csv = `Description;Quantité;Fréquence;Prix unitaire;Code article\n;5;1;2;${fuel.code}\n`;
    const imp = await json(await request.post('/api/requisitions/import-items', {
      headers: H(), multipart: { file: { name: 'i.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + csv, 'utf8') } },
    }));
    expect(imp.status).toBe(200);
    expect(imp.body.data.items[0]).toMatchObject({ stockItemId: fuel.id, unitId: byCode.LITER.id, unit_id: byCode.LITER.id });
  });

  test('Import du catalogue : unité du référentiel ou UNIT_UNKNOWN', async ({ request }) => {
    const csv = `Code;Désignation;Unité\nUIMP1-${stamp};Article 1;Litre\nUIMP2-${stamp};Article 2;m3\nUIMP3-${stamp};Article 3;zz-${stamp}\n`;
    const r = await json(await request.post('/api/stock-items/import', {
      headers: H(), multipart: { file: { name: 'c.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + csv, 'utf8') } },
    }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const items = Object.fromEntries(r.body.data.items.map(i => [i.code, i]));
    expect(items[`UIMP1-${stamp}`]).toMatchObject({ action: 'CREATE', unit: byCode.LITER.abbr });
    expect(items[`UIMP2-${stamp}`].unit).toBe(byCode.CU_METER.abbr); // alias « m3 »
    expect(r.body.data.errors).toEqual([expect.objectContaining({ line: 4, code: 'UNIT_UNKNOWN' })]);
  });

  test('Référentiel : abréviation reportée sur les articles, unité utilisée non supprimable', async ({ request }) => {
    test.skip(!superToken, 'super admin indisponible');
    const S = auth(superToken);
    const created = await json(await request.post('/api/units', { headers: S, data: { code: `T_${stamp}`, abbr: `t${stamp}`.slice(0, 20), name: `Test ${stamp}` } }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    custom = created.body.data;
    const item = (await json(await createItem(request, { code: `UCUS-${stamp}`, name: 'Unité de test', unitId: custom.id }))).body.data;
    expect(item.unit).toBe(custom.abbr);

    const abbr = `n${stamp}`.slice(0, 20);
    expect((await request.put(`/api/units/${custom.id}`, { headers: S, data: { abbr } })).status()).toBe(200);
    expect((await (await request.get(`/api/stock-items/${item.id}`, { headers: H() })).json()).data.unit).toBe(abbr);

    expect((await request.delete(`/api/units/${custom.id}`, { headers: S })).status()).toBe(400);
    const listed = (await (await request.get('/api/units?all=1', { headers: S })).json()).data.find(u => u.id === custom.id);
    expect(listed.supplier_count).toBe(1);
  });

  test.afterAll(async ({ request }) => {
    if (custom && superToken) await request.put(`/api/units/${custom.id}`, { headers: auth(superToken), data: { isActive: false } });
  });
});
