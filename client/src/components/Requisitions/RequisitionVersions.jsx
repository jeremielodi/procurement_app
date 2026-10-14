// src/components/Requisitions/RequisitionVersions.jsx
// Historique des versions d'une réquisition (onglet « Versions » de la fiche) : chaque soumission, ce qui a changé
// par rapport à la précédente, et pourquoi elle a été renvoyée ou retirée. Pendant la correction : modifications
// pas encore soumises.
import React, { useEffect, useState } from 'react'
import { GitCompare, Undo2, CornerDownLeft, Send } from 'lucide-react'
import requisitionService from '../../services/requisitionService'
import RevisionChanges from './RevisionChanges'
import { t } from '../../i18n'
import { formatCurrency, formatDateTime } from '../../utils/formatters'
import { TASK_LABELS } from '../../utils/taskLabels'

export default function RequisitionVersions({ requisitionId, status }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    requisitionService.getVersions(requisitionId).then(r => setData(r.data)).catch(() => setData({ versions: [] }))
  }, [requisitionId, status])

  if (!data) return <p className="text-sm text-gray-500">{t('common.loading')}</p>

  return (
    <div className="space-y-4" data-testid="requisition-versions">
      {data.pendingChanges && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="font-medium text-amber-900 mb-2 flex items-center gap-2"><GitCompare size={16} /> {t('revision.pendingTitle')}</p>
          <RevisionChanges changes={data.pendingChanges} />
        </div>
      )}
      {data.versions.length === 0 && <p className="text-sm text-gray-500">{t('revision.noVersions')}</p>}
      {data.versions.map(v => (
        <div key={v.version} className="rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-gray-900 flex items-center gap-2">
              <Send size={15} className="text-blue-600" />
              {t('revision.versionTitle', { version: v.version })}
              {v.version === data.version && <span className="text-xs font-medium bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{t('revision.current')}</span>}
            </p>
            <p className="text-sm text-gray-600">{formatCurrency(v.amount, v.currency)}</p>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{t('revision.submittedBy', { name: v.submittedBy || '—', date: formatDateTime(v.submittedAt) })}</p>
          {v.comment && <p className="text-sm text-gray-700 mt-1">{t('revision.submitComment', { value: v.comment })}</p>}
          {v.changes && (
            <div className="mt-3 rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{t('revision.changesSince', { version: v.version - 1 })}</p>
              <RevisionChanges changes={v.changes} currency={v.currency} />
            </div>
          )}
          {v.returnKind && (
            <div className="mt-3 flex items-start gap-2 text-sm text-amber-900">
              {v.returnKind === 'WITHDRAWN' ? <Undo2 size={15} className="mt-0.5 text-amber-600" /> : <CornerDownLeft size={15} className="mt-0.5 text-amber-600" />}
              <div>
                <p>{v.returnKind === 'WITHDRAWN'
                  ? t('revision.withdrawnBy', { name: v.returnedBy || '—', date: formatDateTime(v.returnedAt) })
                  : t('revision.returnedBy', { name: v.returnedBy || '—', task: TASK_LABELS[v.returnedTask] || v.returnedTask || '', date: formatDateTime(v.returnedAt) })}</p>
                {v.returnReason && <p className="text-amber-800">« {v.returnReason} »</p>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
