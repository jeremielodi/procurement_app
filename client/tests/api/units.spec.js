import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Unités de mesure (migration 46) : référentiel de la plateforme, traduit, préchargé (24 unités) ; unité obligatoire
// sur chaque ligne de réquisition — « Pièce » par défaut — reprise par la fiche, la correction et le bon de commande.
const SUPERADMIN = {
  email: process.env.SUPERADMIN_EMAIL || 'superadmin@procureapp.com',
  password: process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!',
};
const SEEDED = ['ACT', 'PALLET', 'PILL', 'BOX', 'LOT', 'AMPOULE', 'BAGS', 'BOTTLE', 'CAPSULE', 'BOTTLE2', 'JAR', 'LITER',
  'PIECE', 'BAG', 'TABLET', 'TUBE', 'VIAL', 'UNIT', 'PACKAGE', 'KG', 'ART', 'PERS', 'ROLLS', 'METER'];

test.describe.serial('API › Unités de mesure', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let admin, superToken, project, line, units, piece, kilo, created;
  const requisitions = [];

  const unitsIn = async (request, lang) =>
    (await (await request.get('/api/units', { headers: { ...auth(admin), 'Accept-Language': lang } })).json()).data;
  const createRequisition = (request, items) => request.post('/api/requisitions', { headers: auth(admin), data: {
    title: `[TEST UNITES] ${stamp}`, projectId: project.id, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM',
    items: items.map(it => ({ quantity: 1, frequency: 1, unitPrice: 10, budgetLineId: line.id, ...it })),
  } });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    superToken = (await (await request.post('/api/auth/login', { data: SUPERADMIN })).json()).data?.token;
    [project] = (await (await request.get('/api/projects', { headers: auth(admin) })).json()).data;
    line = (await (await request.post('/api/budget', { headers: auth(admin), data: {
      entityCode: `UNIT-${stamp}`, description: 'Unités', allocatedAmount: 100000, projectId: project.id,
    } })).json()).data;
  });

  test.afterAll(async ({ request }) => {
    for (const id of requisitions) await request.delete(`/api/requisitions/${id}`, { headers: auth(admin) });
    if (line?.id) await request.delete(`/api/budget/${line.id}`, { headers: auth(admin) });
    if (created?.id && superToken) await request.delete(`/api/units/${created.id}`, { headers: auth(superToken) });
  });

  test('Unités préchargées, traduites (FR / EN)', async ({ request }) => {
    units = await unitsIn(request, 'fr');
    for (const code of SEEDED) expect(units.map(u => u.code), code).toContain(code);
    piece = units.find(u => u.code === 'PIECE');
    kilo = units.find(u => u.code === 'KG');
    expect(piece).toMatchObject({ abbr: 'pce', name: 'Pièce' });
    expect(kilo).toMatchObject({ abbr: 'kilo', name: 'Kilogramme' });

    const en = await unitsIn(request, 'en');
    expect(en.find(u => u.code === 'PIECE').name).toBe('Piece');
    expect(en.find(u => u.code === 'BOTTLE2').name).toBe('Flask');
    expect(en.find(u => u.code === 'BAG').name).toBe('Sachet');
  });

  test('Réquisition : unité choisie, « Pièce » par défaut, unité inconnue refusée', async ({ request }) => {
    const bad = await createRequisition(request, [{ description: 'X', unitId: 999999 }]);
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'UNIT_INVALID', line: 0 });

    const res = await createRequisition(request, [
      { description: 'Riz', unitId: kilo.id },
      { description: 'Sans unité' },
    ]);
    expect(res.status(), await res.text()).toBe(201);
    const id = (await res.json()).data.id;
    requisitions.push(id);

    const fr = (await (await request.get(`/api/requisitions/${id}`, { headers: auth(admin) })).json()).data;
    expect(fr.items.map(i => [i.unit_id, i.unit_abbr, i.item_unit])).toEqual([[kilo.id, 'kilo', 'Kilogramme'], [piece.id, 'pce', 'Pièce']]);
    const en = (await (await request.get(`/api/requisitions/${id}?lang=en`, { headers: auth(admin) })).json()).data;
    expect(en.items.map(i => i.item_unit)).toEqual(['Kilogram', 'Piece']);

    const pdf = await request.get(`/api/requisitions/${id}/export/pdf?lang=en`, { headers: auth(admin) });
    expect(pdf.status()).toBe(200);
  });

  test('Import d\'articles : colonne « Unité » (abréviation ou nom), unité inconnue signalée', async ({ request }) => {
    const csv = 'Description;Quantité;Unité;Prix unitaire\nRiz;2;kilo;5\nEau;3;Litre;1\nCâble;1;Mètre;2\nTruc;1;xyz;1\nLibre;1;;1\n';
    const res = await request.post('/api/requisitions/import-items', { headers: auth(admin), multipart: {
      file: { name: 'articles.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + csv, 'utf8') },
    } });
    expect(res.status(), await res.text()).toBe(200);
    const { items, errors } = (await res.json()).data;
    expect(items.map(i => i.unitAbbr || null)).toEqual(['kilo', 'ltr', 'met', null]);
    expect(errors).toEqual([expect.objectContaining({ line: 5, message: expect.stringContaining('xyz') })]);
  });

  test('Super admin : ajout (abréviation obligatoire et unique), traduction, suppression', async ({ request }) => {
    test.skip(!superToken, 'Super admin indisponible');
    const H = auth(superToken);
    expect((await request.post('/api/units', { headers: H, data: { name: `Jour ${stamp}` } })).status()).toBe(400);
    const dup = await request.post('/api/units', { headers: H, data: { name: `Doublon ${stamp}`, abbr: 'PCE' } });
    expect(dup.status()).toBe(409);

    const res = await request.post('/api/units', { headers: H, data: {
      name: `Jour ${stamp}`, abbr: `j${stamp}`.slice(0, 20), translations: { en: { name: `Day ${stamp}` } },
    } });
    expect(res.status(), await res.text()).toBe(201);
    created = (await res.json()).data;
    expect((await unitsIn(request, 'en')).find(u => u.id === created.id)?.name).toBe(`Day ${stamp}`);

    // Les comptes d'entreprise lisent les unités mais ne les modifient pas
    expect((await request.post('/api/units', { headers: auth(admin), data: { name: 'x', abbr: 'x' } })).status()).toBe(403);

    expect((await request.delete(`/api/units/${created.id}`, { headers: H })).status()).toBe(200);
    created = null;
  });

  test('Super admin : « Pièce » (unité par défaut) ni supprimée, ni désactivée, ni recodée', async ({ request }) => {
    test.skip(!superToken, 'Super admin indisponible');
    const H = auth(superToken);
    for (const res of [
      await request.delete(`/api/units/${piece.id}`, { headers: H }),
      await request.put(`/api/units/${piece.id}`, { headers: H, data: { isActive: false } }),
      await request.put(`/api/units/${piece.id}`, { headers: H, data: { code: 'PCS' } }),
    ]) {
      expect(res.status()).toBe(400);
      expect((await res.json()).code).toBe('UNIT_DEFAULT_LOCKED');
    }
    // Une unité utilisée ne se supprime pas (désactiver à la place)
    const used = await request.delete(`/api/units/${kilo.id}`, { headers: H });
    expect(used.status()).toBe(400);
  });
});
