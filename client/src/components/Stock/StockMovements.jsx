// src/components/Stock/StockMovements.jsx
// Journal des mouvements de stock (immuable) : entrées de réception, annulations…, filtres et pagination.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, RefreshCw, Search } from 'lucide-react';
import { stockService, warehouseService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4, signDisplay: 'exceptZero' }).format(Number(n) || 0);
const TYPES = ['OPENING', 'RECEIPT', 'RECEIPT_REVERSAL', 'ISSUE', 'ISSUE_REVERSAL', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'];

/** Tableau des mouvements, réutilisé dans la fiche article (stockItemId fixé) */
export function MovementTable({ rows, showItem = true }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-left text-xs text-gray-500">
        <tr>
          <th className="px-4 py-2">{t('stock.mv.number')}</th>
          <th className="px-4 py-2">{t('stock.mv.date')}</th>
          <th className="px-4 py-2">{t('stock.mv.type')}</th>
          {showItem && <th className="px-4 py-2">{t('stock.item')}</th>}
          <th className="px-4 py-2">{t('stock.warehouse')}</th>
          <th className="px-4 py-2">{t('stock.lot')}</th>
          <th className="px-4 py-2 text-right">{t('stock.quantity')}</th>
          <th className="px-4 py-2">{t('stock.mv.source')}</th>
          <th className="px-4 py-2">{t('stock.mv.by')}</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map(m => (
          <tr key={m.id}>
            <td className="px-4 py-2 font-mono text-xs">{m.movement_number}</td>
            <td className="px-4 py-2 whitespace-nowrap">{new Date(m.performed_at).toLocaleString(getLocale(), { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td className="px-4 py-2">
              <span className={`rounded px-2 py-0.5 text-xs ${Number(m.quantity) >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{t(`stock.mvType.${m.movement_type}`)}</span>
            </td>
            {showItem && (
              <td className="px-4 py-2"><Link to={`/stock/items/${m.stock_item_id}`} className="text-blue-600 hover:underline"><span className="font-mono">{m.item_code}</span> — {m.item_name}</Link></td>
            )}
            <td className="px-4 py-2">{m.warehouse_name}</td>
            <td className="px-4 py-2 font-mono text-xs">{m.lot_number || m.serial_number || '—'}</td>
            <td className={`px-4 py-2 text-right font-medium ${Number(m.quantity) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtQty(m.quantity)} <span className="text-xs text-gray-400">{m.unit}</span></td>
            <td className="px-4 py-2 text-xs">
              {m.source_type === 'GRN' && m.grn_number
                ? <><Link to={`/goods-receipts/${m.source_id}`} className="text-blue-600 hover:underline">{m.grn_number}</Link>{m.po_number && <span className="text-gray-400"> · {m.po_number}</span>}</>
                : m.source_type === 'ISSUE' && m.issue_number
                  ? <><Link to={`/stock/issues/${m.source_id}`} className="text-blue-600 hover:underline">{m.issue_number}</Link>{m.recipient_name && <span className="text-gray-400"> → {m.recipient_name}</span>}</>
                  : m.source_type === 'RETURN' && m.return_number
                    ? <Link to={`/stock/returns/${m.source_id}`} className="text-blue-600 hover:underline">{m.return_number}</Link>
                    : (m.comment || '—')}
            </td>
            <td className="px-4 py-2 text-xs text-gray-500">{m.performed_by_name || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function StockMovements() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({});
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ search: '', warehouseId: '', type: '', fromDate: '', toDate: '' });
  const [debounced, setDebounced] = useState(filters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => { warehouseService.list({ all: 1 }).then(r => setWarehouses(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { const id = setTimeout(() => { setDebounced(filters); setPage(1); }, 300); return () => clearTimeout(id); }, [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const clean = Object.fromEntries(Object.entries(debounced).filter(([, v]) => v));
      const res = await stockService.movements({ ...clean, page, limit: 50 });
      setRows(res.data || []);
      setPagination(res.pagination || {});
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [debounced, page]);

  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><History /> {t('stock.mv.title')}</h1>
        <p className="text-sm text-gray-500">{t('stock.mv.subtitle')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-lg p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={set('search')} placeholder={t('stock.mv.search')} className={`${inputCls} w-full pl-9`} />
        </div>
        <select value={filters.warehouseId} onChange={set('warehouseId')} className={inputCls} aria-label={t('stock.warehouse')}>
          <option value="">{t('stock.allWarehouses')}</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name}</option>)}
        </select>
        <select value={filters.type} onChange={set('type')} className={inputCls} aria-label={t('stock.mv.type')}>
          <option value="">{t('stock.mv.allTypes')}</option>
          {TYPES.map(tp => <option key={tp} value={tp}>{t(`stock.mvType.${tp}`)}</option>)}
        </select>
        <input type="date" value={filters.fromDate} onChange={set('fromDate')} className={inputCls} aria-label={t('stock.mv.from')} title={t('stock.mv.from')} />
        <input type="date" value={filters.toDate} onChange={set('toDate')} className={inputCls} aria-label={t('stock.mv.to')} title={t('stock.mv.to')} />
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
          : rows.length === 0 ? <div className="p-10 text-center text-gray-500">{t('stock.mv.none')}</div>
          : <MovementTable rows={rows} />}
      </div>
      {pagination.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">‹</button>
          <span>{t('common.pageOf', { page, pages: pagination.pages })} · {t('stock.mv.total', { count: pagination.total })}</span>
          <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">›</button>
        </div>
      )}
    </div>
  );
}
