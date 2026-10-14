// src/components/Enterprises/ApprovalPolicySettings.jsx
// « Mon entreprise » : seuils d'approbation N1 / N2 de l'entreprise, repris par les projets sans politique propre
// (sinon valeurs par défaut 25 000 / 100 000). Chaque projet peut avoir les siens (fiche du projet).
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Save } from 'lucide-react'
import ApprovalPolicyFields from '../Common/ApprovalPolicyFields'
import { enterpriseService } from '../../services/enterpriseService'
import { policyError } from '../../utils/approvalPolicy'
import { t } from '../../i18n'

export default function ApprovalPolicySettings() {
  const [data, setData] = useState(null)
  const [policy, setPolicy] = useState({ custom: false, n1Max: '', n2Max: '' })
  const [saving, setSaving] = useState(false)

  const apply = (d) => {
    setData(d)
    setPolicy(d.n1Max != null ? { custom: true, n1Max: d.n1Max, n2Max: d.n2Max } : { custom: false, n1Max: '', n2Max: '' })
  }
  useEffect(() => { enterpriseService.getApprovalPolicy().then(r => apply(r.data)).catch(() => setData(null)) }, [])

  if (!data) return null

  const save = async () => {
    if (policy.custom && policyError(policy.n1Max, policy.n2Max)) { toast.error(policyError(policy.n1Max, policy.n2Max)); return }
    setSaving(true)
    try {
      const r = await enterpriseService.setApprovalPolicy(policy.custom
        ? { n1Max: Number(policy.n1Max), n2Max: Number(policy.n2Max) }
        : { n1Max: null, n2Max: null })
      apply(r.data)
      toast.success(t('approvalPolicy.saved'))
    } catch (_) { /* toast via intercepteur */ } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3" data-testid="enterprise-approval-policy-card">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{t('approvalPolicy.enterpriseTitle')}</h2>
        <p className="text-sm text-gray-500">{t('approvalPolicy.enterpriseHint')}</p>
      </div>
      <ApprovalPolicyFields
        value={policy}
        onChange={setPolicy}
        inherited={data.defaults}
        inheritLabel={t('approvalPolicy.inheritDefault')}
        testId="enterprise-approval-policy"
      />
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} data-testid="enterprise-approval-policy-save"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Save size={16} /> {t('common.save')}
        </button>
      </div>
    </div>
  )
}
