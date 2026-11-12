import { test, expect } from '@playwright/test';
import { getToken, getApproverId, auth } from './helpers.js';

// Nature des articles (migration 63) : Équipement / Consommable — module Stock seulement (la réquisition garde tout le
// catalogue : recherche sans scope=stock). VIEW_EQUIPMENT / VIEW_CONSUMABLES = voir ; MANAGE_EQUIPMENT / MANAGE_CONSUMABLES =
// gérer (fiche, entrées, sorties…). Document mixte : visible avec les seules lignes autorisées.
// Migration 64 : une opération (MVG) par document. Migration 65 : profils de stock liés au projet (stock du projet de
// financement + stock sans projet).
test.describe.serial('API › Stock : équipements / consommables', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const mail = (k) => `nat.${k}.${stamp.toLowerCase()}@nowhere.test`;
  const accounts = {
    cons: { email: mail('cons'), password: 'Secret123', profiles: ['prof_consumables_manager'] },
    equip: { email: mail('equip'), password: 'Secret123', profiles: ['prof_equipment_manager'] },
    holder: { email: mail('holder'), password: 'Secret123', profiles: ['prof_requester'] },
    // Gère les consommables, voit seulement les équipements (VIEW_EQUIPMENT par le profil Finance)
    viewer: { email: mail('viewer'), password: 'Secret123', profiles: ['prof_consumables_manager', 'prof_finance'] },
  };
  const ids = {};
  const tokens = {};
  let admin, wh, paper, chair, laptop, mixedIssue, chairIssue, projectA, projectB;

  const json = async (res) => ({ status: res.status(), body: await res.json() });

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const H = auth(admin);
    for (const [key, a] of Object.entries(accounts)) {
      const created = await request.post('/api/users', {
        headers: H,
        // « Tous les projets » : ces comptes ne sont pas limités par projet (voir le test dédié)
        data: { username: a.email.split('@')[0], email: a.email, password: a.password, firstName: key, lastName: 'Nature', profileIds: a.profiles, allProjectsProfileIds: a.profiles },
      });
      expect(created.status(), await created.text()).toBe(201);
      ids[key] = (await created.json()).data.id;
      tokens[key] = (await (await request.post('/api/auth/login', { data: { email: a.email, password: a.password } })).json()).data.token;
    }
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    wh = (await (await request.post('/api/warehouses', { headers: H, data: { code: `NAT-${stamp}`.slice(0, 30), name: `Dépôt natures ${stamp}`, locationId: locations[0].id } })).json()).data;
    const approverId = await getApproverId(request);
    const mkProject = async (code) => (await (await request.post('/api/projects/', { headers: H, data: { code, name: `Projet ${code}`, projectManagerId: approverId } })).json()).data;
    projectA = await mkProject(`NTA-${stamp}`);
    projectB = await mkProject(`NTB-${stamp}`);
    // Gestionnaire des consommables limité au projet A
    const proj = { email: mail('proj'), password: 'Secret123' };
    const created = await request.post('/api/users', { headers: H, data: {
      username: proj.email.split('@')[0], email: proj.email, password: proj.password, firstName: 'proj', lastName: 'Nature',
      profileIds: ['prof_consumables_manager'], projectProfiles: [{ projectId: projectA.id, profileIds: ['prof_consumables_manager'] }],
    } });
    expect(created.status(), await created.text()).toBe(201);
    ids.proj = (await created.json()).data.id;
    tokens.proj = (await (await request.post('/api/auth/login', { data: proj })).json()).data.token;
    await request.put(`/api/warehouses/${wh.id}/users`, { headers: H, data: { userIds: [ids.cons, ids.equip, ids.viewer, ids.proj] } });
  });

  test('Catalogue : nature saisie, imposée par le n° de série, contrôlée', async ({ request }) => {
    const H = auth(admin);
    const create = (data) => request.post('/api/stock-items', { headers: H, data: { unit: 'pce', ...data } });
    paper = (await json(await create({ code: `NP-${stamp}`, name: 'Rame papier nature' }))).body.data;
    expect(paper.nature).toBe('CONSUMABLE'); // défaut
    chair = (await json(await create({ code: `NC-${stamp}`, name: 'Chaise nature', nature: 'EQUIPMENT' }))).body.data;
    expect(chair.nature).toBe('EQUIPMENT'); // équipement sans n° de série
    expect(chair.track_serials).toBe(false);
    laptop = (await json(await create({ code: `NL-${stamp}`, name: 'Portable nature', trackSerials: true }))).body.data;
    expect(laptop.nature).toBe('EQUIPMENT'); // imposé par le suivi par n° de série

    let r = await json(await create({ code: `NX-${stamp}`, name: 'Incohérent', trackSerials: true, nature: 'CONSUMABLE' }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NATURE_SERIALS_EQUIPMENT');
    r = await json(await create({ code: `NY-${stamp}`, name: 'Invalide', nature: 'MACHIN' }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NATURE_INVALID');

    // Filtre de la liste
    const list = async (nature) => (await (await request.get(`/api/stock-items?search=${stamp}&nature=${nature}&limit=100`, { headers: H })).json()).data.map(i => i.code);
    expect(await list('EQUIPMENT')).toEqual(expect.arrayContaining([chair.code, laptop.code]));
    expect(await list('EQUIPMENT')).not.toContain(paper.code);
    expect(await list('CONSUMABLE')).toEqual([paper.code]);
  });

  test('Gestionnaire des consommables : ne voit ni ne crée d\'équipement', async ({ request }) => {
    const C = auth(tokens.cons);
    const codes = (await (await request.get(`/api/stock-items?search=${stamp}&limit=100`, { headers: C })).json()).data.map(i => i.code);
    expect(codes).toEqual([paper.code]);
    expect((await request.get(`/api/stock-items/${chair.id}`, { headers: C })).status()).toBe(404);
    expect((await request.put(`/api/stock-items/${chair.id}`, { headers: C, data: { name: 'x' } })).status()).toBe(404);

    const created = await json(await request.post('/api/stock-items', { headers: C, data: { code: `NCS-${stamp}`, name: 'Stylo nature', unit: 'pce' } }));
    expect(created.status).toBe(201);
    expect(created.body.data.nature).toBe('CONSUMABLE');
    const refused = await json(await request.post('/api/stock-items', { headers: C, data: { code: `NCE-${stamp}`, name: 'Table nature', unit: 'pce', nature: 'EQUIPMENT' } }));
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('NATURE_FORBIDDEN');

    // Équipements (unités suivies par n° de série) : réservés à VIEW_EQUIPMENT
    expect((await request.get('/api/stock-units', { headers: C })).status()).toBe(403);
    expect((await request.get('/api/stock-units', { headers: auth(tokens.equip) })).status()).toBe(200);

    // Réquisition : tout le catalogue ; écrans du stock (scope=stock) : natures autorisées
    const search = async (scope) => (await (await request.get(`/api/stock-items/search?q=${chair.code}${scope ? '&scope=stock' : ''}`, { headers: C })).json()).data.map(i => i.code);
    expect(await search(false)).toContain(chair.code);
    expect(await search(true)).not.toContain(chair.code);
  });

  test('Stock, sorties : soldes filtrés, document mixte limité aux lignes autorisées', async ({ request }) => {
    const H = auth(admin);
    for (const item of [paper, chair]) {
      const r = await request.post('/api/stock-adjustments', { headers: H, data: { warehouseId: wh.id, stockItemId: item.id, quantity: 10, reason: 'FOUND', comment: 'Stock de test' } });
      expect(r.status(), await r.text()).toBe(201);
    }
    const balanceCodes = async (token) => (await (await request.get(`/api/stock/balances?warehouseId=${wh.id}`, { headers: auth(token) })).json()).data.map(b => b.item_code);
    expect((await balanceCodes(admin)).sort()).toEqual([chair.code, paper.code].sort());
    expect(await balanceCodes(tokens.cons)).toEqual([paper.code]);
    expect(await balanceCodes(tokens.equip)).toEqual([chair.code]);
    const moveCodes = async (token) => [...new Set((await (await request.get(`/api/stock/movements?warehouseId=${wh.id}`, { headers: auth(token) })).json()).data.map(m => m.item_code))];
    expect(await moveCodes(tokens.cons)).toEqual([paper.code]);

    // Sortie d'un équipement par le gestionnaire des consommables : refusée
    const refused = await json(await request.post('/api/stock-issues', { headers: auth(tokens.cons), data: { warehouseId: wh.id, destinationType: 'USER', recipientId: ids.holder, purpose: 'Test', lines: [{ stockItemId: chair.id, quantity: 1 }] } }));
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('NATURE_FORBIDDEN');

    // Bon mixte (administrateur) puis bon d'équipement seul
    const issue = async (lines) => (await json(await request.post('/api/stock-issues', { headers: H, data: { warehouseId: wh.id, destinationType: 'USER', recipientId: ids.holder, purpose: 'Test natures', lines } }))).body.data;
    mixedIssue = await issue([{ stockItemId: paper.id, quantity: 2 }, { stockItemId: chair.id, quantity: 1 }]);
    chairIssue = await issue([{ stockItemId: chair.id, quantity: 1 }]);
    expect(mixedIssue.id).toBeTruthy();

    const C = auth(tokens.cons);
    const listed = (await (await request.get(`/api/stock-issues?warehouseId=${wh.id}`, { headers: C })).json()).data.map(i => i.id);
    expect(listed).toContain(mixedIssue.id);
    expect(listed).not.toContain(chairIssue.id);
    const detail = (await (await request.get(`/api/stock-issues/${mixedIssue.id}`, { headers: C })).json()).data;
    expect(detail.lines.map(l => l.item_code)).toEqual([paper.code]);
    expect(detail.hidden_line_count).toBe(1);
    expect((await request.get(`/api/stock-issues/${chairIssue.id}`, { headers: C })).status()).toBe(404);
    // Annuler le bon mixte toucherait la chaise : refusé
    const cancel = await json(await request.post(`/api/stock-issues/${mixedIssue.id}/cancel`, { headers: C, data: { reason: 'Test' } }));
    expect(cancel.status).toBe(403);
    expect(cancel.body.code).toBe('NATURE_FORBIDDEN');

    // Le bénéficiaire voit tout son bon
    const mine = (await (await request.get(`/api/stock-issues/${mixedIssue.id}`, { headers: auth(tokens.holder) })).json()).data;
    expect(mine.lines).toHaveLength(2);
    expect(mine.hidden_line_count).toBe(0);
  });

  test('Inventaires : un par nature dans le même dépôt, pas de chevauchement avec « tout le dépôt »', async ({ request }) => {
    const open = (token, data = {}) => request.post('/api/stock-counts', { headers: auth(token), data: { warehouseId: wh.id, ...data } });
    const cons = await json(await open(tokens.cons));
    expect(cons.status, JSON.stringify(cons.body)).toBe(201);
    const equip = await json(await open(tokens.equip));
    expect(equip.status, JSON.stringify(equip.body)).toBe(201);
    const all = await json(await open(admin));
    expect(all.status).toBe(409);
    expect(all.body.code).toBe('COUNT_ALREADY_OPEN');

    const consCount = (await (await request.get(`/api/stock-counts/${cons.body.data.id}`, { headers: auth(tokens.cons) })).json()).data;
    expect(consCount.nature).toBe('CONSUMABLE');
    expect(consCount.lines.map(l => l.item_code)).toEqual([paper.code]);
    expect((await request.get(`/api/stock-counts/${equip.body.data.id}`, { headers: auth(tokens.cons) })).status()).toBe(404);
    const consList = (await (await request.get(`/api/stock-counts?warehouseId=${wh.id}`, { headers: auth(tokens.cons) })).json()).data.map(c => c.id);
    expect(consList).toEqual([cons.body.data.id]);

    for (const [token, id] of [[tokens.cons, cons.body.data.id], [tokens.equip, equip.body.data.id]]) {
      expect((await request.post(`/api/stock-counts/${id}/cancel`, { headers: auth(token), data: { reason: 'Test' } })).status()).toBe(200);
    }
  });

  test('Voir sans gérer : VIEW_EQUIPMENT consulte les équipements, seul MANAGE_EQUIPMENT les fait entrer / sortir', async ({ request }) => {
    const V = auth(tokens.viewer);
    const item = (await json(await request.get(`/api/stock-items/${chair.id}`, { headers: V }))).body.data;
    expect(item.can_manage).toBe(false);
    expect((await json(await request.get(`/api/stock-items/${paper.id}`, { headers: V }))).body.data.can_manage).toBe(true);
    const codes = (await (await request.get(`/api/stock/balances?warehouseId=${wh.id}`, { headers: V })).json()).data.map(b => b.item_code);
    expect(codes).toEqual(expect.arrayContaining([chair.code, paper.code]));

    const created = await json(await request.post('/api/stock-items', { headers: V, data: { code: `NVE-${stamp}`, name: 'Bureau nature', unit: 'pce', nature: 'EQUIPMENT' } }));
    expect([created.status, created.body.code]).toEqual([403, 'NATURE_FORBIDDEN']);
    const issue = await json(await request.post('/api/stock-issues', { headers: V, data: { warehouseId: wh.id, destinationType: 'USER', recipientId: ids.holder, purpose: 'Test', lines: [{ stockItemId: chair.id, quantity: 1 }] } }));
    expect([issue.status, issue.body.code]).toEqual([403, 'NATURE_FORBIDDEN']);
    // Équipements à n° de série : consultation oui, enregistrement non
    expect((await request.get('/api/stock-units', { headers: V })).status()).toBe(200);
    expect((await request.post('/api/stock-units/register', { headers: V, data: { stockItemId: laptop.id, warehouseId: wh.id, units: [{ serialNumber: `V-${stamp}` }] } })).status()).toBe(403);
    // Bon mixte : visible en entier, mais pas annulable (il touche des équipements)
    const mixed = (await (await request.get(`/api/stock-issues/${mixedIssue.id}`, { headers: V })).json()).data;
    expect(mixed.lines).toHaveLength(2);
    expect(mixed.can_manage).toBe(false);
  });

  test('Projet : un gestionnaire limité au projet A voit et sort le stock du projet A et le stock sans projet seulement', async ({ request }) => {
    const H = auth(admin);
    for (const [project, quantity] of [[projectA, 5], [projectB, 7]]) {
      const r = await request.post('/api/stock-adjustments', { headers: H, data: { warehouseId: wh.id, stockItemId: paper.id, quantity, reason: 'FOUND', comment: 'Stock projet', projectId: project.id } });
      expect(r.status(), await r.text()).toBe(201);
    }
    const P = auth(tokens.proj);
    const rows = (await (await request.get(`/api/stock/balances?warehouseId=${wh.id}`, { headers: P })).json()).data;
    expect(rows.every(b => b.item_code === paper.code)).toBe(true); // consommables seulement
    expect(rows.map(b => b.project_id || null).sort()).toEqual([null, projectA.id].sort());
    const moves = (await (await request.get(`/api/stock/movements?warehouseId=${wh.id}&limit=100`, { headers: P })).json()).data;
    expect(moves.some(m => m.project_id === projectB.id)).toBe(false);
    const item = (await (await request.get(`/api/stock-items/${paper.id}`, { headers: P })).json()).data;
    expect(Number(item.stock_quantity)).toBe(8 + 5); // sans projet (10 − 2 sortis) + projet A ; jamais le projet B

    const toB = await json(await request.post('/api/stock-issues', { headers: P, data: { warehouseId: wh.id, destinationType: 'USER', recipientId: ids.holder, projectId: projectB.id, purpose: 'Test', lines: [{ stockItemId: paper.id, quantity: 1 }] } }));
    expect([toB.status, toB.body.code]).toEqual([403, 'PROJECT_FORBIDDEN']);
    const tooMuch = await json(await request.post('/api/stock-issues', { headers: P, data: { warehouseId: wh.id, destinationType: 'USER', recipientId: ids.holder, purpose: 'Test', lines: [{ stockItemId: paper.id, quantity: 14 }] } }));
    expect([tooMuch.status, tooMuch.body.code]).toEqual([400, 'STOCK_INSUFFICIENT']);
    const ok = await json(await request.post('/api/stock-issues', { headers: P, data: { warehouseId: wh.id, destinationType: 'USER', recipientId: ids.holder, purpose: 'Test projet', lines: [{ stockItemId: paper.id, quantity: 12 }] } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const lines = (await (await request.get(`/api/stock-issues/${ok.body.data.id}`, { headers: H })).json()).data.lines;
    expect(lines.every(l => [null, projectA.id].includes(l.project_id))).toBe(true);
    expect(lines.reduce((s, l) => s + l.quantity, 0)).toBe(12);

    // Le stock du projet B reste intact ; l'entrée sur le projet B est refusée
    const bRows = (await (await request.get(`/api/stock/balances?warehouseId=${wh.id}&projectId=${projectB.id}`, { headers: H })).json()).data;
    expect(bRows.reduce((s, b) => s + Number(b.quantity), 0)).toBe(7);
    const entry = await json(await request.post('/api/stock-entries', { headers: P, data: { warehouseId: wh.id, entryType: 'DONATION', origin: 'Test', projectId: projectB.id, lines: [{ stockItemId: paper.id, quantity: 1 }] } }));
    expect([entry.status, entry.body.code]).toEqual([403, 'PROJECT_FORBIDDEN']);
  });

  test('Recherche globale : articles des natures autorisées seulement', async ({ request }) => {
    const groups = async (token) => (await (await request.get(`/api/search?q=${stamp}`, { headers: auth(token) })).json()).data;
    const items = (g) => (g.find(x => x.group === 'stockItems')?.items || []).map(i => i.label);
    expect(items(await groups(tokens.cons))).not.toContain(chair.code);
    expect(items(await groups(tokens.cons))).toContain(paper.code);
    expect(items(await groups(tokens.equip))).toContain(chair.code);
  });
});
