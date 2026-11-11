// Étape 2b — cas concret « appel d'offres » : réquisition de 15 ordinateurs, méthode « Appel d'offres (RFP) »,
// publication avec questionnaire, trois offres scellées, clôture anticipée, comparatif (prix + note technique),
// attribution, vue de l'attributaire, bon de commande aux prix de l'offre, approbation N2. La suite (confirmation,
// SAN, GRN, facture, paiement) est celle du cas « cycle d'achat complet ».
import fs from 'fs';
import { CFG, call, tokenFor, loadState, saveState, sleep, future, openBrowser, pick, clickButton } from './lib.mjs';

const DIR = 'tender';
const iso = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

// Offres des trois fournisseurs : prix par article, délai, réponses (garantie = indice de l'option, SAV, références)
const OFFERS = [
  { supplier: 0, laptop: 1820, licence: 115, days: 21, warranty: 1, sav: 'YES', refs: 'Fourniture de 40 ordinateurs à une ONG de Goma (2025)' },
  { supplier: 1, laptop: 1750, licence: 110, days: 14, warranty: 0, sav: 'YES', refs: 'Équipement informatique de 3 hôpitaux du Nord-Kivu (2024-2025)' },
  { supplier: 2, laptop: 1690, licence: 130, days: 30, warranty: 2, sav: 'NO', refs: 'Revendeur agréé, marchés à Bukavu' },
];
const WINNER = 1; // meilleur rapport qualité / prix : garantie 36 mois, SAV à Goma, livraison en 14 jours

