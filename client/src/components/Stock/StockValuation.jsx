// src/components/Stock/StockValuation.jsx
// Valorisation du stock au coût moyen unitaire pondéré (CMUP) : à date, par dépôt (répartition) ou toute l'entreprise,
// totaux par devise, articles non valorisés (aucun coût connu / plusieurs devises), export Excel.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, RefreshCw, Download } from 'lucide-react';
import SearchSelect from '../Common/SearchSelect';
import { stockService, warehouseService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtMoney = (n, digits = 2) => new Intl.NumberFormat(getLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n) || 0);

export default function StockValuation() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ asOf: '', warehouseId: '' });

  useEffect(() => { warehouseService.list({ all: 1 }).then(r => setWarehouses(r.data || [])).catch(() => {}); }, []);
  const load = () => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    stockService.valuation(params).then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [filters]);
  const exportXlsx = async () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    const blob = await stockService.exportValuation(params);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `valorisation-stock-${filters.asOf || new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Coins /> {t('stock.valuation.title')}</h1>
          <p className="text-sm text-gray-500">{t('stock.valuation.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" aria-label={t('common.refresh')}><RefreshCw size={16} /></button>
          <button onClick={exportXlsx} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" data-testid="valuation-export"><Download size={16} /> Excel</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">{t('stock.valuation.asOf')}
          <input type="date" value={filters.asOf} max={new Date().toISOString().slice(0, 10)} onChange={e => setFilters(f => ({ ...f, asOf: e.target.value }))} className={inputCls} />
        </label>
        <SearchSelect value={filters.warehouseId} onChange={e => setFilters(f => ({ ...f, warehouseId: e.target.value }))} className={inputCls} aria-label={t('stock.warehouse')}>
          <option value="">{t('stock.valuation.allWarehouses')}</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name}</option>)}
        </SearchSelect>
      </div>

      {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div> : !data ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs text-gray-500">{t('stock.valuation.total')}</div>
              {data.totals.length === 0 ? <div className="text-xl font-bold text-gray-400">—</div>
                : data.totals.map(tot => <div key={tot.currency} className="text-2xl font-bold text-gray-900" data-testid="valuation-total">{fmtMoney(tot.value)} {tot.currency}</div>)}
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs text-gray-500">{t('stock.valuation.items')}</div>
              <div className="text-2xl font-bold text-gray-900">{data.items.length}</div>
            </div>
            <div className={`rounded-lg border p-4 ${data.notValued + data.mixedCurrency ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs text-gray-500">{t('stock.valuation.notValued')}</div>
              <div className="text-2xl font-bold text-gray-900">{data.notValued + data.mixedCurrency}</div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">{t('stock.code')}</th>
                  <th className="px-4 py-2">{t('stock.item')}</th>
                  <th className="px-4 py-2 text-right">{t('stock.quantity')}</th>
                  <th className="px-4 py-2 text-right">{t('stock.valuation.averageCost')}</th>
                  <th className="px-4 py-2 text-right">{t('stock.valuation.value')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map(r => (
                  <tr key={r.stock_item_id}>
                    <td className="px-4 py-2 font-mono font-semibold">{r.code}</td>
                    <td className="px-4 py-2"><Link to={`/stock/items/${r.stock_item_id}`} className="text-blue-600 hover:underline">{r.name}</Link></td>
                    <td className="px-4 py-2 text-right">{fmtQty(r.quantity)} <span className="text-xs text-gray-400">{r.unit}</span></td>
                    <td className="px-4 py-2 text-right">{r.average_cost !== null ? `${fmtMoney(r.average_cost, 4)} ${r.currency}` : '—'}</td>
                    <td className="px-4 py-2 text-right font-medium">
                      {r.value !== null ? `${fmtMoney(r.value)} ${r.currency}` : <span className="text-xs font-normal text-amber-700">{t(`stock.valuation.status.${r.status}`)}</span>}
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-500">{t('stock.valuation.none')}</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">{t('stock.valuation.method')}</p>
        </>
      )}
    </div>
  );
}
