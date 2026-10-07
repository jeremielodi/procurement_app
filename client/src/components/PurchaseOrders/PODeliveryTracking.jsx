// src/components/PurchaseOrders/PODeliveryTracking.jsx
// Suivi des livraisons d'un bon de commande : par ligne, commandé / reçu / accepté / rejeté / reste à livrer,
// et liste des réceptions (GRN). Le rejeté reste dû : reste = commandé − accepté.
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Truck, PackageCheck } from 'lucide-react';
import { deliveryService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);

const BADGE = {
  DELIVERED: 'bg-green-100 text-green-800',
  PARTIALLY_DELIVERED: 'bg-amber-100 text-amber-800',
  NOT_DELIVERED: 'bg-gray-100 text-gray-700',
};

export function DeliveryStatusBadge({ status, className = '' }) {
  if (!status) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[status] || BADGE.NOT_DELIVERED} ${className}`}>
      <Truck size={11} /> {t(`delivery.status.${status}`)}
    </span>
  );
}

export default function PODeliveryTracking({ poId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['po-delivery', String(poId)],
    queryFn: () => deliveryService.get(poId),
    enabled: !!poId,
  });
  const delivery = data?.data;
  if (isLoading || !delivery || !delivery.items?.length) return null;

  const { totals } = delivery;
  const percent = totals.ordered > 0 ? Math.min(100, Math.round((totals.accepted / totals.ordered) * 100)) : 0;

  return (
    <div className="bg-white rounded-lg shadow" data-testid="po-delivery">
      <div className="p-6 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <Truck size={20} /> {t('delivery.title')}
        </h2>
        <div className="flex items-center gap-3">
          <div className="w-40 h-2 rounded-full bg-gray-100 overflow-hidden" title={t('delivery.progress', { percent })}>
            <div className={`h-full ${percent >= 100 ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${percent}%` }} />
          </div>
          <span className="text-sm text-gray-600">{percent} %</span>
          <DeliveryStatusBadge status={delivery.deliveryStatus} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-6 py-3 text-left font-medium">{t('common.description')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('delivery.ordered')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('delivery.received')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('delivery.accepted')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('delivery.rejected')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('delivery.remaining')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {delivery.items.map(item => (
              <tr key={item.id}>
                <td className="px-6 py-3 text-gray-800">
                  {item.item_code && <span className="mr-1 rounded bg-indigo-50 px-1 text-xs font-semibold text-indigo-700">{item.item_code}</span>}
                  {item.item_description}
                  {item.unit && <span className="ml-1 text-xs text-gray-400">({item.unit})</span>}
                </td>
                <td className="px-4 py-3 text-right">{fmtQty(item.quantity)}</td>
                <td className="px-4 py-3 text-right">{fmtQty(item.delivered_received)}</td>
                <td className="px-4 py-3 text-right text-green-700">{fmtQty(item.delivered_accepted)}</td>
                <td className={`px-4 py-3 text-right ${item.delivered_rejected > 0 ? 'text-red-600' : 'text-gray-400'}`}>{fmtQty(item.delivered_rejected)}</td>
                <td className={`px-4 py-3 text-right font-semibold ${item.quantity_remaining > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                  {item.quantity_remaining > 0 ? fmtQty(item.quantity_remaining) : t('delivery.done')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {delivery.receipts.length > 0 && (
        <div className="border-t border-gray-100 px-6 py-4">
          <p className="mb-2 text-xs font-medium uppercase text-gray-500">{t('delivery.receipts')}</p>
          <ul className="space-y-1 text-sm">
            {delivery.receipts.map(g => (
              <li key={g.id} className={`flex flex-wrap items-center gap-x-3 ${g.status === 'CANCELLED' ? 'text-gray-400 line-through' : ''}`}>
                <PackageCheck size={14} className="text-gray-400" />
                <Link to={`/goods-receipts/${g.id}`} className="font-medium text-blue-600 hover:underline">{g.grn_number}</Link>
                <span>{g.receipt_date ? new Date(g.receipt_date).toLocaleDateString(getLocale()) : '—'}</span>
                {g.warehouse_name && <span className="text-gray-500">{g.warehouse_name}</span>}
                <span className="text-gray-500">{t('delivery.receiptLine', { accepted: fmtQty(g.quantity_accepted), rejected: fmtQty(g.quantity_rejected) })}</span>
                {g.status === 'CANCELLED' && <span className="no-underline text-xs">({t('grnStatus.CANCELLED')})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
