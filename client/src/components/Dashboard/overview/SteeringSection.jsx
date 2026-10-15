// src/components/Dashboard/overview/SteeringSection.jsx
// Volet « Pilotage » (direction : admin, DG, management, auditeur) : cycle P2P médian, tâches en retard, complétion,
// conversion en commande, livraisons complètes, achats urgents, délais par étape et concentration des fournisseurs.
// Chaque carte dit ce qu'elle compte (périmètre), pour éviter les chiffres mal interprétés.
import React from 'react';
import { Link } from 'react-router-dom';
import { t } from '../../../i18n';
import { useCurrency } from '../../../contexts/EnterpriseContext';
import { MetricCard, Section, Panel, HBarList, StatusTag, ageStatus, Empty, fmtDays, fmtNumber, fmtPercent } from './common';

export default function SteeringSection({ data, thresholds }) {
  const { formatAmount } = useCurrency();
  const { tasks, cycle, completion, conversion, deliveries, urgent, stepDurations, suppliers } = data;

  return (
    <Section title={t('dashboard.overview.steering.title')} subtitle={t('dashboard.overview.steering.subtitle')} testId="dashboard-steering">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard testId="kpi-cycle" label={t('dashboard.overview.steering.cycle')}
          value={fmtDays(cycle.medianDays)}
          sub={cycle.count ? t('dashboard.overview.steering.cycleSub', { mean: fmtDays(cycle.meanDays), count: cycle.count }) : t('dashboard.overview.steering.cycleNone')}
          hint={t('dashboard.overview.steering.cycleHint')} />
        <MetricCard testId="kpi-late-tasks" label={t('dashboard.overview.steering.lateTasks')} value={fmtNumber(tasks.late)}
          sub={t('dashboard.overview.steering.lateTasksSub', { total: tasks.total, days: thresholds.lateDays })}
          tone={tasks.blocked > 0 ? 'critical' : tasks.late > 0 ? 'warning' : null}
          toneLabel={tasks.blocked > 0 ? t('dashboard.overview.operations.blocked', { count: tasks.blocked, days: thresholds.blockedDays }) : t('dashboard.overview.operations.toHandle')} />
        <MetricCard testId="kpi-completion" label={t('dashboard.overview.steering.completion')} value={fmtPercent(completion.rate)}
          sub={t('dashboard.overview.steering.completionSub', { completed: completion.completed, closed: completion.closed, inProgress: completion.inProgress })}
          hint={t('dashboard.overview.steering.completionHint')} />
        <MetricCard testId="kpi-conversion" label={t('dashboard.overview.steering.conversion')} value={fmtPercent(conversion.rate)}
          sub={t('dashboard.overview.steering.conversionSub', { converted: conversion.converted, approved: conversion.approved })}
          hint={t('dashboard.overview.steering.conversionHint')} />
        <MetricCard testId="kpi-deliveries" label={t('dashboard.overview.steering.deliveries')} value={fmtPercent(deliveries.rate)}
          sub={t('dashboard.overview.steering.deliveriesSub', { delivered: deliveries.delivered, closedShort: deliveries.closedShort, inProgress: deliveries.inProgress })}
          hint={t('dashboard.overview.steering.deliveriesHint')} />
        <MetricCard testId="kpi-urgent" label={t('dashboard.overview.steering.urgent')} value={fmtPercent(urgent.rate)}
          sub={t('dashboard.overview.steering.urgentSub', { urgent: urgent.urgent, total: urgent.total })}
          hint={t('dashboard.overview.steering.urgentHint')} />
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
        <Panel title={t('dashboard.overview.steering.stepsTitle')} subtitle={t('dashboard.overview.steering.stepsSub')} testId="steering-steps">
          {stepDurations.length === 0 ? <Empty>{t('dashboard.overview.noData')}</Empty> : (
            <HBarList
              rows={stepDurations.map(s => ({
                key: s.key, label: s.label, value: s.medianDays,
                tooltip: t('dashboard.overview.steering.stepTooltip', { label: s.label, median: fmtDays(s.medianDays), mean: fmtDays(s.meanDays), count: s.count, late: s.lateCount }),
              }))}
              format={fmtDays}
            />
          )}
        </Panel>

        <Panel title={t('dashboard.overview.steering.lateTitle')} subtitle={t('dashboard.overview.steering.lateSub', { days: thresholds.lateDays })} testId="steering-late">
          {tasks.lateList.length === 0 ? <Empty>{t('dashboard.overview.steering.noLate')}</Empty> : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.requisition')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.step')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.delay')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.assignee')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tasks.lateList.map(tk => (
                    <tr key={tk.taskId}>
                      <td className="px-3 py-2">
                        <Link to={`/requisitions/${tk.requisitionId}/tasks?task=${tk.taskId}`} className="text-blue-600 hover:underline font-medium">{tk.requisitionNumber}</Link>
                        <div className="text-xs text-gray-500 truncate max-w-[200px]">{tk.projectName || ''}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-800">{tk.label}</td>
                      <td className="px-3 py-2">
                        <StatusTag status={ageStatus(tk.ageDays, thresholds)} />
                        <div className="text-xs text-gray-500">{t('dashboard.overview.lateBy', { value: tk.lateDays })}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{tk.assignee || <span className="italic text-gray-500">{t('dashboard.overview.nobody')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t('dashboard.overview.steering.suppliersTitle')}
        subtitle={t('dashboard.overview.steering.suppliersSub', { share: fmtPercent(suppliers.top5Share), count: suppliers.suppliers, amount: formatAmount(suppliers.totalAmount || 0) })}
        testId="steering-suppliers">
        {suppliers.top.length === 0 ? <Empty>{t('dashboard.overview.noData')}</Empty> : (
          <HBarList
            rows={suppliers.top.map(s => ({
              key: String(s.supplierId), label: s.name || '—', value: s.share,
              tooltip: t('dashboard.overview.steering.supplierTooltip', { name: s.name, amount: formatAmount(s.amount || 0), orders: s.orders }),
            }))}
            format={fmtPercent}
          />
        )}
      </Panel>
    </Section>
  );
}
