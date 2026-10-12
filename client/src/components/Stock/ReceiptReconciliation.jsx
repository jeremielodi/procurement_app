// src/components/Stock/ReceiptReconciliation.jsx
// Rapprochement « réceptions ↔ stock » (audit) : chaque ligne de bon de réception comparée aux mouvements de stock
// qu'elle a produits (quantité acceptée / entrée / reprise, dépôt, lot, coût). Synthèse, filtres, anomalies seulement,
// liens vers la réception, la commande et le journal des mouvements, export Excel (synthèse + détail).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Search, Download, RefreshCw, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import SearchSelect from '../Common/SearchSelect';
import { stockService, warehouseService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtMoney = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n)));
const fmtDay = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(getLocale()) : '—');
const codeLabel = (c) => t(`receiptRecon.code.${c}`);

function ResultBadge({ row }) {
  const cls = row.severity === 'error' ? 'bg-red-100 text-red-800' : row.severity === 'ok' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700';
  const Icon = row.severity === 'error' ? AlertTriangle : row.severity === 'ok' ? CheckCircle2 : Info;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${cls}`}><Icon size={12} /> {codeLabel(row.status)}</span>;
}

export default function ReceiptReconciliation() {
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', warehouseId: '', search: '', onlyIssues: true });
  const [debounced, setDebounced] = useState(filters);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { warehouseService.list({ all: 1 }).then(r => setWarehouses(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { const id = setTimeout(() => setDebounced(filters), 300); return () => clearTimeout(id); }, [filters]);
  const params = () => {
    const p = Object.fromEntries(Object.entries(debounced).filter(([k, v]) => k !== 'onlyIssues' && v));
    if (debounced.onlyIssues) p.onlyIssues = 1;
    return p;
  };
  const load = () => {
    setLoading(true);
    stockService.receiptReconciliation(params()).then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [debounced]);
  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const blob = await stockService.exportReceiptReconciliation(params());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `rapprochement-receptions-stock-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* toast api */ } finally { setExporting(false); }
  };

  const s = data?.summary;
  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ShieldCheck /> {t('receiptRecon.title')}</h1>
          <p className="text-sm text-gray-500">{t('receiptRecon.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" aria-label={t('common.refresh')}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportXlsx} disabled={exporting} className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50" data-testid="recon-export">
            <Download size={16} /> {t('receiptRecon.export')}
          </button>
        </div>
      </div>

      <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{t('receiptRecon.rules')}</p>

      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="recon-summary">
          {[
            ['lines', s.lines, 'text-gray-900'], ['grns', s.grns, 'text-gray-900'], ['ok', s.ok, 'text-green-700'],
            ['info', s.info, 'text-gray-600'], ['errors', s.errors, s.errors ? 'text-red-700' : 'text-green-700'],
          ].map(([k, v, cls]) => (
            <div key={k} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className={`text-2xl font-bold ${cls}`}>{fmtQty(v)}</div>
              <div className="text-xs text-gray-500">{t(`receiptRecon.summary.${k}`)}</div>
            </div>
          ))}
        </div>
      )}
      {s && Object.keys(s.byCode).some(c => !['OK', 'NOT_STOCKABLE', 'CANCELLED_REVERSED'].includes(c)) && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(s.byCode).filter(([c]) => !['OK', 'NOT_STOCKABLE', 'CANCELLED_REVERSED'].includes(c)).map(([c, count]) => (
            <span key={c} className="rounded-full bg-red-50 px-3 py-1 text-xs text-red-800 ring-1 ring-red-200">{codeLabel(c)} : {count}</span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
          <input value={filters.search} onChange={set('search')} placeholder={t('receiptRecon.search')} className={`${inputCls} w-full pl-9`} />
        </div>
        <SearchSelect value={filters.warehouseId} onChange={set('warehouseId')} className={inputCls} aria-label={t('receiptRecon.col.warehouse')}>
          <option value="">{t('receiptRecon.allWarehouses')}</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </SearchSelect>
        <label className="flex items-center gap-1 text-sm text-gray-600">{t('receiptRecon.from')}
          <input type="date" value={filters.fromDate} onChange={set('fromDate')} className={inputCls} aria-label={t('receiptRecon.from')} />
        </label>
        <label className="flex items-center gap-1 text-sm text-gray-600">{t('receiptRecon.to')}
          <input type="date" value={filters.toDate} onChange={set('toDate')} className={inputCls} aria-label={t('receiptRecon.to')} />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
          <input type="checkbox" checked={filters.onlyIssues} onChange={set('onlyIssues')} data-testid="recon-only-issues" /> {t('receiptRecon.onlyIssues')}
        </label>
      </div>

      {s && filters.onlyIssues && !s.errors && (
        <p className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800" data-testid="recon-no-issue">
          <CheckCircle2 size={16} /> {t('receiptRecon.noIssue')}
        </p>
      )}

      {data?.rows?.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm" data-testid="recon-table">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">{t('receiptRecon.col.status')}</th>
                <th className="px-3 py-2">{t('receiptRecon.col.grn')}</th>
                <th className="px-3 py-2">{t('receiptRecon.col.item')}</th>
                <th className="px-3 py-2">{t('receiptRecon.col.warehouse')}</th>
                <th className="px-3 py-2 text-right">{t('receiptRecon.col.accepted')}</th>
                <th className="px-3 py-2 text-right">{t('receiptRecon.col.expected')}</th>
                <th className="px-3 py-2 text-right">{t('receiptRecon.col.entered')}</th>
                <th className="px-3 py-2 text-right">{t('receiptRecon.col.reversed')}</th>
                <th className="px-3 py-2 text-right">{t('receiptRecon.col.poPrice')} / {t('receiptRecon.col.stockCost')}</th>
                <th className="px-3 py-2">{t('receiptRecon.col.movements')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.map(r => (
                <tr key={r.line_id} className={r.severity === 'error' ? 'bg-red-50/50' : ''}>
                  <td className="px-3 py-2">
                    <ResultBadge row={r} />
                    {r.checks.length > 1 && <div className="mt-1 text-xs text-red-700">{r.checks.slice(1).map(codeLabel).join(' · ')}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link to={`/goods-receipts/${r.grn_id}`} className="font-medium text-blue-600 hover:underline">{r.grn_number}</Link>
                    <div className="text-xs text-gray-500">{fmtDay(r.receipt_date)} · {r.po_id ? <Link to={`/purchase-orders/${r.po_id}`} className="hover:underline">{r.po_number}</Link> : '—'}</div>
                    {r.supplier_name && <div className="text-xs text-gray-400">{r.supplier_name}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {r.item_code && <span className="mr-1 font-mono text-xs font-semibold">{r.item_code}</span>}{r.item_name || r.item_description}
                    {r.lot_number && <div className="text-xs text-gray-500">{t('receiptRecon.col.lot')} {r.lot_number}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.warehouse_code || '—'}
                    {r.mv_warehouse_code && r.mv_warehouse_code !== r.warehouse_code && <div className="text-red-700">→ {r.mv_warehouse_code}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtQty(r.accepted)} <span className="text-xs text-gray-400">{r.unit}</span>
                    {Number(r.rejected) > 0 && <div className="text-xs text-gray-400">{t('receiptRecon.col.rejected')} {fmtQty(r.rejected)}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtQty(r.expected)}</td>
                  <td className={`px-3 py-2 text-right ${Math.abs(Number(r.entered) - r.expected) > 1e-6 && r.grn_status !== 'CANCELLED' ? 'font-semibold text-red-700' : ''}`}>{fmtQty(r.entered)}</td>
                  <td className="px-3 py-2 text-right">{Number(r.reversed) > 0 ? fmtQty(r.reversed) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">{fmtMoney(r.po_price)} / {fmtMoney(r.min_cost)} {r.currency}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">
                    {r.movement_numbers || '—'}
                    {r.reversal_numbers && <div className="text-green-700">↩ {r.reversal_numbers}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && !data.rows.length && !(filters.onlyIssues && s && !s.errors) && (
        <p className="py-10 text-center text-gray-500">{t('receiptRecon.empty')}</p>
      )}
    </div>
  );
}
