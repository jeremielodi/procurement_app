/**
 * Traductions françaises des tâches GoFlow (Camunda).
 * Clé : taskDefinitionKey (Activity ID dans le BPMN)
 * Valeur : libellé affiché à l'utilisateur
 */
export const TASK_LABELS = {
  // Circuit d'approbation réquisition
  Activity_ValidationN1_Manager:  'Approbation hiérarchique N1 (Manager)',
  Activity_ValidationN2_Finance:  'Approbation hiérarchique N2 (Finance)',
  Activity_ValidationN3_DG:       'Approbation hiérarchique N3 (Direction Générale)',
  Activity_BudgetAdjustment:      'Ajustement budgétaire',

  // Méthode d'achat
  Activity_DetermineType:         'Déterminer la méthode d\'achat',
  Activity_DirectPurchase:        'Achat direct',
  Activity_RequestQuotations:     'Demande de devis multiples',
  Activity_RFPProcess:            'Appel d\'offres (RFP)',
  Activity_SoleSource:            'Justification source unique',

  // Bon de commande
  Activity_CreatePO:              'Créer le bon de commande',
  Activity_POApproval:            'Approbation du bon de commande',
  Activity_SupplierConfirmation:  'Confirmation de commande fournisseur',

  // Cycle P2P
  Activity_GoodsReceipt:          'Bon de réception (GRN)',
  Activity_ServiceAcceptance:     'Acceptation de service (SAN)',
  Activity_EnterInvoice:          'Saisie de la facture fournisseur',
  Activity_ProcessPayment:        'Traitement du paiement',
};

/**
 * Retourne le libellé français d'une tâche.
 * Priorité : taskDefinitionKey → name (fallback)
 */
export function getTaskLabel(task) {
  if (!task) return 'Tâche';
  return TASK_LABELS[task.taskDefinitionKey] || task.name || task.taskName || 'Tâche sans nom';
}
