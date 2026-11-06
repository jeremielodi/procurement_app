// Intérim du chef de projet pendant son absence (migration 53) : « Mon profil » (userId absent = soi-même) et fiche
// utilisateur de l'administrateur (userId = personne absente). L'intérimaire valide les réquisitions de tous les
// projets dont l'absent est chef ; le titulaire garde la main.
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserCheck, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { delegationService } from '../../services/delegationService'
import SearchSelect from './SearchSelect'
import { t } from '../../i18n'
import { formatDate } from '../../utils/formatters'

const ERRORS = ['NOT_PROJECT_MANAGER', 'DELEGATE_REQUIRED', 'DELEGATE_INVALID', 'DELEGATE_SELF', 'DATES_INVALID', 'END_IN_PAST', 'DELEGATION_OVERLAP', 'NOT_ALLOWED', 'ALREADY_ENDED']
const errorText = (error) => {
  const d = error?.response?.data || {}
  return ERRORS.includes(d.code) ? t(`delegation.err.${d.code}`) : d.message || t('common.errorOccurred')
}
const today = () => new Date().toISOString().slice(0, 10)
const nameOf = (name, email) => (name || '').trim() || email

export default function DelegationCard({ userId = null, currentUserId }) {
  const queryClient = useQueryClient()
  const absentId = userId || currentUserId
  const [form, setForm] = useState(null) // { delegateId, startDate, endDate, reason } pendant la saisie

  const { data, isError } = useQuery({
    queryKey: ['delegations', absentId],
    queryFn: () => delegationService.list(userId ? { userId } : {}),
    enabled: !!absentId,
  })
  const { data: candidatesData } = useQuery({
    queryKey: ['delegation-candidates'],
    queryFn: () => delegationService.candidates(),
    enabled: !!form,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['delegations'] })
  const create = useMutation({
    mutationFn: () => delegationService.create({ ...form, ...(userId ? { delegatorId: userId } : {}) }),
    onSuccess: () => { toast.success(t('delegation.created')); setForm(null); refresh() },
    onError: (e) => toast.error(errorText(e), { duration: 7000 }),
  })
  const end = useMutation({
    mutationFn: (id) => delegationService.end(id),
    onSuccess: () => { toast.success(t('delegation.ended')); refresh() },
    onError: (e) => toast.error(errorText(e)),
  })

  if (isError) return null // fournisseur, super admin : pas d'intérim
  const rows = (data?.data || []).filter(d => d.open)
  const given = rows.filter(d => String(d.delegator_id) === String(absentId))
  const received = rows.filter(d => String(d.delegate_id) === String(absentId))
  const candidates = (candidatesData?.data || []).filter(u => String(u.id) !== String(absentId))
  // Réservé aux chefs de projet ; un intérimaire voit tout de même qui il remplace
  const canDelegate = !!data?.canDelegate
  if (!canDelegate && !given.length && !received.length) return null
  const period = (d) => t('delegation.period', { start: formatDate(d.start_date), end: formatDate(d.end_date) })

  return (
    <div className="bg-white rounded-lg shadow p-6" data-testid="delegation-card">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800"><UserCheck size={18} /> {t('delegation.title')}</h2>
        {!form && canDelegate && (
          <button type="button" onClick={() => setForm({ delegateId: '', startDate: today(), endDate: '', reason: '' })}
            className="flex items-center gap-1 rounded-lg border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50" data-testid="delegation-new">
            <Plus size={14} /> {t('delegation.new')}
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-gray-500">{t(userId ? 'delegation.introAdmin' : 'delegation.intro')}</p>

      {form && (
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-blue-100 bg-blue-50/40 p-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('delegation.delegate')} *</label>
            <SearchSelect value={form.delegateId} onChange={(e) => setForm({ ...form, delegateId: e.target.value })}
              data-testid="delegation-delegate" searchThreshold={0} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value="">{t('delegation.chooseDelegate')}</option>
              {candidates.map(u => (
                <option key={u.id} value={u.id} data-search={u.email}>
                  {nameOf(`${u.first_name || ''} ${u.last_name || ''}`, u.email)}{u.position ? ` — ${u.position}` : ''}
                </option>
              ))}
            </SearchSelect>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('delegation.from')} *</label>
            <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              data-testid="delegation-start" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('delegation.to')} *</label>
            <input type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              data-testid="delegation-end" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('delegation.reason')}</label>
            <input type="text" value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder={t('delegation.reasonPlaceholder')} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div className="flex justify-end gap-2 md:col-span-2">
            <button type="button" onClick={() => setForm(null)} className="rounded-lg border px-3 py-1.5 text-sm">{t('common.cancel')}</button>
            <button type="button" onClick={() => create.mutate()} disabled={!form.delegateId || !form.startDate || !form.endDate || create.isPending}
              data-testid="delegation-save" className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {t('delegation.save')}
            </button>
          </div>
        </div>
      )}

      {!given.length && !received.length && !form && <p className="text-sm text-gray-400">{t('delegation.none')}</p>}
      <ul className="space-y-2">
        {given.map(d => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm" data-testid="delegation-given">
            <span>
              {t('delegation.givenLine', { name: nameOf(d.delegate_name, d.delegate_email) })} · {period(d)}
              {d.active && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">{t('delegation.active')}</span>}
              {d.reason && <span className="block text-xs text-gray-500">{d.reason}</span>}
            </span>
            <button type="button" onClick={() => end.mutate(d.id)} disabled={end.isPending}
              className="flex items-center gap-1 text-xs text-red-600 hover:underline" data-testid="delegation-end-now">
              <X size={12} /> {t(d.active ? 'delegation.endNow' : 'delegation.cancel')}
            </button>
          </li>
        ))}
        {received.map(d => (
          <li key={d.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="delegation-received">
            {t('delegation.receivedLine', { name: nameOf(d.delegator_name, d.delegator_email), count: d.project_count })} · {period(d)}
            {d.active && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">{t('delegation.active')}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
