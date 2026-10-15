// src/components/Dashboard/overview/common.jsx
// Briques partagées des volets du tableau de bord (cartes d'indicateur, barres horizontales, statut d'ancienneté).
// Une seule série par graphique (bleu de l'application) ; l'état (retard, blocage) est toujours donné par une icône
// + un libellé, jamais par la couleur seule.
import React from 'react';
import { AlertTriangle, AlertCircle, Clock, CheckCircle2, Info } from 'lucide-react';
import { t, getLocale } from '../../../i18n';

export const BAR_COLOR = '#2563EB';
export const STATUS_COLORS = { critical: '#d03b3b', warning: '#c2410c', good: '#0f7a0f', neutral: '#6B7280' };

export const fmtNumber = (v, digits = 0) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString(getLocale(), { maximumFractionDigits: digits });
export const fmtPercent = (v) => (v === null || v === undefined ? '—' : `${fmtNumber(v, 1)} %`);
export const fmtDays = (v) => (v === null || v === undefined ? '—' : t('dashboard.overview.days', { count: Number(v), value: fmtNumber(v, 1) }));
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale(), { dateStyle: 'short' }) : '—');

/** Ancienneté d'une tâche : en retard ≥ lateDays, bloquée ≥ blockedDays */
export function ageStatus(days, { lateDays = 2, blockedDays = 7 } = {}) {
  if (days >= blockedDays) return { color: STATUS_COLORS.critical, icon: AlertTriangle, label: t('dashboard.overview.status.blocked') };
  if (days >= lateDays) return { color: STATUS_COLORS.warning, icon: AlertCircle, label: t('dashboard.overview.status.late') };
  return { color: STATUS_COLORS.neutral, icon: Clock, label: t('dashboard.overview.status.onTime') };
}

export function StatusTag({ status }) {
  const Icon = status.icon;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap" style={{ color: status.color }}>
      <Icon size={12} aria-hidden="true" /> {status.label}
    </span>
  );
}

/**
 * Carte d'indicateur : valeur principale, définition courte (ce qui est compté) et, au besoin, un état.
 * tone : 'critical' | 'warning' | 'good' → icône + couleur sur la ligne d'état uniquement
 */
export function MetricCard({ label, value, sub, hint, tone, toneLabel, testId }) {
  const ToneIcon = tone === 'critical' ? AlertTriangle : tone === 'warning' ? AlertCircle : tone === 'good' ? CheckCircle2 : null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1 min-w-0" data-testid={testId}>
      <div className="text-sm text-gray-600 flex items-center gap-1">
        <span>{label}</span>
        {hint && <span title={hint} className="text-gray-400 cursor-help shrink-0"><Info size={13} aria-label={hint} /></span>}
      </div>
      <div className="text-2xl font-semibold text-gray-900 tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
      {ToneIcon && toneLabel && (
        <div className="text-xs font-medium flex items-center gap-1" style={{ color: STATUS_COLORS[tone] }}>
          <ToneIcon size={12} aria-hidden="true" /> {toneLabel}
        </div>
      )}
    </div>
  );
}

/** Barres horizontales (série unique) : libellé, barre, valeur au bout ; title = détail au survol */
export function HBarList({ rows, format = (v) => v, testId }) {
  const max = Math.max(1e-9, ...rows.map(r => r.value || 0));
  return (
    <ul className="space-y-2" data-testid={testId}>
      {rows.map(r => (
        <li key={r.key} className="grid grid-cols-12 gap-3 items-center text-sm" title={r.tooltip}>
          <div className="col-span-12 sm:col-span-5 text-gray-800 leading-tight">{r.label}</div>
          <div className="col-span-9 sm:col-span-5 h-3 bg-gray-100 rounded-r" aria-hidden="true">
            <div className="h-3" style={{ width: `${r.value ? Math.max(2, (r.value / max) * 100) : 0}%`, background: BAR_COLOR, borderRadius: '0 4px 4px 0' }} />
          </div>
          <div className="col-span-3 sm:col-span-2 text-right text-gray-900 font-medium tabular-nums whitespace-nowrap">{format(r.value)}</div>
        </li>
      ))}
    </ul>
  );
}

export function Section({ title, subtitle, children, testId, actions }) {
  return (
    <section className="space-y-4" data-testid={testId}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Panel({ title, subtitle, children, testId }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 min-w-0" data-testid={testId}>
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mb-3">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-3'}>{children}</div>
    </div>
  );
}

export const Empty = ({ children }) => <p className="py-4 text-sm text-gray-500 text-center">{children}</p>;
