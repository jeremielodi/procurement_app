// src/components/SupplierPortal/SupplierOrderList.jsx
// Portail fournisseur — bons de commande reçus : à confirmer en premier, puis l'historique.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, RefreshCw, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { supplierPortalService } from '../../services/supplierPortalService';
import { t, getLocale } from '../../i18n';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale()) : '—');
const fmtMoney = (n, cur) => `${new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)} ${cur || ''}`;

/** État de la commande vu par le fournisseur */
export function OrderResponseBadge({ order }) {
  if (order.supplier_response === 'CONFIRMED' || order.status === 'PO_CONFIRMED') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-800"><CheckCircle2 size={12} /> {t('portal.orders.status.CONFIRMED')}</span>;
  }
  if (order.supplier_response === 'DECLINED') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800"><XCircle size={12} /> {t('portal.orders.status.DECLINED')}</span>;
  }
  if (order.awaiting_response) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"><Clock size={12} /> {t('portal.orders.status.TO_CONFIRM')}</span>;
  }
  return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{t(`badge.${order.status}`)}</span>;
}

export default function SupplierOrderList() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setOrders((await supplierPortalService.getOrders()).data || []); } catch { /* toast api */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toConfirm = orders.filter(o => o.awaiting_response && o.supplier_response !== 'DECLINED').length;

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ClipboardList /> {t('portal.orders.title')}</h1>
          <p className="text-sm text-gray-500">{t('portal.orders.subtitle')}</p>
        </div>
        <button onClick={load} className="rounded-lg border border-gray-300 p-2 hover:bg-gray-50" aria-label={t('common.refresh')} title={t('common.refresh')}><RefreshCw size={16} /></button>
      </div>

      {toConfirm > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('portal.orders.toConfirm', { count: toConfirm })}</div>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {loading ? <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>
          : orders.length === 0 ? <div className="p-10 text-center text-gray-500">{t('portal.orders.none')}</div>
          : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">{t('portal.orders.number')}</th>
                  <th className="px-4 py-2">{t('portal.orders.buyer')}</th>
                  <th className="px-4 py-2">{t('portal.orders.orderDate')}</th>
                  <th className="px-4 py-2">{t('portal.orders.requestedDelivery')}</th>
                  <th className="px-4 py-2 text-right">{t('portal.orders.amount')}</th>
                  <th className="px-4 py-2">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orders.map(o => (
                  <tr key={o.id} onClick={() => navigate(`/supplier/orders/${o.id}`)} className={`cursor-pointer hover:bg-gray-50 ${o.awaiting_response ? 'bg-amber-50/40' : ''}`} data-testid="supplier-order-row">
                    <td className="px-4 py-2 font-mono font-semibold text-blue-700">{o.po_number}</td>
                    <td className="px-4 py-2">{o.buyer_name || '—'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDate(o.order_date)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDate(o.confirmed_delivery_date || o.delivery_date)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{fmtMoney(o.total_amount, o.currency)}</td>
                    <td className="px-4 py-2"><OrderResponseBadge order={o} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
