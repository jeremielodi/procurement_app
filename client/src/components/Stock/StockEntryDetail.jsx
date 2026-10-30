// src/components/Stock/StockEntryDetail.jsx
// Fiche d'un bon d'entrée en stock : type, provenance, dépôt, projet, articles (lots, n° de série, coûts), mouvements.
// Actions calculées par le serveur : valider / refuser (VALIDATE_STOCK_ENTRIES, jamais son propre bon), retirer (auteur,
// en attente), annuler un bon validé (écritures inverses) ; bon PDF à signer.
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, PackagePlus, CheckCircle2, Clock, Ban, Eye, RefreshCw, XCircle, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import BlobPdfViewer from '../Common/BlobPdfViewer';
import { stockEntryService } from '../../services/stockService';
import { ENTRY_TYPES, entryErrorMessage } from './StockEntryForm';
import { t, getLocale } from '../../i18n';

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtMoney = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const STATUS_STYLES = {
  PENDING: ['bg-amber-100 text-amber-800', Clock],
  VALIDATED: ['bg-green-100 text-green-800', CheckCircle2],
  REJECTED: ['bg-red-100 text-red-700', XCircle],
  CANCELLED: ['bg-gray-200 text-gray-600', Ban],
};

export function EntryStatusBadge({ status }) {
  const [cls, Icon] = STATUS_STYLES[status] || STATUS_STYLES.PENDING;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${cls}`} data-testid="entry-status"><Icon size={11} /> {t(`stock.entry.status.${status}`)}</span>;
}

export function EntryTypeBadge({ type }) {
  const [, Icon] = ENTRY_TYPES.find(([k]) => k === type) || ENTRY_TYPES[0];
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800"><Icon size={12} /> {t(`stock.entry.types.${type}`)}</span>;
}

export default function StockEntryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPdf, setShowPdf] = useState(false);
  const [dialog, setDialog] = useState(null); // 'validate' | 'reject' | 'withdraw' | 'cancel'
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => stockEntryService.get(id).then(r => setEntry(r.data)).catch(() => setEntry(null)).finally(() => setLoading(false));
  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!entry) return <div className="p-6 text-gray-500">{t('stock.entry.notFound')}</div>;

  const hasCost = entry.lines.some(l => l.unit_cost !== null);
  const needsReason = dialog && dialog !== 'validate';

  const confirm = async () => {
    if (needsReason && !text.trim()) { toast.error(t('stock.entry.reasonRequired')); return; }
    setBusy(true);
    try {
      if (dialog === 'validate') { await stockEntryService.validate(id, text.trim() || undefined); toast.success(t('stock.entry.validated')); }
      else if (dialog === 'reject') { await stockEntryService.reject(id, text.trim()); toast.success(t('stock.entry.rejected')); }
      else { await stockEntryService.cancel(id, text.trim()); toast.success(t(dialog === 'withdraw' ? 'stock.entry.withdrawn' : 'stock.entry.cancelled')); }
      setDialog(null);
      setText('');
      await load();
    } catch (err) {
      if (err.response?.data?.code || err.response?.data?.message) toast.error(entryErrorMessage(err));
    } finally { setBusy(false); }
  };

  const open = (kind) => { setDialog(kind); setText(''); };
  const dialogs = {
    validate: { title: t('stock.entry.validateTitle', { number: entry.entry_number }), text: t('stock.entry.validateText'), confirm: t('stock.entry.validate'), type: 'success', placeholder: t('stock.entry.validateComment') },
    reject: { title: t('stock.entry.rejectTitle', { number: entry.entry_number }), text: t('stock.entry.rejectText'), confirm: t('stock.entry.reject'), type: 'danger', placeholder: t('stock.entry.reasonLabel') },
    withdraw: { title: t('stock.entry.withdrawTitle', { number: entry.entry_number }), text: t('stock.entry.withdrawText'), confirm: t('stock.entry.withdraw'), type: 'danger', placeholder: t('stock.entry.reasonLabel') },
    cancel: { title: t('stock.entry.cancelTitle', { number: entry.entry_number }), text: t('stock.entry.cancelText'), confirm: t('stock.entry.cancel'), type: 'danger', placeholder: t('stock.entry.reasonLabel') },
  };
  const d = dialog ? dialogs[dialog] : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>
        <div className="flex flex-wrap gap-2">
          {entry.can_withdraw && (
            <button onClick={() => open('withdraw')} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" data-testid="entry-withdraw">
              <Ban size={16} /> {t('stock.entry.withdraw')}
            </button>
          )}
          {entry.can_cancel && (
            <button onClick={() => open('cancel')} className="flex items-center gap-2 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50" data-testid="entry-cancel">
              <Ban size={16} /> {t('stock.entry.cancel')}
            </button>
          )}
          <button onClick={() => setShowPdf(true)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"><Eye size={16} /> {t('stock.entry.pdf')}</button>
          {entry.can_validate && (
            <>
              <button onClick={() => open('reject')} className="flex items-center gap-2 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50" data-testid="entry-reject">
                <XCircle size={16} /> {t('stock.entry.reject')}
              </button>
              <button onClick={() => open('validate')} className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700" data-testid="entry-validate">
                <CheckCircle2 size={16} /> {t('stock.entry.validate')}
              </button>
            </>
          )}
        </div>
      </div>

      {showPdf && (
        <BlobPdfViewer title={entry.entry_number} fileName={`${entry.entry_number}.pdf`} fetchPdf={() => stockEntryService.pdf(entry.id)} onClose={() => setShowPdf(false)} />
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900"><PackagePlus className="text-emerald-600" /> <span data-testid="entry-number">{entry.entry_number}</span></h1>
          <p className="mt-1 text-sm text-gray-500">{fmtDateTime(entry.created_at)} · {t('stock.entry.recordedBy', { name: entry.created_by_name || '—' })}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <EntryTypeBadge type={entry.entry_type} />
          <EntryStatusBadge status={entry.status} />
        </div>
      </div>

      {entry.status === 'PENDING' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {entry.can_validate ? t('stock.entry.pendingForYou') : t('stock.entry.pendingNotice')}
        </div>
      )}
      {entry.self_validation && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" data-testid="entry-self-validation">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {t('stock.entry.selfValidation')}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {[
          [t('stock.warehouse'), <><b>{entry.warehouse_name}</b><div className="text-xs text-gray-500">{entry.warehouse_location} · {entry.warehouse_code}</div></>],
          [t(`stock.entry.originLabel.${entry.entry_type}`), entry.origin ? <b>{entry.origin}</b> : '—'],
          [t('stock.entry.deliveredBy'), entry.delivered_by || '—'],
          [t('stock.entry.reference'), entry.reference || '—'],
          [t('stock.entry.project'), entry.project_name ? <><b>{entry.project_code}</b><div className="text-xs text-gray-500">{entry.project_name}</div></> : '—'],
          [t('stock.entry.totalValue'), entry.total_value !== null ? <b>{fmtMoney(entry.total_value)} {entry.currency_code}</b> : <span className="text-gray-500">{t('stock.entry.noValue')}</span>],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <div className="mb-1 text-xs text-gray-500">{label}</div>{value}
          </div>
        ))}
      </div>
      {entry.reason && <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm"><span className="text-xs text-gray-500">{t('stock.entry.reason')}</span><p>{entry.reason}</p></div>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('stock.item')}</th>
              <th className="px-4 py-2">{t('stock.lot')}</th>
              <th className="px-4 py-2 text-right">{t('stock.quantity')}</th>
              {hasCost && <th className="px-4 py-2 text-right">{t('stock.entry.unitCost', { currency: entry.currency_code || '' })}</th>}
              {hasCost && <th className="px-4 py-2 text-right">{t('stock.entry.lineTotal')}</th>}
              <th className="px-4 py-2">{t('stock.issue.movements')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {entry.lines.map(l => {
              const serials = (l.units || []).length ? l.units : (l.serials || []).map(s => ({ serial_number: s }));
              return (
                <tr key={l.id}>
                  <td className="px-4 py-2">
                    <Link to={`/stock/items/${l.stock_item_id}`} className="hover:underline"><span className="mr-1 font-mono font-semibold">{l.item_code}</span>{l.item_name}</Link>
                    {serials.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1" data-testid="entry-line-serials">
                        {serials.map(u => (
                          <span key={u.serial_number} className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-xs text-indigo-700">
                            {u.serial_number}{u.asset_tag && <span className="text-gray-500"> · {u.asset_tag}</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">{l.lot_number || '—'}{l.expiry_date && <div className="text-gray-400">{new Date(l.expiry_date).toLocaleDateString(getLocale())}</div>}</td>
                  <td className="px-4 py-2 text-right font-medium">{fmtQty(l.quantity)} <span className="text-xs text-gray-400">{l.unit}</span></td>
                  {hasCost && <td className="px-4 py-2 text-right">{fmtMoney(l.unit_cost)}</td>}
                  {hasCost && <td className="px-4 py-2 text-right">{l.unit_cost !== null ? fmtMoney(l.quantity * l.unit_cost) : '—'}</td>}
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">
                    {l.movement_number || <span className="font-sans text-gray-400">{entry.status === 'PENDING' ? t('stock.entry.noMovementYet') : '—'}</span>}
                    {l.reversal_movement_numbers && <span className="text-red-600"> ↩ {l.reversal_movement_numbers}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {entry.validated_at && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {t('stock.entry.validatedOn', { name: entry.validated_by_name || '—', date: fmtDateTime(entry.validated_at) })}
          {entry.validation_comment && <> — « {entry.validation_comment} »</>}
        </div>
      )}
      {entry.status === 'REJECTED' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {t('stock.entry.rejectedOn', { name: entry.rejected_by_name || '—', date: fmtDateTime(entry.rejected_at), reason: entry.reject_reason || '—' })}
        </div>
      )}
      {entry.status === 'CANCELLED' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          {t(entry.validated_at ? 'stock.entry.cancelledAfterValidationOn' : 'stock.entry.withdrawnOn', { name: entry.cancelled_by_name || '—', date: fmtDateTime(entry.cancelled_at), reason: entry.cancel_reason || '—' })}
        </div>
      )}

      <Modal isOpen={!!dialog} onClose={() => !busy && setDialog(null)} title={d?.title} type={d?.type} size="sm" confirmText={d?.confirm} onConfirm={confirm} isLoading={busy}>
        <div className="space-y-3 text-sm text-gray-700">
          <p>{d?.text}</p>
          <textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={d?.placeholder} aria-label={d?.placeholder} data-testid="entry-dialog-text"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </Modal>
    </div>
  );
}
