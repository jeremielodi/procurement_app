/**
 * Libellés traduits des tâches GoFlow (Camunda) — locales : tasks.labels.<taskDefinitionKey>
 * Clé : taskDefinitionKey (Activity ID dans le BPMN)
 */
import { t, labelMap } from '../i18n';

const TASK_KEYS = [
  // Circuit d'approbation réquisition
  'Activity_ValidationN1_Manager', 'Activity_ValidationN2_Finance', 'Activity_ValidationN3_DG', 'Activity_BudgetAdjustment',
  // Méthode d'achat
  'Activity_DetermineType', 'Activity_DirectPurchase', 'Activity_RequestQuotations', 'Activity_RFPProcess', 'Activity_SoleSource',
  // Bon de commande
  'Activity_CreatePO', 'Activity_POApproval', 'Activity_SupplierConfirmation',
  // Cycle P2P
  'Activity_GoodsReceipt', 'Activity_ServiceAcceptance', 'Activity_EnterInvoice', 'Activity_ProcessPayment',
];

export const TASK_LABELS = labelMap('tasks.labels', TASK_KEYS);

/**
 * Retourne le libellé traduit d'une tâche.
 * Priorité : taskDefinitionKey → name (fallback)
 */
export function getTaskLabel(task) {
  if (!task) return t('common.task');
  return TASK_LABELS[task.taskDefinitionKey] || task.name || task.taskName || t('common.unnamedTask');
}
