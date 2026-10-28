import { test, expect } from '@playwright/test';
import { getToken, auth } from './helpers.js';

// Modèles de documents de l'entreprise (migration 44) : livraison + unité de mesure de la réquisition (formulaire de
// demande d'achat), conditions du bon de commande, conditions générales de l'entreprise (dernière page du PDF).
test.describe.serial('API › Modèles de documents (réquisition, bon de commande)', () => {
  const stamp = Date.now().toString(36);
  let admin, project, line, supplier, requisitionId, poId, previousTerms;

  test.beforeAll(async ({ request }) => {
    admin = await getToken(request);
    [project] = (await (await request.get('/api/projects', { headers: auth(admin) })).json()).data;
    const res = await request.post('/api/budget', { headers: auth(admin), data: {
      entityCode: `DOC-${stamp}`.toUpperCase(), loc: '640901', fundingSource: 'FS-01', activityCode: 'T-ACT/01',
      description: 'Modèles de documents', allocatedAmount: 100000, projectId: project.id,
    } });
    line = (await res.json()).data;
    [supplier] = (await (await request.get('/api/suppliers?forPurchaseOrder=1', { headers: auth(admin) })).json()).data;
    previousTerms = (await (await request.get('/api/enterprises/current', { headers: auth(admin) })).json()).data?.po_terms ?? null;
  });

  test.afterAll(async ({ request }) => {
    if (poId) await request.delete(`/api/purchase-orders/${poId}`, { headers: auth(admin) });
    if (requisitionId) await request.delete(`/api/requisitions/${requisitionId}`, { headers: auth(admin) });
    if (line?.id) await request.delete(`/api/budget/${line.id}`, { headers: auth(admin) });
    // JSON : un champ multipart vide n'est pas envoyé par Playwright
    await request.put('/api/enterprises/current', { headers: auth(admin), data: { poTerms: previousTerms || '' } });
  });

  test('Date nécessaire invalide refusée', async ({ request }) => {
    const res = await request.post('/api/requisitions', { headers: auth(admin), data: {
      title: `[TEST DOC] date ${stamp}`, projectId: project.id, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM',
      neededBy: '26/10/2026',
      items: [{ description: 'Article', quantity: 1, frequency: 1, unitPrice: 10, budgetLineId: line.id }],
    } });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('NEEDED_BY_INVALID');
  });

  test('Réquisition : livraison et unité de mesure enregistrées, PDF du formulaire', async ({ request }) => {
    const res = await request.post('/api/requisitions', { headers: auth(admin), data: {
      title: `[TEST DOC] location ${stamp}`, description: 'Informations supplémentaires', justification: 'Appui programmatique',
      projectId: project.id, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM',
      deliveryAddress: 'BUREAU IMA BUNIA', neededBy: '2026-11-15', deliveryRecipient: 'Logistique', deliveryContact: '+243 900 000 000',
      items: [
        { description: 'Location Land Cruiser', quantity: 20, frequency: 1, unit: 'jour', unitPrice: 110, budgetLineId: line.id },
        { description: 'Location Noah', quantity: 5, frequency: 1, unitPrice: 75, budgetLineId: line.id },
      ],
    } });
    expect(res.status(), await res.text()).toBeLessThan(300);
    requisitionId = (await res.json()).data.id;

    const req = (await (await request.get(`/api/requisitions/${requisitionId}`, { headers: auth(admin) })).json()).data;
    expect(req.delivery_address).toBe('BUREAU IMA BUNIA');
    expect(req.needed_by).toBe('2026-11-15');
    expect(req.delivery_recipient).toBe('Logistique');
    expect(req.delivery_contact).toBe('+243 900 000 000');
    expect(req.items.map(i => i.item_unit)).toEqual(['jour', null]);

    for (const lang of ['fr', 'en']) {
      const pdf = await request.get(`/api/requisitions/${requisitionId}/export/pdf?lang=${lang}`, { headers: auth(admin) });
      expect(pdf.status()).toBe(200);
      expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    }
  });

  test('Entreprise : conditions générales du bon de commande', async ({ request }) => {
    const terms = `1. Acceptance of the Purchase Order ${stamp}\nThis Purchase Order may only be accepted…`;
    const res = await request.put('/api/enterprises/current', { headers: auth(admin), multipart: { poTerms: terms } });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).data.po_terms).toBe(terms);

    const tooLong = await request.put('/api/enterprises/current', { headers: auth(admin), multipart: { poTerms: 'x'.repeat(20001) } });
    expect(tooLong.status()).toBe(400);
  });

  test('Bon de commande : conditions de paiement / livraison, instructions, PDF', async ({ request }) => {
    // La commande exige une réquisition active (démarrée dans GoFlow)
    let status = 'DRAFT';
    for (let i = 0; i < 15 && status === 'DRAFT'; i++) {
      await new Promise(r => setTimeout(r, 1000));
      status = (await (await request.get(`/api/requisitions/${requisitionId}`, { headers: auth(admin) })).json()).data.status;
    }
    test.skip(status === 'DRAFT' || !supplier, 'GoFlow requis : réquisition restée en brouillon');

    const req = (await (await request.get(`/api/requisitions/${requisitionId}`, { headers: auth(admin) })).json()).data;
    const res = await request.post('/api/purchase-orders', { headers: auth(admin), data: {
      requisitionId, supplierId: supplier.id, currency: 'USD', totalAmount: 2575,
      shippingAddress: 'BUREAU DE IMA A KISANGANI',
      paymentTerms: '100% PAYEMENT APRES LIVRAISON', deliveryTerms: 'ACHAT STARLINK - BUREAU TSHOPO',
      specialInstructions: 'Veuillez respecter les quantités',
      items: req.items.map(i => ({ description: i.item_description, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), requisitionItemId: i.id })),
    } });
    expect(res.status(), await res.text()).toBeLessThan(300);
    poId = (await res.json()).data.id;

    const po = (await (await request.get(`/api/purchase-orders/${poId}`, { headers: auth(admin) })).json()).data;
    expect(po.payment_terms).toBe('100% PAYEMENT APRES LIVRAISON');
    expect(po.delivery_terms).toBe('ACHAT STARLINK - BUREAU TSHOPO');
    expect(po.special_instructions).toBe('Veuillez respecter les quantités');
    // Unité de mesure reprise de la ligne de réquisition
    expect(po.items.map(i => i.item_unit)).toEqual(['jour', null]);

    for (const lang of ['fr', 'en']) {
      const pdf = await request.get(`/api/purchase-orders/${poId}/pdf?lang=${lang}`, { headers: auth(admin) });
      expect(pdf.status()).toBe(200);
      expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    }
  });

});
