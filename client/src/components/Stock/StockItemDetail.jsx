// src/components/Stock/StockItemDetail.jsx
// Fiche article : caractéristiques, stock par dépôt et par lot, lots (péremption), derniers mouvements.
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Package, RefreshCw, AlertTriangle } from 'lucide-react';
import { stockItemService, stockService } from '../../services/stockService';
import { MovementTable } from './StockMovements';
import { t, getLocale, useTranslation } from '../../i18n';

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale()) : '—');

export default function StockItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lang } = useTranslation();
  const [item, setItem] = useState(null);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([stockItemService.get(id), stockService.movements({ stockItemId: id, limit: 30 })])
      .then(([i, m]) => { setItem(i.data); setMovements(m.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, lang]);

  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!item) return <div className="p-6 text-gray-500">{t('stock.items.notFound')}</div>;

  const low = item.min_quantity !== null && Number(item.stock_quantity) < Number(item.min_quantity);
  const byWarehouse = new Map();
  for (const b of item.balances || []) {
    const key = b.warehouse_id;
    const agg = byWarehouse.get(key) || { name: b.warehouse_name, location: b.location_name, quantity: 0 };
    agg.quantity += Number(b.quantity);
    byWarehouse.set(key, agg);
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm">
        <ArrowLeft size={16} /> {t('common.back')}
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Package /> {item.name}</h1>
          <p className="text-sm text-gray-500">
            <span className="font-mono font-semibold">{item.code}</span> · {item.unit}{item.category_name && ` · ${item.category_name}`}
            {!item.is_active && <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs">{t('refs.inactive')}</span>}
          </p>
          {item.description && <p className="mt-2 text-sm text-gray-600">{item.description}</p>}
        </div>
        <div className={`rounded-lg border p-4 text-right ${low ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
          <div className="text-xs text-gray-500">{t('stock.inStock')}</div>
          <div className={`text-2xl font-bold ${low ? 'text-red-600' : 'text-gray-900'}`}>{item.is_stockable ? `${fmtQty(item.stock_quantity)} ${item.unit}` : '—'}</div>
          {item.min_quantity !== null && <div className="text-xs text-gray-500">{low && <AlertTriangle size={12} className="mr-1 inline text-red-600" />}{t('stock.minimum')} : {fmtQty(item.min_quantity)}</div>}
        </div>
      </div>

      {!item.is_stockable ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">{t('stock.items.notStockableHint')}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="bg-white border border-gray-200 rounded-lg">
            <h2 className="px-4 py-3 border-b font-semibold text-gray-800">{t('stock.items.byWarehouse')}</h2>
            {byWarehouse.size === 0 ? <p className="p-4 text-sm text-gray-500">{t('stock.overview.empty')}</p> : (
              <ul className="divide-y text-sm">
                {[...byWarehouse.entries()].map(([wid, w]) => (
                  <li key={wid} className="flex justify-between px-4 py-2">
                    <Link to={`/stock?warehouseId=${wid}`} className="text-blue-600 hover:underline">{w.name} <span className="text-xs text-gray-400">({w.location})</span></Link>
                    <span className="font-medium">{fmtQty(w.quantity)} {item.unit}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {item.track_lots && (
            <div className="bg-white border border-gray-200 rounded-lg">
              <h2 className="px-4 py-3 border-b font-semibold text-gray-800">{t('stock.items.lotsTitle')}</h2>
              {(item.lots || []).length === 0 ? <p className="p-4 text-sm text-gray-500">{t('stock.items.noLots')}</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-gray-500"><tr>
                    <th className="px-4 py-2">{t('stock.lot')}</th><th className="px-4 py-2">{t('stock.expiry')}</th>
                    <th className="px-4 py-2">{t('common.supplier')}</th><th className="px-4 py-2 text-right">{t('stock.quantity')}</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {item.lots.map(l => {
                      const expired = l.expiry_date && new Date(l.expiry_date) < new Date(new Date().toISOString().slice(0, 10));
                      return (
                        <tr key={l.id} className={Number(l.quantity) <= 0 ? 'text-gray-400' : ''}>
                          <td className="px-4 py-2 font-mono">{l.lot_number}</td>
                          <td className={`px-4 py-2 ${expired ? 'text-red-600 font-semibold' : ''}`}>{fmtDate(l.expiry_date)}{expired && ` (${t('stock.expired')})`}</td>
                          <td className="px-4 py-2">{l.supplier_name || '—'}</td>
                          <td className="px-4 py-2 text-right">{fmtQty(l.quantity)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-semibold text-gray-800">{t('stock.items.lastMovements')}</h2>
          <Link to={`/stock/movements`} className="text-sm text-blue-600 hover:underline">{t('stock.items.allMovements')}</Link>
        </div>
        {movements.length === 0 ? <p className="p-4 text-sm text-gray-500">{t('stock.mv.none')}</p> : <MovementTable rows={movements} showItem={false} />}
      </div>
    </div>
  );
}
