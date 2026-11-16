import { test, expect } from '@playwright/test';
import {
  getToken, getApproverToken, getApproverId, auth, PDF_BUFFER, pmApproval, waitForProcessTask, reviewPurchaseOrder,
} from './helpers.js';

// Accords-cadres — phase 2 : méthode d'achat « Commande sur accord-cadre » (BPMN : Gateway_MethodDecision → cycle de
// commande, sans étape de sourcing) et contrôles du bon de commande passé sur le contrat :
//  - fournisseur et devise du contrat, prix du bordereau, articles hors bordereau refusés, quantité maximale, plafond ;
//  - consommé = bons actifs (un bon rejeté ne consomme plus).
// Requiert BpmnGo (sinon ignoré).
test.describe.serial('API › Accords-cadres — commandes sur contrat (BpmnGo)', () => {
  const stamp = Date.now().toString(36).toUpperCase();
  let requestRef, admin, approver, dg, project, supplier, otherSupplier, agreement, requisition, items, createTask;
  const H = (token = admin) => auth(token);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const year = new Date().getFullYear();
  const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  test.beforeAll(async ({ request }) => {
    requestRef = request;
    admin = await getToken(request);
    approver = await getApproverToken(request);
    const approverId = await getApproverId(request);
    const email = `fadg2.${stamp.toLowerCase()}@procurement.com`;
    expect((await request.post('/api/users', { headers: H(), data: { username: `fadg2${stamp}`, email, password: 'Secret123!', firstName: 'DG', lastName: stamp, profileIds: ['prof_dg'] } })).status()).toBe(201);
    dg = (await (await request.post('/api/auth/login', { data: { email, password: 'Secret123!' } })).json()).data.token;
    project = (await (await request.post('/api/projects/', { headers: H(), data: { code: `FAO-${stamp}`, name: `Projet commandes AC ${stamp}`, projectManagerId: approverId } })).json()).data;
    const mkSupplier = async (name) => (await (await request.post('/api/suppliers', { headers: H(), data: {
      name, email: `${name.replace(/\W+/g, '.').toLowerCase()}@nowhere.test`, status: 'ACTIVE', prequalified: true,
    } })).json()).data;
    supplier = await mkSupplier(`ACO Fournisseur ${stamp}`);
    otherSupplier = await mkSupplier(`ACO Autre ${stamp}`);
    expect(project?.id && supplier?.id && otherSupplier?.id).toBeTruthy();

    // Contrat : plafond 300 USD, rames 5 (max 60), toner 80 (max 1), hors bordereau refusé — validé par le chef de projet puis le DG
    const created = await json(await request.post('/api/framework-agreements', { headers: H(), data: {
      title: `Fournitures ${stamp}`, supplierId: supplier.id, startDate: `${year}-01-01`, endDate: `${year + 1}-12-31`,
      ceilingAmount: 300, currencyId: 1, projectIds: [project.id], allowOffList: false,
      items: [{ description: 'Rame A4', unitPrice: 5, maxQuantity: 60 }, { description: 'Toner', unitPrice: 80, maxQuantity: 1 }],
    } }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    agreement = created.body.data;
    await request.post('/api/upload', { headers: H(), multipart: { entity_type: 'framework_agreement', entity_id: agreement.id, file: { name: 'contrat.pdf', mimeType: 'application/pdf', buffer: PDF_BUFFER } } });
    expect((await request.post(`/api/framework-agreements/${agreement.id}/submit`, { headers: H() })).status()).toBe(200);
    expect((await request.post(`/api/framework-agreements/${agreement.id}/decision`, { headers: H(approver), data: { decision: 'APPROVE' } })).status()).toBe(200);
    const act = await json(await request.post(`/api/framework-agreements/${agreement.id}/decision`, { headers: H(dg), data: { decision: 'APPROVE' } }));
    expect(act.body.data?.status, JSON.stringify(act.body)).toBe('ACTIVE');

    const line = (await (await request.post('/api/budget', { headers: H(), data: { entityCode: `FAO-${stamp}`, description: 'Commandes AC', allocatedAmount: 100000, projectId: project.id } })).json()).data;
    const req = await json(await request.post('/api/requisitions', { headers: H(), data: { submit: true,
      title: `[TEST AC] ${stamp}`, description: 'Commande sur accord-cadre', projectId: project.id, estimatedAmount: 410, currencyId: 1, currencyCode: 'USD',
      priority: 'MEDIUM', justification: 'Test',
      items: [
        { description: 'Rame A4', quantity: 50, frequency: 1, unitPrice: 5, budgetLineId: line.id },
        { description: 'Toner', quantity: 2, frequency: 1, unitPrice: 80, budgetLineId: line.id },
      ],
    } }));
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    requisition = req.body.data;
  });

  test.beforeEach(({ request }) => { requestRef = request; });

  test('Méthode « Commande sur accord-cadre » : contrat obligatoire, pas de répartition, puis directement le bon de commande', async () => {
    const pm = await waitForProcessTask(requestRef, admin, requisition.id, 'Activity_ProjectManagerApproval');
    test.skip(!pm, 'BpmnGo indisponible');
    expect((await requestRef.post(`/api/tasks/${pm.task.id}/complete`, { headers: H(approver), data: { variables: await pmApproval(requestRef, { comment: 'OK' }) } })).status()).toBe(200);
    const method = await waitForProcessTask(requestRef, admin, requisition.id, 'Activity_DetermineType');
    expect(method).toBeTruthy();

    const usable = (await (await requestRef.get(`/api/framework-agreements/usable?requisitionId=${requisition.id}`, { headers: H() })).json()).data;
    expect(usable.map(a => a.id)).toContain(agreement.id);

    const complete = (variables) => requestRef.post(`/api/tasks/${method.task.id}/complete`, { headers: H(), data: { variables } }).then(json);
    expect((await complete({ procurementMethod: 'FRAMEWORK_AGREEMENT' })).body.code).toBe('AGREEMENT_REQUIRED');
    expect((await complete({ procurementMethod: 'FRAMEWORK_AGREEMENT', frameworkAgreementId: agreement.id, multiSupplier: true })).body.code).toBe('SPLIT_NOT_AVAILABLE_FOR_AGREEMENT');
    const ok = await complete({ procurementMethod: 'FRAMEWORK_AGREEMENT', frameworkAgreementId: agreement.id, comment: 'Contrat en cours' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const next = await waitForProcessTask(requestRef, admin, requisition.id, ['Activity_CreatePO', 'Activity_SoleSource', 'Activity_DirectPurchase']);
    expect(next.task.taskDefinitionKey).toBe('Activity_CreatePO'); // aucune étape de sourcing
    createTask = next.task;
    const byReq = (await (await requestRef.get(`/api/framework-agreements/by-requisition/${requisition.id}`, { headers: H() })).json()).data;
    expect(byReq.id).toBe(agreement.id);
    const r = (await (await requestRef.get(`/api/requisitions/${requisition.id}`, { headers: H() })).json()).data;
    expect(r.status).toBe('CLASSIFIED_FRAMEWORK_AGREEMENT');
    items = r.items;
  });

  test('Bon de commande : fournisseur, devise, prix, hors bordereau, quantité maximale et plafond contrôlés', async () => {
    test.skip(!createTask, 'BpmnGo indisponible');
    const rame = items.find(i => i.item_description === 'Rame A4');
    const toner = items.find(i => i.item_description === 'Toner');
    const po = (lines, extra = {}) => requestRef.post('/api/purchase-orders', { headers: H(), data: {
      requisitionId: requisition.id, taskId: createTask.id, supplierId: supplier.id, currency: 'USD', deliveryDate: future(20),
      totalAmount: lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0), items: lines, ...extra,
    } }).then(json);
    const R = (q, p = 5) => ({ description: 'Rame A4', quantity: q, unitPrice: p, requisitionItemId: rame.id });
    const T = (q) => ({ description: 'Toner', quantity: q, unitPrice: 80, requisitionItemId: toner.id });

    expect((await po([R(50)], { supplierId: otherSupplier.id })).body.code).toBe('AGREEMENT_SUPPLIER_MISMATCH');
    expect((await po([R(50)], { currency: 'EUR' })).body.code).toBe('AGREEMENT_CURRENCY_MISMATCH');
    const price = await po([R(50, 6)]);
    expect(price.body.code).toBe('AGREEMENT_PRICE_MISMATCH');
    expect(price.body.details.expected).toBe(5);
    expect((await po([R(10), { description: 'Chaise', quantity: 1, unitPrice: 40 }])).body.code).toBe('AGREEMENT_ITEM_OFF_LIST');
    const qty = await po([R(50), T(2)]);
    expect(qty.body.code).toBe('AGREEMENT_QUANTITY_EXCEEDED');
    expect(qty.body.details.remaining).toBe(1);
    const ceiling = await po([R(50), T(1)]); // 330 > 300
    expect(ceiling.status).toBe(409);
    expect(ceiling.body.code).toBe('AGREEMENT_CEILING_EXCEEDED');
    expect(ceiling.body.details.remaining).toBe(300);

    const ok = await po([R(50)]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const created = (await (await requestRef.get(`/api/purchase-orders/${ok.body.data.id}`, { headers: H() })).json()).data;
    expect(created.framework_agreement_id).toBe(agreement.id);

    const a = (await (await requestRef.get(`/api/framework-agreements/${agreement.id}`, { headers: H() })).json()).data;
    expect(a.consumed_amount).toBe(250);
    expect(a.remaining_amount).toBe(50);
    expect(a.items.find(i => i.description === 'Rame A4').ordered_quantity).toBe(50);
    expect(a.purchase_orders.map(p => p.id)).toEqual([ok.body.data.id]);
    // 250 / 300 = 83 % : alerte de plafond à l'auteur du contrat (une seule fois)
    const me = (await (await requestRef.get('/api/auth/profile', { headers: H() })).json()).data;
    const notes = (await (await requestRef.get(`/api/notifications/${me.id}`, { headers: H() })).json()).data || [];
    expect(notes.filter(n => n.link === `/framework-agreements/${agreement.id}` && /83/.test(n.title))).toHaveLength(1);
    // PDF du bon : mention du contrat
    const pdf = await requestRef.get(`/api/purchase-orders/${ok.body.data.id}/pdf`, { headers: H() });
    expect(pdf.status()).toBe(200);

    // Bon rejeté à la révision : il ne consomme plus le contrat
    const reviewed = await reviewPurchaseOrder(requestRef, approver, requisition.id, ok.body.data.id, { decision: 'REJECT', comment: 'Délai trop long' });
    expect(reviewed?.status, JSON.stringify(reviewed?.body)).toBe(200);
    const after = (await (await requestRef.get(`/api/framework-agreements/${agreement.id}`, { headers: H() })).json()).data;
    expect(after.consumed_amount).toBe(0);
  });

  test('Contrat suspendu : plus proposé pour une réquisition', async () => {
    expect((await requestRef.post(`/api/framework-agreements/${agreement.id}/suspend`, { headers: H(), data: { reason: 'Test' } })).status()).toBe(200);
    const usable = (await (await requestRef.get(`/api/framework-agreements/usable?requisitionId=${requisition.id}`, { headers: H() })).json()).data;
    expect(usable.map(a => a.id)).not.toContain(agreement.id);
    expect((await requestRef.post(`/api/framework-agreements/${agreement.id}/reactivate`, { headers: H() })).status()).toBe(200);
  });
});
