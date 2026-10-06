// src/utils/constants.js
import { withLabel } from '../i18n'

export const REQUISITION_STATUS = withLabel('requisitionStatus', {
  DRAFT: { color: 'gray' },
  PENDING: { color: 'yellow' },
  BUDGET_CHECKED: { color: 'blue' },
  APPROVED: { color: 'green' },
  REJECTED: { color: 'red' },
  IN_PROGRESS: { color: 'blue' },
  COMPLETED: { color: 'green' },
})

export const PROCUREMENT_METHODS = withLabel('procurementMethod', {
  DIRECT_PURCHASE: { icon: 'ShoppingBag' },
  MULTIPLE_QUOTATIONS: { icon: 'FileText' },
  RFP: { icon: 'Trophy' },
  SOLE_SOURCE: { icon: 'User' },
})

export const NOTIFICATION_TYPES = {
  REQUISITION_CREATED: 'success',
  REQUISITION_APPROVED: 'success',
  REQUISITION_REJECTED: 'error',
  BUDGET_CHECKED: 'info',
  PO_CREATED: 'success',
}
