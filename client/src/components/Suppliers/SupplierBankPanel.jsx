// src/components/Suppliers/SupplierBankPanel.jsx
// Coordonnées bancaires d'un fournisseur (contrôle anti-fraude) : état pour mon entreprise, historique des
// changements (avant → après, auteur, origine portail / acheteur) et vérification du dernier changement.
// Tant que le dernier changement n'est pas « vérifié » par l'entreprise, ses paiements sont bloqués.
// La personne qui a saisi le changement ne peut pas le vérifier (séparation des tâches, contrôlé par le serveur).
import React, { useEffect, useState } from 'react';
import { Landmark, ShieldCheck, ShieldAlert, ShieldOff, RefreshCw, ArrowRight, Phone } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { supplierService } from '../../services/supplierService';
import { useAuth } from '../../hooks/useAuth';
import { t, getLocale } from '../../i18n';

const FIELDS = ['bank_name', 'bank_account', 'bank_iban', 'bank_swift'];
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** Pastille d'état des coordonnées bancaires pour mon entreprise */
export function BankStatusBadge({ state }) {
  if (!state || state === 'NONE') return null;
  const cls = { PENDING: 'bg-amber-100 text-amber-800', VERIFIED: 'bg-green-100 text-green-800', REJECTED: 'bg-red-100 text-red-800' }[state];
  const Icon = { PENDING: ShieldAlert, VERIFIED: ShieldCheck, REJECTED: ShieldOff }[state];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${cls}`}><Icon size={12} /> {t(`supplierBank.state.${state}`)}</span>;
}

export default function SupplierBankPanel({ supplier, canVerify, onChanged }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // { change, status }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    supplierService.getBankChanges(supplier.id).then(r => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [supplier.id]);

  const decide = async () => {
    if (dialog.status === 'REJECTED' && !reason.trim()) { toast.error(t('supplierBank.reasonRequired')); return; }
    setBusy(true);
    try {
      const r = await supplierService.reviewBankChange(supplier.id, dialog.change.id, { status: dialog.status, reason: reason.trim() || undefined });
      setData(r.data);
      toast.success(dialog.status === 'VERIFIED' ? t('supplierBank.verified') : t('supplierBank.rejected'));
      setDialog(null);
      onChanged?.();
    } catch (err) {
      const code = err.response?.data?.code;
      toast.error(code && t(`supplierBank.err.${code}`) !== `supplierBank.err.${code}` ? t(`supplierBank.err.${code}`) : (err.response?.data?.message || t('common.error')));
    } finally { setBusy(false); }
  };

  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  const status = data?.status || { state: 'NONE' };
  const changes = data?.changes || [];
  const latest = changes.find(c => c.is_latest);
  const mine = latest && String(latest.changed_by) === String(user?.id);

  return (
    <div className="space-y-5" data-testid="supplier-bank-panel">
      {/* Coordonnées actuelles et état pour mon entreprise */}
      <div className="rounded-lg bg-white p-5 shadow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800"><Landmark size={20} /> {t('supplierBank.current')}</h2>
          <BankStatusBadge state={status.state} />
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map(f => (
            <div key={f}>
              <dt className="text-xs text-gray-500">{t(`supplierBank.fields.${f}`)}</dt>
              <dd className="font-mono text-sm text-gray-900">{supplier[f] || '—'}</dd>
            </div>
          ))}
        </dl>
        {status.state === 'PENDING' && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">{t('supplierBank.pendingTitle', { date: fmtDateTime(status.change?.created_at) })}</p>
            <p className="mt-1">{t('supplierBank.pendingText')}</p>
            <p className="mt-2 flex items-center gap-1 text-xs"><Phone size={12} /> {t('supplierBank.callbackTip')}</p>
          </div>
        )}
        {status.state === 'REJECTED' && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {t('supplierBank.rejectedText', { reason: status.review?.reason || '—' })}
          </div>
        )}
        {status.state === 'NONE' && <p className="mt-4 text-sm text-gray-500">{t('supplierBank.noChange')}</p>}
        {latest && canVerify && status.state !== 'VERIFIED' && (
          mine ? (
            <p className="mt-4 text-sm text-gray-600">{t('supplierBank.ownChange')}</p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => { setDialog({ change: latest, status: 'VERIFIED' }); setReason(''); }}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700" data-testid="bank-verify">
                <ShieldCheck size={16} /> {t('supplierBank.verify')}
              </button>
              {status.state !== 'REJECTED' && (
                <button onClick={() => { setDialog({ change: latest, status: 'REJECTED' }); setReason(''); }}
                  className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">
                  <ShieldOff size={16} /> {t('supplierBank.reject')}
                </button>
              )}
            </div>
          )
        )}
      </div>

      {/* Historique */}
      <div className="overflow-x-auto rounded-lg bg-white shadow">
        <div className="border-b border-gray-200 p-4 font-semibold text-gray-800">{t('supplierBank.history')}</div>
        {!changes.length ? (
          <p className="p-6 text-center text-sm text-gray-500">{t('supplierBank.noHistory')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">{t('supplierBank.col.date')}</th>
                <th className="px-4 py-2">{t('supplierBank.col.by')}</th>
                <th className="px-4 py-2">{t('supplierBank.col.change')}</th>
                <th className="px-4 py-2">{t('supplierBank.col.review')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {changes.map(c => (
                <tr key={c.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{fmtDateTime(c.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{c.changed_by_name || '—'}</div>
                    <div className="text-xs text-gray-500">{t(`supplierBank.source.${c.source}`)}</div>
                  </td>
                  <td className="px-4 py-3">
                    {FIELDS.filter(f => (c.old_values?.[f] || null) !== (c.new_values?.[f] || null)).map(f => (
                      <div key={f} className="flex flex-wrap items-center gap-1 text-xs">
                        <span className="text-gray-500">{t(`supplierBank.fields.${f}`)} :</span>
                        <span className="font-mono text-red-700 line-through">{c.old_values?.[f] || '∅'}</span>
                        <ArrowRight size={12} className="text-gray-400" />
                        <span className="font-mono font-medium text-green-800">{c.new_values?.[f] || '∅'}</span>
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    {c.review_status ? (
                      <>
                        <BankStatusBadge state={c.review_status} />
                        <div className="mt-1 text-xs text-gray-500">{c.reviewed_by_name || '—'} · {fmtDateTime(c.reviewed_at)}</div>
                        {c.review_reason && <div className="text-xs text-red-700">« {c.review_reason} »</div>}
                      </>
                    ) : c.is_latest ? <BankStatusBadge state="PENDING" /> : <span className="text-xs text-gray-400">{t('supplierBank.superseded')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        isOpen={!!dialog}
        onClose={() => !busy && setDialog(null)}
        title={dialog?.status === 'VERIFIED' ? t('supplierBank.verifyTitle') : t('supplierBank.rejectTitle')}
        type={dialog?.status === 'VERIFIED' ? 'success' : 'danger'}
        size="sm"
        confirmText={dialog?.status === 'VERIFIED' ? t('supplierBank.verify') : t('supplierBank.reject')}
        onConfirm={decide}
        isLoading={busy}
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p>{dialog?.status === 'VERIFIED' ? t('supplierBank.verifyText', { supplier: supplier.name }) : t('supplierBank.rejectText')}</p>
          <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
            placeholder={dialog?.status === 'VERIFIED' ? t('supplierBank.verifyComment') : t('supplierBank.reasonPlaceholder')}
            aria-label={t('supplierBank.reasonPlaceholder')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </Modal>
    </div>
  );
}
