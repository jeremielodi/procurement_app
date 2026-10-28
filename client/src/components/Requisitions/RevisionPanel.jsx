// src/components/Requisitions/RevisionPanel.jsx
// Correction d'une réquisition (RequisitionRevisionService) sur sa fiche :
//  - « À corriger » (renvoyée par un approbateur ou retirée) : motif ; le demandeur « Corrige » (formulaire de
//    modification puis nouvelle soumission) ou « Abandonne » (motif obligatoire) ; les autres voient l'état
//  - en attente d'approbation que personne n'a prise en charge : le demandeur peut « Retirer pour corriger »
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileDiff, Undo2, PencilLine, XCircle, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../Common/Modal'
import requisitionService from '../../services/requisitionService'
import { t } from '../../i18n'
import { formatDateTime } from '../../utils/formatters'
import { TASK_LABELS } from '../../utils/taskLabels'

export const REVISION_ERRORS = ['NOT_REQUESTER', 'NOT_EDITABLE', 'NOT_WITHDRAWABLE', 'APPROVAL_IN_PROGRESS', 'TASK_NOT_FOUND', 'BPMNGO_ERROR',
  'RETURN_NOT_SUPPORTED', 'REASON_REQUIRED', 'TITLE_REQUIRED', 'ITEMS_REQUIRED', 'ITEM_INVALID', 'BUDGET_LINE_REQUIRED', 'BUDGET_LINE_INVALID', 'NOT_ON_PROJECT']

export const revisionError = (err) => {
  const d = err?.response?.data || {}
  if (REVISION_ERRORS.includes(d.code)) return t(`revision.err.${d.code}`, { assignee: d.assignee || '' })
  return d.message || t('common.errorOccurred')
}

export default function RevisionPanel({ requisition, onChanged }) {
  const [state, setState] = useState(null)
  const [dialog, setDialog] = useState(null) // 'withdraw' | 'abandon'
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => requisitionService.getRevisionState(requisition.id).then(r => setState(r.data)).catch(() => setState(null))
  useEffect(() => { load() }, [requisition.id, requisition.status])

  if (!state) return null

  const confirm = async () => {
    if (dialog === 'abandon' && !reason.trim()) { toast.error(t('revision.reasonRequired')); return }
    setBusy(true)
    try {
      if (dialog === 'withdraw') {
        await requisitionService.withdraw(requisition.id, reason.trim())
        toast.success(t('revision.withdrawn'))
      } else {
        await requisitionService.abandon(requisition.id, reason.trim())
        toast.success(t('revision.abandoned'))
      }
      setDialog(null)
      setReason('')
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(revisionError(err), { duration: 7000 })
    } finally {
      setBusy(false)
    }
  }

  const ret = state.lastReturn
  const returnedBy = ret?.kind === 'WITHDRAWN'
    ? t('revision.withdrawnBy', { name: ret.by_name || ret.by_email || '—', date: formatDateTime(ret.at) })
    : t('revision.returnedBy', { name: ret?.by_name || ret?.by_email || '—', task: TASK_LABELS[ret?.task] || ret?.task || '', date: formatDateTime(ret?.at) })

  return (
    <>
      {state.status === 'RETURNED' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="revision-banner">
          <div className="flex flex-wrap items-start gap-3">
            <FileDiff className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-[240px]">
              <p className="font-medium text-amber-900">
                {state.isRequester ? t('revision.toCorrectTitle') : t('revision.inCorrectionTitle')}
              </p>
              {ret && <p className="text-sm text-amber-800 mt-0.5">{returnedBy}</p>}
              {ret?.reason && <p className="text-sm text-amber-900 mt-1 whitespace-pre-line">« {ret.reason} »</p>}
              <p className="text-xs text-amber-700 mt-2">{state.isRequester ? t('revision.toCorrectHint') : t('revision.inCorrectionHint')}</p>
            </div>
            {state.canEdit && (
              <div className="flex gap-2">
                <Link to={`/requisitions/${requisition.id}/edit`} data-testid="revision-edit"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700">
                  <PencilLine size={16} /> {t('revision.correct')}
                </Link>
                <button type="button" onClick={() => { setReason(''); setDialog('abandon') }} data-testid="revision-abandon"
                  className="inline-flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50">
                  <XCircle size={16} /> {t('revision.abandon')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {state.canWithdraw && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex flex-wrap items-center gap-3" data-testid="revision-withdraw-card">
          <Info className="h-5 w-5 text-blue-600 shrink-0" />
          <p className="flex-1 min-w-[240px] text-sm text-blue-900">{t('revision.canWithdrawHint')}</p>
          <button type="button" onClick={() => { setReason(''); setDialog('withdraw') }} data-testid="revision-withdraw"
            className="inline-flex items-center gap-2 px-4 py-2 border border-blue-300 text-blue-700 bg-white rounded-lg hover:bg-blue-100">
            <Undo2 size={16} /> {t('revision.withdraw')}
          </button>
        </div>
      )}

      {state.approvalClaimedBy && state.isRequester && (
        <p className="text-sm text-gray-600 flex items-center gap-2">
          <Info size={14} className="text-gray-400" /> {t('revision.claimedHint', { name: state.approvalClaimedBy })}
        </p>
      )}

      <Modal
        isOpen={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === 'withdraw' ? t('revision.withdrawTitle') : t('revision.abandonTitle')}
        type={dialog === 'abandon' ? 'danger' : 'warning'}
        confirmText={dialog === 'withdraw' ? t('revision.withdraw') : t('revision.abandon')}
        cancelText={t('common.cancel')}
        onConfirm={confirm}
        isLoading={busy}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700">{dialog === 'withdraw' ? t('revision.withdrawText') : t('revision.abandonText')}</p>
          <label className="block text-sm font-medium text-gray-700">
            {dialog === 'withdraw' ? t('revision.withdrawReason') : t('revision.abandonReason')}
          </label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} data-testid="revision-reason"
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
        </div>
      </Modal>
    </>
  )
}
