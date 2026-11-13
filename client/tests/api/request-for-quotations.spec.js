/**
 * tests/api/request-for-quotations.spec.js
 *
 * Devis multiples = demande de cotations (migration 59, 2026-11-10) :
 *   - toutes les méthodes sont ouvertes quel que soit le montant (ici « Devis multiples » à 40 000, avant : RFP imposé) ;
 *   - la répartition entre fournisseurs se décide à l'attribution, comme pour l'appel d'offres ;
 *   - la demande de cotations utilise le module des appels d'offres : type RFQ imposé par l'étape ouverte, offres,
 *     clôture, attribution → l'étape « Devis multiples » est terminée, le bon de commande suit ;
 *   - commentaire de l'attribution sous son propre nom dans BpmnGo (awardComment).
 * Requiert BpmnGo.
 */
import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth, supplierRegistration, firstReferenceIds, getProcurementAgentId } from './helpers.js';

const POLL_TIMEOUT = 60_000;
const stamp = Date.now();
let token, approverToken, req, rfq;
const suppliers = [];

test.describe.serial('Devis multiples → demande de cotations (BpmnGo)', () => {
  const H = () => auth(token);
  const openTasks = async (request) => {
    const res = await request.get(`/api/tasks/process/${req.process_instance_id}`, { headers: H() });
    return res.ok() ? ((await res.json()).data || []).filter(t => t.status !== 'COMPLETED') : [];
  };
  const waitForTask = async (request, key) => {
    let task = null;
    await expect.poll(async () => {
      task = (await openTasks(request)).find(t => t.taskDefinitionKey === key) || null;
      return !!task;
    }, { message: `tâche ${key}`, timeout: POLL_TIMEOUT, intervals: [2000] }).toBe(true);
    return task;
  };
  const complete = (request, task, variables, tk = token) =>
    request.post(`/api/tasks/${task.id}/complete`, { headers: auth(tk), data: { variables } });

  test('Réquisition de 40 000 validée ; « Devis multiples » accepté (toutes les méthodes ouvertes)', async ({ request }) => {
    token = await getToken(request);
    approverToken = await getApproverToken(request);
    const { locationId, categoryId } = await firstReferenceIds(request);
    for (const n of [1, 2]) {
      const res = await request.post('/api/auth/register-supplier', { multipart: supplierRegistration({
        name: `Fournisseur RFQ ${n} ${stamp}`, email: `rfq${n}.${stamp}@example.com`, locationIds: [locationId], categoryIds: [categoryId],
      }) });
      expect(res.status(), await res.text()).toBe(201);
      const body = (await res.json()).data;
      const me = (await (await request.get('/api/supplier-portal/me', { headers: auth(body.token) })).json()).data;
      suppliers.push({ id: me.id, token: body.token });
    }
    const projects = (await (await request.get('/api/projects', { headers: H() })).json()).data || [];
    const line = (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: `BL-RFQ-${stamp}`, description: 'Ligne test RFQ', allocatedAmount: 1_000_000, projectId: projects[0].id,
    } })).json()).data;
    const created = await request.post('/api/requisitions', { headers: H(), data: { submit: true,
      title: `[TEST RFQ] ${stamp}`, description: 'Devis multiples', projectId: projects[0].id,
      currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'Test',
      items: ['Ordinateurs', 'Écrans'].map(description => ({ description, quantity: 1, frequency: 1, unitPrice: 20000, budgetLineId: line?.id ?? line })),
    } });
    expect(created.status(), await created.text()).toBe(201);
    req = (await created.json()).data;
    await expect.poll(async () => {
      req = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data;
      return req.process_instance_id || null;
    }, { timeout: 15_000 }).toBeTruthy();

    const approval = await waitForTask(request, 'Activity_ProjectManagerApproval');
    test.skip(!approval, 'BpmnGo indisponible');
    expect((await complete(request, approval, { approved: true, procurementAgentId: await getProcurementAgentId(request) }, approverToken)).status()).toBe(200);

    const method = await waitForTask(request, 'Activity_DetermineType');
    // Répartition : à l'attribution (publiée « par article »), comme pour l'appel d'offres
    const split = await complete(request, method, { procurementMethod: 'MULTIPLE_QUOTATIONS', multiSupplier: true });
    expect((await split.json()).code).toBe('SPLIT_NOT_AVAILABLE_FOR_RFP');
    const ok = await complete(request, method, { procurementMethod: 'MULTIPLE_QUOTATIONS', comment: 'Trois devis suffisent' });
    expect(ok.status(), await ok.text()).toBe(200);
    await waitForTask(request, 'Activity_RequestQuotations');
  });

  test('Demande de cotations publiée avec le module des appels d\'offres (type imposé par l\'étape)', async ({ request }) => {
    const step = await waitForTask(request, 'Activity_RequestQuotations');
    // Type demandé ignoré : l'étape ouverte « Devis multiples » impose RFQ
    const res = await request.post('/api/tenders', { headers: H(), data: {
      requisitionId: req.id, taskId: step.id, tenderNumber: `RFQ-${stamp}`, title: 'Matériel informatique', tenderType: 'RFP',
      startDate: new Date(Date.now() - 60_000).toISOString(), endDate: new Date(Date.now() + 3_600_000).toISOString(), maxDeliveryDays: 20,
    } });
    expect(res.status(), await res.text()).toBe(201);
    rfq = (await res.json()).data;
    expect(rfq.tender_type).toBe('RFQ');

    const [i1, i2] = req.items.map(i => i.id);
    for (const [s, price] of [[suppliers[0], 18000], [suppliers[1], 19500]]) {
      const sub = await request.put(`/api/supplier-portal/tenders/${rfq.id}/submission`, { headers: auth(s.token), data: {
        deliveryDays: 10, items: [{ requisitionItemId: i1, unitPrice: price }, { requisitionItemId: i2, unitPrice: price }],
      } });
      expect(sub.status(), await sub.text()).toBe(200);
    }
    expect((await request.post(`/api/tenders/${rfq.id}/close`, { headers: H() })).status()).toBe(200);
  });

  test('Attribution → étape « Devis multiples » terminée, bon de commande ensuite, commentaire distinct', async ({ request }) => {
    const res = await request.post(`/api/tenders/${rfq.id}/award`, { headers: H(), data: { supplierId: suppliers[0].id, comment: 'Moins-disant' } });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(200);
    expect(body.camundaTaskCompleted).toBe(true);
    await waitForTask(request, 'Activity_CreatePO');
    expect((await openTasks(request)).some(t => t.taskDefinitionKey === 'Activity_RequestQuotations')).toBe(false);

    const vars = (await (await request.get(`/api/workflow/process/${req.process_instance_id}/variables`, { headers: H() })).json()).data || {};
    expect(vars.awardComment).toBe('Moins-disant');
    expect(vars.methodComment).toBe('Trois devis suffisent');
    expect(vars.pmApprovalComment).toBeUndefined(); // validation sans commentaire

    const titles = (await (await request.get(`/api/requisitions/${req.id}/timeline?lang=fr`, { headers: H() })).json()).data.events.map(e => e.title);
    expect(titles).toContain('Demande de cotations publiée');
    expect(titles).toContain('Demande de cotations attribuée');
  });
});
