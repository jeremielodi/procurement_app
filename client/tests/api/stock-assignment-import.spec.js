import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Import des affectations existantes (registre des biens) : Code article + N° de série (ou N° d'inventaire) + Email du détenteur
//  - aperçu : équipement en stock, détenteur = utilisateur actif de l'entreprise, ligne sans email = reste au dépôt ;
//  - confirmation : un bon de sortie USER par dépôt × détenteur, une seule opération, matériel endommagé accepté ;
//  - modèle pré-rempli : équipements en stock, détenteur relevé dans les notes, email proposé si un seul utilisateur correspond.
test.describe.serial('API › Import des affectations d\'équipements', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const holder = { email: `holder.${stamp.toLowerCase()}@test.local`, password: 'Holder123!' };
  let admin, wh1, wh2, laptop, holderId;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const HEAD = ['Code article', 'N° de série', "N° d'inventaire", 'Email du détenteur', 'Motif'];
  const file = (rows, head = HEAD) => ({ file: { name: 'affectations.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + [head, ...rows].map(r => r.join(';')).join('\r\n'), 'utf8') } });
  const send = (request, rows, confirm = false) => request.post('/api/stock-units/assignments/import', { headers: H(), multipart: { ...file(rows), ...(confirm ? { confirm: '1' } : {}) } }).then(json);
  const units = async (request) => Object.fromEntries((await (await request.get(`/api/stock-units?stockItemId=${laptop.id}&limit=100`, { headers: H() })).json()).data.map(u => [u.serial_number, u]));

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    const created = await request.post('/api/users', { headers: H(), data: { username: `holder${stamp}`.toLowerCase(), email: holder.email, password: holder.password,
      firstName: 'Bienfait', lastName: `Buunda${stamp}`, profileIds: ['prof_requester'], allProjectsProfileIds: ['prof_requester'] } });
    expect(created.status(), await created.text()).toBe(201);
    holderId = (await created.json()).data.id;
    wh1 = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `AF1-${stamp}`, name: `Dépôt A ${stamp}`, locationId: locations[0].id } })).json()).data;
    wh2 = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `AF2-${stamp}`, name: `Dépôt B ${stamp}`, locationId: locations[0].id } })).json()).data;
    laptop = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `AF-LAP-${stamp}`, name: 'Laptop affecté', unit: 'pce', categoryId: (cats.find(c => c.is_stockable) || cats[0]).id, trackSerials: true } })).json()).data;
    const imp = await request.post('/api/stock-units/import', { headers: H(), multipart: {
      file: { name: 'parc.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + [
        ['Code article', 'N° de série', 'Code dépôt', 'État', 'Notes'],
        [laptop.code, `S1${stamp}`, wh1.code, 'Bon', `Détenteur : Chauffeur Bienfait BUUNDA${stamp} — Acquis : 2021`],
        [laptop.code, `S2${stamp}`, wh1.code, 'Endommagé', 'Détenteur : Bureau Goma'],
        [laptop.code, `S3${stamp}`, wh2.code, 'Bon', ''],
        [laptop.code, `S4${stamp}`, wh1.code, 'Bon', ''],
      ].map(r => r.join(';')).join('\r\n')) }, confirm: '1' } }).then(json);
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    expect(imp.body.data.units).toBe(4);
  });

  test('Modèle : équipements en stock, détenteur relevé dans les notes, email proposé', async ({ request }) => {
    const res = await request.get('/api/stock-units/assignments/import/template', { headers: H(), params: { format: 'csv' } });
    expect(res.status()).toBe(200);
    const lines = (await res.body()).toString('utf8').replace(/^﻿/, '').split(/\r\n/).filter(Boolean);
    expect(lines[0].split(';').slice(0, 5)).toEqual(HEAD);
    const s1 = lines.find(l => l.startsWith(`${laptop.code};S1${stamp};`)).split(';');
    expect(s1[3]).toBe(holder.email);                            // prénom et nom retrouvés dans « Chauffeur Bienfait BUUNDA… »
    expect(s1[8]).toBe(`Chauffeur Bienfait BUUNDA${stamp}`);
    const s2 = lines.find(l => l.startsWith(`${laptop.code};S2${stamp};`)).split(';');
    expect([s2[3], s2[8]]).toEqual(['', 'Bureau Goma']);         // un lieu : aucun email proposé
    const xlsx = await request.get('/api/stock-units/assignments/import/template', { headers: H(), params: { format: 'xlsx' } });
    expect((await xlsx.body()).subarray(0, 2).toString()).toBe('PK');
  });

  test('Aperçu : contrôles par ligne, ligne sans email laissée au dépôt', async ({ request }) => {
    const tagS3 = (await units(request))[`S3${stamp}`].asset_tag;
    const r = await send(request, [
      [laptop.code, `S1${stamp}`, '', holder.email, ''],
      [laptop.code, `S2${stamp}`, '', holder.email.toUpperCase(), ''],   // endommagé : accepté ; email insensible à la casse
      ['', '', tagS3, holder.email, 'Remis à la mission'],               // par n° d'inventaire seul
      [laptop.code, `S4${stamp}`, '', '', ''],                            // reste au dépôt
      [laptop.code, `S1${stamp}`, '', holder.email, ''],                 // en double
      [laptop.code, `INCONNU${stamp}`, '', holder.email, ''],
      [laptop.code, `S4${stamp}`, '', `personne.${stamp}@nulle.part`, ''],
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.summary).toMatchObject({ units: 3, holders: 1, issues: 2, skipped: 1, errors: 3 });
    expect(Object.fromEntries(r.body.data.errors.map(e => [e.line, e.code]))).toEqual({ 6: 'UNIT_DUPLICATE', 7: 'UNIT_NOT_FOUND', 8: 'HOLDER_UNKNOWN' });
    expect(r.body.data.units[1]).toMatchObject({ serial: `S2${stamp}`, condition: 'DAMAGED', holderEmail: holder.email });
    const missing = await json(await request.post('/api/stock-units/assignments/import', { headers: H(), multipart: file([[laptop.code, `S1${stamp}`]], ['Code article', 'N° de série']) }));
    expect([missing.status, missing.body.code]).toEqual([400, 'MISSING_COLUMNS']);
  });

  test('Confirmation : un bon de sortie par dépôt × détenteur, équipements affectés, détenteur notifié', async ({ request }) => {
    const tagS3 = (await units(request))[`S3${stamp}`].asset_tag;
    const r = await send(request, [
      [laptop.code, `S1${stamp}`, '', holder.email, ''],
      [laptop.code, `S2${stamp}`, '', holder.email, ''],
      ['', '', tagS3, holder.email, 'Remis à la mission'],
      [laptop.code, `S4${stamp}`, '', '', ''],
    ], true);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.units).toBe(3);
    expect(r.body.data.issues).toHaveLength(2);
    expect(r.body.data.issues.map(i => [i.warehouse, i.units]).sort()).toEqual([[wh1.code, 2], [wh2.code, 1]]);
    const u = await units(request);
    for (const s of ['S1', 'S2', 'S3']) expect(u[`${s}${stamp}`]).toMatchObject({ status: 'ASSIGNED', holder_id: holderId });
    expect(u[`S4${stamp}`].status).toBe('IN_STOCK');

    const issue = (await (await request.get(`/api/stock-issues/${r.body.data.issues.find(i => i.warehouse === wh2.code).id}`, { headers: H() })).json()).data;
    expect(issue).toMatchObject({ destination_type: 'USER', recipient_id: holderId, purpose: 'Remis à la mission', status: 'ISSUED' });
    const other = (await (await request.get(`/api/stock-issues/${r.body.data.issues.find(i => i.warehouse === wh1.code).id}`, { headers: H() })).json()).data;
    expect(other.purpose).toBe('Affectation existante (import du registre)');
    // Un bon de sortie = une opération de stock (migration 64) : 2 bons → 2 opérations, les unités d'un même bon ensemble
    const moves = (await (await request.get('/api/stock/movements', { headers: H(), params: { stockItemId: laptop.id, limit: 50 } })).json()).data
      .filter(m => m.movement_type === 'ISSUE');
    expect(moves).toHaveLength(3);
    expect(new Set(moves.map(m => m.group_id)).size).toBe(2);
    for (const number of new Set(moves.map(m => m.issue_number))) {
      expect(new Set(moves.filter(m => m.issue_number === number).map(m => m.group_id)).size).toBe(1);
    }

    const holderToken = (await (await request.post('/api/auth/login', { data: holder })).json()).data.token;
    const holdings = (await (await request.get('/api/stock-holdings/mine', { headers: auth(holderToken) })).json()).data;
    expect(holdings.filter(h => String(h.stock_item_id) === String(laptop.id))).toHaveLength(3);

    // Déjà affecté : refusé
    const again = await send(request, [[laptop.code, `S1${stamp}`, '', holder.email, '']]);
    expect(again.body.data.errors[0].code).toBe('UNIT_ASSIGNED');
  });
});
