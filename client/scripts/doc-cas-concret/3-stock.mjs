// Étape 3 — cas concret « gestion de stock » : don (bon d'entrée) validé par une autre personne, demande au magasin
// servie et reçue, affectation puis retour d'un ordinateur, transfert avec perte en transit, inventaire, rapports ;
// équipements et consommables (migrations 63 à 65) : médicament suivi par lot (gestionnaire des consommables, sortie FEFO),
// chaises de bureau = équipement sans n° de série (gestionnaire des équipements), document mixte aux lignes masquées.
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
  if (run.medIssueId) await pdf(`/stock-issues/${run.medIssueId}/pdf?lang=fr`, 'P5_pdf_sortie-medicament');
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

    console.log('• Équipements et consommables (nature, voir / gérer, projet)');
    await shot('admin', '/stock/items', '32_admin_catalogue-natures');
    // Fiche utilisateur (fenêtre ouverte depuis la liste) : profil exercé sur le seul projet EAU-GOMA
    await shot('admin', '/users', '33_admin_gestionnaire-consommables-projet', { tall: 1500, before: async (p) => {
      await p.fill('input[type="text"]', 'Furaha');
      await p.waitForTimeout(1500);
      await p.locator('tr', { hasText: 'Furaha' }).first().locator('button').first().click();
      await p.waitForTimeout(2000);
    } });
    // Consommable suivi par lot : médicament reçu en dotation, deux lots aux péremptions différentes
    const stampLot = Date.now().toString(36).toUpperCase();
    const med = await call('POST', '/stock-entries', await tok('consumables'), {
      warehouseId: WH, entryType: 'DONATION', origin: 'Pharmacie centrale provinciale (dotation)', deliveredBy: 'Mme Neema, pharmacienne', reference: 'DOT-PHA-2026-117',
      reason: 'Dotation pour la trousse de premiers secours des équipes terrain', projectId: D.project.id, currency: 'USD',
      lines: [
        { stockItemId: I.para.id, quantity: 30, unitCost: 4.2, lotNumber: `PARA-${stampLot}-A`, expiryDate: future(75) },
        { stockItemId: I.para.id, quantity: 50, unitCost: 4.2, lotNumber: `PARA-${stampLot}-B`, expiryDate: future(600) },
      ],
    });
    run.medEntryId = med.id; keep();
    await shot('consumables', `/stock/entries/${med.id}`, '34_consommables_bon-entree-medicament', { tall: 1000 });
    await call('POST', `/stock-entries/${med.id}/validate`, await tok('logistic'), {});
    await shot('consumables', '/stock/consumables', '35_consommables_menu-consommables', { tall: 1100 });
    await shot('consumables', '/stock/items', '36_consommables_catalogue-consommables');
    // Sortie : le lot qui périme le plus tôt part en premier (FEFO)
    const medIssue = await call('POST', '/stock-issues', await tok('consumables'), {
      warehouseId: WH, destinationType: 'USER', recipientId: U.requester.id, projectId: D.project.id, purpose: 'Trousse de premiers secours — mission Katindo',
      lines: [{ stockItemId: I.para.id, quantity: 10 }],
    });
    run.medIssueId = medIssue.id; keep();
    await shot('consumables', `/stock/issues/${medIssue.id}`, '37_consommables_sortie-medicament-fefo', { tall: 1000 });
    // Document mixte (le don : savon, ordinateurs, papier) : lignes d'équipement masquées
    await shot('consumables', `/stock/entries/${run.entryId}`, '38_consommables_document-mixte', { tall: 1100 });
    // Équipement sans n° de série : chaises de bureau
    const chairs = await call('POST', '/stock-entries', await tok('equipment'), {
      warehouseId: WH, entryType: 'OFF_SYSTEM_PURCHASE', origin: 'Mobilier Kivu (achat sur caisse)', deliveredBy: 'Livreur Mobilier Kivu', reference: 'FAC-MK-0932',
      reason: 'Aménagement du bureau de l\'antenne', projectId: D.project.id, currency: 'USD',
      lines: [{ stockItemId: I.chair.id, quantity: 6, unitCost: 85 }],
    });
    run.chairEntryId = chairs.id; keep();
    await call('POST', `/stock-entries/${chairs.id}/validate`, await tok('logistic'), {});
    await shot('equipment', '/stock/items', '39_equipements_catalogue-equipements');
    await shot('equipment', '/stock/equipment', '40_equipements_menu-equipements');
    const logDept = list(await call('GET', '/departments', await tok('admin'))).find(d => d.code === 'LOG');
    const chairIssue = await call('POST', '/stock-issues', await tok('equipment'), {
      warehouseId: WH, destinationType: 'DEPARTMENT', departmentId: logDept.id, projectId: D.project.id, purpose: 'Bureau de l\'antenne logistique',
      lines: [{ stockItemId: I.chair.id, quantity: 4 }],
    });
    run.chairIssueId = chairIssue.id; keep();
    await shot('equipment', `/stock/issues/${chairIssue.id}`, '41_equipements_sortie-chaises-departement', { tall: 1000 });

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
