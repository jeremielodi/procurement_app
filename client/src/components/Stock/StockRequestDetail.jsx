// src/components/Stock/StockRequestDetail.jsx
// Fiche d'une demande au magasin : lignes (demandé, validé, servi, reste, disponible au dépôt), bons de sortie qui l'ont
// servie, décisions. Actions selon les droits renvoyés par l'API : valider (quantités ajustables) / rejeter (validateur),
// servir (→ bon de sortie pré-rempli) / solder le reste (magasinier), retirer (demandeur, rien de servi).
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Check, X, PackageMinus, Ban, Undo2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { stockRequestService } from '../../services/stockRequestService';
import { RequestStatusBadge } from './StockRequestList';
import { requestError } from './StockRequestForm';
import { t, getLocale, useTranslation } from '../../i18n';

const fmtQty = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0));
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '—');
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function StockRequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lang } = useTranslation();
  const [r, setR] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // 'validate' | 'reject' | 'close' | 'cancel'
  const [reason, setReason] = useState('');
  const [validated, setValidated] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    stockRequestService.get(id).then(res => setR(res.data)).catch(() => setR(null)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [id, lang]);

  const open = (kind) => {
    setReason('');
    if (kind === 'validate') setValidated(Object.fromEntries(r.lines.map(l => [l.id, String(l.requested_quantity)])));
    setDialog(kind);
  };
  const act = async () => {
    setBusy(true);
    try {
      let res;
      if (dialog === 'validate') {
        res = await stockRequestService.validate(r.id, { comment: reason, lines: r.lines.map(l => ({ lineId: l.id, validatedQuantity: Number(validated[l.id]) || 0 })) });
      } else if (dialog === 'reject') res = await stockRequestService.reject(r.id, reason);
      else if (dialog === 'close') res = await stockRequestService.close(r.id, reason);
      else res = await stockRequestService.cancel(r.id, reason);
      toast.success(t(`stockRequests.done.${dialog}`));
      setDialog(null);
      setR(null);
      load();
      return res;
    } catch (err) {
      toast.error(requestError(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !r) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!r) return <div className="p-6 text-gray-500">{t('stockRequests.notFound')}</div>;
  const needsReason = ['reject', 'close'].includes(dialog);
  const destination = r.destination_type === 'DEPARTMENT' ? `${r.department_code} — ${r.department_name}` : r.requester_name;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ClipboardList /> {r.request_number} <RequestStatusBadge status={r.status} /></h1>
          <p className="text-sm text-gray-500">{t('stockRequests.byOn', { name: r.requester_name, date: fmtDateTime(r.created_at) })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.can_validate && <>
            <button onClick={() => open('validate')} className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700" data-testid="request-validate"><Check size={16} /> {t('stockRequests.actions.validate')}</button>
            <button onClick={() => open('reject')} className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50" data-testid="request-reject"><X size={16} /> {t('stockRequests.actions.reject')}</button>
          </>}
          {r.can_serve && (
            <Link to={`/stock/issues/new?requestId=${r.id}`} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700" data-testid="request-serve">
              <PackageMinus size={16} /> {t('stockRequests.actions.serve')}
            </Link>
          )}
          {r.can_close && <button onClick={() => open('close')} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50" data-testid="request-close"><Ban size={16} /> {t('stockRequests.actions.close')}</button>}
          {r.can_cancel && <button onClick={() => open('cancel')} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50" data-testid="request-cancel"><Undo2 size={16} /> {t('stockRequests.actions.cancel')}</button>}
        </div>
      </div>

      {r.self_validation && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-testid="request-awaiting">{t('stockRequests.awaitingValidation')}</div>}
      {r.status === 'REJECTED' && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{t('stockRequests.rejectedBy', { name: r.rejected_by_name, date: fmtDateTime(r.rejected_at), reason: r.reject_reason })}</div>}
      {r.status === 'CLOSED' && <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">{t('stockRequests.closedBy', { name: r.closed_by_name, date: fmtDateTime(r.closed_at), reason: r.close_reason })}</div>}
      {r.status === 'CANCELLED' && <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">{t('stockRequests.cancelledOn', { date: fmtDateTime(r.cancelled_at) })}{r.cancel_reason ? ` — ${r.cancel_reason}` : ''}</div>}

      <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><div className="text-xs text-gray-500">{t('stock.warehouse')}</div>{r.warehouse_location} — {r.warehouse_name}</div>
        <div><div className="text-xs text-gray-500">{t('stockRequests.forWhom')}</div>{t(`stockRequests.destination.${r.destination_type}`)} : {destination}</div>
        <div><div className="text-xs text-gray-500">{t('stock.issue.project')}</div>{r.project_code ? `${r.project_code} — ${r.project_name}` : '—'}</div>
        <div><div className="text-xs text-gray-500">{t('stockRequests.neededBy')}</div>{r.needed_by ? new Date(`${r.needed_by}T00:00:00`).toLocaleDateString(getLocale()) : '—'}</div>
        <div className="sm:col-span-2"><div className="text-xs text-gray-500">{t('stockRequests.purpose')}</div>{r.purpose}</div>
        {r.validated_at && <div className="sm:col-span-2 lg:col-span-3"><div className="text-xs text-gray-500">{t('stockRequests.validation')}</div>
          {t('stockRequests.validatedBy', { name: r.validated_by_name, date: fmtDateTime(r.validated_at) })}{r.validation_comment ? ` — ${r.validation_comment}` : ''}</div>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm" data-testid="request-lines">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('stock.item')}</th>
              <th className="px-4 py-2 text-right">{t('stockRequests.requested')}</th>
              <th className="px-4 py-2 text-right">{t('stockRequests.validated')}</th>
              <th className="px-4 py-2 text-right">{t('stockRequests.served')}</th>
              <th className="px-4 py-2 text-right">{t('stockRequests.remaining')}</th>
              <th className="px-4 py-2 text-right">{t('stock.issue.available')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {r.lines.map(l => (
              <tr key={l.id} data-testid="request-line">
                <td className="px-4 py-2"><b>{l.item_name}</b> <span className="font-mono text-xs text-gray-500">{l.item_code}</span></td>
                <td className="px-4 py-2 text-right">{fmtQty(l.requested_quantity)} <span className="text-xs text-gray-400">{l.unit}</span></td>
                <td className="px-4 py-2 text-right">{fmtQty(l.validated_quantity)}</td>
                <td className="px-4 py-2 text-right">{fmtQty(l.served_quantity)}</td>
                <td className="px-4 py-2 text-right font-semibold" data-testid="request-remaining">{['TO_SERVE', 'PARTIALLY_SERVED', 'PENDING_VALIDATION'].includes(r.status) ? fmtQty(l.remaining_quantity) : '—'}</td>
                <td className={`px-4 py-2 text-right ${l.available < l.remaining_quantity ? 'text-amber-700' : ''}`}>{fmtQty(l.available)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {r.issues.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <h2 className="border-b px-4 py-3 font-semibold text-gray-800">{t('stockRequests.issuesTitle')}</h2>
          <ul className="divide-y text-sm">
            {r.issues.map(i => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <Link to={`/stock/issues/${i.id}`} className="font-mono font-semibold text-blue-600 hover:underline">{i.issue_number}</Link>
                <span className="text-gray-600">{fmtDateTime(i.issued_at)} · {i.issued_by_name}</span>
                <span>{fmtQty(i.quantity)}</span>
                <span className={`text-xs ${i.status === 'CANCELLED' ? 'text-gray-500 line-through' : i.acknowledged_at ? 'text-green-700' : 'text-amber-700'}`}>
                  {i.status === 'CANCELLED' ? t('stockRequests.issueCancelled') : i.acknowledged_at ? t('stockRequests.issueAcknowledged') : t('stockRequests.issuePending')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal isOpen={!!dialog} onClose={() => setDialog(null)} title={dialog ? t(`stockRequests.dialog.${dialog}`) : ''}
        onConfirm={act} isLoading={busy} confirmDisabled={needsReason && !reason.trim()} confirmText={dialog ? t(`stockRequests.actions.${dialog}`) : ''}>
        <div className="space-y-3 text-sm">
          {dialog === 'validate' && (
            <>
              <p className="text-gray-600">{t('stockRequests.validateHint')}</p>
              <table className="w-full">
                <tbody className="divide-y">
                  {r.lines.map(l => (
                    <tr key={l.id}>
                      <td className="py-2">{l.item_name} <span className="text-xs text-gray-500">({t('stockRequests.requestedQty', { qty: fmtQty(l.requested_quantity), unit: l.unit })})</span></td>
                      <td className="py-2 text-right">
                        <input type="number" min="0" max={l.requested_quantity} step={l.track_serials ? 1 : 'any'} value={validated[l.id] ?? ''} aria-label={l.item_name}
                          onChange={e => setValidated(v => ({ ...v, [l.id]: e.target.value }))} className={`${inputCls} w-28`} data-testid="validate-quantity" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {dialog === 'close' && <p className="text-gray-600">{t('stockRequests.closeHint')}</p>}
          {dialog === 'cancel' && <p className="text-gray-600">{t('stockRequests.cancelHint')}</p>}
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">{t(needsReason ? 'stockRequests.reasonRequired' : 'stockRequests.comment')}</span>
            <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} className={inputCls} data-testid="request-dialog-reason" />
          </label>
        </div>
      </Modal>
    </div>
  );
}