export async function tender() {
  const D = loadState().dataset;
  if (!D) throw new Error('Jeu de données absent : lancez d\'abord 1-dataset.mjs');
  const U = D.users, S = D.suppliers;
  const tok = (k) => tokenFor(U[k].email);
  const admin = await tok('admin');
  const B = await openBrowser();
  const shot = (email, url, name, opts) => B.shot(email, url, name, { dir: DIR, ...opts });
  const pdf = async (url, name, token = admin) => B.renderPdf(await call('GET', url, token, undefined, { raw: true }), DIR, name, 2);
  fs.mkdirSync(`${CFG.captures}/${DIR}`, { recursive: true });

  async function waitTask(pid, key, timeout = 90_000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const t = (await call('GET', `/tasks/process/${pid}`, admin).catch(() => [])).find(x => x.taskDefinitionKey === key && x.status !== 'COMPLETED');
      if (t) return t;
      await sleep(1500);
    }
    throw new Error(`Étape ${key} introuvable (BpmnGo démarré et BPMN déployé ?)`);
  }
  async function openTask(k, reqId, task) {
    await call('POST', `/tasks/${task.id}/claim`, await tok(k), {}).catch(() => {});
    const page = await B.go(U[k].email, `/requisitions/${reqId}/tasks`);
    await page.locator('[data-testid="task-process"]').first().click({ timeout: 30_000 });
    await page.waitForTimeout(900);
    return page;
  }

  try {
    console.log('• Réquisition et validation');
    const units = await call('GET', '/units', admin);
    const req = await call('POST', '/requisitions', await tok('requester'), {
      title: 'Ordinateurs portables — équipe de terrain EAU-GOMA', description: '15 ordinateurs portables avec licence bureautique pour les animateurs de terrain',
      departmentId: D.dept.id, projectId: D.project.id, estimatedAmount: 28800, currencyId: 1, currencyCode: 'USD', priority: 'HIGH',
      justification: 'Renouvellement du parc (ordinateurs de plus de 6 ans) pour la saisie des données de terrain',
      deliveryAddress: 'Bureau du projet, Avenue de la Paix 12, Goma', neededBy: future(45),
      items: [
        { description: D.items.laptop.name, quantity: 15, frequency: 1, unitPrice: 1800, budgetLineId: D.budget.id, stockItemId: D.items.laptop.id, unitId: units.find(u => u.code === 'PIECE')?.id },
        { description: 'Licence suite bureautique (1 an)', quantity: 15, frequency: 1, unitPrice: 120, budgetLineId: D.budget.id, unitId: units.find(u => u.code === 'UNIT')?.id },
      ],
    });
    let pid = null;
    for (let i = 0; i < 30 && !pid; i++) { pid = (await call('GET', `/requisitions/${req.id}`, admin)).process_instance_id; if (!pid) await sleep(1000); }
    if (!pid) throw new Error('La réquisition n\'a pas démarré de processus BpmnGo');
    const run = { requisitionId: req.id, pid };
    const keep = () => saveState({ ...loadState(), tender: run });
    keep();
    await shot(U.requester.email, `/requisitions/${req.id}`, '01_demandeur_requisition-ordinateurs');
    let t = await waitTask(pid, 'Activity_ProjectManagerApproval');
    await call('POST', `/tasks/${t.id}/complete`, await tok('pm'), { variables: { approved: true, returnedForCorrection: false, procurementAgentId: U.procurement.id, comment: 'Validé — remplacement prévu au budget EAU-01' } });

    console.log('• Méthode : appel d\'offres');
    t = await waitTask(pid, 'Activity_DetermineType');
    await shot(U.procurement.email, null, '02_agent-achats_methode-appel-offres', { before: async () => {
      const p = await openTask('procurement', req.id, t);
      await p.locator('[data-testid="method-RFP"]').click().catch(() => {});
      await p.locator('.fixed textarea').first().fill('Montant élevé : mise en concurrence ouverte à tous les fournisseurs inscrits').catch(() => {});
    } });
    await call('POST', `/tasks/${t.id}/complete`, await tok('procurement'), { variables: { procurementMethod: 'RFP', multiSupplier: false, comment: 'Montant élevé : mise en concurrence ouverte' } });

    console.log('• Publication de l\'appel d\'offres');
    t = await waitTask(pid, 'Activity_RFPProcess');
    const number = `AO-EAU-${Date.now().toString(36).toUpperCase()}`;
    await shot(U.procurement.email, null, '03_agent-achats_formulaire-appel-offres', { tall: 1700, before: async () => {
      const p = await openTask('procurement', req.id, t);
      await p.waitForURL(/tenders\/new/, { timeout: 15_000 });
      await B.settle(p, 1500);
      await p.fill('#tenderNumber', number);
      await p.fill('#maxDeliveryDays', '30');
      await p.fill('#title', 'Fourniture de 15 ordinateurs portables et licences bureautiques');
      await p.fill('#description', 'Ordinateurs 14" (Core i5, 16 Go, SSD 512 Go) avec licence bureautique d\'un an. Livraison au bureau de Goma.');
      await p.evaluate(() => window.scrollTo(0, 0));
    } });
    const tenderRes = await call('POST', '/tenders', await tok('procurement'), {
      requisitionId: req.id, taskId: t.id, tenderNumber: number, title: 'Fourniture de 15 ordinateurs portables et licences bureautiques',
      description: 'Ordinateurs 14" (Core i5, 16 Go, SSD 512 Go) avec licence bureautique d\'un an. Livraison au bureau de Goma.',
      startDate: iso(-1), endDate: iso(7 * 24 * 60), maxDeliveryDays: 30, audience: 'ALL', awardMode: 'SINGLE',
      questions: [
        { label: 'Garantie proposée sur les ordinateurs', answerType: 'CHOICE', required: true,
          options: [{ label: '36 mois', score: 10 }, { label: '24 mois', score: 6 }, { label: '12 mois', score: 2 }] },
        { label: 'Disposez-vous d\'un service après-vente à Goma ?', answerType: 'CHOICE', required: true,
          options: [{ label: 'Oui', score: 5 }, { label: 'Non', score: 0 }] },
        { label: 'Références de marchés similaires', answerType: 'TEXT', required: true },
      ],
    });
    run.tenderId = tenderRes.id; keep();
    await shot(U.procurement.email, `/tenders/${run.tenderId}`, '04_agent-achats_appel-offres-publie', { tall: 1200 });

    console.log('• Offres des fournisseurs');
    const supplierEmail = (i) => S[i].email;
    await shot(supplierEmail(WINNER), '/supplier/tenders', '05_fournisseur_appels-offres-ouverts');
    // Offre saisie comme le ferait le fournisseur (envoyée ensuite par l'API, avec celles des deux autres)
    const w = OFFERS.find(o => o.supplier === WINNER);
    const detail = await call('GET', `/tenders/${run.tenderId}`, admin);
    await shot(supplierEmail(WINNER), `/supplier/tenders/${run.tenderId}`, '06_fournisseur_formulaire-offre', { tall: 1250, before: async (p) => {
      const prices = p.locator('table tbody tr');
      await prices.nth(0).locator('input').nth(0).fill(String(w.laptop));
      await prices.nth(0).locator('input').nth(1).fill('HP ProBook 440 G10');
      await prices.nth(1).locator('input').nth(0).fill(String(w.licence));
      await prices.nth(1).locator('input').nth(1).fill('Microsoft 365 Business Standard');
      await p.fill('#deliveryDays', String(w.days));
      await p.fill('#notes', 'Offre valable 60 jours');
      const qs = detail.questions;
      await pick(p, `#question-${qs[0].id}`, w.warranty);
      await pick(p, `#question-${qs[1].id}`, w.sav === 'YES' ? 0 : 1);
      await p.fill(`#question-${qs[2].id}`, w.refs);
      await p.mouse.click(5, 5);
    } });
    const [laptopItem, licenceItem] = (await call('GET', `/requisitions/${req.id}`, admin)).items;
    const q = detail.questions;
    for (const o of OFFERS) {
      await call('PUT', `/supplier-portal/tenders/${run.tenderId}/submission`, await tokenFor(supplierEmail(o.supplier)), {
        deliveryDays: o.days, notes: 'Offre valable 60 jours',
        items: [{ requisitionItemId: laptopItem.id, unitPrice: o.laptop }, { requisitionItemId: licenceItem.id, unitPrice: o.licence }],
        answers: [{ questionId: q[0].id, value: o.warranty }, { questionId: q[1].id, value: o.sav === 'YES' ? 0 : 1 }, { questionId: q[2].id, value: o.refs }],
      });
    }
    await pdf(`/supplier-portal/tenders/${run.tenderId}/submission/pdf?lang=fr`, 'P1_pdf_offre-fournisseur', await tokenFor(supplierEmail(WINNER)));
    await shot(U.procurement.email, `/tenders/${run.tenderId}`, '07_agent-achats_offres-scellees', { tall: 1200 });

    console.log('• Clôture, comparatif, attribution');
    await shot(U.procurement.email, `/tenders/${run.tenderId}`, '08_agent-achats_cloture-anticipee', { before: (p) => clickButton(p, /Clôturer maintenant/) });
    await call('POST', `/tenders/${run.tenderId}/close`, await tok('procurement'), {});
    await shot(U.procurement.email, `/tenders/${run.tenderId}`, '09_agent-achats_comparatif-offres', { tall: 1700 });
    const closed = await call('GET', `/tenders/${run.tenderId}`, admin);
    const winner = closed.submissions.find(s => s.supplier_name === S[WINNER].name);
    await shot(U.procurement.email, null, '10_agent-achats_attribution', { before: async (p) => {
      // Un bouton « Attribuer » par colonne fournisseur du comparatif, dans l'ordre des en-têtes
      const table = p.locator('[data-testid="comparison-table"]');
      const heads = (await table.locator('thead tr').first().locator('th').allInnerTexts()).slice(2);
      const col = heads.findIndex(h => h.includes(S[WINNER].name));
      await table.getByRole('button', { name: /Attribuer/ }).nth(Math.max(col, 0)).click({ timeout: 10_000 });
      await p.waitForTimeout(700);
      await p.locator('.fixed textarea').first().fill('Meilleur rapport qualité / prix : garantie 36 mois, SAV à Goma, livraison en 14 jours').catch(() => {});
    } });
    await call('POST', `/tenders/${run.tenderId}/award`, await tok('procurement'), {
      supplierId: winner.supplier_id, comment: 'Meilleur rapport qualité / prix : garantie 36 mois, SAV à Goma, livraison en 14 jours',
    });
    await shot(U.procurement.email, `/tenders/${run.tenderId}`, '11_agent-achats_appel-offres-attribue', { tall: 1200 });
    await shot(supplierEmail(WINNER), `/supplier/tenders/${run.tenderId}`, '12_fournisseur_marche-remporte');

    console.log('• Bon de commande et approbation N2');
    t = await waitTask(pid, 'Activity_CreatePO');
    await shot(U.procurement.email, null, '13_agent-achats_bon-commande-attributaire', { tall: 1250, before: async () => {
      const p = await openTask('procurement', req.id, t);
      await p.waitForURL(/purchase-orders/, { timeout: 15_000 });
      await B.settle(p, 2000);
    } });
    const ritems = (await call('GET', `/requisitions/${req.id}`, admin)).items;
    const priceOf = (itemId) => Number(winner.items.find(i => String(i.requisition_item_id) === String(itemId))?.unit_price);
    const lines = ritems.map(i => ({ description: i.item_description, quantity: Number(i.quantity), unitPrice: priceOf(i.id), requisitionItemId: i.id, stockItemId: i.stock_item_id }));
    const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const po = await call('POST', '/purchase-orders', await tok('procurement'), {
      requisitionId: req.id, supplierId: winner.supplier_id, currency: 'USD', totalAmount: total, deliveryDate: future(14), taskId: t.id,
      paymentTerms: '30 % à la commande, 70 % après réception', deliveryTerms: 'Livraison franco au bureau de Goma, installation comprise',
      specialInstructions: `Conformément à l'appel d'offres ${number}`, items: lines,
    });
    run.poId = po.id; keep();
    await waitTask(pid, 'Activity_POReview');
    await call('POST', `/purchase-orders/${po.id}/review`, await tok('reviewer'), { decision: 'APPROVE', comment: 'Conforme à l\'offre retenue' });
    await waitTask(pid, 'Activity_POApprovalN2');
    await shot(U.manager2.email, '/tasks', '14_manager-n2_mes-taches');
    await shot(U.manager2.email, `/purchase-orders/${po.id}`, '15_manager-n2_approbation-bon-commande', { before: (p) => clickButton(p, /^Approuver/) });
    await call('POST', `/purchase-orders/${po.id}/approve`, await tok('manager2'), { comments: 'Approuvé — conforme à l\'attribution' });
    await sleep(4000);
    await pdf(`/purchase-orders/${po.id}/pdf?lang=fr`, 'P2_pdf_bon-de-commande');
    await shot(U.requester.email, `/requisitions/${req.id}?tab=history`, '16_demandeur_suivi-workflow', { tall: 2200 });
    console.log('✅ Appel d\'offres capturé');
  } finally {
    await B.close();
  }
}

if (process.argv[1]?.endsWith('2b-appel-offres.mjs')) tender().catch(e => { console.error('❌', e.message); process.exit(1); });
