// src/components/Stock/StockMovements.jsx
// Journal des mouvements de stock (immuable) : entrées de réception, annulations…, filtres et pagination.
// Deux vues : « Par opération » (groupes de mouvements écrits d'un seul coup, téléchargeables) et « Détail ».
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, History, Layers, List, RefreshCw, Search } from 'lucide-react';
import { stockService, warehouseService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';
import { projectService } from '../../services/projectService';
import { downloadBlob } from '../../utils/supplierDocs';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4, signDisplay: 'exceptZero' }).format(Number(n) || 0);
const fmtDate = (d) => new Date(d).toLocaleString(getLocale(), { dateStyle: 'short', timeStyle: 'short' });
const TYPES = ['OPENING', 'RECEIPT', 'RECEIPT_REVERSAL', 'ISSUE', 'ISSUE_REVERSAL', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'ENTRY', 'ENTRY_REVERSAL'];
const VIEW_KEY = 'app_stock_movements_view';

/** Document à l'origine d'un mouvement ou d'une opération (lien), sinon null */
export function SourceDocument({ m }) {
  if (m.source_type === 'GRN' && m.grn_number) {
    return <><Link to={`/goods-receipts/${m.source_id}`} className="text-blue-600 hover:underline">{m.grn_number}</Link>{m.po_number && <span className="text-gray-400"> · {m.po_number}</span>}</>;
  }
  if (m.source_type === 'ISSUE' && m.issue_number) return <Link to={`/stock/issues/${m.source_id}`} className="text-blue-600 hover:underline">{m.issue_number}</Link>;
  if (m.source_type === 'RETURN' && m.return_number) return <Link to={`/stock/returns/${m.source_id}`} className="text-blue-600 hover:underline">{m.return_number}</Link>;
  if (m.source_type === 'ENTRY' && m.entry_number) {
    return <><Link to={`/stock/entries/${m.source_id}`} className="text-blue-600 hover:underline">{m.entry_number}</Link>{m.entry_origin && <span className="text-gray-400"> ← {m.entry_origin}</span>}</>;
  }
  if (m.source_type === 'COUNT' && m.count_number) return <Link to={`/stock/counts/${m.source_id}`} className="text-blue-600 hover:underline">{m.count_number}</Link>;
  if (m.source_type === 'ADJUSTMENT' && m.adjustment_number) {
    return <><Link to="/stock/adjustments" className="text-blue-600 hover:underline">{m.adjustment_number}</Link>{m.adjustment_reason && <span className="text-gray-400"> · {t(`stock.adjust.reasons.${m.adjustment_reason}`)}</span>}</>;
  }
  return null;
}

/** Libellé de l'opération d'un groupe (réception, sortie, import…) */
export const groupLabel = (g) => t(`stock.mvGroup.source.${g.source_type || 'OTHER'}`, { defaultValue: t('stock.mvGroup.source.OTHER') });

/** Télécharge l'opération en Excel (un mouvement par ligne) */
export async function downloadGroup(g) {
  const blob = await stockService.exportMovementGroup(g.id);
  downloadBlob(blob, `${g.group_number}.xlsx`);
}

