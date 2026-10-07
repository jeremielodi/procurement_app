// src/components/Stock/StockIssueList.jsx
// Liste des bons de sortie (mode « stock » : VIEW_STOCK) ou de mes articles reçus (mode « mine » : tout utilisateur).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageMinus, Plus, RefreshCw, Search, Inbox } from 'lucide-react';
import { stockIssueService, warehouseService, equipmentService } from '../../services/stockService';
import { usePermissions } from '../../hooks/usePermissions';
import { IssueStatusBadge } from './StockIssueDetail';
import { t, getLocale } from '../../i18n';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function StockIssueList({ mine = false }) {
  const { hasPermission } = usePermissions();
  const canIssue = !mine && hasPermission('ISSUE_STOCK');
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({});
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ search: '', warehouseId: '', status: '' });
  const [debounced, setDebounced] = useState(filters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const base = mine ? '/my-items' : '/stock/issues';
  const [holdings, setHoldings] = useState([]);
  useEffect(() => { if (mine) equipmentService.myHoldings().then(r => setHoldings(r.data || [])).catch(() => {}); }, [mine]);

  useEffect(() => { if (!mine) warehouseService.list({ all: 1 }).then(r => setWarehouses(r.data || [])).catch(() => {}); }, [mine]);
  useEffect(() => { const id = setTimeout(() => { setDebounced(filters); setPage(1); }, 300); return () => clearTimeout(id); }, [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const clean = Object.fromEntries(Object.entries(debounced).filter(([, v]) => v));
      const res = await stockIssueService.list({ ...clean, ...(mine ? { mine: 1 } : {}), page, limit: 30 });
      setRows(res.data || []);
      setPagination(res.pagination || {});
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [debounced, page, mine]);
  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));
  const pendingAck = mine ? rows.filter(r => r.status === 'ISSUED' && !r.acknowledged_at).length : 0;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">{mine ? <Inbox /> : <PackageMinus />} {mine ? t('stock.issue.myTitle') : t('stock.issue.title')}</h1>
          <p className="text-sm text-gray-500">{mine ? t('stock.issue.mySubtitle') : t('stock.issue.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" title={t('common.refresh')} aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          {canIssue && (
            <Link to="/stock/issues/new" className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700" data-testid="issue-new">
              <Plus size={16} /> {t('stock.issue.new')}
            </Link>
          )}
        </div>
      </div>

      {pendingAck > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('stock.issue.pendingAck', { count: pendingAck })}</div>}

      {mine && holdings.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-blue-200 bg-white" data-testid="my-holdings">
          <h2 className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-900">{t('stock.return.inMyPossession')}</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {holdings.map(h => (
                <tr key={h.issue_line_id}>
                  <td className="px-4 py-2"><span className="mr-1 font-mono font-semibold">{h.item_code}</span>{h.item_name}
                    {h.serial_number && <span className="ml-2 font-mono text-xs text-indigo-700">{t('stock.equipment.serialLabel', { serial: h.serial_number })}</span>}
                  </td>
                  <td className="px-4 py-2 text-right">{new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(h.remaining)} <span className="text-xs text-gray-400">{h.unit}</span></td>
                  <td className="px-4 py-2 text-xs text-gray-500"><Link to={`/my-items/${h.issue_id}`} className="text-blue-600 hover:underline">{h.issue_number}</Link> · {new Date(h.issued_at).toLocaleDateString(getLocale())}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-gray-500">{t('stock.return.possessionHint')}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={set('search')} placeholder={t('stock.issue.search')} className={`${inputCls} w-full pl-9`} />
        </div>
        {!mine && (
          <select value={filters.warehouseId} onChange={set('warehouseId')} className={inputCls} aria-label={t('stock.warehouse')}>
            <option value="">{t('stock.allWarehouses')}</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name}</option>)}
          </select>
        )}
        <select value={filters.status} onChange={set('status')} className={inputCls} aria-label={t('common.status')}>
          <option value="">{t('stock.issue.allStatuses')}</option>
          <option value="ISSUED">{t('stock.issue.status.ISSUED')}</option>
          <option value="CANCELLED">{t('stock.issue.status.CANCELLED')}</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
          : rows.length === 0 ? <div className="p-10 text-center text-gray-500">{mine ? t('stock.issue.myNone') : t('stock.issue.none')}</div>
          : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">{t('stock.issue.number')}</th>
                  <th className="px-4 py-2">{t('stock.mv.date')}</th>
                  {!mine && <th className="px-4 py-2">{t('stock.issue.recipient')}</th>}
                  <th className="px-4 py-2">{t('stock.warehouse')}</th>
                  <th className="px-4 py-2">{t('stock.issue.items')}</th>
                  <th className="px-4 py-2">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(r => (
                  <tr key={r.id} className={r.status === 'CANCELLED' ? 'text-gray-400' : ''}>
                    <td className="px-4 py-2"><Link to={`${base}/${r.id}`} className="font-mono font-semibold text-blue-600 hover:underline">{r.issue_number}</Link></td>
                    <td className="whitespace-nowrap px-4 py-2">{new Date(r.issued_at).toLocaleDateString(getLocale())}</td>
                    {!mine && <td className="px-4 py-2">{r.recipient_name}</td>}
                    <td className="px-4 py-2">{r.warehouse_name}</td>
                    <td className="max-w-md truncate px-4 py-2" title={r.items}>{t('stock.issue.lineCount', { count: r.line_count })} — {r.items}</td>
                    <td className="px-4 py-2"><IssueStatusBadge issue={r} /></td>
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
