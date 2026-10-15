// src/pages/Dashboard/Dashboard.jsx
// Tableau de bord selon le profil (GET /dashboard/overview) : le serveur ne renvoie que les volets autorisés —
// Opérations (tous), Pilotage + « Qui bloque ? » (direction), Finance (budget), Contrôle (auditeur, admin).
// Filtres communs : période glissante et projet.
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { dashboardService } from '../../services/dashboardService';
import { projectService } from '../../services/projectService';
import { usePermissions } from '../../hooks/usePermissions';
import PendingTasksByProfile from './PendingTasksByProfile';
import OperationsSection from './overview/OperationsSection';
import SteeringSection from './overview/SteeringSection';
import FinanceSection from './overview/FinanceSection';
import ControlSection from './overview/ControlSection';
import LoadingSpinner from '../../components/Common/LoadingSpinner';
import ErrorBoundary from '../../components/Common/ErrorBoundary';
import SearchSelect from '../Common/SearchSelect';
import { t, useTranslation } from '../../i18n';

const PERIODS = ['week', 'month', 'quarter', 'year'];

export default function Dashboard() {
  const [period, setPeriod] = useState('month');
  const [projectId, setProjectId] = useState('');
  const { lang } = useTranslation(); // libellés des étapes / méthodes produits par le serveur
  const { hasPermission } = usePermissions();
  const canFilterProjects = hasPermission('VIEW_PROJECTS');

  const { data: projectsData } = useQuery({
    queryKey: ['projects-for-dashboard-filter'],
    queryFn: () => projectService.getAll(),
    enabled: canFilterProjects,
  });
  const projects = projectsData?.data || [];

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard-overview', period, projectId, lang],
    queryFn: () => dashboardService.getOverview(period, projectId || undefined),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 30000,
  });
  const d = data?.data;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>
              <p className="text-sm text-gray-500">{t('dashboard.overview.headerSub')}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md shadow-sm" role="group" aria-label={t('dashboard.overview.period')}>
                {PERIODS.map((p, i) => (
                  <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p} data-testid={`period-${p}`}
                    className={`px-3 py-1.5 text-sm font-medium border ${i === 0 ? 'rounded-l-md' : ''} ${i === PERIODS.length - 1 ? 'rounded-r-md' : ''} ${i > 0 ? '-ml-px' : ''} ${
                      period === p ? 'bg-blue-600 text-white border-blue-600 relative z-10' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                    {t(`dashboard.overview.periods.${p}`)}
                  </button>
                ))}
              </div>
              {canFilterProjects && (
                <SearchSelect value={projectId} onChange={e => setProjectId(e.target.value)} aria-label={t('dashboard.pending.filterProject')}
                  data-testid="dashboard-project-filter"
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[260px]">
                  <option value="">{t('dashboard.pending.allProjects')}</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
                </SearchSelect>
              )}
              <button type="button" onClick={() => refetch()} title={t('common.refresh')}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          {d && (
            <p className="mt-2 text-xs text-gray-500" data-testid="dashboard-scope">
              {t('dashboard.overview.scope', { days: d.periodDays })}
            </p>
          )}
        </div>

        <div className="p-4 sm:p-6 space-y-8">
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <LoadingSpinner size="lg" text={t('dashboard.loading')} />
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              <h3 className="font-semibold">{t('dashboard.loadError')}</h3>
              <p>{t('dashboard.loadErrorMsg')}</p>
              <button onClick={() => refetch()} className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
                {t('common.retry')}
              </button>
            </div>
          ) : d && (
            <>
              <OperationsSection data={d.operations} thresholds={d.thresholds} />
              {d.steering && <SteeringSection data={d.steering} thresholds={d.thresholds} />}
              {d.access?.steering && <PendingTasksByProfile />}
              {d.finance && <FinanceSection data={d.finance} currency={d.currency} />}
              {d.control && <ControlSection data={d.control} />}
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
