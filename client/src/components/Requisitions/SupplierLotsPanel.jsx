// src/components/Requisitions/SupplierLotsPanel.jsx
// Réquisition répartie entre plusieurs fournisseurs : une part par fournisseur (articles, pro-forma, bon de commande
// et son avancement). Rien n'est affiché sans répartition.
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Split, CheckCircle, Paperclip } from 'lucide-react';
import requisitionService from '../../services/requisitionService';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { t } from '../../i18n';

export default function SupplierLotsPanel({ requisitionId }) {
  const { formatAmount } = useCurrency();
  const { data } = useQuery({
    queryKey: ['requisition-supplier-lots', requisitionId],
    queryFn: () => requisitionService.getSupplierLots(requisitionId),
    enabled: !!requisitionId,
  });
  const lots = data?.data || [];
  if (!lots.length) return null;

  const paid = lots.filter(l => l.paid).length;
  return (
    <div className="bg-white rounded-lg shadow" data-testid="supplier-lots-panel">
      <div className="p-4 border-b border-gray-200 flex flex-wrap items-center gap-2">
        <Split size={20} className="text-indigo-600" />
        <h2 className="text-lg font-semibold flex-1">{t('split.panelTitle', { count: lots.length })}</h2>
        <span className="text-sm text-gray-500">{t('split.panelPaid', { paid, total: lots.length })}</span>
      </div>
      <div className="divide-y divide-gray-100">
        {lots.map(lot => (
          <div key={lot.id} className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm" data-testid="supplier-lot-row">
            <div>
              <p className="font-medium text-gray-800">{t('split.lotLabel', { number: lot.lot_number, supplier: lot.supplier_name })}</p>
              <p className="text-gray-500">{t('split.lotSummary', { count: lot.items.length, amount: formatAmount(lot.estimated_amount) })}</p>
              {lot.attachment_id && (
                <p className="text-gray-500 flex items-center gap-1 mt-1">
                  <Paperclip size={12} /> {lot.attachment_name || t('split.proforma')}
                </p>
              )}
            </div>
            <ul className="text-gray-600 list-disc pl-5">
              {lot.items.map(i => <li key={i.id}>{i.item_description}</li>)}
            </ul>
            <div className="md:text-right">
              {lot.po_id ? (
                <>
                  <Link to={`/purchase-orders/${lot.po_id}`} className="font-medium text-blue-600 hover:underline">{lot.po_number}</Link>
                  <p className="text-gray-500">{t(`badge.${lot.po_status}`, { defaultValue: lot.po_status })}</p>
                  {lot.paid && (
                    <p className="text-green-700 inline-flex items-center gap-1"><CheckCircle size={14} /> {t('split.lotPaid')}</p>
                  )}
                </>
              ) : (
                <p className="text-amber-700">{t('split.noPurchaseOrder')}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
