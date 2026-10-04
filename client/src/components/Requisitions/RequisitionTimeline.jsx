// src/components/Requisitions/RequisitionTimeline.jsx
// Suivi du workflow d'une réquisition : étapes du cycle complet + historique lisible (en français).
// Données : GET /requisitions/:id/timeline (RequisitionTimelineService côté backend).
import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2, Clock, XCircle, Circle, MinusCircle, Info, AlertTriangle, User, RefreshCw, ExternalLink
} from 'lucide-react'
import requisitionService from '../../services/requisitionService'

const STEP_STYLE = {
  done:    { icon: CheckCircle2, cls: 'text-green-600', label: 'Terminé' },
  current: { icon: Clock,        cls: 'text-blue-600 animate-pulse', label: 'En cours' },
  failed:  { icon: XCircle,      cls: 'text-red-600', label: 'Bloqué' },
  pending: { icon: Circle,       cls: 'text-gray-300', label: 'À venir' },
  skipped: { icon: MinusCircle,  cls: 'text-gray-300', label: 'Non réalisé' },
}

const EVENT_STYLE = {
  success: { icon: CheckCircle2,  dot: 'bg-green-100 text-green-600' },
  danger:  { icon: XCircle,       dot: 'bg-red-100 text-red-600' },
  warning: { icon: AlertTriangle, dot: 'bg-yellow-100 text-yellow-700' },
  info:    { icon: Info,          dot: 'bg-blue-100 text-blue-600' },
}

const fmt = (d, withTime = true) => d
  ? new Date(d).toLocaleString('fr-FR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })
  : ''

function DocLinks({ links, onNavigate }) {
  if (!links?.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {links.map(l => (
        <Link key={l.to} to={l.to} onClick={onNavigate}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs hover:bg-blue-100">
          {l.label} <ExternalLink size={10} />
        </Link>
      ))}
    </div>
  )
}

export default function RequisitionTimeline({ requisitionId, onNavigate }) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['requisition-timeline', requisitionId],
    queryFn: () => requisitionService.getTimeline(requisitionId),
    enabled: !!requisitionId,
  })

  if (isLoading) {
    return <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-blue-500" /></div>
  }
  if (error || !data?.data) {
    return <p className="p-6 text-center text-gray-500">Impossible de charger le suivi du workflow.</p>
  }

  const { steps, events, progress } = data.data
  const pct = Math.round((progress.done / progress.total) * 100)
  const current = steps.find(s => s.status === 'current')
  const failed = steps.find(s => s.status === 'failed')

  return (
    <div className="space-y-6" data-testid="requisition-timeline">
      {/* Résumé */}
      <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            {progress.finished ? (
              <span className="font-semibold text-green-700">Cycle terminé : la réquisition a été payée.</span>
            ) : failed ? (
              <span className="font-semibold text-red-700">Processus arrêté à l'étape « {failed.label} ».</span>
            ) : current ? (
              <span><span className="text-gray-500">Étape en cours :</span> <b className="text-blue-700">{current.label}</b>{current.info && <span className="text-gray-600"> — {current.info}</span>}</span>
            ) : (
              <span className="text-gray-600">Processus non démarré.</span>
            )}
          </div>
          <button onClick={() => refetch()} className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1">
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Actualiser
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
            <div className={`h-full ${failed ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-gray-600 whitespace-nowrap">{progress.done} / {progress.total} étapes</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Étapes du workflow complet */}
        <div className="lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Workflow complet</h3>
          <ol className="relative">
            {steps.map((s, i) => {
              const st = STEP_STYLE[s.status] || STEP_STYLE.pending
              const Icon = st.icon
              return (
                <li key={s.key} className="relative pl-8 pb-4" data-testid={`step-${s.key}`} data-status={s.status}>
                  {i < steps.length - 1 && <span className="absolute left-[11px] top-6 h-full w-0.5 bg-gray-200" aria-hidden="true" />}
                  <Icon size={24} className={`absolute left-0 top-0 bg-white ${st.cls}`} />
                  <div className={`text-sm font-medium ${s.status === 'current' ? 'text-blue-700' : s.status === 'skipped' || s.status === 'pending' ? 'text-gray-400' : 'text-gray-900'}`}>
                    {s.label}
                    <span className={`ml-2 text-xs font-normal ${st.cls.replace('animate-pulse', '')}`}>{st.label}</span>
                  </div>
                  {s.date && s.status !== 'pending' && <div className="text-xs text-gray-500">{fmt(s.date, false)}</div>}
                  {s.info && <div className="text-xs text-gray-600">{s.info}</div>}
                  <DocLinks links={s.links} onNavigate={onNavigate} />
                </li>
              )
            })}
          </ol>
        </div>

        {/* Historique réel */}
        <div className="lg:col-span-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Ce qui s'est passé</h3>
          {events.length === 0 ? (
            <p className="text-sm text-gray-500">Aucune action enregistrée.</p>
          ) : (
            <ul className="space-y-3">
              {events.map((e, i) => {
                const st = EVENT_STYLE[e.kind] || EVENT_STYLE.info
                const Icon = st.icon
                return (
                  <li key={i} className={`flex gap-3 p-3 rounded-lg border ${e.pending ? 'border-yellow-300 bg-yellow-50' : 'border-gray-100 bg-white'}`}>
                    <span className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${st.dot}`}><Icon size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap justify-between gap-x-3">
                        <span className="text-sm font-medium text-gray-900">{e.title}</span>
                        {e.date && <span className="text-xs text-gray-400 whitespace-nowrap">{fmt(e.date)}</span>}
                      </div>
                      {e.actor && <div className="text-xs text-gray-600 flex items-center gap-1 mt-0.5"><User size={12} /> {e.actor}</div>}
                      {e.details?.length > 0 && (
                        <ul className="mt-1 text-xs text-gray-600 list-disc pl-4 space-y-0.5">
                          {e.details.map((d, j) => <li key={j}>{d}</li>)}
                        </ul>
                      )}
                      <DocLinks links={e.links} onNavigate={onNavigate} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
