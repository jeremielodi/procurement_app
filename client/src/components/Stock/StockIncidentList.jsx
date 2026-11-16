// src/components/Stock/StockIncidentList.jsx
// Rapports d'incident (migration 68) : onglets « Mes rapports » (détenteur / déclarant), « À valider » (chef de projet,
// intérimaire ou administrateur), « Tous » (VIEW_STOCK). Bandeau des rapports à valider. « Déclarer un incident ».
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ShieldAlert, Plus, RefreshCw, Search } from 'lucide-react';
import { stockIncidentService } from '../../services/stockIncidentService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const filterCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtDate = (d) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T00:00:00` : d).toLocaleDateString(getLocale()) : '—');

export const INCIDENT_TYPES = ['LOST', 'STOLEN', 'DAMAGED'];
export const INCIDENT_STATUSES = ['PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED'];
const STATUS_STYLE = {
  PENDING: 'bg-amber-100 text-amber-800', VALIDATED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800', CANCELLED: 'bg-gray-100 text-gray-600',
};
const TYPE_STYLE = { LOST: 'bg-orange-100 text-orange-800', STOLEN: 'bg-red-100 text-red-800', DAMAGED: 'bg-yellow-100 text-yellow-800' };

export function IncidentStatusBadge({ status }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] || ''}`} data-testid="incident-status">{t(`stockIncidents.status.${status}`)}</span>;
}
export function IncidentTypeBadge({ type }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[type] || ''}`}>{t(`stockIncidents.types.${type}`)}</span>;
}

export default function StockIncidentList() {
  const { hasPermission } = usePermissions();
  const [params, setParams] = useSearchParams();
  const [toValidate, setToValidate] = useState(0);
  const canViewAll = hasPermission('VIEW_STOCK');
  const tabs = ['mine', ...(toValidate > 0 || params.get('scope') === 'toValidate' ? ['toValidate'] : []), ...(canViewAll ? ['all'] : [])];
  const scope = tabs.includes(params.get('scope')) ? params.get('scope') : 'mine';
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({ search: '', status: '', type: '' });
  const [debounced, setDebounced] = useState(filters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => { stockIncidentService.counts().then(r => setToValidate(r.data?.toValidate || 0)).catch(() => {}); }, []);
  useEffect(() => { const id = setTimeout(() => { setDebounced(filters); setPage(1); }, 300); return () => clearTimeout(id); }, [filters]);
  const load = async () => {
    setLoading(true);
    try {
      const res = await stockIncidentService.list({
        scope, search: debounced.search || undefined, status: debounced.status || undefined, type: debounced.type || undefined, page, limit: 30,
      });
      setRows(res.data || []);
      setPagination(res.pagination || {});
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [scope, debounced, page]);
  const setScope = (s) => { setPage(1); setParams(s === 'mine' ? {} : { scope: s }, { replace: true }); };
  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ShieldAlert /> {t('stockIncidents.title')}</h1>
          <p className="text-sm text-gray-500">{t('stockIncidents.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          <Link to="/stock/incidents/new" className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700" data-testid="incident-new">
            <Plus size={16} /> {t('stockIncidents.new')}
          </Link>
        </div>
      </div>

      {toValidate > 0 && scope !== 'toValidate' && (
        <button onClick={() => setScope('toValidate')} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 hover:bg-amber-100" data-testid="incident-banner">
          {t('stockIncidents.bannerToValidate', { count: toValidate })}
        </button>
      )}

      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200">
        {tabs.map(s => (
          <button key={s} onClick={() => setScope(s)} data-testid={`incident-tab-${s}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${scope === s ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t(`stockIncidents.tabs.${s}`)}
            {s === 'toValidate' && toValidate > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">{toValidate}</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={set('search')} placeholder={t('stockIncidents.searchPlaceholder')} className={`${filterCls} w-full pl-9`} />
        </div>
        <SearchSelect value={filters.type} onChange={set('type')} className={filterCls} aria-label={t('stockIncidents.type')} data-testid="incident-type-filter">
          <option value="">{t('stockIncidents.allTypes')}</option>
          {INCIDENT_TYPES.map(k => <option key={k} value={k}>{t(`stockIncidents.types.${k}`)}</option>)}
        </SearchSelect>
        <SearchSelect value={filters.status} onChange={set('status')} className={filterCls} aria-label={t('common.status')}>
          <option value="">{t('stockIncidents.allStatuses')}</option>
          {INCIDENT_STATUSES.map(s => <option key={s} value={s}>{t(`stockIncidents.status.${s}`)}</option>)}
        </SearchSelect>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('stockIncidents.number')}</th>
              <th className="px-4 py-2">{t('stockIncidents.incidentDate')}</th>
              <th className="px-4 py-2">{t('stockIncidents.type')}</th>
              <th className="px-4 py-2">{t('stockIncidents.holder')}</th>
              <th className="px-4 py-2">{t('stockIncidents.items')}</th>
              <th className="px-4 py-2">{t('stockIncidents.project')}</th>
              <th className="px-4 py-2">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="p-8 text-center"><RefreshCw className="mx-auto animate-spin text-blue-500" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-gray-500">{t('stockIncidents.none')}</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50" data-testid="incident-row">
                <td className="whitespace-nowrap px-4 py-2 font-mono font-semibold"><Link to={`/stock/incidents/${r.id}`} className="text-blue-600 hover:underline">{r.incident_number}</Link></td>
                <td className="whitespace-nowrap px-4 py-2">{fmtDate(r.incident_date)}</td>
                <td className="px-4 py-2"><IncidentTypeBadge type={r.incident_type} /></td>
                <td className="px-4 py-2">{r.holder_name}</td>
                <td className="max-w-xs truncate px-4 py-2" title={r.items}>{t('stock.issue.lineCount', { count: r.line_count })} — {r.items}</td>
                <td className="px-4 py-2">{r.project_code || '—'}</td>
                <td className="px-4 py-2">
                  <IncidentStatusBadge status={r.status} />
                  {r.status === 'VALIDATED' && <div className={`mt-0.5 text-xs ${r.employee_liable ? 'text-red-700' : 'text-gray-500'}`}>{t(r.employee_liable ? 'stockIncidents.liableShort' : 'stockIncidents.notLiableShort')}</div>}
                </td>
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
