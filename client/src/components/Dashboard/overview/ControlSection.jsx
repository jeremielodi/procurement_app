// src/components/Dashboard/overview/ControlSection.jsx
// Volet « Contrôle » (auditeur, admin) : rejets et renvois par étape d'approbation, mise en concurrence (méthodes
// d'achat choisies), écarts du rapprochement à 3 voies, tentatives bloquées par le contrôle interne (journal d'audit).
import React from 'react';
import { Link } from 'react-router-dom';
import { t } from '../../../i18n';
import { useCurrency } from '../../../contexts/EnterpriseContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { MetricCard, Section, Panel, HBarList, Empty, fmtDate, fmtNumber, fmtPercent } from './common';

export default function ControlSection({ data }) {
  const { formatAmount } = useCurrency();
  const { hasPermission } = usePermissions();
  const { decisions, methods, discrepancies, blocked } = data;

  return (
    <Section title={t('dashboard.overview.control.title')} subtitle={t('dashboard.overview.control.subtitle')} testId="dashboard-control">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard testId="kpi-rejection" label={t('dashboard.overview.control.rejection')} value={fmtPercent(decisions.rate)}
          sub={t('dashboard.overview.control.rejectionSub', { rejected: decisions.rejected, returned: decisions.returned, decisions: decisions.decisions })}
          hint={t('dashboard.overview.control.rejectionHint')}
          tone={decisions.returnedSeveralTimes > 0 ? 'warning' : null}
          toneLabel={t('dashboard.overview.control.returnedSeveral', { count: decisions.returnedSeveralTimes })} />
        <MetricCard testId="kpi-competition" label={t('dashboard.overview.control.competition')} value={fmtPercent(methods.competitiveRate)}
          sub={t('dashboard.overview.control.competitionSub', { competitive: methods.competitive, total: methods.total, sole: methods.soleSource })}
          hint={t('dashboard.overview.control.competitionHint')} />
        <MetricCard testId="kpi-discrepancies" label={t('dashboard.overview.control.discrepancies')} value={fmtNumber(discrepancies.count)}
          sub={t('dashboard.overview.control.discrepanciesSub', { count: discrepancies.unpaid })}
          tone={discrepancies.unpaid > 0 ? 'warning' : null} toneLabel={t('dashboard.overview.control.toCheck')} />
        <MetricCard testId="kpi-blocked" label={t('dashboard.overview.control.blocked')} value={fmtNumber(blocked.total)}
          sub={t('dashboard.overview.control.blockedSub')} hint={t('dashboard.overview.control.blockedHint')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title={t('dashboard.overview.control.decisionsTitle')} subtitle={t('dashboard.overview.control.decisionsSub')} testId="control-decisions">
          {decisions.steps.length === 0 ? <Empty>{t('dashboard.overview.noData')}</Empty> : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.step')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('dashboard.overview.control.colDecisions')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('dashboard.overview.control.colRejected')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('dashboard.overview.control.colReturned')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('dashboard.overview.control.colRate')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {decisions.steps.map(s => (
                    <tr key={s.key}>
                      <td className="px-3 py-2 text-gray-800">{s.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.decisions}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.rejected}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.returned}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap">{fmtPercent(s.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={t('dashboard.overview.control.methodsTitle')} subtitle={t('dashboard.overview.control.methodsSub')} testId="control-methods">
          {methods.byMethod.length === 0 ? <Empty>{t('dashboard.overview.noData')}</Empty> : (
            <HBarList
              rows={methods.byMethod.map(m => ({
                key: m.method, label: m.label, // libellé traduit par le serveur (langue de la requête)
                value: m.share, tooltip: t('dashboard.overview.control.methodTooltip', { count: m.count, share: fmtPercent(m.share) }),
              }))}
              format={fmtPercent}
            />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 min-w-0">
          <Panel title={t('dashboard.overview.control.discrepanciesTitle')} subtitle={t('dashboard.overview.control.discrepanciesListSub')} testId="control-discrepancies">
            {discrepancies.list.length === 0 ? <Empty>{t('dashboard.overview.control.noDiscrepancy')}</Empty> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.control.colInvoice')}</th>
                      <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.control.colSupplier')}</th>
                      <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.control.colGap')}</th>
                      <th className="text-right px-3 py-2 font-medium">{t('dashboard.overview.control.colAmount')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {discrepancies.list.map(d => (
                      <tr key={d.invoiceId}>
                        <td className="px-3 py-2">
                          <Link to={`/invoices/${d.invoiceId}`} className="text-blue-600 hover:underline font-medium">{d.invoiceNumber}</Link>
                          <div className="text-xs text-gray-500">{d.poNumber} · {fmtDate(d.invoiceDate)}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{d.supplierName || '—'}</td>
                        <td className="px-3 py-2 text-gray-800">{t(`matchStatus.${d.matchStatus}`)}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatAmount(d.amount || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <Panel title={t('dashboard.overview.control.blockedTitle')} subtitle={t('dashboard.overview.control.blockedListSub')} testId="control-blocked">
          <ul className="divide-y divide-gray-100 text-sm">
            {blocked.byAction.map(b => (
              <li key={b.action} className="flex items-center justify-between gap-2 py-2">
                <span className="text-gray-800">{t(`audit.actions.${b.action}`)}</span>
                <span className="font-medium tabular-nums">{b.count}</span>
              </li>
            ))}
          </ul>
          {hasPermission('VIEW_AUDIT_LOGS') && (
            <Link to="/admin/audit" className="mt-2 inline-block text-xs text-blue-600 hover:underline">{t('dashboard.overview.control.openAudit')}</Link>
          )}
        </Panel>
      </div>
    </Section>
  );
}
