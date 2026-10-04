// backend/src/utils/workflowLabels.js
// Traductions françaises du workflow GoFlow (tâches, groupes, méthodes, messages des workers).
// Même table que client/src/utils/taskLabels.js pour les tâches.

const TASK_LABELS = {
  Activity_ValidationN1_Manager: 'Approbation hiérarchique N1 (Manager)',
  Activity_ValidationN2_Finance: 'Approbation hiérarchique N2 (Finance)',
  Activity_ValidationN3_DG:      'Approbation hiérarchique N3 (Direction Générale)',
  Activity_BudgetAdjustment:     'Ajustement budgétaire',
  Activity_DetermineType:        'Déterminer la méthode d\'achat',
  Activity_DirectPurchase:       'Achat direct',
  Activity_RequestQuotations:    'Demande de devis multiples',
  Activity_RFPProcess:           'Appel d\'offres (RFP)',
  Activity_SoleSource:           'Justification source unique',
  Activity_CreatePO:             'Créer le bon de commande',
  Activity_POApproval:           'Approbation du bon de commande',
  Activity_SupplierConfirmation: 'Confirmation de commande fournisseur',
  Activity_GoodsReceipt:         'Bon de réception (GRN)',
  Activity_ServiceAcceptance:    'Acceptation de service (SAN)',
  Activity_EnterInvoice:         'Saisie de la facture fournisseur',
  Activity_ProcessPayment:       'Traitement du paiement',
};

// Anciens noms anglais du BPMN (colonne task_name de workflow_history)
const TASK_NAME_EN = {
  'Manager Approval (N1)':        'Activity_ValidationN1_Manager',
  'Finance Approval (N2)':        'Activity_ValidationN2_Finance',
  'DG Approval (N3)':             'Activity_ValidationN3_DG',
  'Determine Procurement Type':   'Activity_DetermineType',
  'Direct Purchase':              'Activity_DirectPurchase',
  'Request Multiple Quotations':  'Activity_RequestQuotations',
  'Call for Tenders / RFP':       'Activity_RFPProcess',
  'Sole Source Justification':    'Activity_SoleSource',
  'Create Purchase Order':        'Activity_CreatePO',
  'Approve Purchase Order':       'Activity_POApproval',
  'Supplier Order Confirmation':  'Activity_SupplierConfirmation',
  'Goods Receipt Note (GRN)':     'Activity_GoodsReceipt',
  'Service Acceptance Note (SAN)': 'Activity_ServiceAcceptance',
  'Enter Supplier Invoice':       'Activity_EnterInvoice',
  'Process Payment':              'Activity_ProcessPayment',
};

// candidateGroups du BPMN → libellé du rôle
const TASK_GROUPS = {
  Activity_ValidationN1_Manager: 'Manager',
  Activity_ValidationN2_Finance: 'Finance',
  Activity_ValidationN3_DG:      'Direction Générale',
  Activity_DetermineType:        'Achats',
  Activity_DirectPurchase:       'Achats',
  Activity_RequestQuotations:    'Achats',
  Activity_RFPProcess:           'Achats',
  Activity_SoleSource:           'Achats',
  Activity_CreatePO:             'Achats',
  Activity_POApproval:           'Direction',
  Activity_SupplierConfirmation: 'Achats',
  Activity_GoodsReceipt:         'Logistique',
  Activity_ServiceAcceptance:    'Demandeur',
  Activity_EnterInvoice:         'Finance',
  Activity_ProcessPayment:       'Finance',
};

const METHOD_LABELS = {
  DIRECT_PURCHASE:     'Achat direct',
  MULTIPLE_QUOTATIONS: 'Devis multiples',
  RFP:                 'Appel d\'offres',
  SOLE_SOURCE:         'Source unique',
};

const REASON_LABELS = {
  'Amount below direct purchase threshold': 'montant inférieur au seuil d\'achat direct',
  'Amount requires multiple quotations':    'le montant exige plusieurs devis',
  'Amount requires formal tender process':  'le montant exige un appel d\'offres',
  'Approved sole source justification':     'justification de source unique approuvée',
};

const MATCH_LABELS = {
  MATCHED: 'concordant', MISMATCH: 'écart détecté', PARTIAL: 'partiel', PENDING: 'en attente',
};

/** Clé BPMN à partir de task_definition_id ou de l'ancien nom anglais */
function taskKey(row) {
  if (row.task_definition_id && TASK_LABELS[row.task_definition_id]) return row.task_definition_id;
  if (row.task_name && TASK_LABELS[row.task_name]) return row.task_name;
  return TASK_NAME_EN[row.task_name] || null;
}

function taskLabel(keyOrName) {
  return TASK_LABELS[keyOrName] || TASK_LABELS[TASK_NAME_EN[keyOrName]] || keyOrName || 'Tâche';
}

module.exports = {
  TASK_LABELS, TASK_NAME_EN, TASK_GROUPS, METHOD_LABELS, REASON_LABELS, MATCH_LABELS, taskKey, taskLabel,
};
