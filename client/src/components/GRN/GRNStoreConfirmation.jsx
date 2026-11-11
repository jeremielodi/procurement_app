// src/components/GRN/GRNStoreConfirmation.jsx
// Dépôt de la réception + confirmation de l'entrée en magasin (migration 61) : une personne ayant accès au dépôt, autre
// que celle qui a enregistré le GRN, confirme ; son nom, sa fonction, la date et sa signature figurent sur le PDF.
import { useState } from 'react';
import { Warehouse, CheckCircle, Clock, PenLine } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { grnService } from '../../services/grnService';
import { t, getLocale } from '../../i18n';

const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function GRNStoreConfirmation({ grn, onDone }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  if (!grn.warehouse_name) return null;

  const confirmed = !!grn.store_confirmed_at;
  const pending = !confirmed && grn.status !== 'CANCELLED';

  const submit = async () => {
    setSaving(true);
    try {
      await grnService.storeConfirm(grn.id, comment.trim());
      toast.success(t('grn.store.done'));
      setOpen(false);
      setComment('');
      onDone?.();
    } catch (err) {
      const data = err.response?.data || {};
      toast.error(t(`grn.store.err.${data.code}`, { defaultValue: data.message || t('common.errorOccurred') }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-3 text-sm" data-testid="grn-store">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Warehouse size={16} className="text-gray-500" />
          <span className="text-gray-500">{t('grn.warehouse')} :</span>
          <b>{grn.warehouse_name}</b> {grn.warehouse_location && <span className="text-gray-500">({grn.warehouse_location})</span>}
        </div>
        {confirmed && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-green-700" data-testid="grn-store-confirmed">
            <CheckCircle size={15} />
            {t('grn.store.confirmedBy', { name: grn.store_confirmed_by_name, date: fmtDateTime(grn.store_confirmed_at) })}
            {grn.store_confirmed_by_position && <span className="text-green-600">— {grn.store_confirmed_by_position}</span>}
          </span>
        )}
        {pending && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-amber-700" data-testid="grn-store-pending">
              <Clock size={15} /> {t('grn.store.pending')}
            </span>
            {grn.can_store_confirm && (
              <button onClick={() => setOpen(true)} data-testid="grn-store-confirm"
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 font-medium text-white hover:bg-green-700">
                <PenLine size={15} /> {t('grn.store.confirm')}
              </button>
            )}
          </div>
        )}
      </div>
      {confirmed && grn.store_confirmation_comment && (
        <p className="mt-2 text-gray-600">« {grn.store_confirmation_comment} »</p>
      )}
      {pending && grn.store_self_confirmation && (
        <p className="mt-2 text-gray-500" data-testid="grn-store-self">{t('grn.store.selfHint')}</p>
      )}

      <Modal
        isOpen={open}
        onClose={() => !saving && setOpen(false)}
        title={t('grn.store.title', { number: grn.grn_number })}
        size="sm"
        confirmText={t('grn.store.confirm')}
        onConfirm={submit}
        isLoading={saving}
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p>{t('grn.store.text', { warehouse: grn.warehouse_name })}</p>
          <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} data-testid="grn-store-comment"
            placeholder={t('grn.store.comment')} aria-label={t('grn.store.comment')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </Modal>
    </div>
  );
}
