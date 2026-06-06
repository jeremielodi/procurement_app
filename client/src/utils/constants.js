// src/utils/constants.js
export const REQUISITION_STATUS = {
  DRAFT: { label: 'Brouillon', color: 'gray' },
  PENDING: { label: 'En attente', color: 'yellow' },
  BUDGET_CHECKED: { label: 'Budget vérifié', color: 'blue' },
  APPROVED: { label: 'Approuvé', color: 'green' },
  REJECTED: { label: 'Rejeté', color: 'red' },
  IN_PROGRESS: { label: 'En cours', color: 'blue' },
  COMPLETED: { label: 'Terminé', color: 'green' },
}

export const PROCUREMENT_METHODS = {
  DIRECT_PURCHASE: { label: 'Achat direct', icon: 'ShoppingBag' },
  MULTIPLE_QUOTATIONS: { label: 'Multiples devis', icon: 'FileText' },
  RFP: { label: 'Appel d\'offres', icon: 'Trophy' },
  SOLE_SOURCE: { label: 'Source unique', icon: 'User' },
}

export const NOTIFICATION_TYPES = {
  REQUISITION_CREATED: 'success',
  REQUISITION_APPROVED: 'success',
  REQUISITION_REJECTED: 'error',
  BUDGET_CHECKED: 'info',
  PO_CREATED: 'success',
}