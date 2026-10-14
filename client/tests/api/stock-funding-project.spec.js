import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Projet qui a financé chaque entrée en stock (migration 28_stock_funding_project.sql) :
//  - réception (GRN) : projet de la réquisition du bon de commande, automatique (équipements compris)
//  - ajustement d'entrée, parc existant, stock initial importé : projet saisi, facultatif (sortie : stock du projet choisi)
//  - journal des mouvements et équipements : projet affiché, filtre par projet ou « sans projet »
test.describe.serial('API › Stock — projet de financement', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let admin, warehouse, projectA, projectB, paper, laptop, refs = {};
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const movements = async (request, query) => (await (await request.get(`/api/stock/movements?limit=100&${query}`, { headers: H() })).json()).data;

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const [locations, depts, suppliers, cats] = await Promise.all(
      ['/api/public/locations', '/api/departments', '/api/suppliers', '/api/public/market-categories'].map(async (u) => (await (await request.get(u, { headers: H() })).json()).data)
    );
    refs = { dept: depts[0], supplier: suppliers[0] };
    const mkProject = async (code) => (await (await request.post('/api/projects/', { headers: H(), data: { code, name: `Projet ${code}` } })).json()).data;
    projectA = await mkProject(`SFA-${stamp}`);
    projectB = await mkProject(`SFB-${stamp}`);
    warehouse = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `SF-${stamp}`.slice(0, 30), name: `Dépôt financement ${stamp}`, locationId: locations[0].id } })).json()).data;
    const office = cats.find(c => c.is_stockable) || cats[0];
    paper = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `SF-PAP-${stamp}`, name: 'Papier A4', unit: 'rame', categoryId: office.id } })).json()).data;
    laptop = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `SF-LAP-${stamp}`, name: 'Ordinateur portable', unit: 'unité', categoryId: office.id, trackSerials: true } })).json()).data;
    expect(projectA?.id && projectB?.id && warehouse?.id && paper?.id && laptop?.id).toBeTruthy();
  });

  test('Réception (GRN) : projet de la réquisition repris automatiquement, aussi pour un équipement', async ({ request }) => {
    test.skip(!refs.dept || !refs.supplier, 'Département / fournisseur requis');
    const line = (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: `SF-L-${stamp}`, description: 'Ligne financement stock', allocatedAmount: 100_000, projectId: projectA.id,
    } })).json()).data;
    const req = (await (await request.post('/api/requisitions', { headers: H(), data: {
      title: `[TEST FINANCEMENT STOCK] ${stamp}`, description: 'x', departmentId: refs.dept.id, projectId: projectA.id, currencyId: 1, currencyCode: 'USD',
      priority: 'MEDIUM', justification: 'x', items: [
        { description: 'Papier A4', quantity: 10, frequency: 1, unitPrice: 5, stockItemId: paper.id, budgetLineId: line.id },
        { description: 'Ordinateur portable', quantity: 1, frequency: 1, unitPrice: 800, stockItemId: laptop.id, budgetLineId: line.id },
      ],
    } })).json()).data;
    const detail = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data;
    const created = await json(await request.post('/api/purchase-orders', { headers: H(), data: {
      requisitionId: detail.id, supplierId: refs.supplier.id, currency: 'USD', totalAmount: 850,
      items: detail.items.map(i => ({ description: i.item_description, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), stockItemId: i.stock_item_id, requisitionItemId: i.id })),
    } }));
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const po = (await (await request.get(`/api/purchase-orders/${created.body.data.id}`, { headers: H() })).json()).data;
    const lineOf = (id) => po.items.find(l => l.stock_item_id === id);
    const grn = await json(await request.post('/api/goods-receipts', { headers: H(), data: {
      poId: po.id, warehouseId: warehouse.id, grnItems: [
        { poItemId: lineOf(paper.id).id, quantity_received: 10, quantity_accepted: 10, quantity_rejected: 0 },
        { poItemId: lineOf(laptop.id).id, quantity_received: 1, quantity_accepted: 1, quantity_rejected: 0, serials: [{ serialNumber: `SN-SF-${stamp}` }] },
      ],
    } }));
    expect(grn.status, JSON.stringify(grn.body)).toBe(201);

    const receipts = await movements(request, `sourceType=GRN&sourceId=${grn.body.data.id}`);
    expect(receipts.length).toBe(2);
    expect(receipts.every(m => m.project_code === projectA.code)).toBe(true);
    const units = (await (await request.get(`/api/stock-units?stockItemId=${laptop.id}`, { headers: H() })).json()).data;
    expect(units.find(u => u.serial_number === `SN-SF-${stamp}`)?.project_code).toBe(projectA.code);
  });

  test('Ajustement d\'entrée : projet facultatif, contrôlé ; sortie : sur le stock du projet choisi', async ({ request }) => {
    const adjust = (data) => request.post('/api/stock-adjustments', { headers: H(), data: { warehouseId: warehouse.id, stockItemId: paper.id, reason: 'FOUND', comment: 'Trouvé', ...data } });
    const bad = await json(await adjust({ quantity: 3, projectId: '00000000-0000-0000-0000-000000000000' }));
    expect([bad.status, bad.body.code]).toEqual([400, 'PROJECT_NOT_FOUND']);
    expect((await adjust({ quantity: 5, projectId: projectB.id })).status()).toBe(201);
    expect((await adjust({ quantity: 2 })).status()).toBe(201);
    expect((await adjust({ quantity: -1, reason: 'DAMAGE', comment: 'Abîmé', projectId: projectB.id })).status()).toBe(201);

    const all = await movements(request, `stockItemId=${paper.id}&sourceType=ADJUSTMENT`);
    const byQty = Object.fromEntries(all.map(m => [Number(m.quantity), m.project_code || null]));
    expect(byQty).toEqual({ 5: projectB.code, 2: null, '-1': projectB.code });
    // Filtres : par projet, et « sans projet »
    expect((await movements(request, `stockItemId=${paper.id}&projectId=${projectB.id}`)).map(m => Number(m.quantity)).sort()).toEqual([-1, 5]);
    const none = await movements(request, `stockItemId=${paper.id}&projectId=none`);
    expect(none.every(m => !m.project_code)).toBe(true);
    expect(none.some(m => Number(m.quantity) === 2)).toBe(true);
  });

  test('Parc existant : projet de financement sur les équipements enregistrés', async ({ request }) => {
    const r = await json(await request.post('/api/stock-units/register', { headers: H(), data: {
      stockItemId: laptop.id, warehouseId: warehouse.id, projectId: projectB.id, units: [{ serialNumber: `SN-OLD-${stamp}` }],
    } }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [id] = r.body.data.ids;
    const unit = (await (await request.get(`/api/stock-units/${id}`, { headers: H() })).json()).data;
    expect([unit.project_code, unit.history[0]?.project_code]).toEqual([projectB.code, projectB.code]);
    const filtered = (await (await request.get(`/api/stock-units?projectId=${projectB.id}`, { headers: H() })).json()).data;
    expect(filtered.map(u => u.id)).toContain(id);
  });

  test('Import : colonne « Code projet » pour le stock initial (inconnu refusé)', async ({ request }) => {
    const csv = [
      'Code;Désignation;Unité;Code dépôt;Quantité initiale;Code projet',
      `SF-IMP1-${stamp};Cartouches;boîte;${warehouse.code};12;${projectA.code.toLowerCase()}`,
      `SF-IMP2-${stamp};Agrafes;boîte;${warehouse.code};4;`,
      `SF-IMP3-${stamp};Classeurs;pièce;${warehouse.code};3;INCONNU-${stamp}`,
    ].join('\r\n');
    const file = { name: 'import.csv', mimeType: 'text/csv', buffer: Buffer.from(`﻿${csv}\r\n`, 'utf8') };
    const preview = await json(await request.post('/api/stock-items/import', { headers: H(), multipart: { file } }));
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data.openings.map(o => o.project?.code || null)).toEqual([projectA.code, null]);
    expect(preview.body.data.errors.map(e => [e.line, e.code])).toEqual([[4, 'PROJECT_UNKNOWN']]);
    const done = await json(await request.post('/api/stock-items/import', { headers: H(), multipart: { file, confirm: '1' } }));
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const openings = await movements(request, `type=OPENING&search=SF-IMP`);
    const byCode = Object.fromEntries(openings.filter(m => m.item_code.endsWith(stamp)).map(m => [m.item_code, m.project_code || null]));
    expect(byCode).toEqual({ [`SF-IMP1-${stamp}`]: projectA.code, [`SF-IMP2-${stamp}`]: null });
  });
});
