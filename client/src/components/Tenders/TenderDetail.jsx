// src/components/Tenders/TenderDetail.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Gavel, FileSpreadsheet, Lock, XCircle, Pencil, Award, RefreshCw, Clock, Users, ShieldCheck, CheckCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { tenderService } from '../../services/tenderService';
import { supplierLogoUrl } from '../../services/supplierPortalService';
import { TENDER_STATUS, fmtDateTime, fmtMoney, timeLeft, toLocalInput } from '../../utils/tenderStatus';
import TenderTargetingFields, { AUDIENCE_LABELS } from './TenderTargetingFields';
import { t } from '../../i18n';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function TenderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tender, setTender] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [awardTo, setAwardTo] = useState(null);
  const [awardComment, setAwardComment] = useState('');
  const [confirm, setConfirm] = useState(null); // 'close' | 'cancel'

  const load = async () => {
    setLoading(true);
    try {
      const res = await tenderService.getById(id);
      setTender(res.data);
    } catch (_) { /* toast via intercepteur */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  if (loading && !tender) {
    return <div className="flex justify-center items-center h-64"><RefreshCw className="animate-spin text-blue-500" /></div>;
  }
  if (!tender) return <div className="p-6 text-gray-500">{t('tenders.notFound')}</div>;

  const st = TENDER_STATUS[tender.effective_status] || TENDER_STATUS.OPEN;
  const cur = tender.currency_code || '';
  const items = tender.items || [];
  const subs = tender.submissions || [];
  const isOpen = tender.effective_status === 'OPEN';
  const sealed = !!tender.sealed;
  // Après clôture avec offres ouvertes, plus de prolongation possible (secret des offres)
  const canEdit = ['OPEN', 'UPCOMING'].includes(tender.effective_status)
    || (tender.effective_status === 'CLOSED' && subs.length === 0);
  const canAward = tender.effective_status === 'CLOSED' && subs.length > 0;
  const left = isOpen ? timeLeft(tender.end_date) : null;

  // Meilleur PU par item
  const priceOf = (s, itemId) => (s.items || []).find(l => String(l.requisition_item_id) === String(itemId));
  const bestByItem = Object.fromEntries(items.map(i => {
    const prices = subs.map(s => priceOf(s, i.id)).filter(Boolean).map(l => parseFloat(l.unit_price));
    return [i.id, prices.length > 1 ? Math.min(...prices) : null];
  }));
  const isComplete = (s) => (s.items || []).length >= items.length;
  const completeTotals = subs.filter(isComplete).map(s => parseFloat(s.total_amount));
  const bestTotal = completeTotals.length > 1 ? Math.min(...completeTotals) : null;

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(res?.message || okMsg);
      await load();
      return true;
    } catch (_) {
      return false;
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    try { await tenderService.downloadComparison(tender.id, tender.tender_number); } catch (_) { /* toast */ }
    setBusy(false);
  };

  const saveEdit = async () => {
    if (new Date(editForm.endDate) <= new Date(editForm.startDate)) return toast.error(t('tenders.endAfterStart'));
    if (editForm.audience === 'PREQUALIFIED' && !editForm.categoryId) {
      return toast.error(t('tenders.chooseCategoryError'));
    }
    if (editForm.audience === 'PREQUALIFIED' && !(editForm.supplierIds || []).length) {
      return toast.error(t('tenders.selectInvitee'));
    }
    const ok = await run(() => tenderService.update(tender.id, {
      ...editForm,
      categoryId: editForm.categoryId || null,
      locationId: editForm.locationId || null,
      supplierIds: editForm.audience === 'PREQUALIFIED' ? editForm.supplierIds : undefined,
      startDate: new Date(editForm.startDate).toISOString(),
      endDate: new Date(editForm.endDate).toISOString(),
      maxDeliveryDays: parseInt(editForm.maxDeliveryDays),
    }), t('tenders.updated'));
    if (ok) setEditForm(null);
  };

  const doAward = async () => {
    const ok = await run(async () => {
      const res = await tenderService.award(tender.id, awardTo.supplier_id, awardComment);
      if (!res.camundaTaskCompleted) toast(t('tenders.taskNotCompleted'), { icon: '⚠️' });
      return res;
    }, t('tenders.awarded'));
    if (ok) { setAwardTo(null); setAwardComment(''); }
  };

  return (
    <div className="p-6 space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/tenders')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Gavel size={22} /> {tender.tender_number}</h1>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${st.cls}`} data-testid="tender-status">{st.label}</span>
            </div>
            <p className="text-gray-600">{tender.title}</p>
            <p className="text-sm text-gray-500">
              {t('tenders.requisition')} <Link to={`/requisitions/${tender.requisition_id}`} className="text-blue-600 hover:underline">{tender.requisition_number}</Link>
              {tender.department_name && <> · {tender.department_name}</>}
              {tender.project_name && <> · {tender.project_name}</>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={download} disabled={busy || sealed}
            title={sealed ? t('tenders.availableAfterClose') : ''}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            <FileSpreadsheet size={16} /> {t('tenders.comparison')}
          </button>
          {canEdit && (
            <button onClick={() => setEditForm({
              title: tender.title, description: tender.description || '',
              startDate: toLocalInput(tender.start_date), endDate: toLocalInput(tender.end_date),
              maxDeliveryDays: tender.max_delivery_days,
              audience: tender.audience || 'ALL', categoryId: tender.category_id || '', locationId: tender.location_id || '',
              supplierIds: (tender.invitations || []).map(i => i.supplier_id),
            })} className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              <Pencil size={16} /> {tender.effective_status === 'CLOSED' ? t('tenders.extend') : t('common.edit')}
            </button>
          )}
          {isOpen && (
            <button onClick={() => setConfirm('close')} className="flex items-center gap-2 px-4 py-2 border border-yellow-400 text-yellow-800 rounded-lg text-sm hover:bg-yellow-50">
              <Lock size={16} /> {t('tenders.closeNow')}
            </button>
          )}
          {['OPEN', 'UPCOMING', 'CLOSED'].includes(tender.effective_status) && (
            <button onClick={() => setConfirm('cancel')} className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm hover:bg-red-50">
              <XCircle size={16} /> {t('common.cancel')}
            </button>
          )}
        </div>
      </div>

      {/* Infos */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          [t('tenders.openingLabel'), fmtDateTime(tender.start_date)],
          [t('tenders.deadlineLabel'), <>{fmtDateTime(tender.end_date)}{left && <div className="text-xs text-green-600 flex items-center gap-1"><Clock size={12} /> {t('tenders.remaining', { time: left })}</div>}</>],
          [t('tenders.maxDeliveryLabel'), t('tenders.maxDeliveryValue', { count: tender.max_delivery_days })],
          [t('tenders.submissions'), <span className="flex items-center gap-1"><Users size={14} /> {t('tenders.submissionsValue', { count: subs.length, total: tender.registeredSuppliers, kind: t(tender.audience === 'PREQUALIFIED' ? 'tenders.eligible' : 'tenders.registeredKind') })}</span>],
          [t('tenders.diffusion'), AUDIENCE_LABELS[tender.audience || 'ALL']],
          [t('tenders.category'), tender.category_name || '—'],
          [t('tenders.locationLabel'), tender.location_name || t('tenders.allLocations')],
        ].map(([k, v]) => (
          <div key={k} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs uppercase text-gray-500">{k}</div>
            <div className="mt-1 font-medium text-gray-900">{v}</div>
          </div>
        ))}
      </div>

      {tender.description && <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-700 whitespace-pre-line">{tender.description}</div>}

      {tender.effective_status === 'AWARDED' && (
        <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 flex items-center gap-2">
          <Award size={18} /> {t('tenders.awardedTo')} <b>{tender.awarded_supplier_name}</b> {t('tenders.awardedOn', { date: fmtDateTime(tender.awarded_at) })}
        </div>
      )}
      {sealed && (
        <div className="bg-white rounded-xl border border-gray-200" data-testid="sealed-panel">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
            <ShieldCheck size={18} className="text-blue-600" />
            <span className="font-semibold text-gray-800">{t('tenders.sealed')}</span>
            <span className="text-sm text-gray-500">{t('tenders.sealedHint', { date: fmtDateTime(tender.end_date) })}</span>
          </div>
          {subs.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('tenders.noSubmission')}</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {subs.map(s => (
                <li key={s.id} className="px-4 py-3 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    {s.logo_path
                      ? <img src={supplierLogoUrl({ id: s.supplier_id, logo_path: s.logo_path })} alt="" className="h-6 w-6 object-contain" />
                      : <CheckCircle size={16} className="text-green-600" />}
                    <span className="font-medium text-gray-800">{s.supplier_name}</span>
                    <span className="text-gray-400 font-mono text-xs">{s.supplier_code}</span>
                  </span>
                  <span className="text-gray-500">{t('tenders.submittedAt', { date: fmtDateTime(s.updated_at) })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {canAward && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          {t('tenders.closedHint')}
        </div>
      )}

      {/* AO réservé : fournisseurs invités */}
      {tender.audience === 'PREQUALIFIED' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5" data-testid="tender-invitations">
          <h2 className="font-semibold text-gray-800 mb-1">{t('tenders.invitedTitle', { count: (tender.invitations || []).length })}</h2>
          <p className="text-xs text-gray-500 mb-3">{t('tenders.invitedHint')}</p>
          <div className="flex flex-wrap gap-2">
            {(tender.invitations || []).map(i => (
              <span key={i.supplier_id} className={`px-3 py-1 rounded-full text-sm border ${i.submitted ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-200 text-gray-700'}`}>
                {i.supplier_name}
                <span className="text-xs ml-1 opacity-70">{i.submitted ? t('tenders.hasSubmitted') : (i.has_account ? t('tenders.waiting') : t('tenders.withoutAccount'))}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tableau croisé items × fournisseurs (après clôture uniquement) */}
      {!sealed && <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-200 font-semibold text-gray-800">{t('tenders.priceComparison', { currency: cur })}</div>
        {subs.length === 0 ? (
          <div className="p-8 text-center text-gray-400">{t('tenders.noSubmission')}</div>
        ) : (
          <table className="w-full text-sm" data-testid="comparison-table">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600 min-w-[200px]">{t('tenders.item')}</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">{t('tenders.qty')}</th>
                {subs.map(s => (
                  <th key={s.id} className="text-right px-3 py-2 font-medium text-gray-700 min-w-[150px]">
                    <div className="flex items-center justify-end gap-2">
                      {s.logo_path && <img src={supplierLogoUrl({ id: s.supplier_id, logo_path: s.logo_path })} alt="" className="h-6 w-6 object-contain" />}
                      {s.supplier_name}
                    </div>
                    <div className="text-xs font-normal text-gray-500">{t('tenders.unitTotal')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(i => {
                const qty = parseFloat(i.quantity) * parseFloat(i.frequency || 1);
                return (
                  <tr key={i.id}>
                    <td className="px-3 py-2">{i.item_description}</td>
                    <td className="px-3 py-2 text-right">{qty}</td>
                    {subs.map(s => {
                      const l = priceOf(s, i.id);
                      const best = l && bestByItem[i.id] !== null && parseFloat(l.unit_price) === bestByItem[i.id];
                      return (
                        <td key={s.id} className={`px-3 py-2 text-right ${best ? 'bg-green-50 font-semibold text-green-800' : ''}`} title={l?.comment || ''}>
                          {l ? <>{fmtMoney(l.unit_price)}<div className="text-xs text-gray-500 font-normal">{fmtMoney(l.total_price)}</div></> : <span className="text-gray-400">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td colSpan={2} className="px-3 py-2 font-semibold">{t('tenders.offerTotal')}</td>
                {subs.map(s => (
                  <td key={s.id} className={`px-3 py-2 text-right font-bold ${bestTotal !== null && isComplete(s) && parseFloat(s.total_amount) === bestTotal ? 'text-green-700' : ''}`}>
                    {fmtMoney(s.total_amount, cur)}
                    {!isComplete(s) && <div className="text-xs font-normal text-red-600">{t('tenders.incomplete', { done: s.items.length, total: items.length })}</div>}
                  </td>
                ))}
              </tr>
              <tr>
                <td colSpan={2} className="px-3 py-2 text-gray-600">{t('tenders.deliveryTime')}</td>
                {subs.map(s => <td key={s.id} className="px-3 py-2 text-right">{t('tenders.days', { count: s.delivery_days })}</td>)}
              </tr>
              <tr>
                <td colSpan={2} className="px-3 py-2 text-gray-600">{t('tenders.lastUpdate')}</td>
                {subs.map(s => <td key={s.id} className="px-3 py-2 text-right text-xs text-gray-500">{fmtDateTime(s.updated_at)}</td>)}
              </tr>
              {subs.some(s => s.notes) && (
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-gray-600">{t('tenders.remarks')}</td>
                  {subs.map(s => <td key={s.id} className="px-3 py-2 text-right text-xs text-gray-600">{s.notes || ''}</td>)}
                </tr>
              )}
              {canAward && (
                <tr>
                  <td colSpan={2} />
                  {subs.map(s => (
                    <td key={s.id} className="px-3 py-2 text-right">
                      <button onClick={() => setAwardTo(s)}
                        className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
                        <Award size={14} /> {t('tenders.award')}
                      </button>
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          </table>
        )}
      </div>}

      {/* Modale modification */}
      <Modal isOpen={!!editForm} onClose={() => setEditForm(null)} title={t('tenders.editTitle')} size="lg"
        onConfirm={saveEdit} confirmText={t('tenders.saveAndNotify')} isLoading={busy}>
        {editForm && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('tenders.subjectLabel')}</label>
              <input className={inputCls} value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.description')}</label>
              <textarea rows={3} className={inputCls} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('tenders.openingLabel')}</label>
              <input type="datetime-local" className={inputCls} value={editForm.startDate} onChange={e => setEditForm(f => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('tenders.deadlineLabel')}</label>
              <input type="datetime-local" className={inputCls} value={editForm.endDate} onChange={e => setEditForm(f => ({ ...f, endDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('tenders.maxDeliveryDays')}</label>
              <input type="number" min="1" className={inputCls} value={editForm.maxDeliveryDays} onChange={e => setEditForm(f => ({ ...f, maxDeliveryDays: e.target.value }))} />
            </div>
            <div className="col-span-2 border-t pt-3">
              <TenderTargetingFields
                value={{ audience: editForm.audience, categoryId: editForm.categoryId, locationId: editForm.locationId, supplierIds: editForm.supplierIds }}
                lockedIds={(tender.invitations || []).filter(i => i.submitted).map(i => i.supplier_id)}
                onChange={(v) => setEditForm(f => ({ ...f, ...v }))} />
            </div>
          </div>
        )}
      </Modal>

      {/* Modale attribution */}
      <Modal isOpen={!!awardTo} onClose={() => setAwardTo(null)} title={t('tenders.awardTitle')} type="success"
        onConfirm={doAward} confirmText={t('tenders.confirmAward')} isLoading={busy}>
        {awardTo && (
          <div className="space-y-3 text-sm">
            <p>{t('tenders.awardBefore')} <b>{awardTo.supplier_name}</b> {t('tenders.awardFor')} <b>{fmtMoney(awardTo.total_amount, cur)}</b>{t('tenders.awardDelivery', { days: awardTo.delivery_days })}</p>
            {bestTotal !== null && parseFloat(awardTo.total_amount) !== bestTotal && (
              <p className="text-yellow-700 bg-yellow-50 p-2 rounded">{t('tenders.notCheapest')}</p>
            )}
            {!isComplete(awardTo) && <p className="text-red-700 bg-red-50 p-2 rounded">{t('tenders.incompleteOffer', { done: awardTo.items.length, total: items.length })}</p>}
            <textarea rows={3} className={inputCls} placeholder={t('tenders.justification')} value={awardComment} onChange={e => setAwardComment(e.target.value)} />
            <p className="text-gray-500">{t('tenders.awardTaskHint')}</p>
          </div>
        )}
      </Modal>

      {/* Confirmations */}
      <Modal isOpen={!!confirm} onClose={() => setConfirm(null)} type={confirm === 'cancel' ? 'danger' : 'warning'}
        title={confirm === 'cancel' ? t('tenders.cancelTitle') : t('tenders.closeNow')} isLoading={busy}
        onConfirm={async () => {
          const ok = confirm === 'cancel'
            ? await run(() => tenderService.cancel(tender.id), t('tenders.cancelled'))
            : await run(() => tenderService.close(tender.id), t('tenders.closed'));
          if (ok) setConfirm(null);
        }}>
        <p className="text-sm text-gray-700">
          {confirm === 'cancel'
            ? t('tenders.cancelHint')
            : t('tenders.closeHint', { count: subs.length, total: tender.registeredSuppliers })}
        </p>
      </Modal>
    </div>
  );
}
