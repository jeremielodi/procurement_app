// src/components/Enterprises/AssetTagSettings.jsx
// « Mon entreprise » : codification des n° d'inventaire des équipements (migration 57) —
// ORGANISATION-PROJET-CATÉGORIE-ANNÉE-NNN (ex. IMA-MIHR-LAP-2026-001). Préfixe vide = ancienne codification.
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Save, Tag } from 'lucide-react'
import api from '../../services/api'
import { t } from '../../i18n'

// Catégories proposées (même liste que le serveur : utils/assetTags.js) ; le code reste libre (2 à 5 caractères)
export const ASSET_CATEGORIES = ['VEH', 'MOT', 'TAB', 'LAP', 'MON', 'IMP', 'PRO', 'GEN', 'REF', 'CLM', 'COM', 'UPS', 'CAM', 'TEL', 'SCO', 'DSK', 'DSQ', 'AUD', 'TVS', 'ELM']

export default function AssetTagSettings() {
  const [data, setData] = useState(null)
  const [org, setOrg] = useState('')
  const [saving, setSaving] = useState(false)
  const apply = (d) => { setData(d); setOrg(d.org || '') }
  useEffect(() => { api.get('/enterprises/current/asset-tags').then(r => apply(r.data.data)).catch(() => setData(null)) }, [])
  if (!data) return null

  const save = async () => {
    setSaving(true)
    try {
      apply((await api.put('/enterprises/current/asset-tags', { org: org.trim().toUpperCase() })).data.data)
      toast.success(t('assetTagSettings.saved'))
    } catch (_) { /* toast via intercepteur */ } finally { setSaving(false) }
  }
  const preview = org.trim() ? `${org.trim().toUpperCase()}-MIHR-LAP-${new Date().getFullYear()}-001` : data.example

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3" data-testid="enterprise-asset-tags-card">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Tag size={18} /> {t('assetTagSettings.title')}</h2>
        <p className="text-sm text-gray-500">{t('assetTagSettings.hint')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">{t('assetTagSettings.org')}</span>
          <input value={org} maxLength={10} onChange={e => setOrg(e.target.value.toUpperCase())} placeholder="IMA" data-testid="asset-tag-org"
            className="w-32 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
        <div className="text-sm">
          <span className="block text-xs text-gray-500">{t('assetTagSettings.example')}</span>
          <span className="font-mono font-semibold text-gray-900" data-testid="asset-tag-example">{preview}</span>
        </div>
        <button type="button" onClick={save} disabled={saving} data-testid="asset-tag-save"
          className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Save size={16} /> {t('common.save')}
        </button>
      </div>
      <table className="w-full text-xs">
        <thead className="text-left text-gray-500"><tr><th className="py-1">{t('assetTagSettings.segment')}</th><th className="py-1">{t('assetTagSettings.meaning')}</th></tr></thead>
        <tbody className="divide-y text-gray-700">
          {['org', 'project', 'category', 'year', 'number'].map(k => (
            <tr key={k}><td className="py-1 pr-3 font-medium">{t(`assetTagSettings.segments.${k}.label`)}</td><td className="py-1">{t(`assetTagSettings.segments.${k}.text`)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {ASSET_CATEGORIES.map(c => (
          <span key={c} className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5"><b className="font-mono">{c}</b> {t(`assetCategories.${c}`)}</span>
        ))}
      </div>
    </div>
  )
}
