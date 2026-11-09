// src/components/Enterprises/StockPlanningSettings.jsx
// « Mon entreprise » : paramètres de la prévision du réapprovisionnement (migration 55) — période de calcul de la
// consommation moyenne, stock de sécurité, fréquence des commandes, délai de livraison. Un dépôt peut avoir son propre
// stock de sécurité, un article son propre délai (fiches du dépôt et de l'article).
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Save, TrendingUp } from 'lucide-react'
import { enterpriseService } from '../../services/enterpriseService'
import { t } from '../../i18n'

const FIELDS = [
  { key: 'amcMonths', min: 1, max: 24, step: 1 },
  { key: 'safetyMonths', min: 0, max: 24, step: 0.5 },
  { key: 'orderIntervalMonths', min: 0, max: 24, step: 0.5 },
  { key: 'leadTimeDays', min: 0, max: 365, step: 1 },
]
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function StockPlanningSettings() {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const apply = (d) => setForm(Object.fromEntries(FIELDS.map(f => [f.key, String(d[f.key])])))
  useEffect(() => { enterpriseService.getStockPlanning().then(r => apply(r.data)).catch(() => setForm(null)) }, [])
  if (!form) return null

  const invalid = FIELDS.find(f => {
    const v = Number(form[f.key])
    return form[f.key] === '' || !(v >= f.min && v <= f.max) || (f.step === 1 && !Number.isInteger(v))
  })

  const save = async () => {
    if (invalid) { toast.error(t(`stockPlanningSettings.invalid`, { field: t(`stockPlanningSettings.${invalid.key}`), min: invalid.min, max: invalid.max })); return }
    setSaving(true)
    try {
      const r = await enterpriseService.setStockPlanning(Object.fromEntries(FIELDS.map(f => [f.key, Number(form[f.key])])))
      apply(r.data)
      toast.success(t('stockPlanningSettings.saved'))
    } catch (_) { /* toast via intercepteur */ } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3" data-testid="enterprise-stock-planning-card">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><TrendingUp size={18} /> {t('stockPlanningSettings.title')}</h2>
        <p className="text-sm text-gray-500">{t('stockPlanningSettings.hint')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(f => (
          <label key={f.key} className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{t(`stockPlanningSettings.${f.key}`)}</span>
            <input type="number" min={f.min} max={f.max} step={f.step} value={form[f.key]} className={inputCls}
              onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))} data-testid={`stock-planning-${f.key}`} />
            <span className="mt-1 block text-xs text-gray-500">{t(`stockPlanningSettings.${f.key}Hint`)}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-500">{t('stockPlanningSettings.formula')}</p>
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} data-testid="enterprise-stock-planning-save"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Save size={16} /> {t('common.save')}
        </button>
      </div>
    </div>
  )
}