/** Tableau des mouvements, réutilisé dans la fiche article (stockItemId fixé) et la fiche d'une opération (showGroup=false) */
export function MovementTable({ rows, showItem = true, showGroup = true }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-left text-xs text-gray-500">
        <tr>
          <th className="px-4 py-2">{t('stock.mv.number')}</th>
          {showGroup && <th className="px-4 py-2">{t('stock.mvGroup.column')}</th>}
          <th className="px-4 py-2">{t('stock.mv.date')}</th>
          <th className="px-4 py-2">{t('stock.mv.type')}</th>
          {showItem && <th className="px-4 py-2">{t('stock.item')}</th>}
          <th className="px-4 py-2">{t('stock.warehouse')}</th>
          <th className="px-4 py-2">{t('stock.lot')}</th>
          <th className="px-4 py-2 text-right">{t('stock.quantity')}</th>
          <th className="px-4 py-2">{t('stock.mv.source')}</th>
          <th className="px-4 py-2">{t('stock.funding.column')}</th>
          <th className="px-4 py-2">{t('stock.mv.by')}</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map(m => (
          <tr key={m.id}>
            <td className="px-4 py-2 font-mono text-xs">{m.movement_number}</td>
            {showGroup && (
              <td className="px-4 py-2 font-mono text-xs" data-testid="movement-group">
                {m.group_id ? <Link to={`/stock/movement-groups/${m.group_id}`} className="text-blue-600 hover:underline">{m.group_number}</Link> : '—'}
              </td>
            )}
            <td className="px-4 py-2 whitespace-nowrap">{fmtDate(m.performed_at)}</td>
            <td className="px-4 py-2">
              <span className={`rounded px-2 py-0.5 text-xs ${Number(m.quantity) >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{t(`stock.mvType.${m.movement_type}`)}</span>
            </td>
            {showItem && (
              <td className="px-4 py-2"><Link to={`/stock/items/${m.stock_item_id}`} className="text-blue-600 hover:underline"><span className="font-mono">{m.item_code}</span> — {m.item_name}</Link></td>
            )}
            <td className="px-4 py-2">{m.warehouse_name}</td>
            <td className="px-4 py-2 font-mono text-xs">
              {m.lot_number || m.serial_number || '—'}
              {m.asset_tag && <div className="text-gray-500" data-testid="movement-asset-tag">{m.asset_tag}</div>}
            </td>
            <td className={`px-4 py-2 text-right font-medium ${Number(m.quantity) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtQty(m.quantity)} <span className="text-xs text-gray-400">{m.unit}</span></td>
            <td className="px-4 py-2 text-xs">
              {m.source_type === 'ISSUE' && m.issue_number
                ? <><SourceDocument m={m} />{m.recipient_name && <span className="text-gray-400"> {Number(m.quantity) > 0 && m.movement_type === 'TRANSFER_IN' ? '←' : '→'} {m.recipient_name}</span>}</>
                : (m.grn_number || m.return_number || m.count_number || m.adjustment_number || m.entry_number)
                  ? <SourceDocument m={m} />
                  : (m.comment || '—')}
            </td>
            {/* Projet qui a financé l'entrée en stock (réception : projet de la réquisition ; entrée manuelle : saisi) */}
            <td className="px-4 py-2 text-xs" data-testid="movement-project">
              {m.project_code ? <span title={m.project_name}>{m.project_code}</span> : <span className="text-gray-400">—</span>}
            </td>
            <td className="px-4 py-2 text-xs text-gray-500">{m.performed_by_name || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Opérations : une ligne par groupe de mouvements écrits d'un seul coup */
function MovementGroupTable({ rows }) {
  return (
    <table className="w-full text-sm" data-testid="movement-groups">
      <thead className="bg-gray-50 text-left text-xs text-gray-500">
        <tr>
          <th className="px-4 py-2">{t('stock.mvGroup.number')}</th>
          <th className="px-4 py-2">{t('stock.mv.date')}</th>
          <th className="px-4 py-2">{t('stock.mvGroup.operation')}</th>
          <th className="px-4 py-2">{t('stock.mvGroup.content')}</th>
          <th className="px-4 py-2">{t('stock.warehouse')}</th>
          <th className="px-4 py-2 text-right">{t('stock.mvGroup.in')}</th>
          <th className="px-4 py-2 text-right">{t('stock.mvGroup.out')}</th>
          <th className="px-4 py-2">{t('stock.mv.by')}</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map(g => (
          <tr key={g.id} data-testid="movement-group-row">
            <td className="px-4 py-2 font-mono text-xs">
              <Link to={`/stock/movement-groups/${g.id}`} className="text-blue-600 hover:underline">{g.group_number}</Link>
            </td>
            <td className="px-4 py-2 whitespace-nowrap">{fmtDate(g.created_at)}</td>
            <td className="px-4 py-2">
              <div className="font-medium text-gray-800">{groupLabel(g)}</div>
              <div className="text-xs"><SourceDocument m={g} /></div>
            </td>
            <td className="px-4 py-2 text-xs">
              <div>{t('stock.mvGroup.contentText', { items: g.item_count, movements: g.movement_count })}</div>
              {g.unit_count > 0 && <div className="text-indigo-700">{t('stock.mvGroup.units', { count: g.unit_count })}</div>}
              <div className="text-gray-400 truncate max-w-[260px]" title={(g.item_names || []).join(', ')}>
                {(g.item_names || []).join(', ')}{g.item_count > (g.item_names || []).length ? '…' : ''}
              </div>
            </td>
            <td className="px-4 py-2 text-xs">{g.warehouses}</td>
            <td className="px-4 py-2 text-right text-green-700">{g.quantity_in ? fmtQty(g.quantity_in) : '—'}</td>
            <td className="px-4 py-2 text-right text-red-600">{g.quantity_out ? fmtQty(-g.quantity_out) : '—'}</td>
            <td className="px-4 py-2 text-xs text-gray-500">{g.performed_by_name || '—'}</td>
            <td className="px-4 py-2 text-right">
              <button type="button" onClick={() => downloadGroup(g)} title={t('stock.mvGroup.download')} aria-label={t('stock.mvGroup.download')}
                className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-blue-600" data-testid="movement-group-download">
                <Download size={16} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'movements' ? 'movements' : 'groups'; } catch { return 'groups'; } };

export default function StockMovements() {
  const [view, setView] = useState(readView);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({});
  const [warehouses, setWarehouses] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState({ search: '', warehouseId: '', projectId: '', type: '', fromDate: '', toDate: '' });
  const [debounced, setDebounced] = useState(filters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => { warehouseService.list({ all: 1 }).then(r => setWarehouses(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { projectService.getAll().then(r => setProjects(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { const id = setTimeout(() => { setDebounced(filters); setPage(1); }, 300); return () => clearTimeout(id); }, [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const clean = Object.fromEntries(Object.entries(debounced).filter(([, v]) => v));
      const fetch = view === 'groups' ? stockService.movementGroups : stockService.movements;
      const res = await fetch({ ...clean, page, limit: 50 });
      setRows(res.data || []);
      setPagination(res.pagination || {});
    } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [debounced, page, view]);

  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));
  const switchView = (v) => {
    if (v === view) return;
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* stockage indisponible */ }
    setRows([]);
    setPage(1);
    setView(v);
  };
  const tabCls = (v) => `flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md ${view === v ? 'bg-white shadow text-blue-700 font-medium' : 'text-gray-600 hover:text-gray-900'}`;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><History /> {t('stock.mv.title')}</h1>
          <p className="text-sm text-gray-500">{view === 'groups' ? t('stock.mvGroup.subtitle') : t('stock.mv.subtitle')}</p>
        </div>
        <div className="flex rounded-lg bg-gray-100 p-1" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'groups'} onClick={() => switchView('groups')} className={tabCls('groups')} data-testid="movements-view-groups">
            <Layers size={15} /> {t('stock.mvGroup.viewGroups')}
          </button>
          <button type="button" role="tab" aria-selected={view === 'movements'} onClick={() => switchView('movements')} className={tabCls('movements')} data-testid="movements-view-detail">
            <List size={15} /> {t('stock.mvGroup.viewDetail')}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-lg p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filters.search} onChange={set('search')} placeholder={t('stock.mv.search')} className={`${inputCls} w-full pl-9`} />
        </div>
        <SearchSelect value={filters.warehouseId} onChange={set('warehouseId')} className={inputCls} aria-label={t('stock.warehouse')}>
          <option value="">{t('stock.allWarehouses')}</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name}</option>)}
        </SearchSelect>
        {/* Projet qui a financé l'entrée (« non attribué » : entrées sans projet) */}
        <SearchSelect value={filters.projectId} onChange={set('projectId')} className={inputCls} aria-label={t('stock.funding.column')} data-testid="movements-project-filter">
          <option value="">{t('stock.funding.allProjects')}</option>
          <option value="none">{t('stock.funding.unassigned')}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </SearchSelect>
        <SearchSelect value={filters.type} onChange={set('type')} className={inputCls} aria-label={t('stock.mv.type')}>
          <option value="">{t('stock.mv.allTypes')}</option>
          {TYPES.map(tp => <option key={tp} value={tp}>{t(`stock.mvType.${tp}`)}</option>)}
        </SearchSelect>
        <input type="date" value={filters.fromDate} onChange={set('fromDate')} className={inputCls} aria-label={t('stock.mv.from')} title={t('stock.mv.from')} />
        <input type="date" value={filters.toDate} onChange={set('toDate')} className={inputCls} aria-label={t('stock.mv.to')} title={t('stock.mv.to')} />
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
          : rows.length === 0 ? <div className="p-10 text-center text-gray-500">{view === 'groups' ? t('stock.mvGroup.none') : t('stock.mv.none')}</div>
          : view === 'groups' ? <MovementGroupTable rows={rows} /> : <MovementTable rows={rows} />}
      </div>
      {pagination.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">‹</button>
          <span>{t('common.pageOf', { page, pages: pagination.pages })} · {view === 'groups' ? t('stock.mvGroup.total', { count: pagination.total }) : t('stock.mv.total', { count: pagination.total })}</span>
          <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">›</button>
        </div>
      )}
    </div>
  );
}
