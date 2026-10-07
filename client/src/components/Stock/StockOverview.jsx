// src/components/Stock/StockOverview.jsx
// État du stock : synthèse (articles en stock, sous le minimum, lots qui expirent) et soldes
// par article × dépôt × lot, filtres (dépôt, localisation, catégorie, recherche, péremption), export Excel.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Warehouse, Download, RefreshCw, Search, Package, AlertTriangle, CalendarClock, Boxes } from 'lucide-react';
import { stockService, warehouseService } from '../../services/stockService';
import { categoryService } from '../../services/referenceService';
import { t, getLocale, useTranslation } from '../../i18n';
import { usePermissions } from '../../hooks/usePermissions';
import SearchSelect from '../Common/SearchSelect';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale()) : '—');
const daysUntil = (d) => Math.ceil((new Date(d) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);

export default function StockOverview() {
  const { lang } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState(params.get('search') || '');
  const { hasPermission } = usePermissions();

  const filters = {
    warehouseId: params.get('warehouseId') || '',
    categoryId: params.get('categoryId') || '',
    expiringWithinDays: params.get('expiring') || '',
  };
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    warehouseService.list().then(r => setWarehouses(r.data || [])).catch(() => {});
    stockService.summary().then(r => setSummary(r.data)).catch(() => {});
  }, []);
  useEffect(() => { categoryService.listPublic().then(r => setCategories(r.data || [])).catch(() => {}); }, [lang]);

  const query = useMemo(() => ({
    warehouseId: filters.warehouseId || undefined,
    categoryId: filters.categoryId || undefined,
    expiringWithinDays: filters.expiringWithinDays || undefined,
    search: params.get('search') || undefined,
  }), [params]);

  useEffect(() => {
    const id = setTimeout(() => setFilter('search', search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = async () => {
    setLoading(true);
    try { setRows((await stockService.balances(query)).data || []); } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [query, lang]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const blob = await stockService.exportBalances(query);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stock_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* toast api */ } finally { setExporting(false); }
  };

  // Total par article (toutes lignes affichées)
  const totals = useMemo(() => {
    const map = new Map();
    for (const r of rows) map.set(r.stock_item_id, (map.get(r.stock_item_id) || 0) + Number(r.quantity));
    return map;
  }, [rows]);

  const cards = summary ? [
    { icon: Boxes, label: t('stock.overview.itemsInStock'), value: summary.items_in_stock, sub: t('stock.overview.ofStockable', { count: summary.stockable_items }) },
    { icon: AlertTriangle, label: t('stock.overview.belowMin'), value: summary.below_min, warn: summary.below_min > 0, to: '/stock/items?belowMin=1' },
    { icon: CalendarClock, label: t('stock.overview.expiring90'), value: summary.lots_expiring_90d, warn: summary.lots_expiring_90d > 0, onClick: () => setFilter('expiring', '90') },
    { icon: AlertTriangle, label: t('stock.overview.expired'), value: summary.lots_expired, danger: summary.lots_expired > 0, onClick: () => setFilter('expiring', '0') },
  ] : [];

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Package /> {t('stock.overview.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.overview.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50" title={t('common.refresh')} aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          {hasPermission('ISSUE_STOCK') && (
            <Link to={`/stock/issues/new${filters.warehouseId ? `?warehouseId=${filters.warehouseId}` : ''}`} className="flex items-center gap-2 border border-blue-600 text-blue-700 hover:bg-blue-50 px-4 py-2 rounded-lg text-sm">
              <Package size={16} /> {t('stock.issue.new')}
            </Link>
          )}
          <button onClick={exportExcel} disabled={exporting} className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm">
            <Download size={16} /> {t('stock.overview.export')}
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(c => {
            const content = (
              <>
                <div className="flex items-center gap-2 text-xs text-gray-500"><c.icon size={14} /> {c.label}</div>
                <div className={`mt-1 text-2xl font-bold ${c.danger ? 'text-red-600' : c.warn ? 'text-amber-600' : 'text-gray-900'}`}>{c.value}</div>
                {c.sub && <div className="text-xs text-gray-400">{c.sub}</div>}
              </>
            );
            const cls = 'block rounded-lg border border-gray-200 bg-white p-4 text-left hover:shadow-sm';
            return c.to ? <Link key={c.label} to={c.to} className={cls}>{content}</Link>
              : c.onClick ? <button key={c.label} onClick={c.onClick} className={cls}>{content}</button>
              : <div key={c.label} className={cls}>{content}</div>;
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-lg p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('stock.overview.search')} className={`${inputCls} w-full pl-9`} />
        </div>
        <SearchSelect value={filters.warehouseId} onChange={e => setFilter('warehouseId', e.target.value)} className={inputCls} aria-label={t('stock.warehouse')}>
          <option value="">{t('stock.allWarehouses')}</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name}</option>)}
        </SearchSelect>
        <SearchSelect value={filters.categoryId} onChange={e => setFilter('categoryId', e.target.value)} className={inputCls} aria-label={t('stock.category')}>
          <option value="">{t('stock.allCategories')}</option>
          {categories.filter(c => c.is_stockable).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SearchSelect>
        <SearchSelect value={filters.expiringWithinDays} onChange={e => setFilter('expiring', e.target.value)} className={inputCls} aria-label={t('stock.overview.expiryFilter')}>
          <option value="">{t('stock.overview.anyExpiry')}</option>
          <option value="0">{t('stock.overview.expiredOnly')}</option>
          <option value="30">{t('stock.overview.within', { days: 30 })}</option>
          <option value="90">{t('stock.overview.within', { days: 90 })}</option>
          <option value="180">{t('stock.overview.within', { days: 180 })}</option>
        </SearchSelect>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        {loading ? (
          <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <Warehouse className="mx-auto mb-2 text-gray-300" size={36} />
            {t('stock.overview.empty')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('stock.item')}</th>
                <th className="px-4 py-2">{t('stock.warehouse')}</th>
                <th className="px-4 py-2">{t('stock.lot')}</th>
                <th className="px-4 py-2">{t('stock.expiry')}</th>
                <th className="px-4 py-2 text-right">{t('stock.quantity')}</th>
                <th className="px-4 py-2 text-right">{t('stock.overview.itemTotal')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r, i) => {
                const firstOfItem = i === 0 || rows[i - 1].stock_item_id !== r.stock_item_id;
                const days = r.expiry_date ? daysUntil(r.expiry_date) : null;
                const total = totals.get(r.stock_item_id);
                const low = r.min_quantity !== null && total < Number(r.min_quantity);
                return (
                  <tr key={r.id} className={firstOfItem ? 'border-t-2 border-gray-100' : ''}>
                    <td className="px-4 py-2">
                      {firstOfItem && (
                        <Link to={`/stock/items/${r.stock_item_id}`} className="text-blue-600 hover:underline">
                          <span className="font-mono font-semibold">{r.item_code}</span> — {r.item_name}
                        </Link>
                      )}
                      {firstOfItem && r.category_name && <div className="text-xs text-gray-400">{r.category_name}</div>}
                    </td>
                    <td className="px-4 py-2">{r.warehouse_name} <span className="text-xs text-gray-400">({r.location_name})</span></td>
                    <td className="px-4 py-2 font-mono text-xs">{r.lot_number || '—'}</td>
                    <td className={`px-4 py-2 ${days !== null && days < 0 ? 'text-red-600 font-semibold' : days !== null && days <= 90 ? 'text-amber-600' : ''}`}>
                      {fmtDate(r.expiry_date)}
                      {days !== null && days < 0 && <span className="ml-1 text-xs">({t('stock.expired')})</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">{fmtQty(r.quantity)} <span className="text-xs text-gray-400">{r.unit}</span></td>
                    <td className={`px-4 py-2 text-right ${low ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                      {firstOfItem && <>{low && <AlertTriangle size={12} className="mr-1 inline" />}{fmtQty(total)} {r.unit}</>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
