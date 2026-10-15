// src/components/Dashboard/overview/OperationsSection.jsx
// Volet « Opérations » (tous les profils) : mes tâches GoFlow en attente, celles en retard (≥ 2 jours dans l'étape
// actuelle) et la liste « À traiter aujourd'hui » — chaque ligne ouvre la tâche dans l'onglet de sa réquisition.
import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { t } from '../../../i18n';
import { MetricCard, Section, Panel, StatusTag, ageStatus, fmtDate, fmtNumber, STATUS_COLORS } from './common';

export default function OperationsSection({ data, thresholds }) {
  const { lateDays } = thresholds;
  return (
    <Section title={t('dashboard.overview.operations.title')} subtitle={t('dashboard.overview.operations.subtitle', { days: lateDays })} testId="dashboard-operations">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard testId="ops-total" label={t('dashboard.overview.operations.total')} value={fmtNumber(data.total)}
          sub={t('dashboard.overview.operations.totalSub')} />
        <MetricCard testId="ops-late" label={t('dashboard.overview.operations.late')} value={fmtNumber(data.late)}
          sub={t('dashboard.overview.operations.lateSub', { days: lateDays })}
          tone={data.blocked > 0 ? 'critical' : data.late > 0 ? 'warning' : data.total > 0 ? 'good' : null}
          toneLabel={data.blocked > 0 ? t('dashboard.overview.operations.blocked', { count: data.blocked, days: thresholds.blockedDays })
            : data.late > 0 ? t('dashboard.overview.operations.toHandle') : t('dashboard.overview.operations.allOnTime')} />
        <MetricCard testId="ops-claimed" label={t('dashboard.overview.operations.claimedByMe')} value={fmtNumber(data.claimedByMe)}
          sub={t('dashboard.overview.operations.unclaimed', { count: data.unclaimed })} />
        <MetricCard testId="ops-oldest" label={t('dashboard.overview.operations.oldest')}
          value={data.total ? t('dashboard.overview.daysShort', { value: data.oldestAgeDays }) : '—'}
          sub={t('dashboard.overview.operations.oldestSub')} />
      </div>

      <Panel title={t('dashboard.overview.operations.todayTitle')} subtitle={t('dashboard.overview.operations.todaySub')} testId="ops-tasks">
        {data.tasks.length === 0 ? (
          <p className="py-4 text-sm text-center flex items-center justify-center gap-2" style={{ color: STATUS_COLORS.good }}>
            <CheckCircle2 size={16} /> {t('dashboard.overview.operations.none')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.requisition')}</th>
                  <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.step')}</th>
                  <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.project')}</th>
                  <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.since')}</th>
                  <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.delay')}</th>
                  <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.assignee')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.tasks.map(tk => (
                  <tr key={tk.taskId} data-testid="ops-task-row">
                    <td className="px-3 py-2">
                      <Link to={`/requisitions/${tk.requisitionId}/tasks?task=${tk.taskId}`} className="text-blue-600 hover:underline font-medium">{tk.requisitionNumber}</Link>
                      <div className="text-xs text-gray-500 truncate max-w-[240px]">{tk.requisitionTitle}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-800">{tk.label}</td>
                    <td className="px-3 py-2 text-gray-700">{tk.projectName || '—'}</td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                      {fmtDate(tk.since)} <span className="text-gray-500">({t('dashboard.overview.daysShort', { value: tk.ageDays })})</span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusTag status={ageStatus(tk.ageDays, thresholds)} />
                      {tk.lateDays > 0 && <div className="text-xs text-gray-500">{t('dashboard.overview.lateBy', { value: tk.lateDays })}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{tk.assignee || <span className="italic text-gray-500">{t('dashboard.overview.nobody')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.total > data.tasks.length && (
              <p className="mt-2 text-xs text-gray-500">
                {t('dashboard.overview.operations.more', { shown: data.tasks.length, total: data.total })} <Link to="/tasks" className="text-blue-600 hover:underline">{t('dashboard.overview.operations.allTasks')}</Link>
              </p>
            )}
          </div>
        )}
      </Panel>
    </Section>
  );
}
