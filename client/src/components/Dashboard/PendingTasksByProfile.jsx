// src/components/Dashboard/PendingTasksByProfile.jsx
// « Qui bloque ? » : tâches GoFlow en attente, regroupées par profil (rôle).
// Barres horizontales (une seule série → une couleur, pas de légende), valeur au bout de la barre.
// L'ancienneté est affichée en texte + statut (icône + libellé), jamais par la couleur seule.
// Chaque ligne se déplie en tableau des tâches (vue tabulaire accessible).
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Users, AlertTriangle, AlertCircle, Clock, ChevronDown, ChevronRight, CheckCircle2, RefreshCw } from 'lucide-react';
import { dashboardService } from '../../services/dashboardService';
import { projectService } from '../../services/projectService';
import { usePermissions } from '../../hooks/usePermissions';

const BAR_COLOR = '#2563EB'; // bleu de l'application (série unique)
const STATUS = {
  critical: { color: '#d03b3b', icon: AlertTriangle, label: (d) => `Bloqué depuis ${d} j` },
  warning: { color: '#c2410c', icon: AlertCircle, label: (d) => `En attente depuis ${d} j` },
  normal: { color: '#6B7280', icon: Clock, label: (d) => (d === 0 ? "Depuis aujourd'hui" : `Depuis ${d} j`) },
};
const statusFor = (days) => (days >= 7 ? STATUS.critical : days >= 3 ? STATUS.warning : STATUS.normal);

const fmtDate = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function ProfileRow({ g, max }) {
  const [open, setOpen] = useState(false);
  const st = statusFor(g.oldestAgeDays);
  const StatusIcon = st.icon;
  const width = Math.max(4, Math.round((g.count / max) * 100));
  const tooltip = `${g.profileName} — ${g.count} tâche(s) en attente, ${g.claimed} prise(s) en charge ; la plus ancienne : ${g.oldestAgeDays} j`;

  return (
    <li className="py-2" data-testid="pending-profile-row">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} title={tooltip}
        className="w-full grid grid-cols-12 gap-3 items-center text-left rounded-lg px-2 py-1.5 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
        {/* Profil */}
        <div className="col-span-12 sm:col-span-3 flex items-center gap-2 min-w-0">
          {open ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">{g.profileName}</div>
            {g.users === 0 ? (
              <div className="text-xs font-medium flex items-center gap-1" style={{ color: STATUS.critical.color }}>
                <AlertTriangle size={12} /> Aucun utilisateur avec ce profil
              </div>
            ) : g.users !== null && (
              <div className="text-xs text-gray-500 flex items-center gap-1"><Users size={12} /> {g.users} utilisateur(s)</div>
            )}
          </div>
        </div>

        {/* Barre : nombre de tâches en attente */}
        <div className="col-span-8 sm:col-span-6 flex items-center gap-2">
          <div className="flex-1 h-3 bg-gray-100 rounded-r" aria-hidden="true">
            <div className="h-3" style={{ width: `${width}%`, background: BAR_COLOR, borderRadius: '0 4px 4px 0' }} />
          </div>
          <span className="text-sm font-semibold text-gray-900 tabular-nums w-8 text-right">{g.count}</span>
        </div>

        {/* Ancienneté + prise en charge */}
        <div className="col-span-4 sm:col-span-3 text-xs">
          <div className="flex items-center gap-1 font-medium" style={{ color: st.color }}>
            <StatusIcon size={13} /> {st.label(g.oldestAgeDays)}
          </div>
          <div className="text-gray-500">{g.claimed}/{g.count} prise(s) en charge</div>
        </div>
      </button>

      {open && (
        <div className="mt-2 ml-7 overflow-x-auto border border-gray-100 rounded-lg">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Réquisition</th>
                <th className="text-left px-3 py-2 font-medium">Projet</th>
                <th className="text-left px-3 py-2 font-medium">Tâche</th>
                <th className="text-left px-3 py-2 font-medium">En attente depuis</th>
                <th className="text-left px-3 py-2 font-medium">Pris en charge par</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {g.tasks.map(t => (
                <tr key={t.taskId}>
                  <td className="px-3 py-2">
                    <Link to={`/requisitions/${t.requisitionId}`} className="text-blue-600 hover:underline font-medium">{t.requisitionNumber}</Link>
                    <div className="text-gray-500 truncate max-w-[220px]">{t.requisitionTitle}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{t.projectName || '—'}</td>
                  <td className="px-3 py-2 text-gray-800">{t.label}</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDate(t.since)} <span className="text-gray-500">({t.ageDays} j)</span></td>
                  <td className="px-3 py-2 text-gray-700">{t.assignee || <span className="text-gray-500 italic">Personne — à prendre</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.assignees.length > 0 && (
            <div className="px-3 py-2 text-xs text-gray-600 border-t border-gray-100">
              Par personne : {g.assignees.map(a => `${a.name} (${a.count})`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function PendingTasksByProfile() {
  const [projectId, setProjectId] = useState('');
  const { hasPermission } = usePermissions();
  const canFilterProjects = hasPermission('VIEW_PROJECTS');
  const { data: projectsData } = useQuery({
    queryKey: ['projects-for-pending-filter'],
    queryFn: () => projectService.getAll(),
    enabled: canFilterProjects,
  });
  const projects = projectsData?.data || [];
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['dashboard-pending-tasks', projectId],
    queryFn: () => dashboardService.getPendingTasks(projectId || undefined),
    refetchInterval: 5 * 60 * 1000, // rafraîchissement automatique toutes les 5 minutes
  });
  const d = data?.data;
  const max = Math.max(1, ...(d?.byProfile || []).map(g => g.count));

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5" data-testid="pending-tasks-by-profile">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Tâches en cours par profil</h2>
          <p className="text-sm text-gray-500">
            Qui doit agir maintenant ?{d ? ` ${d.total} tâche(s) en attente.` : ''} Cliquez sur un profil pour voir le détail.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canFilterProjects && (
            <select value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="Filtrer par projet"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[260px]">
              <option value="">Tous les projets</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
            </select>
          )}
          <button type="button" onClick={() => refetch()} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100" title="Actualiser">
            <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 flex justify-center"><RefreshCw className="animate-spin text-blue-500" /></div>
      ) : isError ? (
        <p className="py-6 text-sm text-gray-500 text-center">Impossible de charger les tâches en cours.</p>
      ) : d.total === 0 ? (
        <p className="py-6 text-sm text-center flex items-center justify-center gap-2" style={{ color: '#0f7a0f' }}>
          <CheckCircle2 size={16} /> Aucune tâche en attente{projectId ? ' sur ce projet' : ''} : rien ne bloque.
        </p>
      ) : (
        <>
          <div className="hidden sm:grid grid-cols-12 gap-3 px-2 pb-1 text-xs text-gray-500 border-b border-gray-100">
            <div className="col-span-3 pl-6">Profil</div>
            <div className="col-span-6">Tâches en attente</div>
            <div className="col-span-3">Plus ancienne</div>
          </div>
          <ul className="divide-y divide-gray-50">
            {d.byProfile.map(g => <ProfileRow key={g.group} g={g} max={max} />)}
          </ul>
          <p className="mt-2 text-xs text-gray-400">
            Statut : en orange à partir de 3 jours d'attente, en rouge (« bloqué ») à partir de 7 jours.
          </p>
        </>
      )}
    </section>
  );
}
