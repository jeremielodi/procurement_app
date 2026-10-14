import { test, expect } from '@playwright/test';
import { getToken, getApproverToken, auth } from './helpers.js';

// Correction d'une réquisition (migration 25_requisition_revisions.sql, BPMN Activity_ReviseRequisition) :
//  - l'approbateur renvoie pour correction (motif obligatoire) → « À corriger » (RETURNED)
//  - seul le demandeur modifie, et seulement dans cet état ; nouvelle soumission = version 2, nouveau circuit
//    d'approbation selon le NOUVEAU montant (ici N1 → N2)
//  - le demandeur peut retirer sa réquisition tant que personne n'a pris l'approbation ; abandon = annulée
// GoFlow requis (sinon les tests s'ignorent).
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const WAIT = 45_000;

test.describe.serial('API › Correction des réquisitions', () => {
  test.describe.configure({ timeout: 180_000 });
  const stamp = Date.now().toString(36);
  let admin, approver, dept, project, budgetLine, req, task;
  const H = () => auth(admin);
  const A = () => auth(approver);
  const json = async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) });
  const getReq = async (request) => (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data;

  /** Attend une tâche ouverte de la réquisition (clé BPMN), ou null */
  async function waitTask(request, key, requisition = req) {
    const start = Date.now();
    while (Date.now() - start < WAIT) {
      const r = (await (await request.get(`/api/requisitions/${requisition.id}`, { headers: H() })).json()).data;
      if (r?.process_instance_id) {
        const tasks = (await (await request.get(`/api/tasks/process/${r.process_instance_id}`, { headers: H() })).json()).data || [];
        const found = tasks.find(tk => tk.status !== 'COMPLETED' && tk.taskDefinitionKey === key);
        if (found) return found;
        if (r.status === 'BUDGET_INSUFFICIENT') return null;
      }
      await sleep(1500);
    }
    return null;
  }
  async function waitStatus(request, status) {
    const start = Date.now();
    while (Date.now() - start < WAIT) {
      const r = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data;
      if (r?.status === status) return r;
      await sleep(1000);
    }
    return null;
  }
  const createRequisition = async (request, title, unitPrice = 100) => (await (await request.post('/api/requisitions', { headers: H(), data: {
    title: `[TEST CORRECTION] ${title} ${stamp}`, description: 'x', departmentId: dept.id, projectId: project.id, currencyId: 1, currencyCode: 'USD',
    priority: 'MEDIUM', justification: 'Besoin initial', items: [{ description: 'Papier A4', quantity: 10, frequency: 1, unitPrice, budgetLineId: budgetLine.id }],
  } })).json()).data;

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    approver = await getApproverToken(request);
    [dept] = (await (await request.get('/api/departments', { headers: H() })).json()).data;
    [project] = (await (await request.get('/api/projects', { headers: H() })).json()).data;
    budgetLine = (await (await request.post('/api/budget', { headers: H(), data: {
      entityCode: `REV-${stamp}`, description: `Ligne correction ${stamp}`, allocatedAmount: 1_000_000, projectId: project.id,
    } })).json()).data;
    req = await createRequisition(request, 'renvoi');
    expect(req?.id).toBeTruthy();
  });

  test('Version 1 enregistrée à la création ; modification refusée hors correction et par un autre que le demandeur', async ({ request }) => {
    const versions = (await (await request.get(`/api/requisitions/${req.id}/versions`, { headers: H() })).json()).data;
    expect(versions.version).toBe(1);
    expect(versions.versions.map(v => v.version)).toEqual([1]);
    const data = { title: 'x', departmentId: dept.id, projectId: project.id, items: [{ description: 'x', quantity: 1, unitPrice: 1, budgetLineId: budgetLine.id }] };
    const other = await json(await request.put(`/api/requisitions/${req.id}`, { headers: A(), data }));
    expect([other.status, other.body.code]).toEqual([403, 'NOT_REQUESTER']);
    const notYet = await json(await request.put(`/api/requisitions/${req.id}`, { headers: H(), data }));
    expect([notYet.status, notYet.body.code]).toEqual([409, 'NOT_EDITABLE']);
  });

  test('Renvoi pour correction par l\'approbateur : motif obligatoire, « À corriger », étape personnelle du demandeur', async ({ request }) => {
    task = await waitTask(request, 'Activity_ValidationN1_Manager');
    test.skip(!task, 'GoFlow indisponible');
    const noReason = await json(await request.post(`/api/tasks/${task.id}/complete`, { headers: A(), data: { variables: { returnedForCorrection: true } } }));
    expect([noReason.status, noReason.body.code]).toEqual([400, 'RETURN_REASON_REQUIRED']);
    const noDecision = await json(await request.post(`/api/tasks/${task.id}/complete`, { headers: A(), data: { variables: {} } }));
    expect([noDecision.status, noDecision.body.code]).toEqual([400, 'DECISION_REQUIRED']);
    const ok = await json(await request.post(`/api/tasks/${task.id}/complete`, { headers: A(), data: {
      variables: { returnedForCorrection: true, comment: 'Quantité trop faible, ajoutez les enveloppes' },
    } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const current = await waitStatus(request, 'RETURNED');
    expect(current?.status).toBe('RETURNED');
    const state = (await (await request.get(`/api/requisitions/${req.id}/revision`, { headers: H() })).json()).data;
    expect([state.canEdit, state.lastReturn?.kind, state.lastReturn?.reason]).toEqual([true, 'RETURNED', 'Quantité trop faible, ajoutez les enveloppes']);
    // L'approbateur n'a pas la main
    expect((await (await request.get(`/api/requisitions/${req.id}/revision`, { headers: A() })).json()).data.canEdit).toBe(false);

    const revise = await waitTask(request, 'Activity_ReviseRequisition');
    expect(revise, 'étape « Corriger la réquisition »').toBeTruthy();
    // Pas de complétion « à vide » : uniquement par la nouvelle soumission
    const direct = await json(await request.post(`/api/tasks/${revise.id}/complete`, { headers: H(), data: { variables: { resubmitted: true } } }));
    expect([direct.status, direct.body.code]).toEqual([400, 'FORM_REQUIRED']);
  });

  test('Correction puis nouvelle soumission : version 2, changements visibles, nouveau circuit selon le nouveau montant (N2)', async ({ request }) => {
    test.skip(!task, 'GoFlow indisponible');
    const current = await getReq(request);
    const [item] = current.items || (await (await request.get(`/api/requisitions/${req.id}`, { headers: H() })).json()).data.items;
    const itemId = item.id;
    // 10 × 100 → 20 × 100 + enveloppes 100 × 280 = 30 000 → niveau N2 (≥ 25 000)
    const put = await json(await request.put(`/api/requisitions/${req.id}`, { headers: H(), data: {
      title: current.title, description: 'x', justification: 'Besoin revu', priority: 'HIGH', departmentId: dept.id, projectId: project.id,
      items: [
        { id: itemId, description: 'Papier A4', quantity: 20, frequency: 1, unitPrice: 100, budgetLineId: budgetLine.id },
        { description: 'Enveloppes', quantity: 100, frequency: 1, unitPrice: 280, budgetLineId: budgetLine.id },
      ],
    } }));
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.data.estimatedAmount).toBe(30000);

    const pending = (await (await request.get(`/api/requisitions/${req.id}/versions`, { headers: H() })).json()).data.pendingChanges;
    expect(pending.fields.map(f => f.field)).toEqual(expect.arrayContaining(['justification', 'priority', 'amount']));
    expect(pending.items.added.map(i => i.description)).toEqual(['Enveloppes']);
    expect(pending.items.changed[0].changes.map(c => c.field)).toEqual(expect.arrayContaining(['quantity', 'total']));

    const other = await json(await request.post(`/api/requisitions/${req.id}/resubmit`, { headers: A(), data: {} }));
    expect([other.status, other.body.code]).toEqual([403, 'NOT_REQUESTER']);
    const resubmit = await json(await request.post(`/api/requisitions/${req.id}/resubmit`, { headers: H(), data: { comment: 'Enveloppes ajoutées' } }));
    expect(resubmit.status, JSON.stringify(resubmit.body)).toBe(200);
    expect(resubmit.body.data.version).toBe(2);

    const versions = (await (await request.get(`/api/requisitions/${req.id}/versions`, { headers: H() })).json()).data;
    expect(versions.versions.map(v => [v.version, v.returnKind])).toEqual([[2, null], [1, 'RETURNED']]);
    expect(versions.versions[0].comment).toBe('Enveloppes ajoutées');
    expect(versions.versions[0].changes.fields.find(f => f.field === 'amount')).toMatchObject({ before: 1000, after: 30000 });
    expect(versions.pendingChanges).toBeNull();

    const n2 = await waitTask(request, 'Activity_ValidationN2_Finance');
    expect(n2, 'nouveau circuit : approbation N2 (montant ≥ 25 000)').toBeTruthy();
    expect((await getReq(request)).status).not.toBe('RETURNED');

    const timeline = (await (await request.get(`/api/requisitions/${req.id}/timeline`, { headers: H() })).json()).data;
    const titles = timeline.events.map(e => e.title);
    expect(titles.some(tl => tl.startsWith('Renvoyée pour correction'))).toBe(true);
    expect(titles).toContain('Soumise à nouveau — version 2');
  });

  test('Retrait par le demandeur : refusé si l\'approbation est prise en charge, accepté sinon', async ({ request }) => {
    test.skip(!task, 'GoFlow indisponible');
    const n2 = await waitTask(request, 'Activity_ValidationN2_Finance');
    expect((await request.post(`/api/tasks/${n2.id}/claim`, { headers: A() })).status()).toBe(200);
    const claimed = await json(await request.post(`/api/requisitions/${req.id}/withdraw`, { headers: H(), data: {} }));
    expect([claimed.status, claimed.body.code]).toEqual([409, 'APPROVAL_IN_PROGRESS']);
    expect((await (await request.get(`/api/requisitions/${req.id}/revision`, { headers: H() })).json()).data.canWithdraw).toBe(false);
    expect((await request.post(`/api/tasks/${n2.id}/unclaim`, { headers: A() })).status()).toBe(200);

    const notRequester = await json(await request.post(`/api/requisitions/${req.id}/withdraw`, { headers: A(), data: {} }));
    expect([notRequester.status, notRequester.body.code]).toEqual([403, 'NOT_REQUESTER']);
    expect((await (await request.get(`/api/requisitions/${req.id}/revision`, { headers: H() })).json()).data.canWithdraw).toBe(true);
    const ok = await json(await request.post(`/api/requisitions/${req.id}/withdraw`, { headers: H(), data: { reason: 'Je change de fournisseur visé' } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const state = (await (await request.get(`/api/requisitions/${req.id}/revision`, { headers: H() })).json()).data;
    expect([state.status, state.lastReturn?.kind, state.lastReturn?.version]).toEqual(['RETURNED', 'WITHDRAWN', 2]);
    expect(await waitTask(request, 'Activity_ReviseRequisition')).toBeTruthy();
  });

  test('Abandon pendant la correction : motif obligatoire, réquisition annulée', async ({ request }) => {
    test.skip(!task, 'GoFlow indisponible');
    const noReason = await json(await request.post(`/api/requisitions/${req.id}/abandon`, { headers: H(), data: {} }));
    expect([noReason.status, noReason.body.code]).toEqual([400, 'REASON_REQUIRED']);
    const ok = await json(await request.post(`/api/requisitions/${req.id}/abandon`, { headers: H(), data: { reason: 'Besoin couvert autrement' } }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const current = await getReq(request);
    expect(current.status).toBe('CANCELLED');
    const resubmit = await json(await request.post(`/api/requisitions/${req.id}/resubmit`, { headers: H(), data: {} }));
    expect([resubmit.status, resubmit.body.code]).toEqual([409, 'NOT_EDITABLE']);
  });
});
