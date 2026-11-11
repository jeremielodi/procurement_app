// Étape 2 — cas concret « cycle d'achat complet » : une réquisition menée jusqu'au paiement, chaque étape faite par
// la personne qui a le profil, avec la capture de l'écran qu'elle utilise. Les actions passent par l'API (comme le
// ferait le bouton), les captures montrent l'écran juste avant l'action (formulaire rempli, fenêtre ouverte).
import fs from 'fs';
import { CFG, call, tokenFor, loadState, saveState, sleep, future, today, pdfBlob, openBrowser, pick, clickButton } from './lib.mjs';

const DIR = 'workflow';

export async function workflow() {
  const state = loadState();
  const D = state.dataset;
  if (!D) throw new Error('Jeu de données absent : lancez d\'abord 1-dataset.mjs');
  const U = D.users, I = D.items;
  const tok = (k) => tokenFor(k === 'supplier' ? D.supplier.email : U[k].email);
  const email = (k) => (k === 'supplier' ? D.supplier.email : U[k].email);
  const admin = await tok('admin');
  const B = await openBrowser();
  const shot = (k, url, name, opts) => B.shot(email(k), url, name, { dir: DIR, ...opts });
  const pdf = async (url, name, pages) => B.renderPdf(await call('GET', url, admin, undefined, { raw: true }), DIR, name, pages);

  async function waitTask(pid, key, timeout = 90_000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const t = (await call('GET', `/tasks/process/${pid}`, admin).catch(() => [])).find(x => x.taskDefinitionKey === key && x.status !== 'COMPLETED');
      if (t) return t;
      await sleep(1500);
    }
    throw new Error(`Étape ${key} introuvable (BpmnGo démarré et BPMN déployé ?)`);
  }
  /** Prend la tâche en charge (API) puis ouvre sa fenêtre « Traiter » dans l'onglet Tâches de la réquisition */
  async function openTask(k, reqId, task) {
    await call('POST', `/tasks/${task.id}/claim`, await tok(k), {}).catch(e => console.log('  claim', e.message));
    const page = await B.go(email(k), `/requisitions/${reqId}/tasks`);
    await page.locator('[data-testid="task-process"]').first().click({ timeout: 30_000 });
    await page.waitForTimeout(900);
    return page;
  }

  try {
    console.log('• Demande');
    await B.pageFor(email('requester')); // connexion (premier chargement de Vite)
    fs.mkdirSync(`${CFG.captures}/${DIR}`, { recursive: true });
    {
      const ctx = await B.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
      const p = await ctx.newPage();
      await p.goto(CFG.app + '/login'); await p.fill('input[name="email"]', U.requester.email);
      await p.waitForTimeout(1200);
      await p.screenshot({ path: `${CFG.captures}/${DIR}/01_connexion.png` });
      await ctx.close();
    }
    await shot('requester', '/dashboard', '02_demandeur_tableau-de-bord');

    // Formulaire rempli comme le ferait la demandeuse (non envoyé : la réquisition est créée par l'API)
    await shot('requester', '/requisitions/new', '03_demandeur_formulaire-requisition', { tall: 1880, before: async (p) => {
      await p.waitForSelector('input[name="title"]');
      await p.waitForTimeout(1500);
      await p.fill('input[name="title"]', 'Fournitures de bureau — bureau de Goma (T4)');
      await pick(p, '[data-testid="requisition-project"]', D.project.id);
      await p.waitForTimeout(1500);
      await pick(p, 'select[name="departmentId"]', D.dept.id);
      await p.locator('textarea[name="description"]').fill('Papier et toners pour le bureau du projet').catch(() => {});
      await p.locator('textarea[name="justification"]').fill('Réapprovisionnement du bureau pour le dernier trimestre').catch(() => {});
      await p.locator('input[name="deliveryAddress"]').fill('Bureau du projet, Avenue de la Paix 12, Goma').catch(() => {});
      await p.getByRole('button', { name: /Ajouter un article/ }).click();
      await p.waitForTimeout(500);
      for (const [i, [label, qty, price]] of [['Ramette papier A4 80 g', 50, 6], ['Cartouche toner HP 85A', 10, 90]].entries()) {
        const desc = p.getByPlaceholder("Description de l'article").nth(i);
        await desc.click(); await desc.type(label, { delay: 15 });
        await p.waitForTimeout(800); await p.keyboard.press('Escape');
        const nums = p.locator('tbody tr').nth(i).locator('input[type="number"]');
        await nums.nth(0).fill(String(qty)); await nums.nth(2).fill(String(price));
      }
      await pick(p, '[data-testid="item-unit"]', I.units.REAM, 0);
      // Ligne budgétaire de chaque article : fenêtre « Rechercher une ligne budgétaire » → « Sélectionner »
      for (let i = 0; i < 2; i++) {
        await p.getByPlaceholder('Sélectionner ligne budgétaire').nth(i).click();
        await p.getByRole('button', { name: 'Sélectionner', exact: true }).first().click({ timeout: 10_000 }).catch(() => p.keyboard.press('Escape'));
        await p.waitForTimeout(700);
      }
      await p.mouse.click(10, 10);
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(800);
    } });

    const req = await call('POST', '/requisitions', await tok('requester'), {
      title: 'Fournitures de bureau — bureau de Goma (T4)', description: 'Papier et toners pour le bureau du projet',
      departmentId: D.dept.id, projectId: D.project.id, estimatedAmount: 1200, currencyId: 1, currencyCode: 'USD', priority: 'MEDIUM',
      justification: 'Réapprovisionnement du bureau pour le dernier trimestre',
      deliveryAddress: 'Bureau du projet, Avenue de la Paix 12, Goma', neededBy: future(21), deliveryRecipient: U.requester.name, deliveryContact: '+243 990 000 010',
      items: [
        { description: I.paper.name, quantity: 50, frequency: 1, unitPrice: 6, budgetLineId: D.budget.id, stockItemId: I.paper.id, unitId: I.units.REAM },
        { description: I.toner.name, quantity: 10, frequency: 1, unitPrice: 90, budgetLineId: D.budget.id, stockItemId: I.toner.id, unitId: I.units.PIECE },
      ],
    });
    let pid = null;
    for (let i = 0; i < 30 && !pid; i++) { pid = (await call('GET', `/requisitions/${req.id}`, admin)).process_instance_id; if (!pid) await sleep(1000); }
    if (!pid) throw new Error('La réquisition n\'a pas démarré de processus BpmnGo');
    const run = { requisitionId: req.id, pid };
    saveState({ ...loadState(), workflow: run });

    let t = await waitTask(pid, 'Activity_ProjectManagerApproval');
    await shot('requester', `/requisitions/${req.id}`, '04_demandeur_fiche-requisition');
    await pdf(`/requisitions/${req.id}/export/pdf?lang=fr`, 'P1_pdf_formulaire-demande-achat');

    console.log('• Validation du chef de projet');
    await shot('pm', '/tasks', '06_chef-projet_mes-taches');
    await shot('pm', `/requisitions/${req.id}/tasks`, '07_chef-projet_onglet-taches');
    await shot('pm', null, '07b_chef-projet_prendre-en-charge', { before: (p) => clickButton(p, /Prendre en charge/) });
    await shot('pm', null, '08_chef-projet_validation-agent-achats', { before: async () => {
      const p = await openTask('pm', req.id, t);
      await p.locator('.fixed input[type="radio"]').first().check({ force: true });
      await p.waitForTimeout(900);
      await pick(p, '[data-testid="procurement-agent-select"]', U.procurement.id);
      await p.locator('[data-testid="approval-comment"]').fill('Validé — conforme au budget EAU-01').catch(() => {});
    } });
    await call('POST', `/tasks/${t.id}/complete`, await tok('pm'), { variables: { approved: true, returnedForCorrection: false, procurementAgentId: U.procurement.id, comment: 'Validé — conforme au budget EAU-01' } });

    console.log('• Achats');
    t = await waitTask(pid, 'Activity_DetermineType');
    await shot('procurement', '/tasks', '09_agent-achats_mes-taches');
    await shot('procurement', null, '10_agent-achats_methode-achat', { before: async () => {
      const p = await openTask('procurement', req.id, t);
      await p.locator('[data-testid="method-DIRECT_PURCHASE"]').click().catch(() => {});
    } });
    await call('POST', `/tasks/${t.id}/complete`, await tok('procurement'), { variables: { procurementMethod: 'DIRECT_PURCHASE', multiSupplier: false, comment: 'Montant faible, fournisseur habituel' } });

    t = await waitTask(pid, 'Activity_DirectPurchase');
    await shot('procurement', null, '11_agent-achats_achat-direct-proforma', { before: () => openTask('procurement', req.id, t) });
    const supplier = (await call('GET', `/suppliers?forPurchaseOrder=1&requisitionId=${req.id}`, admin)).find(s => s.name === D.supplier.name);
    const up = new FormData();
    up.append('file', pdfBlob(), 'proforma-BK-2026-118.pdf'); up.append('entity_type', 'requisition'); up.append('entity_id', req.id);
    const att = await call('POST', '/upload', await tok('procurement'), up);
    await call('POST', `/tasks/${t.id}/complete`, await tok('procurement'), { variables: {
      supplierId: supplier.id, proformaAttachmentId: att.id, proformaNumber: 'BK-2026-118', proformaAmount: 1200, comment: 'Pro-forma reçue le jour même',
    } });

    t = await waitTask(pid, 'Activity_CreatePO');
    await shot('procurement', null, '12_agent-achats_formulaire-bon-commande', { tall: 1250, before: async () => {
      const p = await openTask('procurement', req.id, t);
      await p.waitForURL(/purchase-orders/, { timeout: 15_000 });
      await B.settle(p, 2000);
    } });
    const ritems = (await call('GET', `/requisitions/${req.id}`, admin)).items || [];
    const po = await call('POST', '/purchase-orders', await tok('procurement'), {
      requisitionId: req.id, supplierId: supplier.id, currency: 'USD', totalAmount: 1200, deliveryDate: future(14), taskId: t.id,
      paymentTerms: 'Paiement à 30 jours après réception de la facture', deliveryTerms: 'Livraison franco au bureau de Goma',
      specialInstructions: 'Livrer entre 8 h et 16 h, contacter la logisticienne à l\'arrivée',
      items: ritems.map(i => ({ description: i.item_description, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), requisitionItemId: i.id, stockItemId: i.stock_item_id })),
    });
    run.poId = po.id; saveState({ ...loadState(), workflow: run });
    await waitTask(pid, 'Activity_POReview');
    await pdf(`/purchase-orders/${po.id}/pdf?lang=fr`, 'P2_pdf_bon-de-commande');

    console.log('• Révision et approbation du bon de commande');
    await shot('reviewer', `/purchase-orders/${po.id}`, '14_reviseur_fiche-bon-commande');
    await shot('reviewer', null, '15_reviseur_approuver-revision', { before: async (p) => {
      await p.locator('[data-testid="po-review-approve"]').click(); await p.waitForTimeout(600);
      await p.locator('[data-testid="po-review-comment"]').fill('Prix conformes à la pro-forma, conditions vérifiées').catch(() => {});
    } });
    await call('POST', `/purchase-orders/${po.id}/review`, await tok('reviewer'), { decision: 'APPROVE', comment: 'Prix conformes à la pro-forma, conditions vérifiées' });
    await waitTask(pid, 'Activity_POApprovalN1');
    await shot('manager', '/tasks', '16_manager-n1_mes-taches');
    await shot('manager', `/purchase-orders/${po.id}`, '17_manager-n1_approbation-bon-commande', { before: (p) => clickButton(p, /^Approuver/) });
    await call('POST', `/purchase-orders/${po.id}/approve`, await tok('manager'), { comments: 'Approuvé' });

    console.log('• Confirmation du fournisseur');
    await waitTask(pid, 'Activity_SupplierConfirmation');
    await sleep(4000); // envoi du bon de commande par le worker
    await shot('supplier', '/supplier/orders', '18_fournisseur_mes-commandes');
    await shot('supplier', `/supplier/orders/${po.id}`, '19_fournisseur_confirmation-commande', { tall: 950, before: async (p) => {
      await p.locator('[data-testid="order-confirm"]').click(); await p.waitForTimeout(500);
      await p.locator('[data-testid="order-delivery-date"]').fill(future(7)).catch(() => {});
      await p.locator('[data-testid="order-comment"]').fill('Commande reçue, livraison prévue la semaine prochaine').catch(() => {});
    } });
    await call('POST', `/supplier-portal/orders/${po.id}/confirm`, await tok('supplier'), { deliveryDate: future(7), reference: 'BL-BK-5521', comment: 'Commande reçue, livraison prévue la semaine prochaine' });

    console.log('• Livraison : SAN puis GRN');
    t = await waitTask(pid, 'Activity_ServiceAcceptance');
    await shot('requester', `/requisitions/${req.id}/tasks`, '20_demandeur_tache-san');
    await shot('requester', `/service-acceptance-notes/new?taskId=${t.id}&poId=${po.id}`, '21_demandeur_formulaire-san', { tall: 1100 });
    await call('POST', '/service-acceptance-notes', await tok('requester'), { poId: po.id, taskId: t.id, serviceAccepted: true, comments: 'Livraison conforme : 50 rames et 10 toners reçus en bon état' });

    t = await waitTask(pid, 'Activity_GoodsReceipt');
    await shot('logistic', `/goods-receipts/new?taskId=${t.id}&poId=${po.id}`, '22_logistique_formulaire-reception');
    const poItems = (await call('GET', `/purchase-orders/${po.id}`, admin)).items;
    const grn = await call('POST', '/goods-receipts', await tok('logistic'), {
      poId: po.id, taskId: t.id, warehouseId: D.wh.id, receiptDate: today(), notes: 'Réception complète au magasin central',
      grnItems: poItems.map(i => ({ poItemId: i.id, item_description: i.item_description ?? i.description, quantity_received: Number(i.quantity), quantity_accepted: Number(i.quantity), quantity_rejected: 0 })),
    });
    run.grnId = grn.id || grn.grnId; saveState({ ...loadState(), workflow: run });
    await shot('logistic', `/goods-receipts/${run.grnId}`, '23_logistique_fiche-reception', { tall: 1100 });
    // Le magasinier (autre personne ayant accès au dépôt) confirme l'entrée en magasin : sa signature sur le GRN
    await shot('storekeeper', `/goods-receipts/${run.grnId}`, '23b_magasinier_confirmer-entree-magasin', { tall: 1100, before: async (p) => {
      await p.locator('[data-testid="grn-store-confirm"]').click();
      await p.waitForTimeout(600);
      await p.locator('[data-testid="grn-store-comment"]').fill('50 rames et 10 toners rangés, étagère B2');
    } });
    await call('POST', `/goods-receipts/${run.grnId}/store-confirm`, await tok('storekeeper'), { comment: '50 rames et 10 toners rangés, étagère B2' });
    await pdf(`/goods-receipts/${run.grnId}/pdf?lang=fr`, 'P3_pdf_bon-de-reception', 1);

    console.log('• Facture et paiement');
    t = await waitTask(pid, 'Activity_EnterInvoice');
    await shot('finance', `/invoices/new?taskId=${t.id}&poId=${po.id}`, '24_finance_formulaire-facture', { tall: 1100 });
    const inv = await call('POST', '/invoices', await tok('finance'), {
      poId: po.id, grnId: run.grnId, taskId: t.id, supplierInvoiceNumber: `FV-BK-${Date.now().toString(36).toUpperCase()}`, invoiceDate: today(), dueDate: future(30),
      subtotal: 1200, taxAmount: 0, totalAmount: 1200, currency: 'USD', notes: 'Facture reçue par email',
    });
    run.invoiceId = inv.id; saveState({ ...loadState(), workflow: run });
    t = await waitTask(pid, 'Activity_ProcessPayment'); // rapprochement à 3 voies fait
    await shot('finance', `/invoices/${inv.id}`, '25_finance_fiche-facture-rapprochement');
    await pdf(`/invoices/${inv.id}/pdf?lang=fr`, 'P4_pdf_facture', 1);
    await shot('finance', `/payments/new?taskId=${t.id}&invoiceId=${inv.id}`, '26_finance_formulaire-paiement', { tall: 1100 });
    const pay = await call('POST', '/payments', await tok('finance'), {
      invoiceId: inv.id, taskId: t.id, amount: 1200, currency: 'USD', paymentMethod: 'BANK_TRANSFER', paymentDate: today(),
      reference: 'VIR-2026-1104', bankAccount: '00011-22233-44', notes: 'Virement bancaire',
    });
    run.paymentId = pay.id; saveState({ ...loadState(), workflow: run });
    await shot('dg', `/payments/${pay.id}`, '27_dg_approbation-paiement');
    await call('POST', `/payments/${pay.id}/approve`, await tok('dg'), {});
    await shot('dg', `/payments/${pay.id}`, '28_dg_paiement-paye');
    await pdf(`/payments/${pay.id}/pdf?lang=fr`, 'P5_pdf_paiement', 1);

    console.log('• Suivi et pilotage');
    await sleep(6000); // clôture de la réquisition par le worker
    await shot('requester', `/requisitions/${req.id}?tab=history`, '29_demandeur_suivi-workflow', { tall: 2600 });
    await shot('admin', '/dashboard', '30_admin_tableau-de-bord', { tall: 1600, before: (p) => p.waitForTimeout(2500) });
    await shot('admin', '/requisitions', '31_admin_liste-requisitions');
    console.log('✅ Cycle d\'achat complet capturé');
  } finally {
    await B.close();
  }
}

if (process.argv[1]?.endsWith('2-workflow.mjs')) workflow().catch(e => { console.error('❌', e.message); process.exit(1); });
