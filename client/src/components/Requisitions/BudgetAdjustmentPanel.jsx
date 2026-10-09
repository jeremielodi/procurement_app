// src/components/Requisitions/BudgetAdjustmentPanel.jsx
// Budget insuffisant (étape GoFlow Activity_BudgetAdjustment) : besoin / disponible par ligne budgétaire,
// changement de ligne des articles, puis « Relancer la vérification » (même réquisition) ou « Abandonner ».
// Visible seulement au statut BUDGET_INSUFFICIENT ; actions réservées au demandeur, à la finance et à l'administrateur.
import React, { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Search, CheckCircle2, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../Common/Modal'
import BudgetLineSearchModal from './BudgetLineSearchModal'
import requisitionService from '../../services/requisitionService'
import { useCurrency } from '../../contexts/EnterpriseContext'
import { t } from '../../i18n'

const ERROR_CODES = ['STILL_INSUFFICIENT', 'TASK_NOT_FOUND', 'NOT_BUDGET_INSUFFICIENT', 'BUDGET_LINE_INVALID', 'FORBIDDEN', 'GOFLOW_ERROR']

export default function BudgetAdjustmentPanel({ requisition, onChanged }) {
  const { formatAmount } = useCurrency()
  const [data, setData] = useState(null)
  const [picking, setPicking] = useState(null) // article dont on change la ligne
  const [dialog, setDialog] = useState(null)   // 'RETRY' | 'ABANDON'
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => requisitionService.getBudgetAdjustment(requisition.id).then(r => setData(r.data)).catch(() => setData(null))
  useEffect(() => { if (requisition.status === 'BUDGET_INSUFFICIENT') load() }, [requisition.id, requisition.status])

  if (requisition.status !== 'BUDGET_INSUFFICIENT' || !data) return null

  const showError = (err) => {
    const d = err.response?.data || {}
    toast.error(ERROR_CODES.includes(d.code) ? t(`budgetAdjust.err.${d.code}`) : (d.message || t('common.errorOccurred')))
  }

  const changeLine = async (budgetLine) => {
    const item = picking
    setPicking(null)
    try {
      await requisitionService.changeBudgetLines(requisition.id, [{ itemId: item.id, budgetLineId: budgetLine.id }])
      toast.success(t('budgetAdjust.lineChanged'))
      await load()
    } catch (err) { showError(err) }
  }

  const decide = async () => {
    setBusy(true)
    try {
      await requisitionService.decideBudgetAdjustment(requisition.id, dialog, comment.trim() || undefined)
      toast.success(dialog === 'RETRY' ? t('budgetAdjust.retried') : t('budgetAdjust.abandoned'))
      setDialog(null)
      onChanged?.()
    } catch (err) { showError(err) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50 p-5 space-y-4" data-testid="budget-adjustment">
      <div className="flex items-start gap-3">
        <AlertTriangle className="flex-shrink-0 text-orange-600" />
        <div>
          <h2 className="font-semibold text-orange-900">{t('budgetAdjust.title')}</h2>
          <p className="text-sm text-orange-800">{data.canAct ? t('budgetAdjust.intro') : t('budgetAdjust.introReadOnly')}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-orange-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-orange-50/60 text-left text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2">{t('budgetAdjust.line')}</th>
              <th className="px-3 py-2 text-right">{t('budgetAdjust.requested')}</th>
              <th className="px-3 py-2 text-right">{t('budgetAdjust.available')}</th>
              <th className="px-3 py-2">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.lines.map(l => (
              <tr key={l.budgetLineId || 'none'}>
                <td className="px-3 py-2">{l.code ? <><b className="font-mono">{l.code}</b> <span className="text-gray-500">{l.description}</span></> : <span className="text-red-700">{t('budgetAdjust.noLine')}</span>}</td>
                <td className="px-3 py-2 text-right">{formatAmount(l.requested)}</td>
                <td className="px-3 py-2 text-right">{formatAmount(l.available)}</td>
                <td className="px-3 py-2">
                  {l.ok
                    ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 size={14} /> {t('budgetAdjust.enough')}</span>
                    : <span className="inline-flex items-center gap-1 text-red-700"><XCircle size={14} /> {t('budgetAdjust.missing', { amount: formatAmount(Math.max(l.requested - l.available, 0)) })}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.canAct && (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2">{t('budgetAdjust.item')}</th>
                  <th className="px-3 py-2 text-right">{t('budgetAdjust.amount')}</th>
                  <th className="px-3 py-2">{t('budgetAdjust.line')}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map(it => (
                  <tr key={it.id}>
                    <td className="px-3 py-2">{it.item_description}</td>
                    <td className="px-3 py-2 text-right">{formatAmount(it.total)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{it.budget_line_code || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setPicking(it)} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50" data-testid="change-budget-line">
                        <Search size={12} /> {t('budgetAdjust.changeLine')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-600">{t('budgetAdjust.financeHint')}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setDialog('RETRY'); setComment('') }} disabled={!data.allOk}
              title={data.allOk ? undefined : t('budgetAdjust.retryDisabled')}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50" data-testid="budget-retry">
              <RefreshCw size={16} /> {t('budgetAdjust.retry')}
            </button>
            <button onClick={() => { setDialog('ABANDON'); setComment('') }}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50" data-testid="budget-abandon">
              <XCircle size={16} /> {t('budgetAdjust.abandon')}
            </button>
          </div>
          {!data.allOk && <p className="text-xs text-orange-800">{t('budgetAdjust.retryDisabled')}</p>}
        </>
      )}

      <BudgetLineSearchModal isOpen={!!picking} onClose={() => setPicking(null)} onSelect={changeLine} projectId={data.projectId} />

      <Modal isOpen={!!dialog} onClose={() => !busy && setDialog(null)} size="sm" isLoading={busy} onConfirm={decide}
        type={dialog === 'ABANDON' ? 'danger' : 'info'}
        title={dialog === 'RETRY' ? t('budgetAdjust.retryTitle') : t('budgetAdjust.abandonTitle')}
        confirmText={dialog === 'RETRY' ? t('budgetAdjust.retry') : t('budgetAdjust.abandon')}>
        <div className="space-y-3 text-sm text-gray-700">
          <p>{dialog === 'RETRY' ? t('budgetAdjust.retryText') : t('budgetAdjust.abandonText')}</p>
          <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} maxLength={1000}
            placeholder={t('budgetAdjust.commentPlaceholder')} aria-label={t('budgetAdjust.commentPlaceholder')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </Modal>
    </div>
  )
}
