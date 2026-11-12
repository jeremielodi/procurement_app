// src/components/PartnerPortal/PartnerTransferDetail.jsx
// Espace partenaire — un envoi : articles envoyés, confirmation de la réception ligne par ligne (quantité reçue ;
// équipement reçu / manquant ; manque = perte en transit signalée au magasin), bon PDF.
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Eye, PackageCheck, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import BlobPdfViewer from '../Common/BlobPdfViewer';
import { partnerPortalService } from '../../services/stockService';
import { IssueStatusBadge, ReceiveLinesTable, receiptState } from '../Stock/StockIssueDetail';
import { t, getLocale } from '../../i18n';

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function PartnerTransferDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [received, setReceived] = useState({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPdf, setShowPdf] = useState(false);

  const load = () => partnerPortalService.transfer(id).then(r => {
    setIssue(r.data);
    setReceived(Object.fromEntries((r.data.lines || []).map(l => [l.id, String(l.quantity)])));
  }).catch(() => setIssue(null)).finally(() => setLoading(false));
  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!issue) return <div className="p-6 text-gray-500">{t('partnerPortal.notFound')}</div>;

  const { receivedLines, invalid, shortLines } = receiptState(issue.lines, received);
  const confirm = async () => {
    if (invalid) { toast.error(t('stock.issue.receiveInvalid')); return; }
    setBusy(true);
    try {
      await partnerPortalService.receive(id, { comment: comment.trim() || undefined, lines: receivedLines });
      toast.success(shortLines ? t('stock.issue.receivedShort', { count: shortLines }) : t('partnerPortal.receivedOk'));
      setLoading(true);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.errorOccurred'));
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate('/partner/transfers')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>
        <button onClick={() => setShowPdf(true)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"><Eye size={16} /> {t('stock.issue.pdfTransfer')}</button>
      </div>
      {showPdf && <BlobPdfViewer title={issue.issue_number} fileName={`${issue.issue_number}.pdf`} fetchPdf={() => partnerPortalService.pdf(issue.id)} onClose={() => setShowPdf(false)} />}

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900"><PackageCheck className="text-blue-600" /> {issue.issue_number}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('partnerPortal.sentBy', { date: fmtDateTime(issue.issued_at), warehouse: issue.warehouse_name, location: issue.warehouse_location })}</p>
          {issue.issued_by_name && <p className="text-sm text-gray-500">{t('stock.issue.issuedBy', { name: issue.issued_by_name })}</p>}
        </div>
        <IssueStatusBadge issue={issue} />
      </div>
      {issue.purpose && <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm"><span className="text-xs text-gray-500">{t('stock.issue.purpose')}</span><p>{issue.purpose}</p></div>}

      {issue.can_receive ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">{t('partnerPortal.confirmTitle')}</h2>
          <p className="text-sm text-gray-600">{t('partnerPortal.confirmText')}</p>
          <ReceiveLinesTable lines={issue.lines} received={received} setReceived={setReceived} />
          {shortLines > 0 && !invalid && (
            <p className="rounded-lg border border-orange-200 bg-orange-50 p-2 text-xs text-orange-800">{t('stock.issue.receiveShortWarning', { count: shortLines })}</p>
          )}
          <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder={t('partnerPortal.commentPlaceholder')} aria-label={t('stock.issue.ackComment')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={confirm} disabled={busy || invalid} className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50" data-testid="partner-confirm-receipt">
            <CheckCircle2 size={16} /> {busy ? t('common.loading') : t('partnerPortal.confirm')}
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('stock.item')}</th>
                <th className="px-4 py-2">{t('stock.lot')}</th>
                <th className="px-4 py-2 text-right">{t('stock.issue.sentQty')}</th>
                <th className="px-4 py-2 text-right">{t('stock.issue.receivedQty')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {issue.lines.map(l => (
                <tr key={l.id}>
                  <td className="px-4 py-2"><span className="mr-1 font-mono font-semibold">{l.item_code}</span>{l.item_name}
                    {l.serial_number && <div className="font-mono text-xs text-indigo-700">{t('stock.equipment.serialLabel', { serial: l.serial_number })}{l.asset_tag && ` · ${l.asset_tag}`}</div>}
                  </td>
                  <td className="px-4 py-2 text-xs">{l.lot_number || '—'}</td>
                  <td className="px-4 py-2 text-right">{fmtQty(l.quantity)} <span className="text-xs text-gray-400">{l.unit}</span></td>
                  <td className={`px-4 py-2 text-right ${l.received_quantity === null ? 'text-gray-400' : l.received_quantity < l.quantity ? 'font-medium text-orange-700' : 'text-green-700'}`}>
                    {l.received_quantity === null ? '—' : fmtQty(l.received_quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {issue.acknowledged_at && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {t('stock.issue.acknowledgedOn', { name: issue.acknowledged_by_name || '—', date: fmtDateTime(issue.acknowledged_at) })}
          {issue.acknowledgement_comment && <> — « {issue.acknowledgement_comment} »</>}
        </div>
      )}
      {issue.status === 'CANCELLED' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">{t('partnerPortal.cancelled', { date: fmtDateTime(issue.cancelled_at), reason: issue.cancel_reason || '—' })}</div>
      )}
    </div>
  );
}
