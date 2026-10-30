// src/components/Stock/StockEntryList.jsx
// Liste des bons d'entrée hors bon de commande (VIEW_STOCK) : filtres type, dépôt, statut, recherche ; bandeau des bons
// en attente de validation ; bouton « Nouveau bon d'entrée » (RECORD_STOCK_ENTRIES).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackagePlus, Plus, RefreshCw, Search } from 'lucide-react';
import { stockEntryService, warehouseService } from '../../services/stockService';
import { usePermissions } from '../../hooks/usePermissions';
import { EntryStatusBadge, EntryTypeBadge } from './StockEntryDetail';
import { ENTRY_TYPES } from './StockEntryForm';
import { t, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const STATUSES = ['PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED'];

export default function StockEntryList() {
  const { hasPermission } = usePermissions();
  const canRecord = hasPermission('RECORD_STOCK_ENTRIES');
  const canValidate = hasPermission('VALIDATE_STOCK_ENTRIES');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({});
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ search: '', warehouseId: '', status: '', entryType: '' });
  const [debounced, setDebounced] = useState(filters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => { warehouseService.list({ all: 1 }).then(r => setWarehouses(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { const id = setTimeout(() => { setDebounced(filters); setPage(1); }, 300); return () => clearTimeout(id); }, [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const clean = Object.fromEntries(Object.entries(debounced).filter(([, v]) => v));
      const [res, pending] = await Promise.all([
        stockEntryService.list({ ...clean, page, limit: 30 }),
        canValidate ? stockEntryService.list({ status: 'PENDING', limit: 1 }) : null,
      ]);
      setRows(res.data || []);
      setPagination(res.pagination || {});
      setPendingCount(pending?.pagination?.total || 0);
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [debounced, page]);
  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><PackagePlus /> {t('stock.entry.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.entry.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" title={t('common.refresh')} aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          {canRecord && (
            <Link to="/stock/entries/new" className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700" data-testid="entry-new">
              <Plus size={16} /> {t('stock.entry.new')}
            </Link>
          )}
        </div>
      </div>

      {canValidate && pendingCount > 0 && filters.status !== 'PENDING' && (
        <button type="button" onClick={() => setFilters(f => ({ ...f, status: 'PENDING' }))}
          className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900 hover:bg-amber-100" data-testid="entry-pending-banner">
          {t('stock.entry.pendingCount', { count: pendingCount })}
        </button>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={set('search')} placeholder={t('stock.entry.search')} className={`${inputCls} w-full pl-9`} />
        </div>
        <SearchSelect value={filters.entryType} onChange={set('entryType')} className={inputCls} aria-label={t('stock.entry.typeLabel')} data-testid="entry-type-filter">
          <option value="">{t('stock.issue.allTypes')}</option>
          {ENTRY_TYPES.map(([k]) => <option key={k} value={k}>{t(`stock.entry.types.${k}`)}</option>)}
        </SearchSelect>
        <SearchSelect value={filters.warehouseId} onChange={set('warehouseId')} className={inputCls} aria-label={t('stock.warehouse')}>
          <option value="">{t('stock.allWarehouses')}</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name}</option>)}
        </SearchSelect>
        <SearchSelect value={filters.status} onChange={set('status')} className={inputCls} aria-label={t('common.status')} data-testid="entry-status-filter">
          <option value="">{t('stock.issue.allStatuses')}</option>
          {STATUSES.map(s => <option key={s} value={s}>{t(`stock.entry.status.${s}`)}</option>)}
        </SearchSelect>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
          : rows.length === 0 ? <div className="p-10 text-center text-gray-500">{t('stock.entry.none')}</div>
          : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">{t('stock.entry.number')}</th>
                  <th className="px-4 py-2">{t('stock.mv.date')}</th>
                  <th className="px-4 py-2">{t('stock.entry.typeLabel')}</th>
                  <th className="px-4 py-2">{t('stock.entry.originColumn')}</th>
                  <th className="px-4 py-2">{t('stock.warehouse')}</th>
                  <th className="px-4 py-2">{t('stock.issue.items')}</th>
                  <th className="px-4 py-2 text-right">{t('stock.entry.totalValue')}</th>
                  <th className="px-4 py-2">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(r => (
                  <tr key={r.id} className={['CANCELLED', 'REJECTED'].includes(r.status) ? 'text-gray-400' : ''}>
                    <td className="px-4 py-2"><Link to={`/stock/entries/${r.id}`} className="font-mono font-semibold text-blue-600 hover:underline">{r.entry_number}</Link></td>
                    <td className="whitespace-nowrap px-4 py-2">{new Date(r.created_at).toLocaleDateString(getLocale())}</td>
                    <td className="px-4 py-2"><EntryTypeBadge type={r.entry_type} /></td>
                    <td className="px-4 py-2">{r.origin || '—'}{r.reference && <div className="text-xs text-gray-500">{r.reference}</div>}</td>
                    <td className="px-4 py-2">{r.warehouse_name}</td>
                    <td className="max-w-md truncate px-4 py-2" title={r.items}>{t('stock.issue.lineCount', { count: r.line_count })} — {r.items}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">{r.total_value !== null ? `${Number(r.total_value).toLocaleString(getLocale(), { maximumFractionDigits: 2 })} ${r.currency_code || ''}` : '—'}</td>
                    <td className="px-4 py-2"><EntryStatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      {pagination.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded border px-3 py-1 disabled:opacity-40">‹</button>
          <span>{t('common.pageOf', { page, pages: pagination.pages })}</span>
          <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="rounded border px-3 py-1 disabled:opacity-40">›</button>
        </div>
      )}
    </div>
  );
}
