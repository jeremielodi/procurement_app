// src/components/PartnerPortal/PartnerHoldings.jsx
// Espace partenaire — matériel et articles reçus, non rendus (équipements « chez le partenaire » avec n° de série).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, RefreshCw } from 'lucide-react';
import { partnerPortalService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);

export default function PartnerHoldings() {
  const [rows, setRows] = useState(null);
  useEffect(() => { partnerPortalService.holdings().then(r => setRows(r.data || [])).catch(() => setRows([])); }, []);
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900"><Package className="text-blue-600" /> {t('partnerPortal.holdingsTitle')}</h1>
        <p className="text-sm text-gray-500">{t('partnerPortal.holdingsSubtitle')}</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {rows === null ? <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-blue-500" /></div>
          : rows.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">{t('partnerPortal.noHoldings')}</p>
          : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr><th className="px-4 py-2">{t('stock.item')}</th><th className="px-4 py-2">{t('partnerPortal.number')}</th><th className="px-4 py-2 text-right">{t('stock.return.held')}</th></tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(h => (
                  <tr key={h.issue_line_id} data-testid="partner-holding">
                    <td className="px-4 py-2"><span className="mr-1 font-mono font-semibold">{h.item_code}</span>{h.item_name}
                      {h.serial_number && <div className="font-mono text-xs text-indigo-700">{t('stock.equipment.serialLabel', { serial: h.serial_number })}{h.asset_tag && ` · ${h.asset_tag}`}</div>}
                      {h.lot_number && <div className="text-xs text-gray-500">{t('grn.lotLabel', { lot: h.lot_number })}</div>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs"><Link to={`/partner/transfers/${h.issue_id}`} className="text-blue-600 hover:underline">{h.issue_number}</Link></td>
                    <td className="px-4 py-2 text-right">{fmtQty(h.remaining)} <span className="text-xs text-gray-400">{h.unit}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
