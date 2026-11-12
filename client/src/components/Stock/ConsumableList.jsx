// src/components/Stock/ConsumableList.jsx
// Menu « Consommables » (VIEW_CONSUMABLES, migration 63) : stock des articles de nature « Consommable », par dépôt et par
// lot, avec la date de péremption (périmé / bientôt périmé), filtres dépôt / recherche / péremption, export Excel.
// Pendant du menu « Équipements » (unités suivies par n° de série). Sorties et entrées : boutons réservés à MANAGE_CONSUMABLES.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Download, RefreshCw, Search, CalendarClock, AlertTriangle, PackageMinus, PackagePlus } from 'lucide-react';
import { stockService, warehouseService } from '../../services/stockService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale, useTranslation } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const in90 = () => new Date(Date.now() + 90 * 86400e3).toISOString().slice(0, 10);

function ExpiryCell({ date }) {
  if (!date) return <span className="text-gray-400">—</span>;
  const d = String(date).slice(0, 10);
  const label = new Date(`${d}T00:00:00`).toLocaleDateString(getLocale());
  if (d < today()) return <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700" data-testid="expiry-expired">{label} · {t('stock.consumables.expired')}</span>;
  if (d <= in90()) return <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800" data-testid="expiry-soon">{label}</span>;
  return <span>{label}</span>;
}

export default function ConsumableList() {
  const { lang } = useTranslation();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('MANAGE_CONSUMABLES');
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ warehouseId: '', search: '', expiring: '' });
  const [debounced, setDebounced] = useState(filters);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { warehouseService.list().then(r => setWarehouses(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { const id = setTimeout(() => setDebounced(filters), 300); return () => clearTimeout(id); }, [filters]);

  const query = useMemo(() => ({
    nature: 'CONSUMABLE',
    warehouseId: debounced.warehouseId || undefined,
    search: debounced.search || undefined,
    expiringWithinDays: debounced.expiring === '' ? undefined : debounced.expiring,
  }), [debounced]);

  useEffect(() => {
    setLoading(true);
    stockService.balances(query).then(r => setRows(r.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [query, lang]);

  const summary = useMemo(() => ({
    items: new Set(rows.map(r => r.stock_item_id)).size,
    expired: rows.filter(r => r.expiry_date && String(r.expiry_date).slice(0, 10) < today()).length,
    soon: rows.filter(r => r.expiry_date && String(r.expiry_date).slice(0, 10) >= today() && String(r.expiry_date).slice(0, 10) <= in90()).length,
  }), [rows]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const blob = await stockService.exportBalances(query);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `consommables_${today()}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* toast api */ } finally { setExporting(false); }
  };

  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Package /> {t('stock.consumables.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.consumables.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && hasPermission('RECORD_STOCK_ENTRIES') && (
            <Link to="/stock/entries/new" className="flex items-center gap-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm" data-testid="consumables-entry">
              <PackagePlus size={16} /> {t('stock.consumables.newEntry')}
            </Link>
          )}
          {canManage && hasPermission('ISSUE_STOCK') && (
            <Link to="/stock/issues/new" className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm" data-testid="consumables-issue">
              <PackageMinus size={16} /> {t('stock.consumables.newIssue')}
            </Link>
          )}
          <button onClick={exportExcel} disabled={exporting} className="flex items-center gap-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm disabled:opacity-50" data-testid="consumables-export">
            <Download size={16} /> {t('stock.consumables.export')}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">{t('stock.consumables.itemsInStock')}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900" data-testid="consumables-count">{summary.items}</p>
        </div>
        <button type="button" onClick={() => setFilters(f => ({ ...f, expiring: '90' }))} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left hover:bg-amber-100">
          <p className="flex items-center gap-1 text-xs text-amber-800"><CalendarClock size={14} /> {t('stock.consumables.expiringSoon')}</p>
          <p className="mt-1 text-2xl font-semibold text-amber-900">{summary.soon}</p>
        </button>
        <button type="button" onClick={() => setFilters(f => ({ ...f, expiring: '0' }))} className="rounded-xl border border-red-200 bg-red-50 p-4 text-left hover:bg-red-100">
          <p className="flex items-center gap-1 text-xs text-red-700"><AlertTriangle size={14} /> {t('stock.consumables.expiredLots')}</p>
          <p className="mt-1 text-2xl font-semibold text-red-800">{summary.expired}</p>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-lg p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={set('search')} placeholder={t('stock.consumables.search')} className={`${inputCls} pl-9`} data-testid="consumables-search" />
        </div>
        <SearchSelect value={filters.warehouseId} onChange={set('warehouseId')} className={`${inputCls} w-auto`} aria-label={t('stock.warehouse')}>
          <option value="">{t('stock.allWarehouses')}</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
        </SearchSelect>
        <SearchSelect value={filters.expiring} onChange={set('expiring')} className={`${inputCls} w-auto`} aria-label={t('stock.expiry')} data-testid="consumables-expiring">
          <option value="">{t('stock.consumables.allExpiry')}</option>
          <option value="0">{t('stock.consumables.onlyExpired')}</option>
          <option value="90">{t('stock.consumables.within90')}</option>
          <option value="180">{t('stock.consumables.within180')}</option>
        </SearchSelect>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        {loading ? (
          <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
        ) : (
          <table className="w-full text-sm" data-testid="consumables-table">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('stock.code')}</th>
                <th className="px-4 py-2">{t('stock.item')}</th>
                <th className="px-4 py-2">{t('stock.category')}</th>
                <th className="px-4 py-2">{t('stock.warehouse')}</th>
                <th className="px-4 py-2">{t('stock.lot')}</th>
                <th className="px-4 py-2">{t('stock.expiry')}</th>
                <th className="px-4 py-2">{t('stock.consumables.project')}</th>
                <th className="px-4 py-2 text-right">{t('stock.quantity')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-mono font-semibold">{r.item_code}</td>
                  <td className="px-4 py-2"><Link to={`/stock/items/${r.stock_item_id}`} className="text-blue-600 hover:underline">{r.item_name}</Link></td>
                  <td className="px-4 py-2">{r.category_name || '—'}</td>
                  <td className="px-4 py-2">{r.warehouse_name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.lot_number || '—'}</td>
                  <td className="px-4 py-2"><ExpiryCell date={r.expiry_date} /></td>
                  <td className="px-4 py-2 text-xs">{r.project_code || '—'}</td>
                  <td className="px-4 py-2 text-right font-medium">{fmtQty(r.quantity)} <span className="text-xs text-gray-500">{r.unit}</span></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">{t('stock.consumables.none')}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
