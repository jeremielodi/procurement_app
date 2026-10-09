// src/components/Stock/StockIssueDetail.jsx
// Fiche d'un bon de sortie : type (employé / transfert / département), destination, dépôt, articles / lots, mouvements.
// Actions : confirmer la réception (bénéficiaire, responsable du département ou dépôt de destination — calculé par
// le serveur : can_acknowledge), annuler = écritures inverses (ISSUE_STOCK), retour, bon PDF.
// Transfert : en transit jusqu'à la réception au dépôt de destination, qui saisit les quantités reçues (manque = perte en transit).
// Utilisé par /stock/issues/:id (logistique) et /my-items/:id (bénéficiaire).
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, PackageMinus, CheckCircle2, Clock, Ban, Eye, RefreshCw, Undo2, Truck, AlertTriangle } from 'lucide-react';
import { ISSUE_TYPES } from './StockIssueForm';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import BlobPdfViewer from '../Common/BlobPdfViewer';
import { stockIssueService } from '../../services/stockService';
import { usePermissions } from '../../hooks/usePermissions';
import { t, getLocale } from '../../i18n';

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function IssueStatusBadge({ issue }) {
  if (issue.status === 'CANCELLED') return <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600"><Ban size={11} /> {t('stock.issue.status.CANCELLED')}</span>;
  const isTransfer = issue.destination_type === 'WAREHOUSE';
  if (issue.acknowledged_at) {
    const short = isTransfer && issue.lines?.some(l => l.received_quantity !== null && l.received_quantity < l.quantity);
    if (short) return <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800"><AlertTriangle size={11} /> {t('stock.issue.status.RECEIVED_SHORT')}</span>;
    return <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800"><CheckCircle2 size={11} /> {t(isTransfer ? 'stock.issue.status.RECEIVED' : 'stock.issue.status.ACKNOWLEDGED')}</span>;
  }
  if (isTransfer) return <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800"><Truck size={11} /> {t('stock.issue.status.IN_TRANSIT')}</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"><Clock size={11} /> {t('stock.issue.status.PENDING_ACK')}</span>;
}

