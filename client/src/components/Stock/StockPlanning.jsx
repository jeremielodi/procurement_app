// src/components/Stock/StockPlanning.jsx
// Prévision du réapprovisionnement (migration 55) : par article × dépôt, ou total de l'entreprise par article.
// CMM (consommation moyenne mensuelle) hors jours de rupture, stock de sécurité, minimum, maximum, en commande, demandé,
// quantité à commander. « Réapprovisionner » : lignes choisies → réquisition pré-remplie (quantité à commander, dépôt de
// destination de chaque ligne, repris par le bon de commande pour la quantité « en commande »).
// Paramètres : « Mon entreprise » (période, sécurité, délai, fréquence), fiche du dépôt (sécurité), fiche de l'article (délai).
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { TrendingUp, RefreshCw, Download, Search, ShoppingCart, Settings } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchSelect from '../Common/SearchSelect';
import { stockService, warehouseService } from '../../services/stockService';
import { categoryService } from '../../services/referenceService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale, useTranslation } from '../../i18n';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmt = (n, digits = 2) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits }).format(Number(n) || 0));

export const PLANNING_STATUSES = ['STOCKOUT', 'BELOW_SAFETY', 'TO_ORDER', 'OVERSTOCK', 'OK', 'NO_CONSUMPTION'];
export const PLANNING_STATUS_STYLE = {
  STOCKOUT: 'bg-red-100 text-red-800 border-red-200',
  BELOW_SAFETY: 'bg-orange-100 text-orange-800 border-orange-200',
  TO_ORDER: 'bg-amber-100 text-amber-800 border-amber-200',
  OVERSTOCK: 'bg-purple-100 text-purple-800 border-purple-200',
  OK: 'bg-green-100 text-green-800 border-green-200',
  NO_CONSUMPTION: 'bg-gray-100 text-gray-700 border-gray-200',
};

