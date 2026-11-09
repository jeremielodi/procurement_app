// src/components/Stock/StockItemPlanning.jsx
// Fiche article : prévision du réapprovisionnement par dépôt (CMM, seuils, à commander) + total de l'entreprise,
// et consommation des 12 derniers mois (sorties − annulations − retours ; dépôt choisi ou tous).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import SearchSelect from '../Common/SearchSelect';
import { stockService } from '../../services/stockService';
import { PlanningStatusBadge } from './StockPlanning';
import { t, getLocale, useTranslation } from '../../i18n';

const fmt = (n, digits = 2) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits }).format(Number(n) || 0));
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(getLocale(), { month: 'short', year: '2-digit' });

export default function StockItemPlanning({ itemId, unit }) {
  const { lang } = useTranslation();
  const [warehouseId, setWarehouseId] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    stockService.planningItem(itemId, warehouseId ? { warehouseId } : {}).then(r => setData(r.data)).catch(() => setData(null));
  }, [itemId, warehouseId, lang]);
  if (!data) return null;

  const rows = [...data.warehouses, ...(data.total && data.warehouses.length > 1 ? [{ ...data.total, total: true }] : [])];
  const months = data.months.map(m => ({ ...m, label: monthLabel(m.month) }));
  const hasConsumption = months.some(m => m.consumption > 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg" data-testid="item-planning">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b">
        <h2 className="flex items-center gap-2 font-semibold text-gray-800"><TrendingUp size={16} /> {t('stock.planning.itemTitle')}</h2>
        <Link to="/stock/planning" className="text-sm text-blue-600 hover:underline">{t('stock.planning.openScreen')}</Link>
      </div>
      {rows.length === 0 ? <p className="p-4 text-sm text-gray-500">{t('stock.planning.none')}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('stock.warehouse')}</th>
                <th className="px-4 py-2">{t('stock.planning.col.status')}</th>
                <th className="px-4 py-2 text-right">{t('stock.planning.col.stock')}</th>
                <th className="px-4 py-2 text-right">{t('stock.planning.col.amc')}</th>
                <th className="px-4 py-2 text-right">{t('stock.planning.col.months')}</th>
                <th className="px-4 py-2 text-right" title={t('stock.planning.col.thresholdsHint')}>{t('stock.planning.col.thresholds')}</th>
                <th className="px-4 py-2 text-right">{t('stock.planning.col.onOrder')}</th>
                <th className="px-4 py-2 text-right">{t('stock.planning.col.toOrder')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={r.warehouseId || 'total'} className={r.total ? 'bg-gray-50 font-semibold' : ''}>
                  <td className="px-4 py-2">{r.total ? t('stock.planning.enterpriseTotal') : r.warehouseName}</td>
                  <td className="px-4 py-2"><PlanningStatusBadge status={r.status} /></td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{fmt(r.stock, 4)} <span className="text-xs text-gray-400">{unit}</span></td>
                  <td className="px-4 py-2 text-right">{r.amc > 0 ? fmt(r.amc) : '—'}</td>
                  <td className="px-4 py-2 text-right">{r.monthsOfStock !== null ? fmt(r.monthsOfStock, 1) : '—'}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-600 whitespace-nowrap">
                    {r.basis === 'AMC' ? `${fmt(r.safetyStock, 0)} / ${fmt(r.minStock, 0)} / ${fmt(r.maxStock, 0)}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">{(r.onOrder + r.requested) > 0 ? fmt(r.onOrder + r.requested, 4) : '—'}</td>
                  <td className="px-4 py-2 text-right">{r.toOrder > 0 ? fmt(r.toOrder, 0) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-700">{t('stock.planning.monthlyConsumption', { unit })}</h3>
          {data.warehouses.length > 1 && (
            <SearchSelect value={warehouseId} onChange={e => setWarehouseId(e.target.value)} aria-label={t('stock.warehouse')}
              className="px-2 py-1 border border-gray-300 rounded-lg text-xs">
              <option value="">{t('stock.planning.allWarehouses')}</option>
              {data.warehouses.map(w => <option key={w.warehouseId} value={w.warehouseId}>{w.warehouseName}</option>)}
            </SearchSelect>
          )}
        </div>
        {!hasConsumption ? <p className="py-6 text-center text-sm text-gray-500">{t('stock.planning.noConsumption')}</p> : (
          <div className="h-48" data-testid="item-consumption-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={{ stroke: '#D1D5DB' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'rgba(37, 99, 235, 0.08)' }} formatter={(v) => [`${fmt(v, 4)} ${unit}`, t('stock.planning.consumption')]} />
                <Bar dataKey="consumption" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
