import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

const csv = (text) => ({ name: 'items.csv', mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

test.describe('API › Réquisitions — import d\'articles & avancement', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
  });

  test('POST /api/requisitions/import-items — CSV ; avec décimales, guillemets et lignes invalides', async ({ request }) => {
    const res = await request.post('/api/requisitions/import-items', {
      headers: auth(token),
      multipart: {
        file: csv('﻿Description;Quantité;Fréquence;Prix unitaire\r\n'
          + 'GPS;3;1;450,50\r\n"Jumelles; étanches";5;;120\r\n;2;1;10\r\nTente;0;1;300\r\n'),
      },
    });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0]).toMatchObject({ description: 'GPS', quantity: 3, unitPrice: 450.5 });
    expect(body.data.items[1]).toMatchObject({ description: 'Jumelles; étanches', frequency: 1 });
    expect(body.data.errors.map(e => e.line)).toEqual([4, 5]);
  });

  // Modèle .xlsx (FR / EN) : réimporté tel quel, ses lignes d'exemple deviennent des articles (en-têtes reconnus, unités résolues)
  for (const [lang, first] of [['fr', 'Ordinateur portable 15"'], ['en', '15" laptop']]) {
    test(`GET /api/requisitions/import-items/template?lang=${lang} — .xlsx réimportable`, async ({ request }) => {
      const res = await request.get(`/api/requisitions/import-items/template?lang=${lang}`, { headers: auth(token) });
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('spreadsheetml');
      const buffer = await res.body();
      expect(buffer.subarray(0, 2).toString()).toBe('PK'); // archive .xlsx

      const back = await request.post('/api/requisitions/import-items', {
        headers: auth(token),
        multipart: { file: { name: 'template.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer } },
      });
      const body = await back.json();
      expect(back.status(), JSON.stringify(body)).toBe(200);
      expect(body.data.errors).toEqual([]);
      expect(body.data.items).toHaveLength(2);
      expect(body.data.items[0]).toMatchObject({ description: first, quantity: 2, frequency: 1, unitPrice: 950, unitAbbr: 'pce' });
      expect(body.data.items[1]).toMatchObject({ quantity: 10, frequency: 12, unitPrice: 6.5, unitAbbr: 'rame' });
    });
  }

  test('POST /api/requisitions/import-items — 400 colonnes manquantes', async ({ request }) => {
    const res = await request.post('/api/requisitions/import-items', {
      headers: auth(token), multipart: { file: csv('Nom,Montant\nA,1\n') },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/requisitions/import-items — 400 format non supporté', async ({ request }) => {
    const res = await request.post('/api/requisitions/import-items', {
      headers: auth(token), multipart: { file: { name: 'items.txt', mimeType: 'text/plain', buffer: Buffer.from('x') } },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/requisitions — avancement (progress_status) et filtre', async ({ request }) => {
    const body = await (await request.get('/api/requisitions', { headers: auth(token) })).json();
    const allowed = ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED'];
    for (const r of body.data) expect(allowed).toContain(r.progress_status);

    const filtered = await (await request.get('/api/requisitions?progress=IN_PROGRESS', { headers: auth(token) })).json();
    for (const r of filtered.data) expect(r.progress_status).toBe('IN_PROGRESS');
  });
});
