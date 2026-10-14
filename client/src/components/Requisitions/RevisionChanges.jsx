// src/components/Requisitions/RevisionChanges.jsx
// Changements entre deux versions d'une réquisition (RequisitionRevisionService.diff) : champs modifiés,
// articles ajoutés / supprimés / modifiés — « avant → après ». Utilisé dans la fenêtre d'approbation et l'historique.
import React from 'react'
import { Plus, Minus, ArrowRight } from 'lucide-react'
import { t } from '../../i18n'
import { formatCurrency } from '../../utils/formatters'

const MONEY = ['amount', 'unitPrice', 'total']

function value(field, v, currency) {
  if (v === '' || v === null || v === undefined) return <span className="italic text-gray-400">{t('revision.empty')}</span>
  if (MONEY.includes(field)) return formatCurrency(v, currency)
  if (field === 'priority') return t(`priority.${v}`)
  return String(v)
}

function Change({ field, before, after, currency, labelPrefix = 'revision.fields' }) {
  return (
    <li className="text-sm">
      <span className="font-medium text-gray-700">{t(`${labelPrefix}.${field}`)} : </span>
      <span className="text-red-700 line-through decoration-red-300">{value(field, before, currency)}</span>
      <ArrowRight size={12} className="inline mx-1 text-gray-400" />
      <span className="text-green-700 font-medium">{value(field, after, currency)}</span>
    </li>
  )
}

export default function RevisionChanges({ changes, currency, compact = false }) {
  if (!changes) return null
  const { fields = [], items = {} } = changes
  const { added = [], removed = [], changed = [] } = items
  if (!fields.length && !added.length && !removed.length && !changed.length) {
    return <p className="text-sm text-gray-500 italic">{t('revision.noChange')}</p>
  }
  return (
    <div className={`space-y-3 ${compact ? '' : 'text-sm'}`} data-testid="revision-changes">
      {fields.length > 0 && (
        <ul className="space-y-1">
          {fields.map(f => <Change key={f.field} {...f} currency={currency} />)}
        </ul>
      )}
      {(added.length > 0 || removed.length > 0 || changed.length > 0) && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{t('revision.items')}</p>
          <ul className="space-y-1.5">
            {added.map((i, k) => (
              <li key={`a${k}`} className="flex items-start gap-1.5 text-sm text-green-800">
                <Plus size={14} className="mt-0.5 shrink-0" />
                <span><strong>{i.description}</strong> — {t('revision.itemLine', { quantity: i.quantity, price: formatCurrency(i.unitPrice, currency), total: formatCurrency(i.total, currency) })}</span>
              </li>
            ))}
            {removed.map((i, k) => (
              <li key={`r${k}`} className="flex items-start gap-1.5 text-sm text-red-800">
                <Minus size={14} className="mt-0.5 shrink-0" />
                <span className="line-through decoration-red-300"><strong>{i.description}</strong> — {formatCurrency(i.total, currency)}</span>
              </li>
            ))}
            {changed.map((i, k) => (
              <li key={`c${k}`} className="text-sm">
                <span className="font-medium text-gray-800">{i.description}</span>
                <ul className="ml-4 mt-0.5 space-y-0.5">
                  {i.changes.map(c => <Change key={c.field} {...c} currency={currency} labelPrefix="revision.itemFields" />)}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