/** Pastille du type de sortie */
export function IssueTypeBadge({ type }) {
  const [, Icon] = ISSUE_TYPES.find(([k]) => k === (type || 'USER')) || ISSUE_TYPES[0];
  const color = { USER: 'bg-blue-50 text-blue-800', WAREHOUSE: 'bg-violet-50 text-violet-800', DEPARTMENT: 'bg-teal-50 text-teal-800' }[type || 'USER'];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${color}`}><Icon size={12} /> {t(`stock.issue.types.${type || 'USER'}`)}</span>;
}

export default function StockIssueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPdf, setShowPdf] = useState(false);
  const [dialog, setDialog] = useState(null); // 'ack' | 'cancel'
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState({}); // lineId → quantité reçue (transfert)

  const load = () => stockIssueService.get(id).then(r => setIssue(r.data)).catch(() => setIssue(null)).finally(() => setLoading(false));
  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!issue) return <div className="p-6 text-gray-500">{t('stock.issue.notFound')}</div>;

  const type = issue.destination_type || 'USER';
  const isTransfer = type === 'WAREHOUSE';
  const canAck = !!issue.can_acknowledge;
  const hasReturns = issue.lines.some(l => l.returned_quantity > 0);
  const outstanding = issue.lines.some(l => l.returned_quantity < l.quantity);
  const canCancel = issue.status === 'ISSUED' && !hasReturns && hasPermission('ISSUE_STOCK');
  const canReturn = !isTransfer && issue.status === 'ISSUED' && outstanding && hasPermission('ISSUE_STOCK');
  const returnLink = type === 'DEPARTMENT' ? `/stock/returns/new?departmentId=${issue.department_id}` : `/stock/returns/new?userId=${issue.recipient_id}`;
  const ackPrompt = isTransfer ? t('stock.issue.ackTransferPrompt') : type === 'DEPARTMENT' ? t('stock.issue.ackDeptPrompt') : t('stock.issue.ackPrompt');

  const openAck = () => {
    setDialog('ack');
    setText('');
    setReceived(Object.fromEntries(issue.lines.map(l => [l.id, String(l.quantity)])));
  };
  const receivedLines = issue.lines.map(l => ({ lineId: l.id, receivedQuantity: Number(String(received[l.id] ?? '').replace(',', '.')) }));
  const invalidReceipt = isTransfer && receivedLines.some((r, i) => !Number.isFinite(r.receivedQuantity) || r.receivedQuantity < 0
    || r.receivedQuantity > issue.lines[i].quantity || String(received[issue.lines[i].id] ?? '').trim() === '');
  const shortLines = isTransfer ? receivedLines.filter((r, i) => r.receivedQuantity < issue.lines[i].quantity).length : 0;

  const confirm = async () => {
    if (dialog === 'cancel' && !text.trim()) { toast.error(t('stock.issue.cancelReasonRequired')); return; }
    if (dialog === 'ack' && invalidReceipt) { toast.error(t('stock.issue.receiveInvalid')); return; }
    setBusy(true);
    try {
      if (dialog === 'ack' && isTransfer) {
        await stockIssueService.receive(id, { comment: text.trim() || undefined, lines: receivedLines });
        toast.success(shortLines ? t('stock.issue.receivedShort', { count: shortLines }) : t('stock.issue.received'));
      } else if (dialog === 'ack') { await stockIssueService.acknowledge(id, text.trim() || undefined); toast.success(t('stock.issue.acknowledged')); }
      else { await stockIssueService.cancel(id, text.trim()); toast.success(isTransfer ? t('stock.issue.transferCancelled') : t('stock.issue.cancelled')); }
      setDialog(null);
      setText('');
      await load();
    } catch { /* toast api */ } finally { setBusy(false); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>
        <div className="flex gap-2">
          {canReturn && (
            <Link to={returnLink} className="flex items-center gap-2 rounded-lg border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50">
              <Undo2 size={16} /> {t('stock.return.record')}
            </Link>
          )}
          {canCancel && (
            <button onClick={() => { setDialog('cancel'); setText(''); }} className="flex items-center gap-2 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
              <Ban size={16} /> {isTransfer ? t('stock.issue.cancelTransfer') : t('stock.issue.cancel')}
            </button>
          )}
          <button onClick={() => setShowPdf(true)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"><Eye size={16} /> {isTransfer ? t('stock.issue.pdfTransfer') : t('stock.issue.pdf')}</button>
          {canAck && (
            <button onClick={openAck} className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700" data-testid="issue-ack">
              <CheckCircle2 size={16} /> {isTransfer ? t('stock.issue.receive') : t('stock.issue.acknowledge')}
            </button>
          )}
        </div>
      </div>

      {showPdf && (
        <BlobPdfViewer title={issue.issue_number} fileName={`${issue.issue_number}.pdf`} fetchPdf={() => stockIssueService.pdf(issue.id)} onClose={() => setShowPdf(false)} />
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900"><PackageMinus className="text-blue-600" /> {issue.issue_number}</h1>
          <p className="mt-1 text-sm text-gray-500">{fmtDateTime(issue.issued_at)} · {t('stock.issue.issuedBy', { name: issue.issued_by_name || '—' })}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <IssueTypeBadge type={type} />
          <IssueStatusBadge issue={issue} />
        </div>
      </div>

      {canAck && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{ackPrompt}</div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {[
          type === 'USER' && [t('stock.issue.recipient'), <><b>{issue.recipient_name}</b><div className="text-xs text-gray-500">{issue.recipient_email}</div></>],
          type === 'DEPARTMENT' && [t('stock.issue.department'), <><b>{issue.department_name}</b><div className="text-xs text-gray-500">{issue.department_code}{issue.recipient_id && <> · {t('stock.issue.collectedByLabel')} : {issue.recipient_name}</>}</div></>],
          [isTransfer ? t('stock.issue.sourceWarehouse') : t('stock.warehouse'), <><b>{issue.warehouse_name}</b><div className="text-xs text-gray-500">{issue.warehouse_location} · {issue.warehouse_code}</div></>],
          isTransfer && [`→ ${t('stock.issue.destinationWarehouse')}`, <><b>{issue.destination_warehouse_name}</b><div className="text-xs text-gray-500">{issue.destination_warehouse_location} · {issue.destination_warehouse_code}</div></>],
          !isTransfer && [t('stock.issue.projectLabel'), issue.project_name ? <><b>{issue.project_code}</b><div className="text-xs text-gray-500">{issue.project_name}</div></> : '—'],
        ].filter(Boolean).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <div className="mb-1 text-xs text-gray-500">{label}</div>{value}
          </div>
        ))}
      </div>
      {issue.purpose && <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm"><span className="text-xs text-gray-500">{t('stock.issue.purpose')}</span><p>{issue.purpose}</p></div>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('stock.item')}</th>
              <th className="px-4 py-2">{t('stock.lot')}</th>
              <th className="px-4 py-2 text-right">{t('stock.quantity')}</th>
              {!isTransfer && <th className="px-4 py-2 text-right">{t('stock.return.returned')}</th>}
              {isTransfer && <th className="px-4 py-2 text-right">{t('stock.issue.receivedQty')}</th>}
              <th className="px-4 py-2">{isTransfer ? t('stock.issue.transferMovements') : t('stock.issue.movements')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {issue.lines.map(l => (
              <tr key={l.id}>
                <td className="px-4 py-2"><span className="mr-1 font-mono font-semibold">{l.item_code}</span>{l.item_name}
                  {l.serial_number && <div className="font-mono text-xs text-indigo-700">{t('stock.equipment.serialLabel', { serial: l.serial_number })}{l.asset_tag && ` · ${l.asset_tag}`}</div>}
                </td>
                <td className="px-4 py-2 text-xs">{l.lot_number ? <>{l.lot_number}{l.expiry_date && <div className="text-gray-400">{new Date(l.expiry_date).toLocaleDateString(getLocale())}</div>}</> : '—'}</td>
                <td className="px-4 py-2 text-right font-medium">{fmtQty(l.quantity)} <span className="text-xs text-gray-400">{l.unit}</span></td>
                {!isTransfer && <td className={`px-4 py-2 text-right ${l.returned_quantity > 0 ? 'text-blue-700' : 'text-gray-400'}`}>{fmtQty(l.returned_quantity)}</td>}
                {isTransfer && (
                  <td className={`px-4 py-2 text-right ${l.received_quantity === null ? 'text-gray-400' : l.received_quantity < l.quantity ? 'font-medium text-orange-700' : 'text-green-700'}`}>
                    {l.received_quantity === null ? (issue.status === 'ISSUED' ? t('stock.issue.inTransitShort') : '—') : fmtQty(l.received_quantity)}
                    {l.received_quantity !== null && l.received_quantity < l.quantity && <div className="text-xs">{t('stock.issue.transitLoss', { qty: fmtQty(l.quantity - l.received_quantity) })}</div>}
                  </td>
                )}
                <td className="px-4 py-2 font-mono text-xs text-gray-500">
                  {l.movement_number}{l.transfer_in_movement_number && <> → {l.transfer_in_movement_number}</>}
                  {l.reversal_movement_number && <span className="text-green-700"> ↩ {l.reversal_out_movement_number ? `${l.reversal_out_movement_number} → ` : ''}{l.reversal_movement_number}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {issue.acknowledged_at && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {t('stock.issue.acknowledgedOn', { name: issue.acknowledged_by_name || issue.recipient_name || '—', date: fmtDateTime(issue.acknowledged_at) })}
          {issue.acknowledgement_comment && <> — « {issue.acknowledgement_comment} »</>}
        </div>
      )}
      {issue.status === 'CANCELLED' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          {t('stock.issue.cancelledOn', { name: issue.cancelled_by_name || '—', date: fmtDateTime(issue.cancelled_at), reason: issue.cancel_reason || '—' })}
        </div>
      )}

      <Modal
        isOpen={!!dialog}
        onClose={() => !busy && setDialog(null)}
        title={dialog === 'ack' ? t('stock.issue.ackTitle') : t('stock.issue.cancelTitle', { number: issue.issue_number })}
        type={dialog === 'ack' ? 'success' : 'danger'}
        size={dialog === 'ack' && isTransfer ? 'lg' : 'sm'}
        confirmText={dialog === 'ack' ? (isTransfer ? t('stock.issue.receive') : t('stock.issue.acknowledge')) : t('stock.issue.cancel')}
        onConfirm={confirm}
        isLoading={busy}
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p>{dialog === 'ack'
            ? (isTransfer ? t('stock.issue.ackTransferText', { name: issue.destination_warehouse_name }) : t('stock.issue.ackText'))
            : (isTransfer ? (issue.acknowledged_at ? t('stock.issue.cancelReceivedTransferText') : t('stock.issue.cancelTransferText')) : t('stock.issue.cancelText'))}</p>
          {dialog === 'ack' && isTransfer && (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm" data-testid="receive-lines">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2">{t('stock.item')}</th>
                    <th className="px-3 py-2 text-right">{t('stock.issue.sentQty')}</th>
                    <th className="px-3 py-2 text-right">{t('stock.issue.receivedQty')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {issue.lines.map(l => {
                    const value = received[l.id] ?? '';
                    const short = Number(String(value).replace(',', '.')) < l.quantity;
                    return (
                      <tr key={l.id} className={short ? 'bg-orange-50' : ''}>
                        <td className="px-3 py-2"><span className="mr-1 font-mono text-xs font-semibold">{l.item_code}</span>{l.item_name}
                          {l.serial_number && <div className="font-mono text-xs text-indigo-700">{t('stock.equipment.serialLabel', { serial: l.serial_number })}</div>}
                          {l.lot_number && <div className="text-xs text-gray-500">{t('stock.lot')} {l.lot_number}</div>}
                        </td>
                        <td className="px-3 py-2 text-right">{fmtQty(l.quantity)} <span className="text-xs text-gray-400">{l.unit}</span></td>
                        <td className="px-3 py-2 text-right">
                          {l.unit_id ? (
                            <label className="inline-flex items-center gap-2 text-xs">
                              <input type="checkbox" checked={value !== '0'} onChange={e => setReceived(r => ({ ...r, [l.id]: e.target.checked ? '1' : '0' }))} />
                              {value !== '0' ? t('stock.issue.unitReceived') : t('stock.issue.unitMissing')}
                            </label>
                          ) : (
                            <input type="number" min="0" max={l.quantity} step="any" value={value}
                              onChange={e => setReceived(r => ({ ...r, [l.id]: e.target.value }))}
                              aria-label={t('stock.issue.receivedQty')}
                              className="w-28 rounded border border-gray-300 px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {dialog === 'ack' && isTransfer && shortLines > 0 && !invalidReceipt && (
            <p className="rounded-lg border border-orange-200 bg-orange-50 p-2 text-xs text-orange-800">{t('stock.issue.receiveShortWarning', { count: shortLines })}</p>
          )}
          <textarea rows={2} value={text} onChange={e => setText(e.target.value)}
            placeholder={dialog === 'ack' ? t('stock.issue.ackComment') : t('stock.issue.cancelReason')}
            aria-label={dialog === 'ack' ? t('stock.issue.ackComment') : t('stock.issue.cancelReason')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </Modal>
    </div>
  );
}