export function PlanningStatusBadge({ status }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${PLANNING_STATUS_STYLE[status] || ''}`} data-testid="planning-status">
      {t(`stock.planning.status.${status}`)}
    </span>
  );
}

/** Réquisition pré-remplie avec les lignes choisies (quantité à commander, dépôt de destination) */
export function restockPrefill(rows) {
  return {
    title: t('stock.planning.restockTitle', { date: new Date().toLocaleDateString(getLocale()) }),
    justification: t('stock.planning.restockJustification', {
      list: rows.map(r => `${r.code}${r.warehouseName ? ` → ${r.warehouseName}` : ''} (${t('stock.planning.restockLine', { stock: fmt(r.stock), amc: fmt(r.amc), unit: r.unit })})`).join(', '),
    }),
    items: rows.map(r => ({
      quantity: r.toOrder,
      stockItem: { id: r.stockItemId, code: r.code, name: r.name, unit: r.unit, unit_id: r.unitId, is_stockable: true, track_lots: r.trackLots, track_serials: r.trackSerials },
      destinationWarehouse: r.warehouseId ? { id: r.warehouseId, name: r.warehouseName } : null,
    })),
  };
}

export default function StockPlanning() {
  const { lang } = useTranslation();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState([]);
  const [categories, setCategories] = useState([]);
  // view : '' = tous les dépôts (article × dépôt), 'enterprise' = total par article, sinon id d'un dépôt
  const [filters, setFilters] = useState({ view: params.get('view') || '', categoryId: '', search: '', status: params.get('status') || '' });
  const [debounced, setDebounced] = useState(filters);
  const [selected, setSelected] = useState([]);

  useEffect(() => { warehouseService.list().then(r => setWarehouses(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { categoryService.listPublic().then(r => setCategories(r.data || [])).catch(() => {}); }, [lang]);
  useEffect(() => { const id = setTimeout(() => setDebounced(filters), 300); return () => clearTimeout(id); }, [filters]);

  const query = useMemo(() => {
    const q = {};
    if (debounced.view === 'enterprise') q.level = 'enterprise';
    else if (debounced.view) q.warehouseId = debounced.view;
    if (debounced.categoryId) q.categoryId = debounced.categoryId;
    if (debounced.search) q.search = debounced.search;
    return q;
  }, [debounced.view, debounced.categoryId, debounced.search]);

  const load = () => {
    setLoading(true);
    setSelected([]);
    stockService.planning(query).then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [query, lang]);

  const rowKey = (r) => `${r.stockItemId}|${r.warehouseId || ''}`;
  const rows = useMemo(() => (data?.rows || []).filter(r => !filters.status || r.status === filters.status), [data, filters.status]);
  const orderable = rows.filter(r => r.toOrder > 0);
  const chosen = rows.filter(r => selected.includes(rowKey(r)));
  const enterpriseView = data?.level === 'enterprise';
  const toggle = (r) => setSelected(s => (s.includes(rowKey(r)) ? s.filter(k => k !== rowKey(r)) : [...s, rowKey(r)]));

  const restock = () => {
    const lines = chosen.length ? chosen : orderable;
    if (!lines.length) { toast(t('stock.planning.nothingToOrder')); return; }
    navigate('/requisitions/new', { state: { prefill: restockPrefill(lines) } });
  };

  const exportXlsx = async () => {
    const blob = await stockService.exportPlanning({ ...query, ...(filters.status && { status: filters.status }) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `prevision-stock-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const s = data?.settings;
  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><TrendingUp /> {t('stock.planning.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.planning.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          <button onClick={exportXlsx} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" data-testid="planning-export"><Download size={16} /> Excel</button>
          {hasPermission('CREATE_REQUISITIONS') && (
            <button onClick={restock} disabled={!orderable.length} data-testid="planning-restock"
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
              <ShoppingCart size={16} /> {chosen.length ? t('stock.planning.restockSelected', { count: chosen.length }) : t('stock.planning.restockAll', { count: orderable.length })}
            </button>
          )}
        </div>
      </div>

      {s && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-900" data-testid="planning-settings">
          <span>{t('stock.planning.settings.period', { count: s.amcMonths })}</span>
          <span>{t('stock.planning.settings.safety', { value: fmt(s.safetyMonths) })}</span>
          <span>{t('stock.planning.settings.lead', { value: s.leadTimeDays })}</span>
          <span>{t('stock.planning.settings.interval', { value: fmt(s.orderIntervalMonths) })}</span>
          {hasPermission('MANAGE_USERS') && (
            <Link to="/settings/enterprise" className="ml-auto inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"><Settings size={12} /> {t('stock.planning.settings.change')}</Link>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <SearchSelect value={filters.view} onChange={e => setFilters(f => ({ ...f, view: e.target.value }))} className={inputCls} aria-label={t('stock.planning.view')} data-testid="planning-view">
          <option value="">{t('stock.planning.allWarehouses')}</option>
          <option value="enterprise">{t('stock.planning.enterpriseTotal')}</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name}</option>)}
        </SearchSelect>
        <SearchSelect value={filters.categoryId} onChange={e => setFilters(f => ({ ...f, categoryId: e.target.value }))} className={inputCls} aria-label={t('stock.category')}>
          <option value="">{t('stock.allCategories')}</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SearchSelect>
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} placeholder={t('stock.planning.searchPlaceholder')}
            className={`${inputCls} w-full pl-9`} data-testid="planning-search" />
        </div>
      </div>

      {data && (
        <div className="flex flex-wrap gap-2" data-testid="planning-counts">
          <button onClick={() => setFilters(f => ({ ...f, status: '' }))}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${!filters.status ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>
            {t('stock.planning.all')} ({data.counts.total})
          </button>
          {PLANNING_STATUSES.map(st => (
            <button key={st} onClick={() => setFilters(f => ({ ...f, status: f.status === st ? '' : st }))} data-testid={`planning-count-${st}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${filters.status === st ? 'ring-2 ring-blue-500 ring-offset-1' : ''} ${PLANNING_STATUS_STYLE[st]}`}>
              {t(`stock.planning.status.${st}`)} ({data.counts[st] || 0})
            </button>
          ))}
        </div>
      )}

      {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div> : !data ? null : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm" data-testid="planning-table">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" aria-label={t('stock.planning.selectAll')} checked={orderable.length > 0 && orderable.every(r => selected.includes(rowKey(r)))}
                    onChange={e => setSelected(e.target.checked ? orderable.map(rowKey) : [])} disabled={!orderable.length} />
                </th>
                <th className="px-3 py-2">{t('stock.item')}</th>
                {!enterpriseView && <th className="px-3 py-2">{t('stock.warehouse')}</th>}
                <th className="px-3 py-2">{t('stock.planning.col.status')}</th>
                <th className="px-3 py-2 text-right">{t('stock.planning.col.stock')}</th>
                <th className="px-3 py-2 text-right" title={t('stock.planning.col.amcHint')}>{t('stock.planning.col.amc')}</th>
                <th className="px-3 py-2 text-right">{t('stock.planning.col.months')}</th>
                <th className="px-3 py-2 text-right" title={t('stock.planning.col.thresholdsHint')}>{t('stock.planning.col.thresholds')}</th>
                <th className="px-3 py-2 text-right">{t('stock.planning.col.onOrder')}</th>
                <th className="px-3 py-2 text-right">{t('stock.planning.col.requested')}</th>
                <th className="px-3 py-2 text-right">{t('stock.planning.col.toOrder')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={rowKey(r)} className={selected.includes(rowKey(r)) ? 'bg-blue-50' : ''} data-testid="planning-row">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.includes(rowKey(r))} onChange={() => toggle(r)} disabled={!(r.toOrder > 0)} aria-label={r.code} />
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/stock/items/${r.stockItemId}`} className="font-medium text-blue-600 hover:underline">{r.name}</Link>
                    <div className="font-mono text-xs text-gray-500">{r.code}{r.categoryName ? ` · ${r.categoryName}` : ''}</div>
                  </td>
                  {!enterpriseView && <td className="px-3 py-2 text-gray-700">{r.warehouseName}</td>}
                  <td className="px-3 py-2">
                    <PlanningStatusBadge status={r.status} />
                    {r.basis === 'MIN_QUANTITY' && <div className="mt-0.5 text-[11px] text-gray-500">{t('stock.planning.basisMin')}</div>}
                    {r.stockoutDays > 0 && <div className="mt-0.5 text-[11px] text-gray-500">{t('stock.planning.stockoutDays', { value: fmt(r.stockoutDays, 0) })}</div>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(r.stock, 4)} <span className="text-xs text-gray-400">{r.unit}</span></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{r.amc > 0 ? fmt(r.amc) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.monthsOfStock !== null ? fmt(r.monthsOfStock, 1) : '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-xs text-gray-600">
                    {r.basis === 'AMC' ? `${fmt(r.safetyStock, 0)} / ${fmt(r.minStock, 0)} / ${fmt(r.maxStock, 0)}` : r.basis === 'MIN_QUANTITY' ? `— / ${fmt(r.minStock, 0)} / —` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">{r.onOrder > 0 ? fmt(r.onOrder, 4) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.requested > 0 ? fmt(r.requested, 4) : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold" data-testid="planning-to-order">{r.toOrder > 0 ? fmt(r.toOrder, 0) : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={enterpriseView ? 10 : 11} className="p-8 text-center text-gray-500">{t('stock.planning.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">{t('stock.planning.method')}</p>
    </div>
  );
}
