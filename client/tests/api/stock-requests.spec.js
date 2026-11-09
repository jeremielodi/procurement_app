import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, getApproverId, auth } from './helpers.js';

// Demandes internes au magasin (migration 56_stock_requests.sql) :
//  - tout utilisateur de l'entreprise demande des articles stockables à un dépôt ;
//  - validation : option de l'entreprise ; validateur = chef du projet (ou intérimaire), sinon responsable du département,
//    sinon administrateur ; jamais le demandeur (403 SELF_APPROVAL) ;
//  - service par un bon de sortie (stockRequestId + requestLineId), jamais plus que validé ; annuler le bon rouvre la demande ;
//  - solde du reste par le magasinier (CLOSED), retrait par le demandeur tant que rien n'est servi.
test.describe.serial('API › Stock — demandes au magasin', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let admin, approver, me, approverId, plainUser, wh, rice, soap, project, initialValidation;
  const H = (token = admin) => auth(token);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  let requestRef;
  const get = (id, token = admin) => requestRef.get(`/api/stock-requests/${id}`, { headers: H(token) }).then(json);
  const create = (data, token = admin) => requestRef.post('/api/stock-requests', { headers: H(token), data: { warehouseId: wh.id, purpose: 'Fournitures du mois', ...data } }).then(json);
  const serve = (requestId, lines, extra = {}) => requestRef.post('/api/stock-issues', { headers: H(), data: {
    warehouseId: wh.id, destinationType: 'USER', recipientId: me.id, stockRequestId: requestId, lines, ...extra,
  } }).then(json);
  const setValidation = (validationRequired) => requestRef.put('/api/enterprises/current/stock-requests', { headers: H(), data: { validationRequired } }).then(json);

  test.beforeAll(async ({ request }) => {
    requestRef = request;
    admin = await getToken(request);
    approver = await getApproverToken(request);
    approverId = await getApproverId(request);
    me = (await (await request.get('/api/auth/profile', { headers: H() })).json()).data;
    initialValidation = (await (await request.get('/api/enterprises/current/stock-requests', { headers: H() })).json()).data?.validationRequired;
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    const category = (cats.find(c => c.is_stockable) || cats[0]).id;
    wh = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `DM-${stamp}`, name: `Magasin demandes ${stamp}`, locationId: locations[0].id } })).json()).data;
    rice = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `DM-RIZ-${stamp}`, name: `Riz demandes ${stamp}`, unit: 'kg', categoryId: category } })).json()).data;
    soap = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `DM-SAV-${stamp}`, name: `Savon demandes ${stamp}`, unit: 'pce', categoryId: category } })).json()).data;
    project = (await (await request.post('/api/projects/', { headers: H(), data: { code: `DM-${stamp}`, name: `Projet demandes ${stamp}`, projectManagerId: approverId } })).json()).data;
    // Ligne budgétaire : un projet de test sans budget, proposé en tête des formulaires de réquisition, gênerait les autres tests
    await request.post('/api/budget', { headers: H(), data: { entityCode: `DM-${stamp}`, description: 'Demandes au magasin', allocatedAmount: 1000, projectId: project.id } });
    for (const item of [rice, soap]) {
      const r = await json(await request.post('/api/stock-adjustments', { headers: H(), data: { warehouseId: wh.id, stockItemId: item.id, quantity: 50, reason: 'FOUND', comment: 'Stock initial' } }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    // Utilisateur sans droit sur le stock (ni demandeur, ni validateur des demandes de l'admin)
    const email = `dm.${stamp.toLowerCase()}@procurement.com`;
    const u = await json(await request.post('/api/users', { headers: H(), data: { username: `dm${stamp}`, email, password: 'Secret123!', firstName: 'Demande', lastName: stamp, profileIds: ['prof_requester'] } }));
    expect(u.status, JSON.stringify(u.body)).toBe(201);
    plainUser = (await (await request.post('/api/auth/login', { data: { email, password: 'Secret123!' } })).json()).data.token;
    expect(wh?.id && rice?.id && soap?.id && project?.id && plainUser).toBeTruthy();
  });

  test.beforeEach(({ request }) => { requestRef = request; });

  test.afterAll(async ({ request }) => {
    if (initialValidation !== undefined) await request.put('/api/enterprises/current/stock-requests', { headers: H(), data: { validationRequired: !!initialValidation } });
  });

  test('Contrôles de création ; articles disponibles dans le dépôt', async ({ request }) => {
    expect((await setValidation(false)).status).toBe(200);
    const noPurpose = await create({ purpose: ' ', lines: [{ stockItemId: rice.id, quantity: 1 }] });
    expect([noPurpose.status, noPurpose.body.code]).toEqual([400, 'PURPOSE_REQUIRED']);
    const twice = await create({ lines: [{ stockItemId: rice.id, quantity: 1 }, { stockItemId: rice.id, quantity: 2 }] });
    expect([twice.status, twice.body.code]).toEqual([400, 'ITEM_TWICE']);
    const noDept = await create({ destinationType: 'DEPARTMENT', lines: [{ stockItemId: rice.id, quantity: 1 }] });
    expect([noDept.status, noDept.body.code]).toEqual([400, 'DEPARTMENT_REQUIRED']);
    const items = (await (await request.get(`/api/stock-requests/items?warehouseId=${wh.id}&q=DM-RIZ-${stamp}`, { headers: H(plainUser) })).json()).data;
    expect(items.find(i => i.id === rice.id)?.available).toBe(50);
    const options = (await (await request.get('/api/stock-requests/options', { headers: H(plainUser) })).json()).data;
    expect(options.warehouses.some(w => w.id === wh.id)).toBeTruthy();
    expect(options.validationRequired).toBe(false);
  });

  let direct;
  test('Sans validation : à servir ; service en plusieurs fois, jamais plus que demandé ; annulation du bon = rouverte ; solde', async ({ request }) => {
    const created = await create({ lines: [{ stockItemId: rice.id, quantity: 10 }, { stockItemId: soap.id, quantity: 4 }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.requestNumber).toMatch(/^DEM-\d{4}-\d{5}$/);
    expect(created.body.data.status).toBe('TO_SERVE');
    direct = (await get(created.body.data.id)).body.data;
    const line = (item) => direct.lines.find(l => l.stock_item_id === item.id);
    expect(line(rice)).toMatchObject({ requested_quantity: 10, validated_quantity: 10, served_quantity: 0, remaining_quantity: 10, available: 50 });
    expect(direct).toMatchObject({ can_serve: true, can_cancel: true, can_validate: false });

    // Contrôles du bon de sortie
    const wrongTo = await serve(direct.id, [{ stockItemId: rice.id, quantity: 1, requestLineId: line(rice).id }], { recipientId: approverId });
    expect([wrongTo.status, wrongTo.body.code]).toEqual([400, 'REQUEST_DESTINATION_MISMATCH']);
    const wrongLine = await serve(direct.id, [{ stockItemId: soap.id, quantity: 1, requestLineId: line(rice).id }]);
    expect([wrongLine.status, wrongLine.body.code]).toEqual([400, 'REQUEST_LINE_INVALID']);

    const first = await serve(direct.id, [{ stockItemId: rice.id, quantity: 6, requestLineId: line(rice).id }]);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.requestStatus).toBe('PARTIALLY_SERVED');
    const over = await serve(direct.id, [{ stockItemId: rice.id, quantity: 5, requestLineId: line(rice).id }]);
    expect([over.status, over.body.code, over.body.available]).toEqual([400, 'REQUEST_QUANTITY_EXCEEDED', 4]);

    const rest = await serve(direct.id, [{ stockItemId: rice.id, quantity: 4, requestLineId: line(rice).id }, { stockItemId: soap.id, quantity: 4, requestLineId: line(soap).id }]);
    expect(rest.status, JSON.stringify(rest.body)).toBe(201);
    expect(rest.body.data.requestStatus).toBe('SERVED');
    let after = (await get(direct.id)).body.data;
    expect(after).toMatchObject({ status: 'SERVED', can_serve: false, can_cancel: false });
    expect(after.issues).toHaveLength(2);
    const issue = (await (await request.get(`/api/stock-issues/${rest.body.data.id}`, { headers: H() })).json()).data;
    expect(issue.request_number).toBe(direct.request_number);

    // Annulation du second bon : la demande redevient à servir (partiellement servie)
    const cancel = await json(await request.post(`/api/stock-issues/${rest.body.data.id}/cancel`, { headers: H(), data: { reason: 'Erreur' } }));
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    after = (await get(direct.id)).body.data;
    expect(after.status).toBe('PARTIALLY_SERVED');
    expect(after.lines.find(l => l.stock_item_id === rice.id).remaining_quantity).toBe(4);

    // Solde du reste par le magasinier (motif obligatoire), retrait impossible après un service
    const noReason = await json(await request.post(`/api/stock-requests/${direct.id}/close`, { headers: H(), data: { reason: '' } }));
    expect([noReason.status, noReason.body.code]).toEqual([400, 'REASON_REQUIRED']);
    const withdraw = await json(await request.post(`/api/stock-requests/${direct.id}/cancel`, { headers: H(), data: {} }));
    expect([withdraw.status, withdraw.body.code]).toEqual([409, 'NOT_CANCELLABLE']);
    const closed = await json(await request.post(`/api/stock-requests/${direct.id}/close`, { headers: H(), data: { reason: 'Rupture fournisseur' } }));
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.data).toMatchObject({ status: 'CLOSED', close_reason: 'Rupture fournisseur' });
    const late = await serve(direct.id, [{ stockItemId: rice.id, quantity: 1, requestLineId: line(rice).id }]);
    expect([late.status, late.body.code]).toEqual([409, 'REQUEST_NOT_OPEN']);
  });

  let pending;
  test('Avec validation : chef du projet seul, jamais le demandeur ; quantités réduites ; service limité au validé', async ({ request }) => {
    expect((await setValidation(true)).status).toBe(200);
    const created = await create({ projectId: project.id, lines: [{ stockItemId: rice.id, quantity: 8 }, { stockItemId: soap.id, quantity: 2 }] });
    expect(created.body.data.status).toBe('PENDING_VALIDATION');
    pending = (await get(created.body.data.id)).body.data;
    expect(pending).toMatchObject({ can_validate: false, self_validation: true, can_serve: false });
    expect(pending.lines.every(l => l.validated_quantity === null)).toBeTruthy();
    const riceLine = pending.lines.find(l => l.stock_item_id === rice.id);

    const notYet = await serve(pending.id, [{ stockItemId: rice.id, quantity: 1, requestLineId: riceLine.id }]);
    expect([notYet.status, notYet.body.code]).toEqual([409, 'REQUEST_NOT_OPEN']);
    const self = await json(await request.post(`/api/stock-requests/${pending.id}/validate`, { headers: H(), data: {} }));
    expect([self.status, self.body.code]).toEqual([403, 'SELF_APPROVAL']);
    const outsider = await json(await request.post(`/api/stock-requests/${pending.id}/validate`, { headers: H(plainUser), data: {} }));
    expect(outsider.status).toBe(404);

    // Le chef de projet voit la demande à valider
    const toValidate = (await (await request.get('/api/stock-requests?scope=toValidate', { headers: H(approver) })).json()).data;
    expect(toValidate.some(r => r.id === pending.id)).toBeTruthy();
    expect((await get(pending.id, approver)).body.data.can_validate).toBe(true);
    const tooMuch = await json(await request.post(`/api/stock-requests/${pending.id}/validate`, { headers: H(approver), data: { lines: [{ lineId: riceLine.id, validatedQuantity: 9 }] } }));
    expect([tooMuch.status, tooMuch.body.code]).toEqual([400, 'INVALID_QUANTITY']);
    const ok = await json(await request.post(`/api/stock-requests/${pending.id}/validate`, { headers: H(approver), data: { lines: [{ lineId: riceLine.id, validatedQuantity: 3 }], comment: 'Stock limité' } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'TO_SERVE', validation_comment: 'Stock limité' });
    expect(ok.body.data.lines.find(l => l.stock_item_id === rice.id)).toMatchObject({ validated_quantity: 3, remaining_quantity: 3 });
    expect(ok.body.data.lines.find(l => l.stock_item_id === soap.id).validated_quantity).toBe(2);
    const again = await json(await request.post(`/api/stock-requests/${pending.id}/validate`, { headers: H(approver), data: {} }));
    expect([again.status, again.body.code]).toEqual([409, 'NOT_PENDING']);

    const over = await serve(pending.id, [{ stockItemId: rice.id, quantity: 4, requestLineId: riceLine.id }]);
    expect([over.status, over.body.code]).toEqual([400, 'REQUEST_QUANTITY_EXCEEDED']);
    const served = await serve(pending.id, [{ stockItemId: rice.id, quantity: 3, requestLineId: riceLine.id }]);
    expect(served.status, JSON.stringify(served.body)).toBe(201);
    // Le bon reprend le projet de la demande
    const issue = (await (await request.get(`/api/stock-issues/${served.body.data.id}`, { headers: H() })).json()).data;
    expect(issue.project_id).toBe(project.id);
    const toServe = (await (await request.get('/api/stock-requests?scope=toServe', { headers: H() })).json()).data;
    expect(toServe.find(r => r.id === pending.id)?.status).toBe('PARTIALLY_SERVED');
  });

  test('Pour un département, sans projet : validée par le responsable du département, servie vers ce département', async ({ request }) => {
    const dept = (await (await request.post('/api/departments', { headers: H(), data: { code: `DM${stamp}`.slice(0, 20), name: `Département demandes ${stamp}`, managerId: approverId } })).json()).data;
    expect(dept?.id).toBeTruthy();
    const created = (await create({ destinationType: 'DEPARTMENT', departmentId: dept.id, lines: [{ stockItemId: soap.id, quantity: 5 }] })).body.data;
    expect(created.status).toBe('PENDING_VALIDATION');
    const ok = await json(await request.post(`/api/stock-requests/${created.id}/validate`, { headers: H(approver), data: {} }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const line = ok.body.data.lines[0];
    const toUser = await serve(created.id, [{ stockItemId: soap.id, quantity: 5, requestLineId: line.id }]);
    expect([toUser.status, toUser.body.code]).toEqual([400, 'REQUEST_DESTINATION_MISMATCH']);
    const served = await serve(created.id, [{ stockItemId: soap.id, quantity: 5, requestLineId: line.id }], { destinationType: 'DEPARTMENT', departmentId: dept.id, recipientId: me.id });
    expect(served.status, JSON.stringify(served.body)).toBe(201);
    expect(served.body.data.requestStatus).toBe('SERVED');
  });

  test('Rejet (motif obligatoire) et retrait par le demandeur', async ({ request }) => {
    const r1 = (await create({ projectId: project.id, lines: [{ stockItemId: soap.id, quantity: 1 }] })).body.data;
    const noReason = await json(await request.post(`/api/stock-requests/${r1.id}/reject`, { headers: H(approver), data: {} }));
    expect([noReason.status, noReason.body.code]).toEqual([400, 'REASON_REQUIRED']);
    const rejected = await json(await request.post(`/api/stock-requests/${r1.id}/reject`, { headers: H(approver), data: { reason: 'Pas prioritaire' } }));
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body.data).toMatchObject({ status: 'REJECTED', reject_reason: 'Pas prioritaire' });

    const r2 = (await create({ projectId: project.id, lines: [{ stockItemId: soap.id, quantity: 1 }] })).body.data;
    const notMine = await json(await request.post(`/api/stock-requests/${r2.id}/cancel`, { headers: H(approver), data: {} }));
    expect([notMine.status, notMine.body.code]).toEqual([403, 'NOT_REQUESTER']);
    const cancelled = await json(await request.post(`/api/stock-requests/${r2.id}/cancel`, { headers: H(), data: { reason: 'Plus besoin' } }));
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED' });
  });

  test('Demande d\'un utilisateur sans droit sur le stock : la sienne seulement ; listes et compteurs', async ({ request }) => {
    expect((await setValidation(false)).status).toBe(200);
    const mine = await create({ lines: [{ stockItemId: soap.id, quantity: 2 }] }, plainUser);
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    const list = (await (await request.get('/api/stock-requests?scope=all', { headers: H(plainUser) })).json());
    expect(list.scope).toBe('mine');
    expect(list.data.map(r => r.id)).toEqual([mine.body.data.id]);
    expect((await json(await request.get(`/api/stock-requests/${direct.id}`, { headers: H(plainUser) }))).status).toBe(404);
    const all = (await (await request.get(`/api/stock-requests?scope=all&search=${stamp}`, { headers: H() })).json()).data;
    expect(all.some(r => r.id === mine.body.data.id)).toBeTruthy();
    const counts = (await (await request.get('/api/stock-requests/counts', { headers: H() })).json()).data;
    expect(counts.toServe).toBeGreaterThanOrEqual(1);
    // Fermer une demande demande ISSUE_STOCK
    const forbidden = await request.post(`/api/stock-requests/${mine.body.data.id}/close`, { headers: H(plainUser), data: { reason: 'x' } });
    expect(forbidden.status()).toBe(403);
  });
});
