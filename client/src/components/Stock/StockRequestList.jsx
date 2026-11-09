// src/components/Stock/StockRequestList.jsx
// Demandes au magasin (migration 56) : onglets « Mes demandes » (tout utilisateur), « À valider » (validateurs),
// « À servir » (magasiniers : ISSUE_STOCK + accès au dépôt), « Toutes » (VIEW_STOCK). Bandeau des demandes en attente.
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, Plus, RefreshCw, Search } from 'lucide-react';
import { stockRequestService } from '../../services/stockRequestService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale()) : '—');
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);

export const REQUEST_STATUSES = ['PENDING_VALIDATION', 'TO_SERVE', 'PARTIALLY_SERVED', 'SERVED', 'REJECTED', 'CANCELLED', 'CLOSED'];
const STATUS_STYLE = {
  PENDING_VALIDATION: 'bg-amber-100 text-amber-800',
  TO_SERVE: 'bg-blue-100 text-blue-800',
  PARTIALLY_SERVED: 'bg-indigo-100 text-indigo-800',
  SERVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-600',
  CLOSED: 'bg-gray-200 text-gray-700',
};

export function RequestStatusBadge({ status }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] || ''}`} data-testid="request-status">{t(`stockRequests.status.${status}`)}</span>;
}

export default function StockRequestList() {
  const { hasPermission } = usePermissions();
  const [params, setParams] = useSearchParams();
  const [counts, setCounts] = useState({ toValidate: 0, toServe: 0 });
  const canServe = hasPermission('ISSUE_STOCK');
  const canViewAll = hasPermission('VIEW_STOCK');
  const tabs = [
    'mine',
    ...(counts.toValidate > 0 || params.get('scope') === 'toValidate' ? ['toValidate'] : []),
    ...(canServe ? ['toServe'] : []),
    ...(canViewAll ? ['all'] : []),
  ];
  const scope = tabs.includes(params.get('scope')) ? params.get('scope') : 'mine';
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [debounced, setDebounced] = useState(filters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => { stockRequestService.counts().then(r => setCounts(r.data || {})).catch(() => {}); }, []);
  useEffect(() => { const id = setTimeout(() => { setDebounced(filters); setPage(1); }, 300); return () => clearTimeout(id); }, [filters]);
  const load = async () => {
    setLoading(true);
    try {
      const res = await stockRequestService.list({ scope, search: debounced.search || undefined, status: debounced.status || undefined, page, limit: 30 });
      setRows(res.data || []);
      setPagination(res.pagination || {});
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [scope, debounced, page]);
  const setScope = (s) => { setPage(1); setParams(s === 'mine' ? {} : { scope: s }, { replace: true }); };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ClipboardList /> {t('stockRequests.title')}</h1>
          <p className="text-sm text-gray-500">{t('stockRequests.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          <Link to="/stock/requests/new" className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700" data-testid="request-new">
            <Plus size={16} /> {t('stockRequests.new')}
          </Link>
        </div>
      </div>

      {(counts.toValidate > 0 || counts.toServe > 0) && (
        <div className="flex flex-wrap gap-3" data-testid="request-banners">
          {counts.toValidate > 0 && (
            <button onClick={() => setScope('toValidate')} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 hover:bg-amber-100">
              {t('stockRequests.bannerToValidate', { count: counts.toValidate })}
            </button>
          )}
          {counts.toServe > 0 && (
            <button onClick={() => setScope('toServe')} className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900 hover:bg-blue-100">
              {t('stockRequests.bannerToServe', { count: counts.toServe })}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200">
        {tabs.map(s => (
          <button key={s} onClick={() => setScope(s)} data-testid={`request-tab-${s}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${scope === s ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t(`stockRequests.tabs.${s}`)}
            {s === 'toValidate' && counts.toValidate > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">{counts.toValidate}</span>}
            {s === 'toServe' && counts.toServe > 0 && <span className="ml-1 rounded-full bg-blue-600 px-1.5 text-xs text-white">{counts.toServe}</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} placeholder={t('stockRequests.searchPlaceholder')} className={`${inputCls} w-full pl-9`} />
        </div>
        <SearchSelect value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className={inputCls} aria-label={t('stockRequests.statusLabel')}>
          <option value="">{t('stockRequests.allStatuses')}</option>
          {REQUEST_STATUSES.map(s => <option key={s} value={s}>{t(`stockRequests.status.${s}`)}</option>)}
        </SearchSelect>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('stockRequests.number')}</th>
              <th className="px-4 py-2">{t('common.date')}</th>
              {scope !== 'mine' && <th className="px-4 py-2">{t('stockRequests.requester')}</th>}
              <th className="px-4 py-2">{t('stock.warehouse')}</th>
              <th className="px-4 py-2">{t('stockRequests.items')}</th>
              <th className="px-4 py-2 text-right">{t('stockRequests.served')}</th>
              <th className="px-4 py-2">{t('stockRequests.statusLabel')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="p-8 text-center"><RefreshCw className="mx-auto animate-spin text-blue-500" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-gray-500">{t('stockRequests.none')}</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50" data-testid="request-row">
                <td className="px-4 py-2 whitespace-nowrap font-mono font-semibold"><Link to={`/stock/requests/${r.id}`} className="text-blue-600 hover:underline">{r.request_number}</Link></td>
                <td className="px-4 py-2 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                {scope !== 'mine' && <td className="px-4 py-2">{r.requester_name}</td>}
                <td className="px-4 py-2">{r.warehouse_name}</td>
                <td className="px-4 py-2 max-w-xs truncate" title={r.items}>{r.items}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{fmtQty(r.served_total)} / {fmtQty(r.validated_total)}</td>
                <td className="px-4 py-2"><RequestStatusBadge status={r.status} /></td>
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
