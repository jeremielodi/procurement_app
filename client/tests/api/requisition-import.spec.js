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
