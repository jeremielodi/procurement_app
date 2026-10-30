import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Bons d'entrée en stock hors bon de commande (migration 47) :
// saisie (aucun mouvement) → validation par une AUTRE personne (mouvements ENTRY, lots, équipements à n° de série,
// coût → valorisation) ; refus, retrait par l'auteur ; annulation d'un bon validé = écritures inverses, refusée si le
// stock entré a été sorti ; cloisonnement par dépôt et droits.
const future = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);

test.describe.serial('API › Bons d\'entrée en stock', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const recorder = { email: `ent.rec.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const validator = { email: `ent.val.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  const requester = { email: `ent.req.${stamp.toLowerCase()}@nowhere.test`, password: 'Secret123' };
  let admin, recToken, valToken, reqToken, recorderId, validatorId;
  let wh, otherWh, project, fuel, med, laptop;
  let donation, withdrawn, rejected;

  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const balance = async (request, itemId, warehouseId = wh.id) => {
    const rows = (await (await request.get(`/api/stock/balances?warehouseId=${warehouseId}&stockItemId=${itemId}&includeEmpty=1`, { headers: auth(admin) })).json()).data;
    return rows.reduce((s, r) => s + Number(r.quantity), 0);
  };
  const create = (request, token, data) => request.post('/api/stock-entries', { headers: auth(token), data: { warehouseId: wh.id, ...data } });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const H = auth(admin);
    const get = async (u) => (await (await request.get(u, { headers: H })).json()).data;
    const [locations, projects, cats] = await Promise.all(['/api/public/locations', '/api/projects', '/api/public/market-categories'].map(get));
    project = projects[0];
    const ids = {};
    for (const [account, profile, key] of [[recorder, 'prof_logistic', 'rec'], [validator, 'prof_logistic', 'val'], [requester, 'prof_requester', 'req']]) {
      const created = await request.post('/api/users', { headers: H, data: { username: account.email.split('@')[0], email: account.email, password: account.password, firstName: key, lastName: profile, profileIds: [profile], allProjectsProfileIds: [profile] } });
      expect(created.status()).toBe(201);
      ids[key] = (await created.json()).data.id;
    }
    recorderId = ids.rec;
    validatorId = ids.val;
    const login = async (a) => (await (await request.post('/api/auth/login', { data: a })).json()).data.token;
    [recToken, valToken, reqToken] = await Promise.all([login(recorder), login(validator), login(requester)]);

    const goma = locations.find(l => l.code === 'GOMA');
    wh = (await (await request.post('/api/warehouses', { headers: H, data: { code: `EN-${stamp}`.slice(0, 30), name: `Dépôt entrées ${stamp}`, locationId: goma.id } })).json()).data;
    otherWh = (await (await request.post('/api/warehouses', { headers: H, data: { code: `EX-${stamp}`.slice(0, 30), name: `Dépôt sans accès ${stamp}`, locationId: goma.id } })).json()).data;
    await request.put(`/api/warehouses/${wh.id}/users`, { headers: H, data: { userIds: [recorderId, validatorId] } });

    const item = async (data) => (await (await request.post('/api/stock-items', { headers: H, data })).json()).data;
    fuel = await item({ code: `ENF-${stamp}`, name: 'Gasoil entrées', unit: 'L', categoryId: cats.find(c => c.code === 'FUEL').id });
    med = await item({ code: `ENM-${stamp}`, name: 'Antipaludéen don', unit: 'boîte', categoryId: cats.find(c => c.code === 'MEDICAL_SUPPLIES').id, trackLots: true, trackExpiry: true });
    laptop = await item({ code: `ENL-${stamp}`, name: 'Ordinateur don', unit: 'pce', categoryId: cats.find(c => c.code === 'IT_EQUIPMENT').id, trackSerials: true });
  });

  test('Droits : un demandeur ne saisit ni ne consulte de bon d\'entrée', async ({ request }) => {
    expect((await create(request, reqToken, { entryType: 'DONATION', lines: [{ stockItemId: fuel.id, quantity: 1 }] })).status()).toBe(403);
    expect((await request.get('/api/stock-entries', { headers: auth(reqToken) })).status()).toBe(403);
  });

  test('Saisie refusée : type, motif « autre », dépôt sans accès, lot / péremption / n° de série manquants', async ({ request }) => {
    const cases = [
      [{ entryType: 'GIFT', lines: [{ stockItemId: fuel.id, quantity: 1 }] }, 400, 'INVALID_ENTRY_TYPE'],
      [{ entryType: 'OTHER', lines: [{ stockItemId: fuel.id, quantity: 1 }] }, 400, 'REASON_REQUIRED'],
      [{ entryType: 'DONATION', lines: [] }, 400, 'NO_LINES'],
      [{ entryType: 'DONATION', warehouseId: otherWh.id, lines: [{ stockItemId: fuel.id, quantity: 1 }] }, 403, 'WAREHOUSE_FORBIDDEN'],
      [{ entryType: 'DONATION', lines: [{ stockItemId: fuel.id, quantity: 0 }] }, 400, 'INVALID_QUANTITY'],
      [{ entryType: 'DONATION', lines: [{ stockItemId: fuel.id, quantity: 1, unitCost: -2 }] }, 400, 'INVALID_COST'],
      [{ entryType: 'DONATION', lines: [{ stockItemId: med.id, quantity: 5, expiryDate: future(100) }] }, 400, 'LOT_REQUIRED'],
      [{ entryType: 'DONATION', lines: [{ stockItemId: med.id, quantity: 5, lotNumber: 'L1', expiryDate: future(-3) }] }, 400, 'LOT_EXPIRED'],
      [{ entryType: 'DONATION', lines: [{ stockItemId: laptop.id, quantity: 2, serials: ['SN-ONLY-ONE'] }] }, 400, 'SERIALS_REQUIRED'],
      [{ entryType: 'DONATION', lines: [{ stockItemId: laptop.id, quantity: 1, serials: [`D-${stamp}`] }, { stockItemId: laptop.id, quantity: 1, serials: [`d-${stamp}`] }] }, 400, 'SERIAL_DUPLICATE'],
    ];
    for (const [data, status, code] of cases) {
      const r = await json(await create(request, recToken, data));
      expect(r.status, `${code}: ${JSON.stringify(r.body)}`).toBe(status);
      expect(r.body.code).toBe(code);
    }
  });

  test('Don saisi : en attente, aucun mouvement ; les valideurs sont prévenus', async ({ request }) => {
    const r = await json(await create(request, recToken, {
      entryType: 'DONATION', origin: 'Bailleur test', deliveredBy: 'Chauffeur du bailleur', reference: `LTR-${stamp}`, projectId: project.id,
      lines: [
        { stockItemId: fuel.id, quantity: 200, unitCost: 1.2 },
        { stockItemId: med.id, quantity: 40, unitCost: 3, lotNumber: `DON-${stamp}`, expiryDate: future(300) },
        { stockItemId: laptop.id, quantity: 2, unitCost: 700, serials: [`SNA-${stamp}`, `SNB-${stamp}`] },
      ],
    }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    donation = r.body.data;
    expect(donation.entryNumber).toMatch(/^ENT-\d{4}-\d{5}$/);

    const detail = (await (await request.get(`/api/stock-entries/${donation.id}`, { headers: auth(recToken) })).json()).data;
    expect(detail.status).toBe('PENDING');
    expect(detail.total_value).toBeCloseTo(200 * 1.2 + 40 * 3 + 2 * 700, 4);
    expect(detail.lines.every(l => !l.movement_number)).toBe(true);
    expect(detail).toMatchObject({ can_validate: false, can_withdraw: true, self_validation: true });
    expect(await balance(request, fuel.id)).toBe(0);

    const notes = (await (await request.get(`/api/notifications/${validatorId}`, { headers: auth(valToken) })).json()).data || [];
    expect(notes.some(n => String(n.title).includes(donation.entryNumber))).toBe(true);
  });

  test('Séparation des tâches : l\'auteur ne peut ni valider ni refuser son propre bon (tracé)', async ({ request }) => {
    const r = await json(await request.post(`/api/stock-entries/${donation.id}/validate`, { headers: auth(recToken), data: {} }));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SELF_VALIDATION');
    expect((await json(await request.post(`/api/stock-entries/${donation.id}/reject`, { headers: auth(recToken), data: { reason: 'x' } }))).body.code).toBe('SELF_VALIDATION');
    const logs = (await (await request.get(`/api/audit-logs?action=SOD_VIOLATION_BLOCKED&q=${encodeURIComponent(recorder.email)}`, { headers: auth(admin) })).json()).data;
    expect(logs.some(l => (l.entity_ref || l.entity_id) === donation.id || JSON.stringify(l).includes(donation.entryNumber))).toBe(true);
  });

  test('Validation par une autre personne : stock, lot, équipements (n° d\'inventaire), projet, coût, opération', async ({ request }) => {
    const r = await json(await request.post(`/api/stock-entries/${donation.id}/validate`, { headers: auth(valToken), data: { comment: 'Vérifié' } }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const e = r.body.data;
    expect(e.status).toBe('VALIDATED');
    expect(e.validated_by).toBe(validatorId);
    expect(e.lines.every(l => l.movement_number)).toBe(true);
    const lap = e.lines.find(l => l.stock_item_id === laptop.id);
    expect(lap.units).toHaveLength(2);
    expect(lap.units.every(u => /^INV-\d{4}-\d{5}$/.test(u.asset_tag) && u.status === 'IN_STOCK')).toBe(true);

    expect(await balance(request, fuel.id)).toBe(200);
    expect(await balance(request, med.id)).toBe(40);
    expect(await balance(request, laptop.id)).toBe(2);

    const mv = (await (await request.get(`/api/stock/movements?sourceType=ENTRY&sourceId=${donation.id}&limit=50`, { headers: auth(admin) })).json());
    const rows = mv.data;
    expect(rows).toHaveLength(4); // gasoil, lot de médicaments, 2 équipements
    expect(rows.every(m => m.movement_type === 'ENTRY' && m.entry_number === donation.entryNumber && m.project_id === project.id)).toBe(true);
    expect(Number(rows.find(m => m.stock_item_id === fuel.id).unit_cost)).toBeCloseTo(1.2, 4);
    expect(new Set(rows.map(m => m.group_id)).size).toBe(1); // une validation = une opération
    // Recherche par n° du bon dans le journal et dans les opérations
    const found = (await (await request.get(`/api/stock/movements?search=${donation.entryNumber}`, { headers: auth(admin) })).json()).data;
    expect(found.map(m => m.id).sort()).toEqual(rows.map(m => m.id).sort());
    const groups = (await (await request.get(`/api/stock/movement-groups?search=${donation.entryNumber}`, { headers: auth(admin) })).json()).data;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ source_type: 'ENTRY', entry_number: donation.entryNumber, movement_count: 4 });

    const val = (await (await request.get(`/api/stock/valuation?warehouseId=${wh.id}`, { headers: auth(admin) })).json()).data;
    expect(val.items.find(i => i.stock_item_id === fuel.id)).toMatchObject({ quantity: 200, status: 'VALUED' });

    // Deuxième validation refusée
    expect((await json(await request.post(`/api/stock-entries/${donation.id}/validate`, { headers: auth(valToken), data: {} }))).body.code).toBe('NOT_PENDING');
  });

  test('N° de série déjà en stock : refusé à la saisie', async ({ request }) => {
    const r = await json(await create(request, recToken, { entryType: 'RETURN', lines: [{ stockItemId: laptop.id, quantity: 1, serials: [`sna-${stamp}`] }] }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('SERIAL_EXISTS');
  });

  test('Retrait par l\'auteur et refus par le valideur : aucun mouvement', async ({ request }) => {
    withdrawn = (await (await create(request, recToken, { entryType: 'OFF_SYSTEM_PURCHASE', origin: 'Marché', lines: [{ stockItemId: fuel.id, quantity: 10, unitCost: 1.5 }] })).json()).data;
    rejected = (await (await create(request, recToken, { entryType: 'OTHER', reason: 'Trouvé au magasin', lines: [{ stockItemId: fuel.id, quantity: 5 }] })).json()).data;

    // Le valideur ne retire pas le bon d'un autre ; l'auteur le retire (motif obligatoire)
    expect((await json(await request.post(`/api/stock-entries/${withdrawn.id}/cancel`, { headers: auth(valToken), data: { reason: 'x' } }))).body.code).toBe('NOT_AUTHOR');
    expect((await json(await request.post(`/api/stock-entries/${withdrawn.id}/cancel`, { headers: auth(recToken), data: {} }))).body.code).toBe('REASON_REQUIRED');
    let r = await json(await request.post(`/api/stock-entries/${withdrawn.id}/cancel`, { headers: auth(recToken), data: { reason: 'Saisi en double' } }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('CANCELLED');

    expect((await json(await request.post(`/api/stock-entries/${rejected.id}/reject`, { headers: auth(valToken), data: {} }))).body.code).toBe('REASON_REQUIRED');
    r = await json(await request.post(`/api/stock-entries/${rejected.id}/reject`, { headers: auth(valToken), data: { reason: 'Pas de justificatif' } }));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'REJECTED', reject_reason: 'Pas de justificatif' });
    expect((await json(await request.post(`/api/stock-entries/${rejected.id}/validate`, { headers: auth(valToken), data: {} }))).body.code).toBe('NOT_PENDING');

    expect(await balance(request, fuel.id)).toBe(200);
    const list = (await (await request.get(`/api/stock-entries?warehouseId=${wh.id}&status=REJECTED`, { headers: auth(admin) })).json()).data;
    expect(list.map(e => e.id)).toEqual([rejected.id]);
    const search = (await (await request.get(`/api/stock-entries?search=${encodeURIComponent(`SNB-${stamp}`)}`, { headers: auth(admin) })).json()).data;
    expect(search.map(e => e.id)).toEqual([donation.id]);
  });

  test('Annulation d\'un bon validé : refusée si le stock a été sorti, sinon écritures inverses', async ({ request }) => {
    // Le stock entré est utilisé (sortie de 150 L) → annulation refusée
    const issue = await json(await request.post('/api/stock-issues', { headers: auth(admin), data: {
      destinationType: 'USER', warehouseId: wh.id, recipientId: validatorId, lines: [{ stockItemId: fuel.id, quantity: 150 }],
    } }));
    expect(issue.status, JSON.stringify(issue.body)).toBe(201);
    expect((await json(await request.post(`/api/stock-entries/${donation.id}/cancel`, { headers: auth(valToken), data: { reason: 'Erreur' } }))).body.code).toBe('ENTRY_USED');
    expect(await balance(request, fuel.id)).toBe(50);

    // La sortie est annulée → l'annulation du bon passe : tout revient à zéro, équipements annulés
    expect((await request.post(`/api/stock-issues/${issue.body.data.id}/cancel`, { headers: auth(admin), data: { reason: 'test' } })).status()).toBe(200);
    // L'auteur (sans VALIDATE…) — ici logistique, donc autorisé ; le demandeur non
    expect((await request.post(`/api/stock-entries/${donation.id}/cancel`, { headers: auth(reqToken), data: { reason: 'x' } })).status()).toBe(403);
    const r = await json(await request.post(`/api/stock-entries/${donation.id}/cancel`, { headers: auth(valToken), data: { reason: 'Don retourné au bailleur' } }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('CANCELLED');
    expect(r.body.data.lines.every(l => l.reversal_movement_numbers)).toBe(true);
    expect(r.body.data.lines.find(l => l.stock_item_id === laptop.id).units.every(u => u.status === 'VOID')).toBe(true);
    for (const it of [fuel, med, laptop]) expect(await balance(request, it.id)).toBe(0);

    const audit = (await (await request.get('/api/audit-logs?actions=STOCK_ENTRY_VALIDATED,STOCK_ENTRY_CANCELLED,STOCK_ENTRY_REJECTED&limit=200', { headers: auth(admin) })).json()).data;
    const refs = audit.map(l => l.entity_ref);
    for (const id of [donation.id, withdrawn.id, rejected.id]) expect(refs).toContain(id);
  });

  test('Bon d\'entrée PDF (FR / EN)', async ({ request }) => {
    for (const lang of ['fr', 'en']) {
      const res = await request.get(`/api/stock-entries/${donation.id}/pdf?lang=${lang}`, { headers: auth(recToken) });
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('application/pdf');
      expect((await res.body()).subarray(0, 4).toString()).toBe('%PDF');
    }
  });

  test('Cloisonnement : un bon introuvable hors de l\'entreprise / id inconnu → 404', async ({ request }) => {
    expect((await request.get('/api/stock-entries/00000000-0000-0000-0000-000000000000', { headers: auth(admin) })).status()).toBe(404);
  });
});
