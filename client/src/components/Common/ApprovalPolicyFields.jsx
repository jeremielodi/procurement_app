// src/components/Common/ApprovalPolicyFields.jsx
// Saisie des seuils d'approbation N1 / N2 (projet ou entreprise) : politique héritée (de l'entreprise, ou valeurs par
// défaut) ou seuils propres. value = { custom, n1Max, n2Max } ; inherited = politique reprise si non personnalisée.
import React from 'react'
import { ShieldCheck } from 'lucide-react'
import { t } from '../../i18n'
import { policySummary, policyError } from '../../utils/approvalPolicy'

export default function ApprovalPolicyFields({ value, onChange, inherited, inheritLabel, testId = 'approval-policy' }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const error = value.custom ? policyError(value.n1Max, value.n2Max) : null
  const preview = value.custom && !error ? { n1Max: value.n1Max, n2Max: value.n2Max } : inherited

  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-3" data-testid={testId}>
      <p className="text-sm font-medium flex items-center gap-2"><ShieldCheck size={16} className="text-blue-600" /> {t('approvalPolicy.title')}</p>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="radio" className="mt-0.5" checked={!value.custom} onChange={() => set({ custom: false })} data-testid={`${testId}-inherit`} />
        <span>{inheritLabel}{inherited && <span className="block text-xs text-gray-500">{policySummary(inherited)}</span>}</span>
      </label>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="radio" className="mt-0.5" checked={!!value.custom} onChange={() => set({ custom: true, n1Max: value.n1Max || inherited?.n1Max || '', n2Max: value.n2Max || inherited?.n2Max || '' })} data-testid={`${testId}-custom`} />
        <span>{t('approvalPolicy.custom')}</span>
      </label>
      {value.custom && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-6">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('approvalPolicy.n1Label')}</label>
            <input type="number" min="0" step="any" value={value.n1Max} onChange={(e) => set({ n1Max: e.target.value })} name="approvalN1Max"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('approvalPolicy.n2Label')}</label>
            <input type="number" min="0" step="any" value={value.n2Max} onChange={(e) => set({ n2Max: e.target.value })} name="approvalN2Max"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <p className="sm:col-span-2 text-xs text-gray-500">{t('approvalPolicy.hint')}</p>
        </div>
      )}
      {error
        ? <p className="text-xs text-red-600 pl-6">{error}</p>
        : preview && <p className="text-xs text-gray-600 pl-6" data-testid={`${testId}-summary`}>{t('approvalPolicy.applies', { summary: policySummary(preview) })}</p>}
    </div>
  )
}
