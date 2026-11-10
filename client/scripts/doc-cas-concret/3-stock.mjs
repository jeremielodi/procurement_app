// Étape 3 — cas concret « gestion de stock » : don (bon d'entrée) validé par une autre personne, demande au magasin
// servie et reçue, affectation puis retour d'un ordinateur, transfert avec perte en transit, inventaire, rapports.
// À lancer après 2-workflow.mjs (le stock du magasin central vient de la réception de la commande).
import { call, tokenFor, loadState, saveState, sleep, future, openBrowser, clickButton } from './lib.mjs';

const DIR = 'stock';
const list = (x) => (Array.isArray(x) ? x : x?.rows || x?.data || []);

/** Bons à signer, dans leur état final : entrée validée, sortie reçue, transfert réceptionné, retour */
export async function stockPdfs(B, run, token) {
  const pdf = async (url, name) => B.renderPdf(await call('GET', url, token, undefined, { raw: true }), DIR, name, 1);
  await pdf(`/stock-entries/${run.entryId}/pdf?lang=fr`, 'P1_pdf_bon-entree');
  await pdf(`/stock-issues/${run.issueId}/pdf?lang=fr`, 'P2_pdf_bon-de-sortie');
  await pdf(`/stock-issues/${run.transferId}/pdf?lang=fr`, 'P3_pdf_bon-de-transfert');
  await pdf(`/stock-returns/${run.returnId}/pdf?lang=fr`, 'P4_pdf_bon-de-retour');
}

