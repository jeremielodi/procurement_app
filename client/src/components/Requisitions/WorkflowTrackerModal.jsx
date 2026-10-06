// src/components/Requisitions/WorkflowTrackerModal.jsx
// Même vue de suivi du workflow, accessible depuis la liste et la fiche réquisition
import React from 'react'
import Modal from '../Common/Modal'
import RequisitionTimeline from './RequisitionTimeline'
import { t } from '../../i18n'

export default function WorkflowTrackerModal({ requisition, onClose }) {
  if (!requisition) return null
  return (
    <Modal
      isOpen={!!requisition}
      onClose={onClose}
      title={`${t('workflowModal.title', { number: requisition.requisition_number })}${requisition.title ? ` · ${requisition.title}` : ''}`}
      size="full"
      showFooter={false}
    >
      <div className="max-h-[75vh] overflow-y-auto pr-1">
        <RequisitionTimeline requisitionId={requisition.id} onNavigate={onClose} />
      </div>
    </Modal>
  )
}
