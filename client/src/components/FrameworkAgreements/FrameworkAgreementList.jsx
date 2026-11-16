// src/components/FrameworkAgreements/FrameworkAgreementList.jsx
// Registre des accords-cadres (migration 69) : onglets « Tous » (VIEW_FRAMEWORK_AGREEMENTS), « À valider » (chef de
// projet concerné, puis directeur général), « Mes validations » (sans droit de lecture : contrats où l'on intervient).
// Consommé / plafond, jours restants, filtres statut / fournisseur / recherche. « Nouvel accord-cadre » (MANAGE).
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileSignature, Plus, RefreshCw, Search } from 'lucide-react';
import { frameworkAgreementService } from '../../services/frameworkAgreementService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const filterCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
export const fmtDate = (d) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T00:00:00` : d).toLocaleDateString(getLocale()) : '—');
export const fmtMoney = (n, currency) => {
  const v = new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
  return currency ? `${v} ${currency}` : v;
};

export const AGREEMENT_STATUSES = ['DRAFT', 'PENDING_VALIDATION', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CLOSED', 'CANCELLED'];
const STATUS_STYLE = {
  DRAFT: 'bg-gray-100 text-gray-700', PENDING_VALIDATION: 'bg-amber-100 text-amber-800', ACTIVE: 'bg-green-100 text-green-800',
  EXPIRED: 'bg-orange-100 text-orange-800', SUSPENDED: 'bg-yellow-100 text-yellow-800', CLOSED: 'bg-slate-200 text-slate-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

export function AgreementStatusBadge({ status }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] || ''}`} data-testid="agreement-status">{t(`frameworkAgreements.status.${status}`)}</span>;
}

/** Barre consommé / plafond (rouge ≥ 100 %, orange ≥ 80 %) */
export function ConsumptionBar({ percent }) {
  const p = Math.max(0, Number(percent) || 0);
  const color = p >= 100 ? 'bg-red-500' : p >= 80 ? 'bg-orange-400' : 'bg-blue-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200" title={`${p} %`}>
      <div className={`h-full ${color}`} style={{ width: `${Math.min(p, 100)}%` }} />
    </div>
  );
}

/** Message d'erreur traduit d'une réponse de l'API (code → frameworkAgreements.err.*) */
export function agreementError(err) {
  const body = err?.response?.data || {};
  if (body.code) {
    const key = `frameworkAgreements.err.${body.code}`;
    const details = body.details || {};
    const msg = t(key, { ...details, projects: (details.projects || []).join(', '), line: body.line !== undefined ? body.line + 1 : '' });
    if (msg !== key) return body.line !== undefined ? `${t('frameworkAgreements.lineN', { n: body.line + 1 })} : ${msg}` : msg;
  }
  return body.message || err?.message || t('common.error');
}

