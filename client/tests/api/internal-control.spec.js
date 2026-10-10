import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth } from './helpers.js';

// Contrôle interne (migration 21_internal_control.sql) :
//  - permissions d'écriture dédiées (réception, SAN, facture, paiement) ; profil Auditeur en lecture seule
//  - séparation des tâches : bon de commande, facture, paiement, tâches GoFlow d'approbation
//  - coordonnées bancaires modifiées → paiement bloqué jusqu'à vérification par une autre personne
//  - facture en double (même fournisseur, même n° de facture fournisseur) refusée
//  - journal d'audit : tentatives refusées et actions sensibles tracées
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const WAIT = 40_000;

test.describe.serial('API › Contrôle interne', () => {
  test.describe.configure({ timeout: 120_000 }); // création de la réquisition + démarrage GoFlow
  const stamp = Date.now().toString(36);
  const viewer = { email: `ic.viewer.${stamp}@nowhere.test`, password: 'Secret123' };
  const auditor = { email: `ic.auditor.${stamp}@nowhere.test`, password: 'Secret123' };
  const logistic = { email: `ic.logistic.${stamp}@nowhere.test`, password: 'Secret123' };
  let admin, approver, viewerToken, auditorToken, logisticToken;
  let dept, project, supplier, otherSupplier, req, po, invoice, budgetLine;
  const H = () => auth(admin);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const future = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);
  const lastAudit = async (request, query) => (await (await request.get(`/api/audit-logs?limit=5&${query}`, { headers: H() })).json()).data;

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    approver = await getApproverToken(request);
    for (const [creds, profile, key] of [[viewer, 'prof_user', 'viewer'], [auditor, 'prof_auditor', 'auditor'], [logistic, 'prof_logistic', 'logistic']]) {
      const res = await request.post('/api/users', { headers: H(), data: {
        username: `ic${key}${stamp}`, email: creds.email, password: creds.password, firstName: key, lastName: stamp, profileIds: [profile],
      } });
      expect(res.status(), await res.text()).toBe(201);
    }
    const login = async (c) => (await (await request.post('/api/auth/login', { data: c })).json()).data.token;
    [viewerToken, auditorToken, logisticToken] = await Promise.all([login(viewer), login(auditor), login(logistic)]);

    [dept] = (await (await request.get('/api/departments', { headers: H() })).json()).data;
    [project] = (await (await request.get('/api/projects', { headers: H() })).json()).data;
    const mk = async (name) => (await (await request.post('/api/suppliers', { headers: H(), data: {
      name, email: `${name.replace(/\W+/g, '.').toLowerCase()}@nowhere.test`, status: 'ACTIVE', prequalified: true,
      bankName: 'Banque initiale', bankAccount: '0001-1111',
    } })).json()).data;
    supplier = await mk(`IC Fournisseur ${stamp}`);
    otherSupplier = await mk(`IC Autre ${stamp}`);
    expect(supplier?.id && otherSupplier?.id).toBeTruthy();
    budgetLine = (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: `IC-${stamp}`, description: `Ligne contrôle interne ${stamp}`, allocatedAmount: 1_000_000, projectId: project.id,
    } })).json()).data;
    req = (await (await request.post('/api/requisitions', { headers: H(), data: {
      title: `[TEST CONTRÔLE INTERNE] ${stamp}`, description: 'x', departmentId: dept.id, projectId: project.id, currencyId: 1, currencyCode: 'USD',
      priority: 'MEDIUM', justification: 'x', items: [{ description: 'Article contrôle', quantity: 2, frequency: 1, unitPrice: 50, budgetLineId: budgetLine.id }],
    } })).json()).data;
    expect(req?.id).toBeTruthy();
  });

  test('Permissions : un profil « consultation » ne peut saisir ni réception, ni facture, ni paiement', async ({ request }) => {
    for (const [url, data] of [
      ['/api/goods-receipts', { poId: 1, items: [] }],
      ['/api/service-acceptance-notes', { poId: 1 }],
      ['/api/invoices', { totalAmount: 10, invoiceDate: future(0) }],
      ['/api/payments', { amount: 10, poId: 1 }],
    ]) {
      expect((await request.post(url, { headers: auth(viewerToken), data })).status(), url).toBe(403);
    }
    expect((await request.post('/api/payments/1/approve', { headers: auth(logisticToken), data: {} })).status()).toBe(403);
  });

  test('Auditeur : lecture (budget, journal d\'audit, achats, stock), aucune écriture', async ({ request }) => {
    for (const url of ['/api/budget/summary', `/api/budget/${budgetLine.id}`, '/api/audit-logs?limit=1', '/api/requisitions', '/api/purchase-orders', '/api/invoices', '/api/payments', '/api/stock/valuation', '/api/suppliers?all=1']) {
      expect((await request.get(url, { headers: auth(auditorToken) })).status(), url).toBe(200);
    }
    for (const [method, url, data] of [
      ['post', '/api/requisitions', { title: 'x' }], ['post', '/api/purchase-orders', {}], ['post', '/api/invoices', { totalAmount: 1, invoiceDate: future(0) }],
      ['put', `/api/budget/${budgetLine.id}`, { allocatedAmount: 1 }], ['post', '/api/suppliers', { name: 'x' }], ['post', '/api/stock-adjustments', {}],
      ['put', `/api/suppliers/${supplier.id}/bank-changes/1/review`, { status: 'VERIFIED' }],
    ]) {
      expect((await request[method](url, { headers: auth(auditorToken), data })).status(), `${method} ${url}`).toBe(403);
    }
    // Aucune tâche GoFlow à traiter
    const tasks = await json(await request.get('/api/tasks/user', { headers: auth(auditorToken) }));
    expect((tasks.body.data || []).filter(tk => tk.canClaim || tk.canComplete)).toHaveLength(0);
  });

  test('Bon de commande : son créateur ne peut pas l\'approuver (tracé), un autre administrateur oui', async ({ request }) => {
    po = (await (await request.post('/api/purchase-orders', { headers: H(), data: {
      requisitionId: req.id, supplierId: supplier.id, currency: 'USD', totalAmount: 100, deliveryDate: future(15),
      items: [{ description: 'Article contrôle', quantity: 2, unitPrice: 50 }],
    } })).json()).data;
    expect(po?.id).toBeTruthy();
    const self = await json(await request.post(`/api/purchase-orders/${po.id}/approve`, { headers: H(), data: { comments: 'moi-même' } }));
    expect([self.status, self.body.code]).toEqual([403, 'SELF_APPROVAL']);
    const logged = await lastAudit(request, `action=SOD_VIOLATION_BLOCKED&entityType=purchase_order&entityRef=${po.id}`);
    expect(logged[0]?.new_value?.rule).toBe('SELF_APPROVAL');
    expect((await request.post(`/api/purchase-orders/${po.id}/approve`, { headers: auth(approver), data: { comments: 'ok' } })).status()).toBe(200);
  });

  test('Facture : n° interne généré, n° fournisseur conservé ; doublon refusé (tracé) ; même n° chez un autre fournisseur accepté', async ({ request }) => {
    const number = `F-${stamp}`;
    const first = await json(await request.post('/api/invoices', { headers: H(), data: {
      poId: po.id, supplierInvoiceNumber: number, invoiceDate: future(0), totalAmount: 100, subtotal: 100,
    } }));
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    invoice = first.body.data;
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d+$/);
    const saved = (await (await request.get(`/api/invoices/${invoice.id}`, { headers: H() })).json()).data;
    expect([saved.supplier_invoice_number, saved.supplier_id]).toEqual([number, supplier.id]);
    // Même n°, casse et espaces différents → doublon
    const dup = await json(await request.post('/api/invoices', { headers: H(), data: {
      poId: po.id, supplierInvoiceNumber: ` ${number.toLowerCase()} `, invoiceDate: future(0), totalAmount: 100,
    } }));
    expect([dup.status, dup.body.code, dup.body.details?.invoiceId]).toEqual([409, 'DUPLICATE_INVOICE', invoice.id]);
    expect((await lastAudit(request, `action=INVOICE_DUPLICATE_BLOCKED&q=${encodeURIComponent(saved.invoice_number)}`)).length).toBeGreaterThan(0);
    // Autre fournisseur (son propre bon de commande) : même n° accepté
    const otherPo = (await (await request.post('/api/purchase-orders', { headers: H(), data: {
      requisitionId: req.id, supplierId: otherSupplier.id, currency: 'USD', totalAmount: 10, deliveryDate: future(15),
      items: [{ description: 'Autre article', quantity: 1, unitPrice: 10 }],
    } })).json()).data;
    expect((await request.post(`/api/purchase-orders/${otherPo.id}/approve`, { headers: auth(approver), data: {} })).status()).toBe(200);
    const other = await json(await request.post('/api/invoices', { headers: H(), data: {
      poId: otherPo.id, supplierInvoiceNumber: number, invoiceDate: future(0), totalAmount: 10,
    } }));
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    // Validation : pas par celui qui l'a saisie
    const selfOk = await json(await request.post(`/api/invoices/${invoice.id}/approve`, { headers: H(), data: {} }));
    expect([selfOk.status, selfOk.body.code]).toEqual([403, 'SELF_APPROVAL']);
    expect((await request.post(`/api/invoices/${invoice.id}/approve`, { headers: auth(approver), data: {} })).status()).toBe(200);
  });

  test('Chaîne de rattachement : commande → réquisition, facture → commande, paiement → facture', async ({ request }) => {
    // Commande sans réquisition
    const noReq = await json(await request.post('/api/purchase-orders', { headers: H(), data: { supplierId: supplier.id, totalAmount: 5, items: [] } }));
    expect([noReq.status, noReq.body.code]).toEqual([400, 'REQUISITION_REQUIRED']);
    // L'auteur d'une commande est toujours l'utilisateur connecté (createdBy du client ignoré)
    const approverId = (await (await request.get('/api/auth/profile', { headers: auth(approver) })).json()).data.id;
    const spoof = await json(await request.post('/api/purchase-orders', { headers: H(), data: {
      requisitionId: req.id, supplierId: supplier.id, totalAmount: 5, createdBy: approverId, items: [{ description: 'x', quantity: 1, unitPrice: 5 }],
    } }));
    expect(spoof.status).toBe(201);
    const spoofPo = (await (await request.get(`/api/purchase-orders/${spoof.body.data.id}`, { headers: H() })).json()).data;
    expect(spoofPo.created_by).not.toBe(approverId);
    expect(spoofPo.self_approval).toBe(true);
    // Facture sans commande, sur une commande en attente ; paiement sans facture
    const noPo = await json(await request.post('/api/invoices', { headers: H(), data: { invoiceDate: future(0), totalAmount: 10, supplierInvoiceNumber: `X-${stamp}` } }));
    expect([noPo.status, noPo.body.code]).toEqual([400, 'PO_REQUIRED']);
    const pending = await json(await request.post('/api/invoices', { headers: H(), data: { poId: spoof.body.data.id, invoiceDate: future(0), totalAmount: 5, supplierInvoiceNumber: `Y-${stamp}` } }));
    expect([pending.status, pending.body.code]).toEqual([409, 'PO_NOT_INVOICEABLE']);
    const noInvoice = await json(await request.post('/api/payments', { headers: H(), data: { poId: po.id, amount: 10, paymentDate: future(0) } }));
    expect([noInvoice.status, noInvoice.body.code]).toEqual([400, 'INVOICE_REQUIRED']);
  });

  test('Coordonnées bancaires modifiées : paiement bloqué ; vérification par une autre personne ; rejet motivé', async ({ request }) => {
    // Changement par l'acheteur (admin) → à vérifier
    expect((await request.put(`/api/suppliers/${supplier.id}`, { headers: H(), data: { bankAccount: '9999-0000', bankName: 'Nouvelle banque' } })).status()).toBe(200);
    const fiche = (await (await request.get(`/api/suppliers/${supplier.id}`, { headers: H() })).json()).data;
    expect(fiche.bank_status.state).toBe('PENDING');
    const history = (await (await request.get(`/api/suppliers/${supplier.id}/bank-changes`, { headers: H() })).json()).data;
    expect(history.changes[0]).toEqual(expect.objectContaining({ source: 'BUYER', is_latest: true }));
    expect([history.changes[0].old_values.bank_account, history.changes[0].new_values.bank_account]).toEqual(['0001-1111', '9999-0000']);
    const changeId = history.changes[0].id;
    // Journal : numéros masqués
    const changedLog = await lastAudit(request, `action=SUPPLIER_BANK_CHANGED&entityType=supplier&entityRef=${supplier.id}`);
    expect(changedLog[0].new_value.bank_account).toBe('•••0000');

    // Paiement refusé tant que non vérifié (tracé)
    const blocked = await json(await request.post('/api/payments', { headers: H(), data: { invoiceId: invoice.id, amount: 100, paymentDate: future(0) } }));
    expect([blocked.status, blocked.body.code]).toEqual([409, 'BANK_CHANGE_UNVERIFIED']);
    expect((await lastAudit(request, `action=PAYMENT_BLOCKED&entityRef=${supplier.id}`)).length).toBeGreaterThan(0);

    // La personne qui a fait le changement ne peut pas le vérifier ; le motif est obligatoire au rejet
    const self = await json(await request.put(`/api/suppliers/${supplier.id}/bank-changes/${changeId}/review`, { headers: H(), data: { status: 'VERIFIED' } }));
    expect([self.status, self.body.code]).toEqual([403, 'SELF_VERIFICATION']);
    const noReason = await json(await request.put(`/api/suppliers/${supplier.id}/bank-changes/${changeId}/review`, { headers: auth(approver), data: { status: 'REJECTED' } }));
    expect([noReason.status, noReason.body.code]).toEqual([400, 'REASON_REQUIRED']);
    const rejected = await json(await request.put(`/api/suppliers/${supplier.id}/bank-changes/${changeId}/review`, { headers: auth(approver), data: { status: 'REJECTED', reason: 'RIB non confirmé par téléphone' } }));
    expect(rejected.body.data.status.state).toBe('REJECTED');
    const stillBlocked = await json(await request.post('/api/payments', { headers: H(), data: { invoiceId: invoice.id, amount: 100, paymentDate: future(0) } }));
    expect(stillBlocked.body.code).toBe('BANK_CHANGE_REJECTED');

    // Contre-appel fait : vérifié → paiement possible
    const verified = await json(await request.put(`/api/suppliers/${supplier.id}/bank-changes/${changeId}/review`, { headers: auth(approver), data: { status: 'VERIFIED' } }));
    expect(verified.body.data.status.state).toBe('VERIFIED');
    const pay = await json(await request.post('/api/payments', { headers: H(), data: { invoiceId: invoice.id, amount: 100, paymentDate: future(0) } }));
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);

    // Approbation du paiement : pas par celui qui l'a saisi
    const paymentId = pay.body.data.id;
    const selfPay = await json(await request.post(`/api/payments/${paymentId}/approve`, { headers: H(), data: {} }));
    expect([selfPay.status, selfPay.body.code]).toEqual([403, 'SELF_APPROVAL']);
    const selfStatus = await json(await request.patch(`/api/payments/${paymentId}/status`, { headers: H(), data: { status: 'PAID' } }));
    expect(selfStatus.status).toBe(403);
    expect((await request.post(`/api/payments/${paymentId}/approve`, { headers: auth(approver), data: {} })).status()).toBe(200);

    // Nouveau changement → de nouveau à vérifier (le précédent est remplacé)
    expect((await request.put(`/api/suppliers/${supplier.id}`, { headers: auth(approver), data: { bankIban: 'CD00 1234' } })).status()).toBe(200);
    const again = (await (await request.get(`/api/suppliers/${supplier.id}/bank-changes`, { headers: H() })).json()).data;
    expect([again.status.state, again.changes.length]).toEqual(['PENDING', 2]);
    const old = await json(await request.put(`/api/suppliers/${supplier.id}/bank-changes/${changeId}/review`, { headers: H(), data: { status: 'VERIFIED' } }));
    expect([old.status, old.body.code]).toEqual([409, 'SUPERSEDED']);
    // Aucun changement bancaire = aucune nouvelle ligne
    expect((await request.put(`/api/suppliers/${supplier.id}`, { headers: H(), data: { notes: 'note' } })).status()).toBe(200);
    expect((await (await request.get(`/api/suppliers/${supplier.id}/bank-changes`, { headers: H() })).json()).data.changes).toHaveLength(2);
  });

  test('Journal d\'audit : modification de budget (avant / après) et onglet des échecs et blocages', async ({ request }) => {
    expect((await request.put(`/api/budget/${budgetLine.id}`, { headers: H(), data: { allocatedAmount: 900_000 } })).status()).toBe(200);
    const [row] = await lastAudit(request, `action=BUDGET_LINE_UPDATED&entityType=budget_line&entityRef=${budgetLine.id}`);
    expect(Number(row.old_value.allocated_amount)).toBe(1_000_000);
    expect(Number(row.new_value.allocated_amount)).toBe(900_000);
    expect(row.entity_label).toContain(`IC-${stamp}`);
    const failures = (await (await request.get('/api/audit-logs?failuresOnly=1&limit=50', { headers: H() })).json()).data;
    expect(failures.some(r => r.action === 'SOD_VIOLATION_BLOCKED')).toBe(true);
    expect(failures.some(r => r.action === 'PAYMENT_BLOCKED')).toBe(true);
  });

  test('Tâche GoFlow : hors groupe refusée ; le demandeur ne peut ni prendre ni approuver sa propre réquisition', async ({ request }) => {
    // Réquisition de l'admin → tâche d'approbation N1
    let current;
    const start = Date.now();
    let task;
    while (Date.now() - start < WAIT) {
      current = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data;
      if (current?.process_instance_id) {
        const tasks = (await (await request.get(`/api/tasks/process/${current.process_instance_id}`, { headers: H() })).json()).data || [];
        task = tasks.find(tk => tk.status !== 'COMPLETED' && tk.taskDefinitionKey?.startsWith('Activity_Validation'));
        if (task) break;
      }
      await sleep(1500);
    }
    test.skip(!task, 'GoFlow indisponible');
    expect([task.canClaim, task.canComplete, task.blockedReason]).toEqual([false, false, 'SELF_APPROVAL']);

    const outsider = await json(await request.post(`/api/tasks/${task.id}/complete`, { headers: auth(logisticToken), data: { variables: { approved: true } } }));
    expect([outsider.status, outsider.body.code]).toEqual([403, 'TASK_NOT_IN_GROUP']);
    const claim = await json(await request.post(`/api/tasks/${task.id}/claim`, { headers: H() }));
    expect([claim.status, claim.body.code]).toEqual([403, 'SELF_APPROVAL']);
    // La clé et la réquisition envoyées par le client sont ignorées : impossible de contourner le contrôle
    const self = await json(await request.post(`/api/tasks/${task.id}/complete`, { headers: H(), data: {
      variables: { approved: true }, taskDefinitionKey: 'Activity_DirectPurchase', requisitionId: '00000000-0000-0000-0000-000000000000',
    } }));
    expect([self.status, self.body.code]).toEqual([403, 'SELF_APPROVAL']);
    const ok = await json(await request.post(`/api/tasks/${task.id}/complete`, { headers: auth(approver), data: { variables: { approved: true } } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});