export async function stock() {
  const D = loadState().dataset;
  if (!D) throw new Error('Jeu de données absent : lancez d\'abord 1-dataset.mjs');
  const U = D.users, I = D.items, WH = D.wh.id, WH2 = D.wh2.id;
  const tok = (k) => tokenFor(U[k].email);
  const B = await openBrowser();
  const shot = (k, url, name, opts) => B.shot(U[k].email, url, name, { dir: DIR, ...opts });
  const run = {};
  const keep = () => saveState({ ...loadState(), stock: run });

  try {
    console.log('• Organisation');
    await shot('logistic', '/stock', '01_logistique_vue-ensemble-stock', { tall: 1300 });
    await shot('logistic', '/stock/items', '02_logistique_catalogue-articles');
    await shot('admin', '/stock/warehouses', '03_admin_depots-et-acces');

    console.log('• Bon d\'entrée (don)');
    await shot('storekeeper', '/stock/entries/new', '04_magasinier_nouveau-bon-entree', { tall: 1300 });
    const entry = await call('POST', '/stock-entries', await tok('storekeeper'), {
      warehouseId: WH, entryType: 'DONATION', origin: 'Fondation Partenaire Kivu', deliveredBy: 'Camion FPK — chauffeur M. Bisimwa', reference: 'BL-FPK-2026-044',
      reason: 'Don pour les activités d\'hygiène et l\'équipe terrain', projectId: D.project.id, currency: 'USD',
      lines: [
        { stockItemId: I.soap.id, quantity: 40, unitCost: 12, lotNumber: `SAV-${Date.now().toString(36).toUpperCase()}`, expiryDate: future(540) },
        { stockItemId: I.laptop.id, quantity: 3, unitCost: 650, serials: [1, 2, 3].map(n => `5CD${Date.now().toString(36).toUpperCase()}${n}`) },
        { stockItemId: I.paper.id, quantity: 20, unitCost: 5.5 },
      ],
    });
    run.entryId = entry.id; keep();
    await shot('logistic', `/stock/entries/${entry.id}`, '06_logistique_validation-bon-entree', { tall: 1100, before: (p) => clickButton(p, /^Valider/) });
    await call('POST', `/stock-entries/${entry.id}/validate`, await tok('logistic'), {});
    await shot('logistic', `/stock/entries/${entry.id}`, '07_logistique_bon-entree-valide', { tall: 1100 });
    await shot('logistic', '/stock/equipment', '08_logistique_equipements-numeros-inventaire');

    console.log('• Demande au magasin');
    await shot('requester', '/stock/requests/new', '09_demandeur_nouvelle-demande-magasin', { tall: 1100 });
    const request = await call('POST', '/stock-requests', await tok('requester'), {
      warehouseId: WH, destinationType: 'USER', projectId: D.project.id, purpose: 'Sensibilisation hygiène — quartier Katindo', neededBy: future(3),
      lines: [{ stockItemId: I.soap.id, quantity: 6 }, { stockItemId: I.paper.id, quantity: 5 }],
    });
    run.requestId = request.id; keep();
    await shot('requester', `/stock/requests/${request.id}`, '10_demandeur_demande-a-servir', { tall: 1000 });
    await shot('storekeeper', '/stock/requests?scope=toServe', '11_magasinier_demandes-a-servir');
    await shot('storekeeper', `/stock/issues/new?requestId=${request.id}`, '12_magasinier_servir-la-demande', { tall: 1200 });
    const req = await call('GET', `/stock-requests/${request.id}`, await tok('storekeeper'));
    const issue = await call('POST', '/stock-issues', await tok('storekeeper'), {
      warehouseId: WH, destinationType: 'USER', recipientId: U.requester.id, stockRequestId: request.id,
      lines: req.lines.map(l => ({ requestLineId: l.id, stockItemId: l.stock_item_id, quantity: Number(l.validated_quantity ?? l.quantity) })),
    });
    run.issueId = issue.id; keep();
    await shot('storekeeper', `/stock/issues/${issue.id}`, '13_magasinier_bon-de-sortie', { tall: 1000 });
    await shot('requester', `/my-items/${issue.id}`, '14_demandeur_accuse-reception', { tall: 1000 });
    await call('POST', `/stock-issues/${issue.id}/acknowledge`, await tok('requester'), {});
    await shot('requester', '/my-items', '15_demandeur_mes-articles-recus');

    console.log('• Affectation d\'un ordinateur');
    const units = list(await call('GET', `/stock-units?stockItemId=${I.laptop.id}&status=IN_STOCK`, await tok('logistic')));
    const laptop = await call('POST', '/stock-issues', await tok('logistic'), {
      warehouseId: WH, destinationType: 'USER', recipientId: U.manager.id, purpose: 'Dotation — responsable des opérations', projectId: D.project.id,
      lines: [{ stockItemId: I.laptop.id, unitIds: [units[0].id] }],
    });
    run.laptopIssueId = laptop.id; keep();
    await call('POST', `/stock-issues/${laptop.id}/acknowledge`, await tok('manager'), {});
    await shot('logistic', `/stock/issues/${laptop.id}`, '16_logistique_affectation-ordinateur', { tall: 1000 });

    console.log('• Transfert vers l\'antenne Nord');
    const transfer = await call('POST', '/stock-issues', await tok('logistic'), {
      warehouseId: WH, destinationType: 'WAREHOUSE', destinationWarehouseId: WH2, purpose: 'Réapprovisionnement de l\'antenne Nord',
      lines: [{ stockItemId: I.paper.id, quantity: 15 }, { stockItemId: I.toner.id, quantity: 3 }],
    });
    run.transferId = transfer.id; keep();
    await shot('logistic', '/stock/issues', '17_logistique_liste-des-sorties');
    await shot('storekeeper', `/stock/issues/${transfer.id}`, '18_magasinier_reception-transfert', { tall: 1000, before: (p) => clickButton(p, /Réceptionner/) });
    const tr = await call('GET', `/stock-issues/${transfer.id}`, await tok('storekeeper'));
    await call('POST', `/stock-issues/${transfer.id}/receive`, await tok('storekeeper'), {
      comment: '1 rame mouillée pendant le transport',
      lines: tr.lines.map(l => ({ lineId: l.id, receivedQuantity: l.stock_item_id === I.paper.id ? Number(l.quantity) - 1 : Number(l.quantity) })),
    });
    await shot('storekeeper', `/stock/issues/${transfer.id}`, '19_magasinier_transfert-receptionne-avec-manque', { tall: 1000 });

    console.log('• Retour de l\'ordinateur');
    await shot('logistic', `/stock/returns/new?userId=${U.manager.id}`, '20_logistique_retour-equipement', { tall: 1000 });
    const lap = await call('GET', `/stock-issues/${laptop.id}`, await tok('logistic'));
    const ret = await call('POST', '/stock-returns', await tok('logistic'), {
      warehouseId: WH, returnedBy: U.manager.id, comment: 'Fin de mission, ordinateur rendu',
      lines: [{ issueLineId: lap.lines[0].id, quantity: 1, condition: 'GOOD' }],
    });
    run.returnId = ret.id; keep();
    await shot('logistic', `/stock/returns/${ret.id}`, '21_logistique_bon-de-retour', { tall: 1000 });

    console.log('• Inventaire');
    const count = await call('POST', '/stock-counts', await tok('logistic'), { warehouseId: WH, comment: 'Inventaire de fin de trimestre' });
    run.countId = count.id; keep();
    await shot('logistic', `/stock/counts/${count.id}`, '22_logistique_inventaire-comptage', { tall: 1200 });
    const c = await call('GET', `/stock-counts/${count.id}`, await tok('logistic'));
    await call('PUT', `/stock-counts/${count.id}/lines`, await tok('logistic'), { entries: c.lines.map(l => {
      const paper = l.stock_item_id === I.paper.id || l.item_code === I.paper.code;
      return { lineId: l.id, countedQuantity: Number(l.expected_quantity) - (paper ? 2 : 0), ...(paper ? { note: '2 rames abîmées retirées' } : {}) };
    }) });
    await shot('logistic', `/stock/counts/${count.id}`, '23_logistique_inventaire-ecarts', { tall: 1200 });
    // Validation des écarts : administrateur seulement (ADJUST_STOCK)
    await shot('admin', `/stock/counts/${count.id}`, '23b_admin_validation-inventaire', { tall: 1200, before: (p) => clickButton(p, /Valider/) });
    await call('POST', `/stock-counts/${count.id}/validate`, await tok('admin'), {});
    await shot('logistic', `/stock/counts/${count.id}`, '23c_logistique_inventaire-valide', { tall: 1200 });
    await shot('logistic', '/stock/adjustments', '24_logistique_ajustements');

    console.log('• Suivi et rapports');
    await sleep(1000);
    await shot('logistic', '/stock/movements', '25_logistique_journal-operations');
    const groups = list(await call('GET', '/stock/movement-groups', await tok('logistic')));
    if (groups[0]) await shot('logistic', `/stock/movement-groups/${groups[0].id}`, '26_logistique_detail-operation', { tall: 1000 });
    await shot('logistic', `/stock/items/${I.paper.id}`, '27_logistique_fiche-article', { tall: 1300 });
    await shot('logistic', '/stock/planning', '28_logistique_prevision-reapprovisionnement');
    await shot('admin', '/stock/valuation', '29_admin_valorisation-cmup');
    await shot('admin', '/stock/reconciliation', '30_admin_rapprochement-receptions-stock');
    await shot('logistic', '/stock', '31_logistique_vue-ensemble-finale', { tall: 1300 });

    console.log('• Documents PDF');
    await stockPdfs(B, run, await tok('logistic'));
    console.log('✅ Gestion de stock capturée');
  } finally {
    await B.close();
  }
}

if (process.argv[1]?.endsWith('3-stock.mjs')) stock().catch(e => { console.error('❌', e.message); process.exit(1); });
