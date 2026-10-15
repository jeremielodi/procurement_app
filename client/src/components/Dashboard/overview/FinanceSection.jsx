// src/components/Dashboard/overview/FinanceSection.jsx
// Volet « Finance » (MANAGE_BUDGET : finance, admin ; AUDIT_ACCESS : auditeur) : budget consommé = montant PAYÉ
// (cumul) / budget alloué, engagements ouverts (commandes actives restant à payer), délai de paiement, factures à payer,
// budget par projet. Montants dans la devise de l'entreprise uniquement.
import React from 'react';
import { t } from '../../../i18n';
import { useCurrency } from '../../../contexts/EnterpriseContext';
import { MetricCard, Section, Panel, Empty, fmtDays, fmtNumber, fmtPercent, BAR_COLOR } from './common';

export default function FinanceSection({ data, currency }) {
  const { formatAmount } = useCurrency();
  const { budget, commitments, paymentDelay, invoices, byProject } = data;

  return (
    <Section title={t('dashboard.overview.finance.title')} subtitle={t('dashboard.overview.finance.subtitle', { currency })} testId="dashboard-finance">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard testId="kpi-budget" label={t('dashboard.overview.finance.budget')} value={fmtPercent(budget.rate)}
          sub={t('dashboard.overview.finance.budgetSub', { paid: formatAmount(budget.paid || 0), allocated: formatAmount(budget.allocated || 0) })}
          hint={t('dashboard.overview.finance.budgetHint')}
          tone={budget.otherCurrencyCount > 0 ? 'warning' : null}
          toneLabel={t('dashboard.overview.finance.otherCurrency', { count: budget.otherCurrencyCount })} />
        <MetricCard testId="kpi-commitments" label={t('dashboard.overview.finance.commitments')} value={formatAmount(commitments.amount || 0)}
          sub={t('dashboard.overview.finance.commitmentsSub', { count: commitments.orders })}
          hint={t('dashboard.overview.finance.commitmentsHint')} />
        <MetricCard testId="kpi-payment-delay" label={t('dashboard.overview.finance.paymentDelay')} value={fmtDays(paymentDelay.medianDays)}
          sub={paymentDelay.count ? t('dashboard.overview.finance.paymentDelaySub', { mean: fmtDays(paymentDelay.meanDays), count: paymentDelay.count }) : t('dashboard.overview.finance.noPayment')}
          hint={t('dashboard.overview.finance.paymentDelayHint')} />
        <MetricCard testId="kpi-invoices" label={t('dashboard.overview.finance.invoices')} value={fmtNumber(invoices.count)}
          sub={t('dashboard.overview.finance.invoicesSub', { amount: formatAmount(invoices.amount || 0) })}
          tone={invoices.overdue > 0 ? 'warning' : null}
          toneLabel={t('dashboard.overview.finance.overdue', { count: invoices.overdue })} />
      </div>

      <Panel title={t('dashboard.overview.finance.byProjectTitle')} subtitle={t('dashboard.overview.finance.byProjectSub')} testId="finance-projects">
        {byProject.length === 0 ? <Empty>{t('dashboard.overview.noData')}</Empty> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">{t('dashboard.overview.col.project')}</th>
                  <th className="text-right px-3 py-2 font-medium">{t('dashboard.overview.finance.allocated')}</th>
                  <th className="text-right px-3 py-2 font-medium">{t('dashboard.overview.finance.paid')}</th>
                  <th className="text-left px-3 py-2 font-medium w-1/3">{t('dashboard.overview.finance.consumed')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {byProject.map(p => (
                  <tr key={p.projectId}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{p.code}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[260px]">{p.name}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatAmount(p.allocated || 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatAmount(p.paid || 0)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2" title={t('dashboard.overview.finance.projectTooltip', { rate: fmtPercent(p.rate) })}>
                        <div className="flex-1 h-2.5 bg-gray-100 rounded-r" aria-hidden="true">
                          <div className="h-2.5" style={{ width: `${Math.min(100, p.rate || 0)}%`, background: BAR_COLOR, borderRadius: '0 4px 4px 0' }} />
                        </div>
                        <span className="text-xs text-gray-900 tabular-nums w-14 text-right whitespace-nowrap">{fmtPercent(p.rate)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Section>
  );
}
