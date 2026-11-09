// src/components/Enterprises/StockRequestSettings.jsx
// « Mon entreprise » : validation des demandes au magasin (migration 56). Activée : chaque demande est validée par le chef
// du projet indiqué (ou son intérimaire), sinon le responsable du département, sinon un administrateur, avant d'être servie.
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ClipboardList } from 'lucide-react'
import { stockRequestService } from '../../services/stockRequestService'
import { t } from '../../i18n'

export default function StockRequestSettings() {
  const [required, setRequired] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { stockRequestService.getSettings().then(r => setRequired(!!r.data?.validationRequired)).catch(() => setRequired(null)) }, [])
  if (required === null) return null

  const toggle = async (value) => {
    setSaving(true)
    try {
      const r = await stockRequestService.setSettings(value)
      setRequired(!!r.data?.validationRequired)
      toast.success(t('stockRequestSettings.saved'))
    } catch (_) { /* toast via intercepteur */ } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3" data-testid="enterprise-stock-requests-card">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><ClipboardList size={18} /> {t('stockRequestSettings.title')}</h2>
        <p className="text-sm text-gray-500">{t('stockRequestSettings.hint')}</p>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={required} disabled={saving} onChange={e => toggle(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
          data-testid="stock-request-validation" />
        <span>
          <span className="font-medium text-gray-800">{t('stockRequestSettings.validation')}</span>
          <span className="block text-xs text-gray-500">{t('stockRequestSettings.validationHint')}</span>
        </span>
      </label>
    </div>
  )
}