export default function FrameworkAgreementList() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('MANAGE_FRAMEWORK_AGREEMENTS');
  const canViewAll = hasPermission(['VIEW_FRAMEWORK_AGREEMENTS', 'MANAGE_FRAMEWORK_AGREEMENTS']);
  const [params, setParams] = useSearchParams();
  const [toValidate, setToValidate] = useState(0);
  const tabs = [...(canViewAll ? ['all'] : ['involved']), ...(toValidate > 0 || params.get('scope') === 'toValidate' ? ['toValidate'] : [])];
  const scope = tabs.includes(params.get('scope')) ? params.get('scope') : tabs[0];
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [debounced, setDebounced] = useState(filters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => { frameworkAgreementService.counts().then(r => setToValidate(r.data?.toValidate || 0)).catch(() => {}); }, []);
  useEffect(() => { const id = setTimeout(() => { setDebounced(filters); setPage(1); }, 300); return () => clearTimeout(id); }, [filters]);
  const load = async () => {
    setLoading(true);
    try {
      const res = await frameworkAgreementService.list({ scope, search: debounced.search || undefined, status: debounced.status || undefined, page, limit: 30 });
      setRows(res.data || []);
      setPagination(res.pagination || {});
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [scope, debounced, page]);
  const setScope = (s) => { setPage(1); setParams(s === tabs[0] ? {} : { scope: s }, { replace: true }); };
  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><FileSignature /> {t('frameworkAgreements.title')}</h1>
          <p className="text-sm text-gray-500">{t('frameworkAgreements.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          {canManage && (
            <Link to="/framework-agreements/new" className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700" data-testid="agreement-new">
              <Plus size={16} /> {t('frameworkAgreements.new')}
            </Link>
          )}
        </div>
      </div>

      {toValidate > 0 && scope !== 'toValidate' && (
        <button onClick={() => setScope('toValidate')} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 hover:bg-amber-100" data-testid="agreement-banner">
          {t('frameworkAgreements.bannerToValidate', { count: toValidate })}
        </button>
      )}

      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200">
        {tabs.map(s => (
          <button key={s} onClick={() => setScope(s)} data-testid={`agreement-tab-${s}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${scope === s ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t(`frameworkAgreements.tabs.${s}`)}
            {s === 'toValidate' && toValidate > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">{toValidate}</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={set('search')} placeholder={t('frameworkAgreements.searchPlaceholder')} className={`${filterCls} w-full pl-9`} data-testid="agreement-search" />
        </div>
        <SearchSelect value={filters.status} onChange={set('status')} className={filterCls} aria-label={t('common.status')} data-testid="agreement-status-filter">
          <option value="">{t('frameworkAgreements.allStatuses')}</option>
          {AGREEMENT_STATUSES.map(s => <option key={s} value={s}>{t(`frameworkAgreements.status.${s}`)}</option>)}
        </SearchSelect>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('frameworkAgreements.number')}</th>
              <th className="px-4 py-2">{t('frameworkAgreements.contract')}</th>
              <th className="px-4 py-2">{t('frameworkAgreements.supplier')}</th>
              <th className="px-4 py-2">{t('frameworkAgreements.period')}</th>
              <th className="px-4 py-2">{t('frameworkAgreements.projects')}</th>
              <th className="min-w-[180px] px-4 py-2">{t('frameworkAgreements.consumption')}</th>
              <th className="px-4 py-2">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="p-8 text-center"><RefreshCw className="mx-auto animate-spin text-blue-500" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-gray-500">{t('frameworkAgreements.none')}</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50" data-testid="agreement-row">
                <td className="whitespace-nowrap px-4 py-2 font-mono font-semibold"><Link to={`/framework-agreements/${r.id}`} className="text-blue-600 hover:underline">{r.agreement_number}</Link></td>
                <td className="max-w-xs px-4 py-2">
                  <div className="truncate font-medium" title={r.title}>{r.title}</div>
                  {r.contract_reference && <div className="text-xs text-gray-500">{r.contract_reference}</div>}
                </td>
                <td className="px-4 py-2">{r.supplier_name}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs">
                  {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                  {r.effective_status === 'ACTIVE' && r.days_left <= 30 && <div className="text-orange-600">{t('frameworkAgreements.daysLeft', { count: r.days_left })}</div>}
                </td>
                <td className="px-4 py-2 text-xs">{r.projects?.length ? r.projects.map(p => p.code).join(', ') : <span className="text-gray-500">{t('frameworkAgreements.allProjects')}</span>}</td>
                <td className="px-4 py-2">
                  <div className="mb-1 flex justify-between gap-2 text-xs">
                    <span>{fmtMoney(r.consumed_amount)} / {fmtMoney(r.ceiling_amount, r.currency_code)}</span>
                    <span className="text-gray-500">{r.consumed_percent} %</span>
                  </div>
                  <ConsumptionBar percent={r.consumed_percent} />
                </td>
                <td className="px-4 py-2"><AgreementStatusBadge status={r.effective_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded border px-3 py-1 disabled:opacity-40">{t('common.previous')}</button>
          <span>{page} / {pagination.pages}</span>
          <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="rounded border px-3 py-1 disabled:opacity-40">{t('common.next')}</button>
        </div>
      )}
    </div>
  );
}
