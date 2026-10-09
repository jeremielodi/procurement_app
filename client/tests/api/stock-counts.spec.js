import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Inventaire physique (photo, comptage, stock trouvé, validation → ajustements, équipement non retrouvé → perdu)
// et ajustements ponctuels ; séparation des tâches COUNT_STOCK (logistique) / ADJUST_STOCK (admin).
test.describe.serial('API › Inventaires et ajustements', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const logistic = { email: `cnt.log.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  let admin, logToken, wh, fuel, med, laptop, units, lot, count;
  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const L = () => auth(logToken);
  const balance = async (request, itemId) => {
    const rows = (await (await request.get(`/api/stock/balances?warehouseId=${wh.id}&stockItemId=${itemId}&includeEmpty=1`, { headers: auth(admin) })).json()).data;
    return rows.reduce((s, r) => s + Number(r.quantity), 0);
  };

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const H = auth(admin);
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    const created = await request.post('/api/users', { headers: H, data: { username: `cntlog${stamp}`, email: logistic.email, password: logistic.password, firstName: 'Cnt', lastName: stamp, profileIds: ['prof_logistic'] } });
    expect(created.status()).toBe(201);
    logToken = (await (await request.post('/api/auth/login', { data: logistic })).json()).data.token;
    wh = (await (await request.post('/api/warehouses', { headers: H, data: { code: `CN-${stamp}`.slice(0, 30), name: `Dépôt inventaire ${stamp}`, locationId: locations[0].id } })).json()).data;
    await request.put(`/api/warehouses/${wh.id}/users`, { headers: H, data: { userIds: [(await created.json()).data.id] } });
    fuel = (await (await request.post('/api/stock-items', { headers: H, data: { code: `CNF-${stamp}`, name: `Gasoil inventaire ${stamp}`, unit: 'L', categoryId: cats.find(c => c.code === 'FUEL').id } })).json()).data;
    med = (await (await request.post('/api/stock-items', { headers: H, data: { code: `CNM-${stamp}`, name: `Médicament inventaire ${stamp}`, unit: 'boîte', categoryId: cats.find(c => c.code === 'MEDICAL_SUPPLIES').id, trackLots: true, trackExpiry: true } })).json()).data;
    laptop = (await (await request.post('/api/stock-items', { headers: H, data: { code: `CNL-${stamp}`, name: `Portable inventaire ${stamp}`, unit: 'pc', categoryId: cats.find(c => c.code === 'FUEL').id, trackSerials: true } })).json()).data;
    // Stock initial : 2 ordinateurs (parc existant) ; ajustements « trouvé » pour le gasoil (et un lot de médicaments, plus tard)
    expect((await request.post('/api/stock-units/register', { headers: L(), data: { stockItemId: laptop.id, warehouseId: wh.id, units: [`CN1-${stamp}`, `CN2-${stamp}`] } })).status()).toBe(201);
    units = (await (await request.get(`/api/stock-units?stockItemId=${laptop.id}`, { headers: H })).json()).data;
  });

  test('Ajustement ponctuel : droits, motif et commentaire obligatoires, entrée en stock', async ({ request }) => {
    const data = { warehouseId: wh.id, stockItemId: fuel.id, quantity: 100, reason: 'FOUND', comment: 'Stock initial non saisi' };
    expect((await request.post('/api/stock-adjustments', { headers: L(), data })).status()).toBe(403); // la logistique ne valide pas
    expect((await json(await request.post('/api/stock-adjustments', { headers: auth(admin), data: { ...data, comment: ' ' } }))).body.code).toBe('COMMENT_REQUIRED');
    expect((await json(await request.post('/api/stock-adjustments', { headers: auth(admin), data: { ...data, reason: 'MAGIC' } }))).body.code).toBe('INVALID_REASON');
    const ok = await json(await request.post('/api/stock-adjustments', { headers: auth(admin), data }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.adjustmentNumber).toMatch(/^AJU-\d{4}-\d{5}$/);
    expect(await balance(request, fuel.id)).toBe(100);
    // Sortie supérieure au stock refusée
    const tooMuch = await json(await request.post('/api/stock-adjustments', { headers: auth(admin), data: { ...data, quantity: -150, reason: 'LOSS' } }));
    expect([tooMuch.status, tooMuch.body.code]).toEqual([409, 'STOCK_INSUFFICIENT']);
    const list = (await (await request.get(`/api/stock-adjustments?warehouseId=${wh.id}`, { headers: L() })).json()).data;
    expect(list.map(a => [a.reason, a.quantity])).toEqual([['FOUND', 100]]);
  });

  test('Ouverture : photo du stock attendu ; un seul inventaire ouvert par dépôt', async ({ request }) => {
    const res = await json(await request.post('/api/stock-counts', { headers: L(), data: { warehouseId: wh.id, comment: 'Inventaire annuel' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.countNumber).toMatch(/^CNT-\d{4}-\d{5}$/);
    count = (await (await request.get(`/api/stock-counts/${res.body.data.id}`, { headers: L() })).json()).data;
    const expected = count.lines.map(l => [l.item_code, l.serial_number || null, l.expected_quantity]).sort();
    expect(expected).toEqual([[fuel.code, null, 100], [laptop.code, `CN1-${stamp}`, 1], [laptop.code, `CN2-${stamp}`, 1]].sort());
    const again = await json(await request.post('/api/stock-counts', { headers: L(), data: { warehouseId: wh.id } }));
    expect([again.status, again.body.code]).toEqual([409, 'COUNT_ALREADY_OPEN']);
  });

  test('Comptage : quantités, équipement présent / absent, stock trouvé avec un nouveau lot', async ({ request }) => {
    const byKey = (code, serial) => count.lines.find(l => l.item_code === code && (l.serial_number || null) === serial);
    const entries = [
      { lineId: byKey(fuel.code, null).id, countedQuantity: 92.5, note: 'Évaporation' },
      { lineId: byKey(laptop.code, `CN1-${stamp}`).id, countedQuantity: 1 },
      { lineId: byKey(laptop.code, `CN2-${stamp}`).id, countedQuantity: 0, note: 'Introuvable' },
    ];
    expect((await json(await request.put(`/api/stock-counts/${count.id}/lines`, { headers: L(), data: { entries: [{ lineId: entries[1].lineId, countedQuantity: 3 }] } }))).body.code).toBe('INVALID_UNIT_COUNT');
    expect((await request.put(`/api/stock-counts/${count.id}/lines`, { headers: L(), data: { entries } })).status()).toBe(200);
    // Stock trouvé : lot inconnu → créé (péremption obligatoire)
    expect((await json(await request.post(`/api/stock-counts/${count.id}/lines`, { headers: L(), data: { stockItemId: med.id, lotNumber: `LOT-${stamp}`, countedQuantity: 12 } }))).body.code).toBe('EXPIRY_REQUIRED');
    const added = await json(await request.post(`/api/stock-counts/${count.id}/lines`, { headers: L(), data: { stockItemId: med.id, lotNumber: `LOT-${stamp}`, expiryDate: '2030-01-31', countedQuantity: 12, note: 'Carton non enregistré' } }));
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const dup = await json(await request.post(`/api/stock-counts/${count.id}/lines`, { headers: L(), data: { stockItemId: med.id, lotNumber: `LOT-${stamp}`, countedQuantity: 1 } }));
    expect([dup.status, dup.body.code]).toEqual([409, 'LINE_EXISTS']);
    expect((await json(await request.post(`/api/stock-counts/${count.id}/lines`, { headers: L(), data: { stockItemId: laptop.id, countedQuantity: 1 } }))).body.code).toBe('SERIAL_ITEM');
  });

  test('Validation : réservée à ADJUST_STOCK, comptage complet exigé, écarts ajustés, équipement perdu', async ({ request }) => {
    expect((await request.post(`/api/stock-counts/${count.id}/validate`, { headers: L() })).status()).toBe(403);
    // Une ligne remise à « non comptée » bloque la validation
    const fuelLine = count.lines.find(l => l.item_code === fuel.code);
    await request.put(`/api/stock-counts/${count.id}/lines`, { headers: L(), data: { entries: [{ lineId: fuelLine.id, countedQuantity: null }] } });
    const incomplete = await json(await request.post(`/api/stock-counts/${count.id}/validate`, { headers: auth(admin) }));
    expect([incomplete.status, incomplete.body.code, incomplete.body.pending]).toEqual([409, 'NOT_COMPLETE', 1]);
    await request.put(`/api/stock-counts/${count.id}/lines`, { headers: L(), data: { entries: [{ lineId: fuelLine.id, countedQuantity: 92.5, note: 'Évaporation' }] } });

    const ok = await json(await request.post(`/api/stock-counts/${count.id}/validate`, { headers: auth(admin) }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.adjustedLines).toBe(3); // gasoil −7,5 ; portable perdu ; médicament +12
    expect(await balance(request, fuel.id)).toBe(92.5);
    expect(await balance(request, med.id)).toBe(12);
    expect(await balance(request, laptop.id)).toBe(1);
    const lost = (await (await request.get(`/api/stock-units/${units.find(u => u.serial_number === `CN2-${stamp}`).id}`, { headers: auth(admin) })).json()).data;
    expect(lost.status).toBe('LOST');
    const after = (await (await request.get(`/api/stock-counts/${count.id}`, { headers: L() })).json()).data;
    expect(after.status).toBe('VALIDATED');
    expect(after.lines.filter(l => l.movement_number).length).toBe(3);
    const movements = (await (await request.get(`/api/stock/movements?search=${count.count_number}`, { headers: auth(admin) })).json()).data;
    expect(movements.map(m => [m.movement_type, Number(m.quantity)]).sort()).toEqual([['ADJUSTMENT_IN', 12], ['ADJUSTMENT_OUT', -1], ['ADJUSTMENT_OUT', -7.5]].sort());
    expect(movements.every(m => m.count_number === count.count_number)).toBe(true);
    // Inventaire clos : plus de saisie
    expect((await json(await request.put(`/api/stock-counts/${count.id}/lines`, { headers: L(), data: { entries: [{ lineId: fuelLine.id, countedQuantity: 1 }] } }))).body.code).toBe('COUNT_CLOSED');
  });

  test('Inventaire partiel annulé : aucun mouvement ; un nouvel inventaire peut être ouvert', async ({ request }) => {
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    const res = await json(await request.post('/api/stock-counts', { headers: L(), data: { warehouseId: wh.id, categoryId: cats.find(c => c.code === 'MEDICAL_SUPPLIES').id } }));
    expect(res.status).toBe(201);
    const partial = (await (await request.get(`/api/stock-counts/${res.body.data.id}`, { headers: L() })).json()).data;
    expect(partial.lines.map(l => l.item_code)).toEqual([med.code]);
    expect((await request.post(`/api/stock-counts/${partial.id}/cancel`, { headers: L(), data: { reason: 'Erreur de périmètre' } })).status()).toBe(200);
    expect(await balance(request, med.id)).toBe(12);
    const list = (await (await request.get(`/api/stock-counts?warehouseId=${wh.id}`, { headers: L() })).json()).data;
    expect(list.map(c => c.status).sort()).toEqual(['CANCELLED', 'VALIDATED']);
  });
});
