import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Gestion de stock liée aux achats :
// dépôts (par entreprise, par localisation) + accès → catalogue d'articles → réquisition / PO avec articles
// → réceptions (GRN) partielles avec lots → entrées en stock, suivi des livraisons, sur-livraison refusée,
// choix du dépôt, annulation (écritures inverses), export, cloisonnement entre entreprises.
const SUPERADMIN = {
  email: process.env.SUPERADMIN_EMAIL || 'superadmin@procureapp.com',
  password: process.env.SUPERADMIN_PASSWORD || 'SuperAdmin123!',
};

const future = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);

test.describe.serial('API › Gestion de stock', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const logistic = { email: `logistic.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const requester = { email: `requester.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  let admin, logisticToken, requesterToken, logisticId;
  let goma, bunia, w1, w2, w3, fuel, med, refs = {};
  let po, poLines = {}, grn1, grn2;

  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const asAdmin = () => auth(admin);
  const asLogistic = () => auth(logisticToken);

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const [locations, depts, projects, suppliers] = await Promise.all(
      ['/api/public/locations', '/api/departments', '/api/projects', '/api/suppliers'].map(async (u) => (await (await request.get(u, { headers: asAdmin() })).json()).data)
    );
    goma = locations.find(l => l.code === 'GOMA');
    bunia = locations.find(l => l.code === 'BUNIA');
    refs = { dept: depts[0], project: projects[0], supplier: suppliers[0] };

    for (const [account, profile] of [[logistic, 'prof_logistic'], [requester, 'prof_requester']]) {
      const created = await request.post('/api/users', {
        headers: asAdmin(),
        data: { username: account.email.split('@')[0], email: account.email, password: account.password, firstName: 'Test', lastName: profile, profileIds: [profile] },
      });
      expect(created.status(), `création ${profile}`).toBe(201);
      if (profile === 'prof_logistic') logisticId = (await created.json()).data.id;
    }
    logisticToken = (await (await request.post('/api/auth/login', { data: logistic })).json()).data.token;
    requesterToken = (await (await request.post('/api/auth/login', { data: requester })).json()).data.token;
  });

  test('Référentiels : codes stables, catégories stockables', async ({ request }) => {
    expect(goma?.code).toBe('GOMA');
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    expect(cats.find(c => c.code === 'FUEL')?.is_stockable).toBe(true);
    expect(cats.find(c => c.code === 'HOTEL')?.is_stockable).toBe(false);
    refs.cats = Object.fromEntries(cats.map(c => [c.code, c]));
  });

  test('Dépôts : créés par l\'admin, plusieurs par localisation, code unique', async ({ request }) => {
    const create = (data, token = asAdmin()) => request.post('/api/warehouses', { headers: token, data });
    let r = await json(await create({ code: `G1-${stamp}`.slice(0, 30), name: 'Dépôt central Goma', locationId: goma.id }));
    expect(r.status).toBe(201);
    w1 = r.body.data;
    expect(w1.location_name).toBe('Goma');
    r = await json(await create({ code: `G2-${stamp}`.slice(0, 30), name: 'Dépôt aéroport Goma', locationId: goma.id }));
    expect(r.status).toBe(201);
    w2 = r.body.data;
    r = await json(await create({ code: `B1-${stamp}`.slice(0, 30), name: 'Dépôt Bunia', locationId: bunia.id }));
    w3 = r.body.data;

    expect((await create({ code: w1.code.toLowerCase(), name: 'Doublon', locationId: goma.id })).status()).toBe(400);
    expect((await create({ code: 'X1', name: 'Sans localisation' })).status()).toBe(400);
    expect((await create({ code: 'X2', name: 'Pirate', locationId: goma.id }, asLogistic())).status()).toBe(403);
    const list = (await (await request.get(`/api/warehouses?locationId=${goma.id}`, { headers: asAdmin() })).json()).data;
    expect(list.map(w => w.id)).toEqual(expect.arrayContaining([w1.id, w2.id]));
  });

  test('Accès : la logistique ne voit que les dépôts accordés', async ({ request }) => {
    expect((await (await request.get('/api/warehouses/mine', { headers: asLogistic() })).json()).data).toEqual([]);
    const r = await json(await request.put(`/api/warehouses/${w1.id}/users`, { headers: asAdmin(), data: { userIds: [logisticId] } }));
    expect(r.status).toBe(200);
    expect(r.body.data.map(u => u.email)).toEqual([logistic.email]);
    const mine = (await (await request.get('/api/warehouses/mine', { headers: asLogistic() })).json()).data;
    expect(mine.map(w => w.id)).toEqual([w1.id]);
  });

  test('Catalogue : règles de création', async ({ request }) => {
    const create = (data) => request.post('/api/stock-items', { headers: asLogistic(), data });
    let r = await json(await create({ code: `FUEL-${stamp}`, name: 'Gasoil', unit: 'L', categoryId: refs.cats.FUEL.id, minQuantity: 500 }));
    expect(r.status).toBe(201);
    fuel = r.body.data;
    expect(fuel.is_stockable).toBe(true); // déduit de la catégorie
    r = await json(await create({ code: `MED-${stamp}`, name: 'Paracétamol 500 mg', unit: 'boîte', categoryId: refs.cats.MEDICAL_SUPPLIES.id, trackLots: true, trackExpiry: true }));
    expect(r.status).toBe(201);
    med = r.body.data;
    r = await json(await create({ code: `HOTEL-${stamp}`, name: 'Nuitée', unit: 'nuit', categoryId: refs.cats.HOTEL.id }));
    expect(r.body.data.is_stockable).toBe(false);

    expect((await create({ code: fuel.code.toLowerCase(), name: 'Doublon', unit: 'L' })).status()).toBe(400);
    expect((await create({ code: `BAD-${stamp}`, name: 'x', unit: 'u', trackExpiry: true })).status()).toBe(400);
    expect((await request.post('/api/stock-items', { headers: auth(requesterToken), data: { code: 'R1', name: 'x', unit: 'u' } })).status()).toBe(403);
    // Autocomplétion ouverte à tous les utilisateurs de l'entreprise, consultation du stock non
    const found = (await (await request.get(`/api/stock-items/search?q=${encodeURIComponent(`FUEL-${stamp}`)}`, { headers: auth(requesterToken) })).json()).data;
    expect(found.map(i => i.id)).toContain(fuel.id);
    expect((await request.get('/api/stock/balances', { headers: auth(requesterToken) })).status()).toBe(403);
  });

  test('Import de réquisition : colonne « Code article » facultative', async ({ request }) => {
    const csv = `Description;Quantité;Fréquence;Prix unitaire;Code article\n;20;1;1,5;${fuel.code.toLowerCase()}\nFormation;1;1;100;\nX;1;1;1;INCONNU-${stamp}\n`;
    const res = await json(await request.post('/api/requisitions/import-items', {
      headers: asAdmin(),
      multipart: { file: { name: 'import.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + csv, 'utf8') } },
    }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [fuelLine, freeLine] = res.body.data.items;
    expect(fuelLine).toMatchObject({ stockItemId: fuel.id, itemCode: fuel.code, description: 'Gasoil', unit: 'L' }); // désignation reprise du catalogue
    expect(freeLine.stockItemId).toBeUndefined();
    expect(res.body.data.errors.map(e => e.line)).toEqual([4]);
  });

  test('Réquisition puis PO : l\'article suit chaque ligne', async ({ request }) => {
    test.skip(!refs.dept || !refs.supplier, 'Département / fournisseur requis');
    const req = await json(await request.post('/api/requisitions', {
      headers: asAdmin(),
      data: {
        title: `[TEST STOCK] ${stamp}`, description: 'Test gestion de stock', departmentId: refs.dept.id, projectId: refs.project?.id,
        currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'Test',
        items: [
          { description: 'Gasoil', quantity: 100.5, frequency: 1, unitPrice: 1.5, stockItemId: fuel.id },
          { description: 'Paracétamol 500 mg', quantity: 50, frequency: 1, unitPrice: 2, stockItemId: med.id },
          { description: 'Formation des agents (texte libre)', quantity: 3, frequency: 1, unitPrice: 100 },
        ],
      },
    }));
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const detail = (await (await request.get(`/api/requisitions/${req.body.data.id}`, { headers: asAdmin() })).json()).data;
    expect(detail.items.map(i => i.item_code)).toEqual([fuel.code, med.code, null]);

    const created = await json(await request.post('/api/purchase-orders', {
      headers: asAdmin(),
      data: {
        requisitionId: detail.id, supplierId: refs.supplier.id, currency: 'USD', totalAmount: 550.75,
        items: detail.items.map(i => ({
          description: i.item_description, quantity: Number(i.quantity), unitPrice: Number(i.unit_price),
          stockItemId: i.stock_item_id, requisitionItemId: i.id,
        })),
      },
    }));
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    po = (await (await request.get(`/api/purchase-orders/${created.body.data.id}`, { headers: asAdmin() })).json()).data;
    expect(po.delivery_status).toBe('NOT_DELIVERED');
    for (const line of po.items) {
      if (line.stock_item_id === fuel.id) poLines.fuel = line;
      else if (line.stock_item_id === med.id) poLines.med = line;
      else poLines.free = line;
    }
    expect(poLines.fuel.quantity).toBe(100.5); // décimales conservées, renvoyées en nombre
    expect(poLines.fuel.quantity_remaining).toBe(100.5);
    expect(poLines.med.track_lots).toBe(true);
  });

  test('GRN : contrôles (lot, péremption, sur-livraison) — rien n\'est créé en cas d\'erreur', async ({ request }) => {
    test.skip(!po);
    const post = (grnItems, extra = {}) => request.post('/api/goods-receipts', { headers: asLogistic(), data: { poId: po.id, grnItems, ...extra } });
    const line = (l, qty, more = {}) => ({ poItemId: l.id, item_description: l.item_description, quantity_received: qty, quantity_accepted: qty, quantity_rejected: 0, ...more });

    let r = await json(await post([line(poLines.med, 10)]));
    expect([r.status, r.body.code]).toEqual([400, 'LOT_REQUIRED']);
    r = await json(await post([line(poLines.med, 10, { lotNumber: 'L-OLD', expiryDate: '2020-01-01' })]));
    expect(r.body.code).toBe('LOT_EXPIRED');
    r = await json(await post([line(poLines.fuel, 100.6)]));
    expect([r.status, r.body.code, r.body.remaining]).toEqual([400, 'OVER_DELIVERY', 100.5]);
    r = await json(await post([{ ...line(poLines.fuel, 10), quantity_accepted: 9 }]));
    expect(r.body.code).toBe('INVALID_QUANTITY');
    const grns = (await (await request.get(`/api/purchase-orders/${po.id}/goods-receipts`, { headers: asLogistic() })).json()).data;
    expect(grns).toEqual([]);
  });

  test('GRN partiel : dépôt unique choisi d\'office, entrées en stock de l\'accepté, lots', async ({ request }) => {
    test.skip(!po);
    const r = await json(await request.post('/api/goods-receipts', {
      headers: asLogistic(),
      data: {
        poId: po.id, observations: 'Première livraison',
        grnItems: [
          { poItemId: poLines.fuel.id, quantity_received: 70.5, quantity_accepted: 60.5, quantity_rejected: 10, rejection_reason: 'Bidons fuyants' },
          { poItemId: poLines.med.id, quantity_received: 30, quantity_accepted: 30, quantity_rejected: 0, lotNumber: `L1-${stamp}`, expiryDate: future(400) },
          { poItemId: poLines.free.id, quantity_received: 3, quantity_accepted: 3, quantity_rejected: 0 },
        ],
      },
    }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    grn1 = r.body.data;
    expect(grn1.warehouseId).toBe(w1.id);
    expect(grn1.stockMovements).toBe(2); // la formation (texte libre) n'entre pas en stock
    expect(grn1.poFullyDelivered).toBe(false);

    const balances = (await (await request.get(`/api/stock/balances?warehouseId=${w1.id}`, { headers: asLogistic() })).json()).data;
    expect(balances.find(b => b.stock_item_id === fuel.id).quantity).toBe('60.5000');
    const medLot = balances.find(b => b.stock_item_id === med.id);
    expect([medLot.lot_number, Number(medLot.quantity)]).toEqual([`L1-${stamp}`, 30]);

    const delivery = (await (await request.get(`/api/purchase-orders/${po.id}/delivery`, { headers: asLogistic() })).json()).data;
    expect(delivery.deliveryStatus).toBe('PARTIALLY_DELIVERED');
    const byId = Object.fromEntries(delivery.items.map(i => [i.id, i]));
    expect(byId[poLines.fuel.id]).toMatchObject({ delivered_accepted: 60.5, delivered_rejected: 10, quantity_remaining: 40 });
    expect(byId[poLines.med.id].quantity_remaining).toBe(20);
    expect(byId[poLines.free.id].quantity_remaining).toBe(0);
    expect(delivery.receipts.map(g => g.grn_number)).toEqual([grn1.grnNumber]);

    const detail = (await (await request.get(`/api/goods-receipts/${grn1.id}`, { headers: asLogistic() })).json()).data;
    expect(detail.warehouse_name).toBe('Dépôt central Goma');
    expect(detail.items.find(i => i.po_item_id === poLines.med.id).lot_number).toBe(`L1-${stamp}`);
  });

  test('Plusieurs dépôts accessibles : choix obligatoire, et seulement parmi les dépôts accordés', async ({ request }) => {
    test.skip(!po);
    await request.put(`/api/warehouses/${w2.id}/users`, { headers: asAdmin(), data: { userIds: [logisticId] } });
    const post = (extra) => request.post('/api/goods-receipts', {
      headers: asLogistic(),
      data: { poId: po.id, grnItems: [{ poItemId: poLines.fuel.id, quantity_received: 40, quantity_accepted: 40, quantity_rejected: 0 }], ...extra },
    });
    let r = await json(await post({}));
    expect([r.status, r.body.code]).toEqual([400, 'WAREHOUSE_REQUIRED']);
    r = await json(await post({ warehouseId: w3.id }));
    expect([r.status, r.body.code]).toEqual([403, 'WAREHOUSE_FORBIDDEN']);
    r = await json(await post({ warehouseId: w2.id }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    grn2 = r.body.data;
    expect(grn2.warehouseId).toBe(w2.id);
  });

  test('Lot existant avec une autre péremption refusé ; dernière livraison → PO livré', async ({ request }) => {
    test.skip(!po);
    const post = (lot, expiry) => request.post('/api/goods-receipts', {
      headers: asLogistic(),
      data: { poId: po.id, warehouseId: w1.id, grnItems: [{ poItemId: poLines.med.id, quantity_received: 20, quantity_accepted: 20, quantity_rejected: 0, lotNumber: lot, expiryDate: expiry }] },
    });
    let r = await json(await post(`l1-${stamp}`, future(10))); // même lot (casse différente), autre date
    expect(r.body.code).toBe('LOT_EXPIRY_MISMATCH');
    r = await json(await post(`L2-${stamp}`, future(200)));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.poFullyDelivered).toBe(true);
    const delivery = (await (await request.get(`/api/purchase-orders/${po.id}/delivery`, { headers: asAdmin() })).json()).data;
    expect([delivery.deliveryStatus, delivery.totals.remaining]).toEqual(['DELIVERED', 0]);
    const list = (await (await request.get(`/api/purchase-orders?search=${po.po_number}`, { headers: asAdmin() })).json()).data;
    expect(list.find(p => p.id === po.id).delivery_status).toBe('DELIVERED');
  });

  test('Mouvements et lots tracés ; stock par article', async ({ request }) => {
    test.skip(!po);
    const mv = (await (await request.get(`/api/stock/movements?stockItemId=${med.id}`, { headers: asLogistic() })).json());
    expect(mv.data.map(m => [m.movement_type, Number(m.quantity), m.lot_number]).sort()).toEqual([
      ['RECEIPT', 20, `L2-${stamp}`], ['RECEIPT', 30, `L1-${stamp}`],
    ]);
    expect(mv.data.every(m => /^MVT-\d{4}-\d{6}$/.test(m.movement_number) && m.grn_number && m.po_number === po.po_number)).toBe(true);
    const item = (await (await request.get(`/api/stock-items/${med.id}`, { headers: asLogistic() })).json()).data;
    expect(Number(item.stock_quantity)).toBe(50);
    expect(item.lots.map(l => l.lot_number)).toEqual([`L2-${stamp}`, `L1-${stamp}`]); // tri par péremption
    const below = (await (await request.get('/api/stock-items?belowMin=1&all=1&limit=1000', { headers: asLogistic() })).json()).data;
    expect(below.map(i => i.id)).toContain(fuel.id); // 100,5 L < minimum 500 L
  });

  test('Annulation d\'un GRN : écritures inverses, livraisons recalculées, pas de double annulation', async ({ request }) => {
    test.skip(!grn2);
    expect((await request.post(`/api/goods-receipts/${grn2.id}/cancel`, { headers: asLogistic(), data: {} })).status()).toBe(403); // permission
    const r = await json(await request.post(`/api/goods-receipts/${grn2.id}/cancel`, { headers: asAdmin(), data: { reason: 'Erreur de saisie' } }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.reversedMovements).toBe(1);
    const withEmpty = (await (await request.get(`/api/stock/balances?warehouseId=${w2.id}&includeEmpty=1`, { headers: asAdmin() })).json()).data;
    expect(Number(withEmpty.find(b => b.stock_item_id === fuel.id).quantity)).toBe(0);
    const balances = (await (await request.get(`/api/stock/balances?warehouseId=${w2.id}&includeEmpty=0`, { headers: asAdmin() })).json()).data;
    expect(balances.find(b => b.stock_item_id === fuel.id)).toBeUndefined(); // solde 0 → masqué par défaut
    const delivery = (await (await request.get(`/api/purchase-orders/${po.id}/delivery`, { headers: asAdmin() })).json()).data;
    expect(delivery.deliveryStatus).toBe('PARTIALLY_DELIVERED');
    expect(delivery.items.find(i => i.id === poLines.fuel.id).quantity_remaining).toBe(40);
    const again = await json(await request.post(`/api/goods-receipts/${grn2.id}/cancel`, { headers: asAdmin(), data: {} }));
    expect([again.status, again.body.code]).toEqual([409, 'ALREADY_CANCELLED']);
    const viaStatus = await request.patch(`/api/goods-receipts/${grn2.id}/status`, { headers: asAdmin(), data: { status: 'COMPLETE' } });
    expect(viaStatus.status()).toBe(409); // statut figé
  });

  test('Export Excel du stock', async ({ request }) => {
    const res = await request.get(`/api/stock/balances/export?warehouseId=${w1.id}`, { headers: asLogistic() });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('spreadsheetml');
    expect((await res.body()).subarray(0, 2).toString()).toBe('PK');
  });

  test('Cloisonnement : une autre entreprise ne voit ni n\'utilise les dépôts et articles', async ({ request }) => {
    const login = await request.post('/api/auth/login', { data: SUPERADMIN });
    const superToken = (await login.json()).data?.token;
    test.skip(!superToken, 'Super admin indisponible');
    expect((await request.get('/api/warehouses', { headers: auth(superToken) })).status()).toBe(403); // super admin : pas d'achats
    const other = { email: `stockadm.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
    const ent = await request.post('/api/enterprises', {
      headers: auth(superToken),
      multipart: { name: `Stock test ${stamp}`, code: `S${stamp}`.slice(0, 12), currencyId: '1', adminEmail: other.email, adminPassword: other.password, adminFirstName: 'Stock' },
    });
    expect(ent.status()).toBe(201);
    const otherToken = (await (await request.post('/api/auth/login', { data: other })).json()).data.token;
    const h = auth(otherToken);
    expect((await (await request.get('/api/warehouses?all=1', { headers: h })).json()).data).toEqual([]);
    expect((await (await request.get('/api/stock/balances', { headers: h })).json()).data).toEqual([]);
    expect((await (await request.get(`/api/stock-items/search?q=${stamp}`, { headers: h })).json()).data).toEqual([]);
    for (const url of [`/api/warehouses/${w1.id}`, `/api/stock-items/${fuel.id}`]) {
      expect((await request.get(url, { headers: h })).status(), url).toBe(404);
    }
    expect((await request.put(`/api/warehouses/${w1.id}/users`, { headers: h, data: { userIds: [] } })).status()).toBe(404);
    // Même code de dépôt autorisé dans une autre entreprise
    expect((await request.post('/api/warehouses', { headers: h, data: { code: w1.code, name: 'Homonyme', locationId: goma.id } })).status()).toBe(201);
  });
});
