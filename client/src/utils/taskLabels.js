/**
 * Libellés traduits des tâches BpmnGo (Camunda) — locales : tasks.labels.<taskDefinitionKey>
 * Clé : taskDefinitionKey (Activity ID dans le BPMN)
 */
import { t, labelMap } from '../i18n';

const TASK_KEYS = [
  // Validation de la réquisition : chef de projet (anciens processus : N1 / N2 / N3)
  'Activity_ProjectManagerApproval',
  'Activity_ValidationN1_Manager', 'Activity_ValidationN2_Finance', 'Activity_ValidationN3_DG', 'Activity_BudgetAdjustment',
  'Activity_ReviseRequisition',
  // Méthode d'achat
  'Activity_DetermineType', 'Activity_DirectPurchase', 'Activity_RequestQuotations', 'Activity_RFPProcess', 'Activity_SoleSource',
  'Activity_AllocateSuppliers',
  // Bon de commande
  'Activity_CreatePO', 'Activity_POReview', 'Activity_POApproval', 'Activity_POApprovalN1', 'Activity_POApprovalN2', 'Activity_POApprovalN3',
  'Activity_SupplierConfirmation',
  // Cycle P2P
  'Activity_GoodsReceipt', 'Activity_ServiceAcceptance', 'Activity_EnterInvoice', 'Activity_ProcessPayment',
];

export const TASK_LABELS = labelMap('tasks.labels', TASK_KEYS);

// Approbation du bon de commande : N1 / N2 / N3 selon son montant (Activity_POApproval = processus démarrés avant)
export const PO_APPROVAL_TASKS = ['Activity_POApproval', 'Activity_POApprovalN1', 'Activity_POApprovalN2', 'Activity_POApprovalN3'];

/**
 * Retourne le libellé traduit d'une tâche.
 * Priorité : taskDefinitionKey → name (fallback)
 */
export function getTaskLabel(task) {
  if (!task) return t('common.task');
  return TASK_LABELS[task.taskDefinitionKey] || task.name || task.taskName || t('common.unnamedTask');
}
