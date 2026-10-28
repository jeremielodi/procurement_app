/**
 * tests/api/document-signatures.spec.js
 *
 * Signatures dans les PDF (cycle GoFlow réel) :
 *   - réquisition : signature du demandeur, puis celle de l'approbateur N1 une fois l'étape approuvée — étape terminée
 *     sans prise en charge préalable, comme depuis la fenêtre de l'onglet tâches (l'auteur n'est alors connu que par
 *     la ligne APPROVED de TaskController)
 *   - bon de commande : signature du créateur (« Demandé par »), puis celle de l'approbateur (« Approuvé par ») une fois
 *     l'étape Activity_POApproval terminée — approbation historisée (approvals.entity_id TEXT, migration 44) et
 *     approved_by renseigné
 * Une signature = une image intégrée au PDF : on compte les images avant / après chaque approbation.
 *
 * Requiert GoFlow (sinon les tests s'ignorent).
 */
import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';
import { getToken, getApproverToken, auth, directPurchaseVariables } from './helpers.js';

const POLL_TIMEOUT = 60_000;

/** PNG 8×4 d'une couleur unie (deux couleurs = deux images distinctes dans le PDF) */
function png([r, g, b]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), 8 + data.length);
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

/** Nombre d'images intégrées au PDF (Chrome écrit une XObject /Subtype /Image par image distincte) */
const imageCount = (pdf) => (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;

test.describe.serial('API › Signatures dans les PDF de réquisition et de bon de commande', () => {
  let token, approverToken, approverId, req, po, line;
  const saved = {}; // signatures existantes, rétablies à la fin

  async function openTasks(request, pid) {
    const res = await request.get(`/api/tasks/process/${pid}`, { headers: auth(token) });
    if (!res.ok()) return [];
    const body = await res.json();
    return (body.data || body.tasks || []).filter(t => t.status !== 'COMPLETED');
  }
  async function waitForTask(request, key) {
    let task = null;
    await expect.poll(async () => {
      task = (await openTasks(request, req.process_instance_id)).find(t => t.taskDefinitionKey === key) || null;
      return !!task;
    }, { message: `tâche ${key}`, timeout: POLL_TIMEOUT, intervals: [2000] }).toBe(true);
    return task;
  }
  const complete = (request, task, variables, tk = token) =>
    request.post(`/api/tasks/${task.id}/complete`, { headers: auth(tk), data: { variables } });
  const pdf = async (request, url) => {
    const res = await request.get(url, { headers: auth(token), params: { lang: 'fr' } });
    expect(res.status()).toBe(200);
    return res.body();
  };

  test.beforeAll(async ({ request }) => {
    token = await getToken(request);
    approverToken = await getApproverToken(request);
    approverId = (await (await request.get('/api/auth/profile', { headers: auth(approverToken) })).json()).data?.id;
    for (const [who, tk, color] of [['requester', token, [20, 40, 160]], ['approver', approverToken, [160, 20, 40]]]) {
      const current = await request.get('/api/auth/signature', { headers: auth(tk) });
      saved[who] = current.ok() ? { buffer: await current.body(), mimeType: current.headers()['content-type'] } : null;
      const res = await request.put('/api/auth/signature', { headers: auth(tk), multipart: {
        signature: { name: 'signature.png', mimeType: 'image/png', buffer: png(color) },
      } });
      expect(res.status(), await res.text()).toBe(200);
    }
  });

  test.afterAll(async ({ request }) => {
    for (const [who, tk] of [['requester', token], ['approver', approverToken]]) {
      if (saved[who]) {
        await request.put('/api/auth/signature', { headers: auth(tk), multipart: {
          signature: { name: 'signature', mimeType: saved[who].mimeType, buffer: saved[who].buffer },
        } });
      } else {
        await request.delete('/api/auth/signature', { headers: auth(tk) });
      }
    }
  });

  test('Réquisition : signature du demandeur, puis de l\'approbateur après approbation', async ({ request }) => {
    const H = auth(token);
    const [project] = (await (await request.get('/api/projects', { headers: H })).json()).data;
    line = (await (await request.post('/api/budget', { headers: H, data: {
      entityCode: `BL-SIGN-${Date.now()}`, description: 'Signatures PDF', allocatedAmount: 1000000, projectId: project.id,
    } })).json()).data;
    const created = await request.post('/api/requisitions', { headers: H, data: {
      title: `[TEST SIGNATURES] ${Date.now()}`, description: 'Signatures', projectId: project.id,
      currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM', justification: 'Test',
      items: [{ description: 'Pièce', quantity: 1, frequency: 1, unit: 'pièce', unitPrice: 1000, budgetLineId: line.id }],
    } });
    expect(created.status(), await created.text()).toBe(201);
    req = (await created.json()).data;
    await expect.poll(async () => {
      req = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data;
      return req.process_instance_id || null;
    }, { timeout: 15_000 }).toBeTruthy();
    test.skip(!req.process_instance_id, 'GoFlow requis');

    const before = imageCount(await pdf(request, `/api/requisitions/${req.id}/export/pdf`));
    expect(before, 'signature du demandeur').toBeGreaterThanOrEqual(1);

    // Approbation N1 par un autre utilisateur, sans prise en charge préalable
    const n1 = await waitForTask(request, 'Activity_ValidationN1_Manager');
    const res = await complete(request, n1, { approved: true, returnedForCorrection: false, comment: 'OK' }, approverToken);
    expect(res.status(), await res.text()).toBe(200);

    const after = imageCount(await pdf(request, `/api/requisitions/${req.id}/export/pdf`));
    expect(after, 'signature de l\'approbateur ajoutée').toBe(before + 1);
  });

  test('Bon de commande : signature du créateur, puis de l\'approbateur après approbation', async ({ request }) => {
    test.skip(!req?.process_instance_id, 'GoFlow requis');
    const H = auth(token);
    const method = await waitForTask(request, 'Activity_DetermineType');
    expect((await complete(request, method, { procurementMethod: 'DIRECT_PURCHASE' })).status()).toBe(200);
    const supplier = (await (await request.get('/api/suppliers', { headers: H, params: { forPurchaseOrder: 1 } })).json()).data[0];
    const direct = await waitForTask(request, 'Activity_DirectPurchase');
    const done = await complete(request, direct, await directPurchaseVariables(request, token, req.id, supplier.id));
    expect(done.status(), await done.text()).toBe(200);
    await waitForTask(request, 'Activity_CreatePO');

    const items = (await (await request.get(`/api/requisitions/${req.id}`, { headers: H })).json()).data.items;
    const created = await request.post('/api/purchase-orders', { headers: H, data: {
      requisitionId: req.id, supplierId: supplier.id, currency: 'USD', totalAmount: 1000, paymentTerms: '100 % après livraison',
      items: items.map(i => ({ description: i.item_description, quantity: 1, unitPrice: 1000, requisitionItemId: i.id })),
    } });
    expect([200, 201], await created.text()).toContain(created.status());
    po = (await created.json()).data;

    const before = imageCount(await pdf(request, `/api/purchase-orders/${po.id}/pdf`));
    expect(before, 'signature du créateur (« Demandé par »)').toBeGreaterThanOrEqual(1);

    // Approbation depuis l'onglet tâches de la réquisition (autre utilisateur : séparation des tâches)
    const approval = await waitForTask(request, 'Activity_POApproval');
    const res = await complete(request, approval, { poApproved: true, poId: po.id, comment: 'OK' }, approverToken);
    expect(res.status(), await res.text()).toBe(200);

    const detail = (await (await request.get(`/api/purchase-orders/${po.id}`, { headers: H })).json()).data;
    expect(detail.status).toBe('PO_APPROVED');
    expect(detail.approved_by).toBe(approverId);
    expect(detail.approvals.map(a => [a.approver_id, a.status])).toEqual([[approverId, 'APPROVED']]);

    const after = imageCount(await pdf(request, `/api/purchase-orders/${po.id}/pdf`));
    expect(after, 'signature de l\'approbateur (« Approuvé par ») ajoutée').toBe(before + 1);
  });
});
