// src/components/Requisitions/WorkflowTrackerModal.jsx
// Même vue de suivi du workflow, accessible depuis la liste et la fiche réquisition
import React from 'react'
import Modal from '../Common/Modal'
import RequisitionTimeline from './RequisitionTimeline'

export default function WorkflowTrackerModal({ requisition, onClose }) {
  if (!requisition) return null
  return (
    <Modal
      isOpen={!!requisition}
      onClose={onClose}
      title={`Suivi du workflow — ${requisition.requisition_number}${requisition.title ? ` · ${requisition.title}` : ''}`}
      size="full"
      showFooter={false}
    >
      <div className="max-h-[75vh] overflow-y-auto pr-1">
        <RequisitionTimeline requisitionId={requisition.id} onNavigate={onClose} />
      </div>
    </Modal>
  )
}
