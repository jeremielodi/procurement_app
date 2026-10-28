// backend/src/utils/workflowLabels.js
// Libellés du workflow BpmnGo (tâches, groupes, méthodes, messages des workers), traduits via src/i18n/locales.
// Mêmes libellés que client/src/locales (tasks.labels) pour les tâches.
// Les constantes exportées (TASK_LABELS, TASK_GROUPS…) sont en français (langue par défaut : emails, journaux) ;
// les fonctions acceptent une langue : taskLabel(key, 'en'), groupLabel(key, 'en')…
const i18n = require('../i18n');

// candidateGroups du BPMN (= profil prof_<groupe>) — utilisé pour « tâches en cours par profil »
const TASK_CANDIDATE_GROUPS = {
  Activity_ValidationN1_Manager: 'manager',
  Activity_ValidationN2_Finance: 'manager_n2', // Manager niveau 2 (migration 27 ; avant : Finance)
  Activity_ValidationN3_DG:      'manager_n3', // Manager niveau 3 (migration 27 ; avant : DG)
  Activity_DetermineType:        'procurement',
  Activity_DirectPurchase:       'procurement',
  Activity_RequestQuotations:    'procurement',
  Activity_RFPProcess:           'procurement',
  Activity_SoleSource:           'procurement',
  Activity_AllocateSuppliers:    'procurement', // répartition des articles entre plusieurs fournisseurs
  Activity_CreatePO:             'procurement',
  Activity_POApproval:           'management',
  Activity_SupplierConfirmation: 'procurement',
  Activity_GoodsReceipt:         'logistic',
  Activity_ServiceAcceptance:    'requester',
  Activity_ReviseRequisition:    'requester', // étape personnelle : le demandeur de la réquisition (PERSONAL_TASKS)
  Activity_EnterInvoice:         'finance',
  Activity_ProcessPayment:       'finance',
};

const TASK_KEYS = [
  'Activity_ValidationN1_Manager', 'Activity_ValidationN2_Finance', 'Activity_ValidationN3_DG', 'Activity_BudgetAdjustment',
  ...Object.keys(TASK_CANDIDATE_GROUPS).filter(k => !k.startsWith('Activity_Validation')),
];

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
  'Allocate Items to Suppliers':  'Activity_AllocateSuppliers',
  'Create Purchase Order':        'Activity_CreatePO',
  'Approve Purchase Order':       'Activity_POApproval',
  'Supplier Order Confirmation':  'Activity_SupplierConfirmation',
  'Goods Receipt Note (GRN)':     'Activity_GoodsReceipt',
  'Service Acceptance Note (SAN)': 'Activity_ServiceAcceptance',
  'Enter Supplier Invoice':       'Activity_EnterInvoice',
  'Process Payment':              'Activity_ProcessPayment',
  'Revise Requisition':           'Activity_ReviseRequisition',
};

const isTaskKey = (k) => TASK_KEYS.includes(k);

/** Clé BPMN à partir de task_definition_id ou de l'ancien nom anglais */
function taskKey(row) {
  if (row.task_definition_id && isTaskKey(row.task_definition_id)) return row.task_definition_id;
  if (row.task_name && isTaskKey(row.task_name)) return row.task_name;
  return TASK_NAME_EN[row.task_name] || null;
}

function taskLabel(keyOrName, lang) {
  const t = i18n.translator(lang);
  const key = isTaskKey(keyOrName) ? keyOrName : TASK_NAME_EN[keyOrName];
  if (key) return t(`workflow.tasks.${key}`);
  return keyOrName || t('workflow.task');
}

/** Libellé du rôle attendu pour une tâche (candidateGroup), ou null */
function groupLabel(key, lang) {
  const group = TASK_CANDIDATE_GROUPS[key];
  return group ? i18n.translator(lang)(`workflow.roles.${group}`) : null;
}

const methodLabel = (method, lang) => (i18n.has(lang, `workflow.methods.${method}`) ? i18n.translator(lang)(`workflow.methods.${method}`) : method);
const reasonLabel = (reason, lang) => (i18n.has(lang, `workflow.reasons.${reason}`) ? i18n.translator(lang)(`workflow.reasons.${reason}`) : reason);
const matchLabel = (status, lang) => (i18n.has(lang, `workflow.match.${status}`) ? i18n.translator(lang)(`workflow.match.${status}`) : status);

// Tables françaises (compatibilité : emails des tâches, code existant)
const TASK_LABELS = Object.fromEntries(TASK_KEYS.map(k => [k, taskLabel(k, 'fr')]));
const TASK_GROUPS = Object.fromEntries(Object.keys(TASK_CANDIDATE_GROUPS).map(k => [k, groupLabel(k, 'fr')]));
const fr = i18n.translator('fr');
const METHOD_LABELS = Object.fromEntries(['DIRECT_PURCHASE', 'MULTIPLE_QUOTATIONS', 'RFP', 'SOLE_SOURCE'].map(m => [m, fr(`workflow.methods.${m}`)]));
const MATCH_LABELS = Object.fromEntries(['MATCHED', 'MISMATCH', 'PARTIAL', 'PENDING'].map(m => [m, fr(`workflow.match.${m}`)]));

// Tâches attribuées par le processus à UNE personne (assignee ${requester}) : notifiées au seul demandeur, traitées
// par lui sans dépendre de son profil
const PERSONAL_TASKS = ['Activity_BudgetAdjustment', 'Activity_ReviseRequisition'];

module.exports = {
  PERSONAL_TASKS,
  TASK_LABELS, TASK_NAME_EN, TASK_GROUPS, TASK_CANDIDATE_GROUPS, METHOD_LABELS, MATCH_LABELS,
  taskKey, taskLabel, groupLabel, methodLabel, reasonLabel, matchLabel,
};
