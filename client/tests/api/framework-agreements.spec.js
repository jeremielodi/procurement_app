import { test, expect } from '@playwright/test';
import { getToken, auth, PDF_BUFFER } from './helpers.js';

// Accords-cadres (migration 69_framework_agreements.sql) — phase 1 : registre et validation
//  - un fournisseur, une période, un plafond, un bordereau de prix ; projets facultatifs (aucun = toute l'entreprise) ;
//  - saisie manuelle : contrat signé joint obligatoire avant la soumission ;
//  - validation : chef de chaque projet listé, puis directeur général (prof_dg) qui active ; jamais l'auteur ;
//  - rejet = retour en brouillon (motif), nouvelle soumission = nouveau tour (les chefs de projet revalident).
test.describe.serial('API › Accords-cadres — registre et validation', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let requestRef, admin, pm1, pm2, dg, outsider, supplier, p1, p2, agreementId, globalId;
  const H = (token = admin) => auth(token);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const year = new Date().getFullYear();
  const base = () => ({
    title: `Fournitures de bureau ${stamp}`, supplierId: supplier.id, startDate: `${year}-01-01`, endDate: `${year + 1}-12-31`,
    ceilingAmount: 50000, contractReference: `CTR-${stamp}`,
    items: [
      { description: 'Rame de papier A4', unitPrice: 6.5, maxQuantity: 2000 },
      { description: 'Stylo bleu', unitPrice: 0.4 },
    ],
  });
  const create = (data, token = admin) => requestRef.post('/api/framework-agreements', { headers: H(token), data }).then(json);
  const get = (id, token = admin) => requestRef.get(`/api/framework-agreements/${id}`, { headers: H(token) }).then(json);
  const post = (id, action, data = {}, token = admin) => requestRef.post(`/api/framework-agreements/${id}/${action}`, { headers: H(token), data }).then(json);
  const decide = (id, token, decision = 'APPROVE', comment) => post(id, 'decision', { decision, comment }, token);
  const attach = (id) => requestRef.post('/api/upload', {
    headers: H(), multipart: { entity_type: 'framework_agreement', entity_id: id, file: { name: `contrat-${stamp}.pdf`, mimeType: 'application/pdf', buffer: PDF_BUFFER } },
  });

  test.beforeAll(async ({ request }) => {
    requestRef = request;
    admin = await getToken(request);
    const mk = async (prefix, profileIds) => {
      const email = `${prefix}.${stamp.toLowerCase()}@procurement.com`;
      const u = await json(await request.post('/api/users', { headers: H(), data: { username: `${prefix}${stamp}`, email, password: 'Secret123!', firstName: prefix, lastName: stamp, profileIds } }));
      expect(u.status, JSON.stringify(u.body)).toBe(201);
      const token = (await (await request.post('/api/auth/login', { data: { email, password: 'Secret123!' } })).json()).data.token;
      return { id: u.body.data.id, token };
    };
    const m1 = await mk('fapm1', ['prof_requester']);
    const m2 = await mk('fapm2', ['prof_requester']);
    pm1 = m1.token; pm2 = m2.token;
    dg = (await mk('fadg', ['prof_dg'])).token;
    outsider = (await mk('faout', ['prof_requester'])).token;
    p1 = (await (await request.post('/api/projects/', { headers: H(), data: { code: `FA1-${stamp}`, name: `Projet AC 1 ${stamp}`, projectManagerId: m1.id } })).json()).data;
    p2 = (await (await request.post('/api/projects/', { headers: H(), data: { code: `FA2-${stamp}`, name: `Projet AC 2 ${stamp}`, projectManagerId: m2.id } })).json()).data;
    supplier = (await (await request.post('/api/suppliers', { headers: H(), data: {
      name: `AC Fournisseur ${stamp}`, email: `ac.${stamp.toLowerCase()}@nowhere.test`, status: 'ACTIVE', prequalified: true,
    } })).json()).data;
    expect(p1?.id && p2?.id && supplier?.id).toBeTruthy();
  });

  test.beforeEach(({ request }) => { requestRef = request; });

  test('Contrôles de la saisie', async () => {
    const cases = [
      [{ title: '' }, 'TITLE_REQUIRED'],
      [{ supplierId: null }, 'SUPPLIER_REQUIRED'],
      [{ startDate: `${year}-06-01`, endDate: `${year}-01-01` }, 'DATES_INVALID'],
      [{ ceilingAmount: 0 }, 'CEILING_INVALID'],
      [{ items: [{ description: 'Article', unitPrice: -1 }] }, 'PRICE_INVALID'],
      [{ items: [{ description: '', unitPrice: 1 }] }, 'ITEM_DESCRIPTION_REQUIRED'],
      [{ projectIds: ['00000000-0000-0000-0000-000000000000'] }, 'PROJECT_NOT_FOUND'],
      [{ tenderId: 999999999 }, 'TENDER_NOT_FOUND'],
    ];
    for (const [patch, code] of cases) {
      const r = await create({ ...base(), ...patch });
      expect(r.body.code, `${code} ${JSON.stringify(r.body)}`).toBe(code);
    }
    // Sans la permission de gérer les accords-cadres
    expect((await create(base(), outsider)).status).toBe(403);
  });

  test('Brouillon, modification, contrat signé obligatoire à la soumission', async () => {
    const r = await create({ ...base(), projectIds: [p1.id, p2.id] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    agreementId = r.body.data.id;
    expect(r.body.data.agreementNumber).toMatch(/^AC-\d{4}-\d{5}$/);

    const upd = await json(await requestRef.put(`/api/framework-agreements/${agreementId}`, { headers: H(), data: {
      title: `Fournitures ${stamp}`, items: [...base().items, { description: 'Classeur', unitPrice: 3, maxQuantity: 100 }],
    } }));
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.data.items).toHaveLength(3);
    expect(upd.body.data.projects.map(p => p.id).sort()).toEqual([p1.id, p2.id].sort());
    expect(upd.body.data.status).toBe('DRAFT');
    expect(upd.body.data.consumed_amount).toBe(0);
    expect(upd.body.data.remaining_amount).toBe(50000);

    expect((await post(agreementId, 'submit')).body.code).toBe('CONTRACT_REQUIRED');
    expect((await attach(agreementId)).status()).toBe(200);
    const sub = await post(agreementId, 'submit');
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const a = (await get(agreementId)).body.data;
    expect(a.status).toBe('PENDING_VALIDATION');
    expect(a.attachments).toHaveLength(1);
    expect(a.steps.filter(s => s.step === 'PROJECT_MANAGER' && s.state === 'PENDING')).toHaveLength(2);
    expect(a.steps.find(s => s.step === 'DG').state).toBe('WAITING');
    // Plus modifiable une fois soumis
    const locked = await json(await requestRef.put(`/api/framework-agreements/${agreementId}`, { headers: H(), data: { title: 'X' } }));
    expect(locked.body.code).toBe('NOT_EDITABLE');
  });

  test('Visibilité et ordre de validation : chefs de projet puis DG, jamais l\'auteur', async () => {
    expect((await get(agreementId, outsider)).status).toBe(404);
    const seen = await get(agreementId, pm1);
    expect(seen.status).toBe(200);
    expect(seen.body.data.can_decide).toBe(true);
    const todo = (await (await requestRef.get('/api/framework-agreements?scope=toValidate', { headers: H(pm1) })).json()).data;
    expect(todo.some(x => x.id === agreementId)).toBe(true);

    expect((await decide(agreementId, admin)).body.code).toBe('SELF_APPROVAL');
    expect((await decide(agreementId, dg)).body.code).toBe('NOT_VALIDATOR'); // chefs de projet d'abord
    expect((await decide(agreementId, outsider)).status).toBe(404);

    const ok = await decide(agreementId, pm1, 'APPROVE', 'Prix conformes');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe('PENDING_VALIDATION');
    expect((await decide(agreementId, pm1)).body.code).toBe('NOT_VALIDATOR'); // déjà fait

    expect((await decide(agreementId, pm2, 'REJECT')).body.code).toBe('REASON_REQUIRED');
    const rej = await decide(agreementId, pm2, 'REJECT', 'Plafond trop élevé pour le projet');
    expect(rej.body.data.status).toBe('DRAFT');
    const back = (await get(agreementId)).body.data;
    expect(back.last_reject_reason).toBe('Plafond trop élevé pour le projet');
    expect(back.approvals.map(x => x.decision)).toEqual(['APPROVED', 'REJECTED']);
  });

  test('Nouvelle soumission : nouveau tour, puis DG qui active', async () => {
    await requestRef.put(`/api/framework-agreements/${agreementId}`, { headers: H(), data: { ceilingAmount: 30000 } });
    expect((await post(agreementId, 'submit')).status).toBe(200);
    let a = (await get(agreementId)).body.data;
    expect(a.submission_round).toBe(2);
    expect(a.steps.filter(s => s.state === 'PENDING' && s.step === 'PROJECT_MANAGER')).toHaveLength(2); // pm1 revalide

    expect((await decide(agreementId, pm1)).status).toBe(200);
    expect((await decide(agreementId, pm2)).status).toBe(200);
    a = (await get(agreementId, dg)).body.data;
    expect(a.can_decide).toBe(true);
    expect(a.steps.find(s => s.step === 'DG').state).toBe('PENDING');
    const act = await decide(agreementId, dg, 'APPROVE', 'Bon pour exécution');
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    expect(act.body.data.status).toBe('ACTIVE');
    a = (await get(agreementId)).body.data;
    expect(a.status).toBe('ACTIVE');
    expect(a.effective_status).toBe('ACTIVE');
    expect(a.activated_by_name).toContain('fadg');
    expect(a.ceiling_amount).toBe(30000);
    expect((await decide(agreementId, dg)).body.code).toBe('NOT_PENDING');
  });

  test('Vie du contrat : suspension, réactivation, clôture', async () => {
    expect((await post(agreementId, 'suspend')).body.code).toBe('REASON_REQUIRED');
    expect((await post(agreementId, 'suspend', { reason: 'Litige qualité' })).body.data.status).toBe('SUSPENDED');
    expect((await post(agreementId, 'submit')).body.code).toBe('NOT_DRAFT');
    expect((await post(agreementId, 'reactivate')).body.data.status).toBe('ACTIVE');
    expect((await post(agreementId, 'close', { reason: 'Marché terminé' })).body.data.status).toBe('CLOSED');
    expect((await post(agreementId, 'reactivate')).body.code).toBe('STATUS_INVALID');
    expect((await post(agreementId, 'close', {}, dg)).status).toBe(403);
  });

  test('Contrat ouvert à toute l\'entreprise : le DG seul ; liste et filtres', async () => {
    const r = await create({ ...base(), title: `Carburant ${stamp}`, items: [], allowOffList: true });
    globalId = r.body.data.id;
    await attach(globalId);
    expect((await post(globalId, 'submit')).status).toBe(200);
    expect((await decide(globalId, pm1)).status).toBe(404); // aucun lien avec ce contrat : introuvable
    expect((await get(globalId, dg)).body.data.can_decide).toBe(true);
    expect((await decide(globalId, dg)).body.data.status).toBe('ACTIVE');

    const list = async (q, token = admin) => (await (await requestRef.get(`/api/framework-agreements?${q}`, { headers: H(token) })).json()).data;
    const mine = await list(`search=${stamp}`);
    expect(mine.map(x => x.id)).toEqual(expect.arrayContaining([agreementId, globalId]));
    expect((await list(`search=${stamp}&status=ACTIVE`)).map(x => x.id)).toEqual([globalId]);
    // Projet 1 : contrat de l'entreprise + contrat du projet ; projet inconnu du premier contrat → seulement le global
    expect((await list(`search=${stamp}&projectId=${p1.id}`)).length).toBe(2);
    // Utilisateur sans permission de lecture : seulement les contrats où il intervient
    expect((await list(`search=${stamp}`, outsider))).toHaveLength(0);
    expect((await list(`search=${stamp}`, pm1)).map(x => x.id)).toEqual([agreementId]);
  });
});
