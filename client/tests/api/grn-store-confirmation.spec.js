import { test, expect } from '@playwright/test';
import zlib from 'zlib';
import { getToken, auth } from './helpers.js';

// Confirmation de l'entrée en magasin d'une réception (migration 61) : une personne ayant accès au dépôt du GRN, autre
// que celle qui l'a enregistré, confirme ; nom, fonction figée, date et signature dans le cadre « Dépôt » du PDF.
// Refus : son propre GRN (SELF_VALIDATION, tracé), sans accès au dépôt, deux fois. Notifications : magasin à la
// réception, auteur du GRN à la confirmation. Audit GOODS_RECEIPT_STORE_CONFIRMED.

/** PNG uni 8 × 4 (signature de test) */
function png([r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
    out.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return out;
  };
  const [w, h] = [8, 4];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const imageCount = (pdf) => (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;

test.describe.serial('API › GRN : confirmation de l\'entrée en magasin', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const accounts = {
    logistic: { email: `grnsc.log.${stamp.toLowerCase()}@nowhere.test`, profile: 'prof_logistic', position: null },
    keeper: { email: `grnsc.kep.${stamp.toLowerCase()}@nowhere.test`, profile: 'prof_store_keeper', position: `Magasinier ${stamp}` },
    outsider: { email: `grnsc.out.${stamp.toLowerCase()}@nowhere.test`, profile: 'prof_logistic', position: null },
  };
  const password = 'Secret123';
  let admin, tokens = {}, ids = {}, wh, grn;

  const json = async (res) => ({ status: res.status(), body: await res.json() });
  const confirm = (request, who, data = {}) => request.post(`/api/goods-receipts/${grn.id}/store-confirm`, { headers: auth(tokens[who]), data }).then(json);
  const detail = async (request, who) => (await (await request.get(`/api/goods-receipts/${grn.id}`, { headers: auth(tokens[who]) })).json()).data;
  const pdf = async (request) => {
    const res = await request.get(`/api/goods-receipts/${grn.id}/pdf?lang=fr`, { headers: auth(admin) });
    expect(res.status()).toBe(200);
    return res.body();
  };

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    const H = auth(admin);
    const get = async (u) => (await (await request.get(u, { headers: H })).json()).data;
    const [locations, depts, projects, suppliers, cats] = await Promise.all(
      ['/api/public/locations', '/api/departments', '/api/projects', '/api/suppliers', '/api/public/market-categories'].map(get));
    const goma = locations.find(l => l.code === 'GOMA') || locations[0];

    for (const [key, a] of Object.entries(accounts)) {
      const created = await request.post('/api/users', { headers: H, data: {
        username: a.email.split('@')[0], email: a.email, password, firstName: 'Test', lastName: key, position: a.position,
        profileIds: [a.profile], allProjectsProfileIds: a.profile === 'prof_store_keeper' ? [] : [a.profile],
      } });
      expect(created.status(), `création ${key}`).toBe(201);
      ids[key] = (await created.json()).data.id;
      tokens[key] = (await (await request.post('/api/auth/login', { data: { email: a.email, password } })).json()).data.token;
    }
    wh = (await (await request.post('/api/warehouses', { headers: H, data: { code: `GSC-${stamp}`.slice(0, 30), name: `Dépôt GSC ${stamp}`, locationId: goma.id } })).json()).data;
    await request.put(`/api/warehouses/${wh.id}/users`, { headers: H, data: { userIds: [ids.logistic, ids.keeper] } });
    const fuel = (await (await request.post('/api/stock-items', { headers: H, data: {
      code: `GSC-FUEL-${stamp}`, name: 'Gasoil GSC', unit: 'L', categoryId: cats.find(c => c.code === 'FUEL').id,
    } })).json()).data;

    // Réquisition → bon de commande → réception par la logistique (dans le dépôt)
    const req = await json(await request.post('/api/requisitions', { headers: H, data: {
      title: `[TEST GRN MAGASIN] ${stamp}`, description: 'Confirmation du magasin', departmentId: depts[0]?.id, projectId: projects[0]?.id,
      currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'Test',
      items: [{ description: `Gasoil ${stamp}`, quantity: 20, frequency: 1, unitPrice: 2, stockItemId: fuel.id }],
    } }));
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const r = await get(`/api/requisitions/${req.body.data.id}`);
    const po = await json(await request.post('/api/purchase-orders', { headers: H, data: {
      requisitionId: r.id, supplierId: suppliers[0].id, currency: 'USD', totalAmount: 40,
      items: r.items.map(i => ({ description: i.item_description, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), requisitionItemId: i.id, stockItemId: fuel.id })),
    } }));
    test.skip(po.status >= 300, `PO non créé (BpmnGo requis ?) : ${JSON.stringify(po.body)}`);
    const poLine = (await get(`/api/purchase-orders/${po.body.data.id}`)).items[0];
    const created = await json(await request.post('/api/goods-receipts', { headers: auth(tokens.logistic), data: {
      poId: po.body.data.id, warehouseId: wh.id,
      grnItems: [{ poItemId: poLine.id, quantity_received: 20, quantity_accepted: 20, quantity_rejected: 0 }],
    } }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    grn = created.body.data;
  });

  test.afterAll(async ({ request }) => {
    if (tokens.keeper) await request.delete('/api/auth/signature', { headers: auth(tokens.keeper) });
  });

  test('Réception enregistrée : à confirmer, le magasin est prévenu', async ({ request }) => {
    const mine = await detail(request, 'logistic');
    expect(mine).toMatchObject({ store_confirmed_at: null, can_store_confirm: false, store_self_confirmation: true });
    expect(await detail(request, 'keeper')).toMatchObject({ can_store_confirm: true, store_self_confirmation: false });
    expect(await detail(request, 'outsider')).toMatchObject({ can_store_confirm: false });
    const notes = (await (await request.get(`/api/notifications/${ids.keeper}`, { headers: auth(tokens.keeper) })).json()).data;
    expect(notes.some(n => n.title.includes(mine.grn_number) && n.link === `/goods-receipts/${grn.id}`)).toBe(true);
  });

  test('Refus : son propre GRN (tracé), sans accès au dépôt', async ({ request }) => {
    const self = await confirm(request, 'logistic');
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_VALIDATION');
    const logs = (await (await request.get('/api/audit-logs?action=SOD_VIOLATION_BLOCKED', { headers: auth(admin) })).json()).data;
    expect(logs.some(l => l.entity_ref === String(grn.id) || l.new_value?._label === grn.grnNumber)).toBe(true);

    const outsider = await confirm(request, 'outsider');
    expect(outsider.status).toBe(403);
    expect(outsider.body.code).toBe('WAREHOUSE_FORBIDDEN');
  });

  test('Le magasinier confirme : nom, fonction, signature dans le PDF ; une seule fois', async ({ request }) => {
    const before = imageCount(await pdf(request));
    const sig = await request.put('/api/auth/signature', { headers: auth(tokens.keeper), multipart: {
      signature: { name: 'signature.png', mimeType: 'image/png', buffer: png([30, 60, 170]) },
    } });
    expect(sig.status(), await sig.text()).toBe(200);
    // Signature enregistrée mais entrée pas encore confirmée : rien dans le PDF
    expect(imageCount(await pdf(request))).toBe(before);

    const ok = await confirm(request, 'keeper', { comment: '20 L rangés dans la cuve 2' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({
      store_confirmed_by: ids.keeper, store_confirmed_by_position: accounts.keeper.position,
      store_confirmation_comment: '20 L rangés dans la cuve 2', store_confirmed_by_name: 'Test keeper',
    });
    expect(ok.body.data.store_confirmed_at).toBeTruthy();
    expect(imageCount(await pdf(request))).toBe(before + 1);

    const again = await confirm(request, 'keeper');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_CONFIRMED');
    expect(await detail(request, 'keeper')).toMatchObject({ can_store_confirm: false });

    // Auteur du GRN prévenu, confirmation tracée
    const notes = (await (await request.get(`/api/notifications/${ids.logistic}`, { headers: auth(tokens.logistic) })).json()).data;
    expect(notes.some(n => n.link === `/goods-receipts/${grn.id}` && n.message.includes('Test keeper'))).toBe(true);
    const logs = (await (await request.get('/api/audit-logs?action=GOODS_RECEIPT_STORE_CONFIRMED', { headers: auth(admin) })).json()).data;
    expect(logs.some(l => l.entity_ref === String(grn.id))).toBe(true);
  });

  test('Fonction figée : un changement de poste ne modifie pas la confirmation', async ({ request }) => {
    const user = (await (await request.get(`/api/users/${ids.keeper}`, { headers: auth(admin) })).json()).data;
    const res = await request.put(`/api/users/${ids.keeper}`, { headers: auth(admin), data: {
      firstName: user.firstName, lastName: user.lastName, department: user.department, position: 'Autre poste', language: user.language,
      profileIds: user.profiles.map(p => p.id), allProjectsProfileIds: user.profiles.filter(p => p.all_projects).map(p => p.id),
    } });
    expect(res.status()).toBe(200);
    expect((await detail(request, 'keeper')).store_confirmed_by_position).toBe(accounts.keeper.position);
  });
});
