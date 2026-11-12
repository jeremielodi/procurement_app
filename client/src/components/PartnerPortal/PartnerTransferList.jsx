// src/components/PartnerPortal/PartnerTransferList.jsx
// Espace partenaire — page d'accueil : partenaire, compteurs, envois reçus (à confirmer / reçus / annulés).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeartHandshake as Handshake, Inbox, CheckCircle2, Package, RefreshCw, MapPin } from 'lucide-react';
import { partnerPortalService } from '../../services/stockService';
import { IssueStatusBadge } from '../Stock/StockIssueDetail';
import { PartnerTypeBadge } from '../Stock/PartnerList';
import { t, getLocale } from '../../i18n';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale(), { dateStyle: 'medium' }) : '—');
const TABS = ['pending', 'received', 'cancelled', 'all'];

export default function PartnerTransferList() {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState(null);

  useEffect(() => { partnerPortalService.me().then(r => setMe(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    setRows(null);
    partnerPortalService.transfers({ status: tab === 'all' ? undefined : tab, limit: 200 }).then(r => setRows(r.data || [])).catch(() => setRows([]));
  }, [tab]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {me && (
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900"><Handshake className="text-blue-600" /> {me.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <PartnerTypeBadge type={me.partner_type} />
              <span className="flex items-center gap-1"><MapPin size={13} /> {me.location_name}</span>
              <span>· {t('partnerPortal.of', { enterprise: me.enterprise_name })}</span>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            {[['pending', me.pending_count, Inbox, 'text-amber-700'], ['received', me.received_count, CheckCircle2, 'text-green-700'], ['units', me.unit_count, Package, 'text-indigo-700']].map(([k, v, Icon, c]) => (
              <div key={k} className="rounded-lg border border-gray-200 px-4 py-2" data-testid={`partner-count-${k}`}>
                <div className={`flex items-center justify-center gap-1 text-lg font-bold ${c}`}><Icon size={16} /> {v}</div>
                <div className="text-xs text-gray-500">{t(`partnerPortal.counts.${k}`)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {me?.pending_count > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{t('partnerPortal.pendingBanner', { count: me.pending_count })}</div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap gap-1 border-b border-gray-200 px-3 pt-3">
          {TABS.map(k => (
            <button key={k} onClick={() => setTab(k)} data-testid={`partner-tab-${k}`}
              className={`rounded-t-lg px-3 py-2 text-sm ${tab === k ? 'border-b-2 border-blue-600 font-medium text-blue-700' : 'text-gray-600 hover:text-gray-900'}`}>
              {t(`partnerPortal.tabs.${k}`)}
            </button>
          ))}
        </div>
        {rows === null ? <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-blue-500" /></div>
          : rows.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">{t('partnerPortal.none')}</p>
          : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">{t('partnerPortal.number')}</th>
                  <th className="px-4 py-2">{t('partnerPortal.sentOn')}</th>
                  <th className="px-4 py-2">{t('partnerPortal.from')}</th>
                  <th className="px-4 py-2">{t('partnerPortal.items')}</th>
                  <th className="px-4 py-2">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(r => (
                  <tr key={r.id} data-testid="partner-transfer-row">
                    <td className="px-4 py-2 font-mono"><Link to={`/partner/transfers/${r.id}`} className="font-semibold text-blue-600 hover:underline">{r.issue_number}</Link></td>
                    <td className="px-4 py-2">{fmtDate(r.issued_at)}</td>
                    <td className="px-4 py-2">{r.warehouse_name}<div className="text-xs text-gray-500">{r.warehouse_location}</div></td>
                    <td className="px-4 py-2 text-xs text-gray-600">{r.items} <span className="text-gray-400">({t('partnerPortal.lines', { count: r.line_count })})</span></td>
                    <td className="px-4 py-2"><IssueStatusBadge issue={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
