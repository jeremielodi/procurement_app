import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Rapports d'incident (migration 68_stock_incidents.sql) :
//  - l'employé déclare une perte / un vol / un dommage sur un article qu'il détient (le magasin peut le faire pour lui) ;
//  - validation par le chef du projet du stock, à défaut l'administrateur ; jamais le détenteur ni le déclarant ;
//  - le validateur se prononce sur la responsabilité de l'employé ;
//  - perte / vol validés : l'article sort des détentions (équipement LOST) ; dommage : équipement « Endommagé », toujours détenu.
test.describe.serial('API › Stock — rapports d\'incident', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const S = (n) => `INC-SN-${stamp}-${n}`;
  let admin, approver, approverId, employee, employeeId, outsider, wh, paper, laptop, project, units = {};
  let requestRef;
  const H = (token = admin) => auth(token);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const today = new Date().toISOString().slice(0, 10);
  const report = (data, token = employee) => requestRef.post('/api/stock-incidents', { headers: H(token), data: {
    incidentType: 'LOST', incidentDate: today, incidentPlace: 'Bureau de Goma', circumstances: 'Oublié dans un taxi au retour de mission', ...data,
  } }).then(json);
  const get = (id, token = admin) => requestRef.get(`/api/stock-incidents/${id}`, { headers: H(token) }).then(json);
  const act = (id, action, data = {}, token = approver) => requestRef.post(`/api/stock-incidents/${id}/${action}`, { headers: H(token), data }).then(json);
  const holdings = async () => (await (await requestRef.get('/api/stock-holdings/mine', { headers: H(employee) })).json()).data;
  const line = (rows, pred) => rows.find(pred);
  const unit = async (id) => (await (await requestRef.get(`/api/stock-units/${id}`, { headers: H() })).json()).data;

  test.beforeAll(async ({ request }) => {
    requestRef = request;
    admin = await getToken(request);
    const locations = (await (await request.get('/api/public/locations')).json()).data;
    const cats = (await (await request.get('/api/public/market-categories')).json()).data;
    const category = (cats.find(c => c.is_stockable) || cats[0]).id;
    wh = (await (await request.post('/api/warehouses', { headers: H(), data: { code: `IN-${stamp}`, name: `Magasin incidents ${stamp}`, locationId: locations[0].id } })).json()).data;
    paper = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `IN-PAP-${stamp}`, name: `Rame incidents ${stamp}`, unit: 'pce', categoryId: category } })).json()).data;
    laptop = (await (await request.post('/api/stock-items', { headers: H(), data: { code: `IN-LAP-${stamp}`, name: `Portable incidents ${stamp}`, unit: 'pce', categoryId: category, trackSerials: true } })).json()).data;
    // Chef de projet (non administrateur), employé et un autre utilisateur sans droit
    const mk = async (prefix) => {
      const email = `${prefix}.${stamp.toLowerCase()}@procurement.com`;
      const u = await json(await request.post('/api/users', { headers: H(), data: { username: `${prefix}${stamp}`, email, password: 'Secret123!', firstName: prefix, lastName: stamp, profileIds: ['prof_requester'] } }));
      expect(u.status, JSON.stringify(u.body)).toBe(201);
      const token = (await (await request.post('/api/auth/login', { data: { email, password: 'Secret123!' } })).json()).data.token;
      return { id: u.body.data.id, token };
    };
    const e = await mk('incemp');
    employee = e.token; employeeId = e.id;
    outsider = (await mk('incout')).token;
    const pm = await mk('incpm');
    approver = pm.token; approverId = pm.id;
    project = (await (await request.post('/api/projects/', { headers: H(), data: { code: `IN-${stamp}`, name: `Projet incidents ${stamp}`, projectManagerId: approverId } })).json()).data;
    await request.post('/api/budget', { headers: H(), data: { entityCode: `IN-${stamp}`, description: 'Incidents', allocatedAmount: 1000, projectId: project.id } });
    expect(wh?.id && paper?.id && laptop?.id && project?.id).toBeTruthy();

    // Stock : 20 rames du projet, 5 sans projet, 4 portables du projet
    for (const [quantity, projectId] of [[20, project.id], [5, undefined]]) {
      const r = await json(await request.post('/api/stock-adjustments', { headers: H(), data: { warehouseId: wh.id, stockItemId: paper.id, quantity, reason: 'FOUND', comment: 'Stock initial', projectId } }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const reg = await json(await request.post('/api/stock-units/register', { headers: H(), data: { stockItemId: laptop.id, warehouseId: wh.id, projectId: project.id, units: [1, 2, 3, 4].map(n => ({ serialNumber: S(n) })) } }));
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const list = (await (await request.get(`/api/stock-units?stockItemId=${laptop.id}`, { headers: H() })).json()).data;
    for (const u of list) units[u.serial_number] = u.id;


    // Sorties vers l'employé : 6 rames + 4 portables du projet, 2 rames sans projet
    let r = await json(await request.post('/api/stock-issues', { headers: H(), data: {
      warehouseId: wh.id, destinationType: 'USER', recipientId: employeeId, projectId: project.id, purpose: 'Dotation',
      lines: [{ stockItemId: paper.id, quantity: 6 }, { stockItemId: laptop.id, unitIds: [1, 2, 3, 4].map(n => units[S(n)]) }],
    } }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    r = await json(await request.post('/api/stock-issues', { headers: H(), data: {
      warehouseId: wh.id, destinationType: 'USER', recipientId: employeeId, purpose: 'Fournitures', lines: [{ stockItemId: paper.id, quantity: 2 }],
    } }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  test.beforeEach(({ request }) => { requestRef = request; });

  let held;
  const paperP = () => line(held, h => h.stock_item_id === paper.id && h.project_id === project.id);
  const paperNone = () => line(held, h => h.stock_item_id === paper.id && !h.project_id);
  const lap = (n) => line(held, h => h.serial_number === S(n));

  test('Contrôles de la déclaration', async () => {
    held = await holdings();
    expect(paperP()?.remaining).toBe(6);
    expect(paperNone()?.remaining).toBe(2);
    const cases = [
      [{ incidentType: 'LOSS', lines: [{ issueLineId: paperP().issue_line_id, quantity: 1 }] }, 400, 'INCIDENT_TYPE_INVALID'],
      [{ incidentDate: '2999-01-01', lines: [{ issueLineId: paperP().issue_line_id, quantity: 1 }] }, 400, 'INCIDENT_DATE_FUTURE'],
      [{ circumstances: 'Perdu', lines: [{ issueLineId: paperP().issue_line_id, quantity: 1 }] }, 400, 'CIRCUMSTANCES_REQUIRED'],
      [{ lines: [] }, 400, 'NO_LINES'],
      [{ incidentType: 'DAMAGED', lines: [{ issueLineId: paperP().issue_line_id, quantity: 1 }] }, 400, 'DAMAGE_EQUIPMENT_ONLY'],
      [{ lines: [{ issueLineId: paperP().issue_line_id, quantity: 7 }] }, 400, 'OVER_HELD'],
      [{ lines: [{ issueLineId: paperP().issue_line_id, quantity: 1 }, { issueLineId: paperNone().issue_line_id, quantity: 1 }] }, 400, 'MIXED_PROJECTS'],
    ];
    for (const [data, status, code] of cases) {
      const r = await report(data);
      expect([r.status, r.body.code], JSON.stringify(data)).toEqual([status, code]);
    }
    // Article d'un autre : l'administrateur ne peut pas le déclarer à son propre nom
    const other = await report({ lines: [{ issueLineId: paperP().issue_line_id, quantity: 1 }] }, admin);
    expect([other.status, other.body.code]).toEqual([400, 'NOT_HOLDER']);
    // Un simple employé ne déclare pas pour le compte d'un autre
    const forOther = await report({ holderId: employeeId, lines: [{ issueLineId: paperP().issue_line_id, quantity: 1 }] }, outsider);
    expect([forOther.status, forOther.body.code]).toEqual([403, 'NOT_ALLOWED']);
  });

  let lost;
  test('Perte : chef de projet seul ; responsabilité obligatoire ; l\'article sort des détentions', async ({ request }) => {
    const r = await report({ lines: [{ issueLineId: paperP().issue_line_id, quantity: 2 }, { issueLineId: lap(1).issue_line_id }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.incidentNumber).toMatch(/^INC-\d{4}-\d{5}$/);
    lost = (await get(r.body.data.id, employee)).body.data;
    expect(lost).toMatchObject({ status: 'PENDING', incident_type: 'LOST', project_id: project.id, can_validate: false, can_cancel: true, self_validation: true });
    expect(lost.validators.map(v => String(v.id))).toEqual([String(approverId)]);

    held = await holdings();
    expect(paperP()).toMatchObject({ incident_pending_quantity: 2, incident_pending_count: 1 });
    expect(lap(1).incident_pending_count).toBe(1);
    // Déjà déclaré : équipement en attente, quantité limitée au reste non déclaré
    expect((await report({ lines: [{ issueLineId: lap(1).issue_line_id }] })).body.code).toBe('INCIDENT_PENDING');
    const over = await report({ lines: [{ issueLineId: paperP().issue_line_id, quantity: 5 }] });
    expect([over.body.code, over.body.available]).toEqual(['OVER_HELD', 4]);

    // Séparation des tâches et validateur
    expect((await act(lost.id, 'validate', { employeeLiable: false }, employee))).toMatchObject({ status: 403, body: { code: 'SELF_APPROVAL' } });
    expect((await act(lost.id, 'validate', { employeeLiable: false }, admin))).toMatchObject({ status: 403, body: { code: 'NOT_VALIDATOR' } });
    expect((await get(lost.id, outsider)).status).toBe(404);
    const toValidate = (await (await request.get('/api/stock-incidents?scope=toValidate', { headers: H(approver) })).json()).data;
    expect(toValidate.map(i => i.id)).toContain(lost.id);
    expect((await (await request.get('/api/stock-incidents/counts', { headers: H(approver) })).json()).data.toValidate).toBeGreaterThan(0);

    expect((await act(lost.id, 'validate', {}))).toMatchObject({ status: 400, body: { code: 'LIABILITY_REQUIRED' } });
    const ok = await act(lost.id, 'validate', { employeeLiable: true, comment: 'Négligence : retenue à étudier' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'VALIDATED', employee_liable: true, decision_comment: 'Négligence : retenue à étudier', validated_by: approverId });
    expect((await act(lost.id, 'reject', { reason: 'x' }))).toMatchObject({ status: 409, body: { code: 'NOT_PENDING' } });

    held = await holdings();
    expect(paperP().remaining).toBe(4);
    expect(lap(1)).toBeUndefined();
    expect(await unit(units[S(1)])).toMatchObject({ status: 'LOST', holder_id: null });

    const pdf = await request.get(`/api/stock-incidents/${lost.id}/pdf?lang=fr`, { headers: H(employee) });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
  });

  test('Vol déclaré par le magasin pour l\'employé ; rejet avec motif — l\'article reste détenu', async () => {
    const r = await report({ holderId: employeeId, incidentType: 'STOLEN', policeReference: `PV-${stamp}`, lines: [{ issueLineId: lap(2).issue_line_id }] }, admin);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const inc = (await get(r.body.data.id, employee)).body.data;
    expect(inc).toMatchObject({ holder_id: employeeId, police_reference: `PV-${stamp}`, incident_type: 'STOLEN', can_cancel: true });
    expect((await act(inc.id, 'reject', { reason: ' ' }))).toMatchObject({ status: 400, body: { code: 'REASON_REQUIRED' } });
    const rej = await act(inc.id, 'reject', { reason: 'Aucune plainte déposée' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(200);
    expect(rej.body.data).toMatchObject({ status: 'REJECTED', reject_reason: 'Aucune plainte déposée' });
    expect(await unit(units[S(2)])).toMatchObject({ status: 'ASSIGNED', holder_id: employeeId });
  });

  test('Dommage : retrait par l\'employé, puis validation — équipement endommagé, toujours détenu', async () => {
    const first = await report({ incidentType: 'DAMAGED', circumstances: 'Écran fissuré après une chute', lines: [{ issueLineId: lap(3).issue_line_id }] });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await act(first.body.data.id, 'cancel', {}, outsider)).status).toBe(404);
    const cancelled = await act(first.body.data.id, 'cancel', { reason: 'Erreur de saisie' }, employee);
    expect([cancelled.status, cancelled.body.data?.status]).toEqual([200, 'CANCELLED']);

    const second = await report({ incidentType: 'DAMAGED', circumstances: 'Écran fissuré après une chute', lines: [{ issueLineId: lap(3).issue_line_id }] });
    const ok = await act(second.body.data.id, 'validate', { employeeLiable: false, comment: 'Usure normale' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await unit(units[S(3)])).toMatchObject({ status: 'ASSIGNED', condition: 'DAMAGED', holder_id: employeeId });
    expect((await report({ incidentType: 'DAMAGED', circumstances: 'Encore une chute du portable', lines: [{ issueLineId: lap(3).issue_line_id }] })).body.code).toBe('ALREADY_DAMAGED');
  });

  test('Article sans projet : validé par l\'administrateur', async () => {
    const r = await report({ lines: [{ issueLineId: paperNone().issue_line_id, quantity: 1 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const inc = (await get(r.body.data.id, admin)).body.data;
    expect(inc.project_id).toBeNull();
    expect(inc.can_validate).toBe(true);
    // Le chef de projet (sans droit sur le stock) ne voit pas un rapport qu'il ne valide pas
    expect((await act(inc.id, 'validate', { employeeLiable: false }, approver)).status).toBe(404);
    const ok = await act(inc.id, 'validate', { employeeLiable: false }, admin);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    held = await holdings();
    expect(paperNone().remaining).toBe(1);
  });

  test('Article rendu entre-temps : validation refusée (HOLDING_CHANGED)', async ({ request }) => {
    const r = await report({ lines: [{ issueLineId: lap(4).issue_line_id }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const ret = await json(await request.post('/api/stock-returns', { headers: H(), data: { warehouseId: wh.id, returnedBy: employeeId, lines: [{ issueLineId: lap(4).issue_line_id, quantity: 1, condition: 'GOOD' }] } }));
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect((await act(r.body.data.id, 'validate', { employeeLiable: false }))).toMatchObject({ status: 409, body: { code: 'HOLDING_CHANGED' } });
    expect((await act(r.body.data.id, 'reject', { reason: 'Retrouvé et rendu au magasin' })).status).toBe(200);
  });

  test('Listes : mes rapports, tous (VIEW_STOCK), recherche', async ({ request }) => {
    const mine = (await (await request.get('/api/stock-incidents?scope=mine', { headers: H(employee) })).json()).data;
    expect(mine.length).toBeGreaterThanOrEqual(6);
    const all = (await (await request.get(`/api/stock-incidents?scope=all&search=${S(1)}`, { headers: H() })).json()).data;
    expect(all.map(i => i.id)).toEqual([lost.id]);
    const notAllowed = await (await request.get('/api/stock-incidents?scope=all', { headers: H(outsider) })).json();
    expect(notAllowed.scope).toBe('mine');
    expect(notAllowed.data).toEqual([]);
  });
});
