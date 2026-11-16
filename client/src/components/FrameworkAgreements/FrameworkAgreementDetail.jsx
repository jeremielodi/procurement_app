// src/components/FrameworkAgreements/FrameworkAgreementDetail.jsx
// Fiche d'un accord-cadre (migration 69) : contrat, consommation du plafond, étapes de validation (chef de chaque projet
// puis directeur général), bordereau avec quantités commandées, contrat signé (pièces jointes), bons de commande passés,
// historique des décisions. Actions selon les droits renvoyés par l'API : modifier / soumettre (brouillon), approuver /
// rejeter (validateur du moment), suspendre / réactiver / clôturer / annuler.
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, FileSignature, Check, X, Send, Pencil, PauseCircle, PlayCircle, Lock, Ban, RefreshCw, Paperclip, Download, Upload, CircleDot, CheckCircle2, MinusCircle, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import { frameworkAgreementService } from '../../services/frameworkAgreementService';
import { uploadService } from '../../services/uploadService';
import { AgreementStatusBadge, ConsumptionBar, agreementError, fmtDate, fmtMoney } from './FrameworkAgreementList';
import { t, getLocale, useTranslation } from '../../i18n';

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '—');
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const btn = 'flex items-center gap-2 rounded-lg px-4 py-2 text-sm';

// Dialogues : décision (approve / reject) et changements d'état ; reasonRequired = motif obligatoire
const DIALOGS = {
  approve: { reasonRequired: false }, reject: { reasonRequired: true }, submit: { noReason: true },
  suspend: { reasonRequired: true }, reactivate: { noReason: true }, close: { reasonRequired: true }, cancel: { reasonRequired: false },
};

function StepIcon({ state }) {
  if (state === 'DONE') return <CheckCircle2 size={18} className="text-green-600" />;
  if (state === 'SKIPPED') return <MinusCircle size={18} className="text-gray-400" />;
  if (state === 'PENDING') return <CircleDot size={18} className="text-amber-500" />;
  return <Clock size={18} className="text-gray-400" />;
}

export default function FrameworkAgreementDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lang } = useTranslation();
  const [a, setA] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  const load = () => {
    setLoading(true);
    frameworkAgreementService.get(id).then(res => setA(res.data)).catch(() => setA(null)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [id, lang]);

  const open = (kind) => { setReason(''); setDialog(kind); };
  const act = async () => {
    setBusy(true);
    try {
      let message;
      if (dialog === 'approve' || dialog === 'reject') {
        const res = await frameworkAgreementService.decide(a.id, dialog === 'approve' ? 'APPROVE' : 'REJECT', reason);
        message = dialog === 'reject' ? t('frameworkAgreements.done.reject') : res.data?.status === 'ACTIVE' ? t('frameworkAgreements.done.activated') : t('frameworkAgreements.done.approve');
      } else if (dialog === 'submit') {
        await frameworkAgreementService.submit(a.id);
        message = t('frameworkAgreements.done.submit');
      } else {
        await frameworkAgreementService.changeStatus(a.id, dialog, reason);
        message = t(`frameworkAgreements.done.${dialog}`);
      }
      toast.success(message);
      setDialog(null);
      load();
    } catch (err) {
      toast.error(agreementError(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await uploadService.uploadFile(file, 'framework_agreement', a.id);
      toast.success(t('frameworkAgreements.attachmentAdded'));
      load();
    } catch (err) { toast.error(agreementError(err)); }
  };
  const download = async (att) => {
    try {
      const blob = await uploadService.downloadFile(att.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = att.file_name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch { toast.error(t('common.error')); }
  };

  if (loading && !a) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!a) return <div className="p-6 text-gray-500">{t('frameworkAgreements.notFound')}</div>;
  const cfg = DIALOGS[dialog] || {};
  const pending = a.status === 'PENDING_VALIDATION';

  return (
    <div className="max-w-6xl space-y-5 p-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-gray-900">
            <FileSignature className="text-blue-600" /> {a.agreement_number} <AgreementStatusBadge status={a.effective_status} />
          </h1>
          <p className="text-lg text-gray-800">{a.title}</p>
          <p className="text-sm text-gray-500">{t('frameworkAgreements.createdByOn', { name: a.created_by_name || '—', date: fmtDateTime(a.created_at) })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.can_edit && <Link to={`/framework-agreements/${a.id}/edit`} className={`${btn} border border-gray-300 hover:bg-gray-50`} data-testid="agreement-edit"><Pencil size={16} /> {t('common.edit')}</Link>}
          {a.can_submit && <button onClick={() => open('submit')} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`} data-testid="agreement-submit"><Send size={16} /> {t('frameworkAgreements.actions.submit')}</button>}
          {a.can_decide && <>
            <button onClick={() => open('approve')} className={`${btn} bg-green-600 text-white hover:bg-green-700`} data-testid="agreement-approve"><Check size={16} /> {t('frameworkAgreements.actions.approve')}</button>
            <button onClick={() => open('reject')} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`} data-testid="agreement-reject"><X size={16} /> {t('frameworkAgreements.actions.reject')}</button>
          </>}
          {a.can_suspend && <button onClick={() => open('suspend')} className={`${btn} border border-gray-300 hover:bg-gray-50`} data-testid="agreement-suspend"><PauseCircle size={16} /> {t('frameworkAgreements.actions.suspend')}</button>}
          {a.can_reactivate && <button onClick={() => open('reactivate')} className={`${btn} border border-gray-300 hover:bg-gray-50`} data-testid="agreement-reactivate"><PlayCircle size={16} /> {t('frameworkAgreements.actions.reactivate')}</button>}
          {a.can_close && <button onClick={() => open('close')} className={`${btn} border border-gray-300 hover:bg-gray-50`} data-testid="agreement-close"><Lock size={16} /> {t('frameworkAgreements.actions.close')}</button>}
          {a.can_cancel && <button onClick={() => open('cancel')} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`} data-testid="agreement-cancel"><Ban size={16} /> {t('frameworkAgreements.actions.cancel')}</button>}
        </div>
      </div>

      {a.status === 'DRAFT' && a.last_reject_reason && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" data-testid="agreement-rejected">
          {t('frameworkAgreements.rejectedBy', { name: a.last_rejected_by_name, date: fmtDateTime(a.last_rejected_at), reason: a.last_reject_reason })}
        </div>
      )}
      {a.self_validation && <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">{t('frameworkAgreements.selfValidation')}</div>}
      {a.status === 'SUSPENDED' && <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-900">{t('frameworkAgreements.suspendedBy', { name: a.suspended_by_name, date: fmtDateTime(a.suspended_at), reason: a.suspend_reason })}</div>}
      {['CLOSED', 'CANCELLED'].includes(a.status) && <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">{t(`frameworkAgreements.${a.status === 'CLOSED' ? 'closedBy' : 'cancelledBy'}`, { name: a.closed_by_name, date: fmtDateTime(a.closed_at) })}{a.close_reason ? ` — ${a.close_reason}` : ''}</div>}
      {a.effective_status === 'EXPIRED' && <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-900">{t('frameworkAgreements.expiredNotice', { date: fmtDate(a.end_date) })}</div>}
      {a.activated_at && <p className="text-sm text-green-800" data-testid="agreement-activated">{t('frameworkAgreements.activatedBy', { name: a.activated_by_name, date: fmtDateTime(a.activated_at) })}{a.activated_by_position ? ` (${a.activated_by_position})` : ''}</p>}

      {pending && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm" data-testid="agreement-steps">
          <div className="mb-2 font-medium text-amber-900">
            {a.validators?.length ? t('frameworkAgreements.awaiting', { names: a.validators.map(v => v.name).join(', ') }) : t('frameworkAgreements.awaitingNobody')}
          </div>
          <ol className="space-y-1.5">
            {a.steps.map((s, idx) => (
              <li key={idx} className="flex flex-wrap items-center gap-2" data-testid={`agreement-step-${s.step}`}>
                <StepIcon state={s.state} />
                {s.step === 'DG'
                  ? <span className="font-medium">{t('frameworkAgreements.steps.dg')}</span>
                  : <span><span className="font-medium">{t('frameworkAgreements.steps.projectManager', { project: s.projectCode })}</span> — {s.managerName || '—'}</span>}
                <span className="text-xs text-gray-600">
                  {s.state === 'DONE' ? t('frameworkAgreements.steps.doneBy', { name: s.decidedByName, date: fmtDateTime(s.decidedAt) }) : t(`frameworkAgreements.steps.state.${s.state}`)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-2 lg:col-span-2">
          <div><div className="text-xs text-gray-500">{t('frameworkAgreements.supplier')}</div><Link to={`/suppliers/${a.supplier_id}`} className="text-blue-600 hover:underline">{a.supplier_name}</Link></div>
          <div><div className="text-xs text-gray-500">{t('frameworkAgreements.form.reference')}</div>{a.contract_reference || '—'}</div>
          <div><div className="text-xs text-gray-500">{t('frameworkAgreements.period')}</div>{fmtDate(a.start_date)} → {fmtDate(a.end_date)}{a.effective_status === 'ACTIVE' && <span className="ml-1 text-xs text-gray-500">({t('frameworkAgreements.daysLeft', { count: a.days_left })})</span>}</div>
          <div><div className="text-xs text-gray-500">{t('frameworkAgreements.projects')}</div>{a.projects.length ? a.projects.map(p => `${p.code} — ${p.name}`).join(', ') : t('frameworkAgreements.allProjects')}</div>
          <div><div className="text-xs text-gray-500">{t('frameworkAgreements.offList')}</div>{t(a.allow_off_list ? 'frameworkAgreements.offListYes' : 'frameworkAgreements.offListNo')}</div>
          {a.tender_id && <div><div className="text-xs text-gray-500">{t('frameworkAgreements.origin')}</div><Link to={`/tenders/${a.tender_id}`} className="text-blue-600 hover:underline">{a.tender_number}</Link> — {a.tender_title}</div>}
          {a.description && <div className="sm:col-span-2"><div className="text-xs text-gray-500">{t('frameworkAgreements.form.description')}</div><p className="whitespace-pre-wrap">{a.description}</p></div>}
        </div>
        <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 text-sm" data-testid="agreement-consumption">
          <div className="text-xs text-gray-500">{t('frameworkAgreements.ceiling')}</div>
          <div className="text-xl font-bold">{fmtMoney(a.ceiling_amount, a.currency_code)}</div>
          <ConsumptionBar percent={a.consumed_percent} />
          <div className="flex justify-between"><span className="text-gray-500">{t('frameworkAgreements.consumed')}</span><span>{fmtMoney(a.consumed_amount, a.currency_code)} ({a.consumed_percent} %)</span></div>
          <div className="flex justify-between font-medium"><span className="text-gray-500">{t('frameworkAgreements.remaining')}</span><span className={a.remaining_amount < 0 ? 'text-red-600' : ''}>{fmtMoney(a.remaining_amount, a.currency_code)}</span></div>
          <p className="text-xs text-gray-500">{t('frameworkAgreements.consumptionRule')}</p>
        </div>
      </div>

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b px-4 py-3 font-semibold text-gray-900">{t('frameworkAgreements.priceList')}</h2>
        <table className="w-full text-sm" data-testid="agreement-items">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('frameworkAgreements.item')}</th>
              <th className="px-4 py-2">{t('frameworkAgreements.unit')}</th>
              <th className="px-4 py-2 text-right">{t('frameworkAgreements.unitPrice')}</th>
              <th className="px-4 py-2 text-right">{t('frameworkAgreements.maxQuantity')}</th>
              <th className="px-4 py-2 text-right">{t('frameworkAgreements.ordered')}</th>
              <th className="px-4 py-2 text-right">{t('frameworkAgreements.orderedAmount')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {a.items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">{t('frameworkAgreements.noItems')}</td></tr>}
            {a.items.map(i => (
              <tr key={i.id}>
                <td className="px-4 py-2">{i.description}{i.stock_item_code && <span className="ml-2 font-mono text-xs text-gray-500">{i.stock_item_code}</span>}</td>
                <td className="px-4 py-2">{i.unit_name}</td>
                <td className="px-4 py-2 text-right">{fmtMoney(i.unit_price)}</td>
                <td className="px-4 py-2 text-right">{i.max_quantity ? fmtQty(i.max_quantity) : '—'}</td>
                <td className={`px-4 py-2 text-right ${i.max_quantity && i.ordered_quantity >= i.max_quantity ? 'font-semibold text-orange-700' : ''}`}>{fmtQty(i.ordered_quantity)}</td>
                <td className="px-4 py-2 text-right">{fmtMoney(i.ordered_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="agreement-attachments">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">{t('frameworkAgreements.signedContract')}</h2>
            {a.can_attach && <>
              <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50" data-testid="agreement-attach"><Upload size={14} /> {t('frameworkAgreements.attach')}</button>
              <input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden" onChange={upload} />
            </>}
          </div>
          {a.attachments.length === 0
            ? <p className="text-sm text-gray-500">{t(a.tender_id ? 'frameworkAgreements.noAttachmentTender' : 'frameworkAgreements.noAttachment')}</p>
            : <ul className="space-y-1 text-sm">{a.attachments.map(att => (
              <li key={att.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 truncate"><Paperclip size={14} className="text-gray-400" /> {att.file_name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500">{fmtDateTime(att.uploaded_at)}<button onClick={() => download(att)} className="rounded p-1 hover:bg-gray-100" aria-label={t('common.download')}><Download size={14} /></button></span>
              </li>
            ))}</ul>}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 font-semibold text-gray-900">{t('frameworkAgreements.history')}</h2>
          {a.approvals.length === 0 ? <p className="text-sm text-gray-500">{t('frameworkAgreements.noDecision')}</p> : (
            <ul className="space-y-2 text-sm" data-testid="agreement-history">
              {a.approvals.map(ap => (
                <li key={ap.id} className="border-l-2 pl-3" style={{ borderColor: ap.decision === 'APPROVED' ? '#16a34a' : '#dc2626' }}>
                  <div className="font-medium">
                    {t(`frameworkAgreements.decision.${ap.decision}`)} — {ap.step === 'DG' ? t('frameworkAgreements.steps.dg') : t('frameworkAgreements.steps.projectManager', { project: ap.project_code })}
                  </div>
                  <div className="text-xs text-gray-500">
                    {ap.decided_by_name}{ap.decided_by_position ? ` (${ap.decided_by_position})` : ''}{ap.on_behalf_of_name ? ` — ${t('frameworkAgreements.onBehalfOf', { name: ap.on_behalf_of_name })}` : ''} · {fmtDateTime(ap.decided_at)} · {t('frameworkAgreements.round', { n: ap.round })}
                  </div>
                  {ap.comment && <div className="whitespace-pre-wrap text-gray-700">{ap.comment}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b px-4 py-3 font-semibold text-gray-900">{t('frameworkAgreements.purchaseOrders')}</h2>
        <table className="w-full text-sm" data-testid="agreement-pos">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('frameworkAgreements.po')}</th>
              <th className="px-4 py-2">{t('frameworkAgreements.requisition')}</th>
              <th className="px-4 py-2">{t('frameworkAgreements.project')}</th>
              <th className="px-4 py-2">{t('common.status')}</th>
              <th className="px-4 py-2 text-right">{t('frameworkAgreements.consumed')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {a.purchase_orders.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">{t('frameworkAgreements.noPurchaseOrders')}</td></tr>}
            {a.purchase_orders.map(po => (
              <tr key={po.id}>
                <td className="px-4 py-2"><Link to={`/purchase-orders/${po.id}`} className="font-mono text-blue-600 hover:underline">{po.po_number}</Link></td>
                <td className="px-4 py-2">{po.requisition_id ? <Link to={`/requisitions/${po.requisition_id}`} className="text-blue-600 hover:underline">{po.requisition_number}</Link> : '—'}</td>
                <td className="px-4 py-2">{po.project_code || '—'}</td>
                <td className="px-4 py-2 text-xs">{t(`badge.${po.status}`, { defaultValue: po.status })}</td>
                <td className="px-4 py-2 text-right">{fmtMoney(po.consumed_amount, a.currency_code)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Modal isOpen={!!dialog} onClose={() => setDialog(null)} title={dialog ? t(`frameworkAgreements.dialog.${dialog}`) : ''}
        onConfirm={act} isLoading={busy} confirmDisabled={cfg.reasonRequired && !reason.trim()} confirmText={dialog ? t(`frameworkAgreements.actions.${dialog}`) : ''}>
        <div className="space-y-3 text-sm">
          <p className="text-gray-600">{dialog ? t(`frameworkAgreements.dialogHint.${dialog}`) : ''}</p>
          {!cfg.noReason && (
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">{t(cfg.reasonRequired ? 'frameworkAgreements.reasonRequired' : 'frameworkAgreements.comment')}</span>
              <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} className={inputCls} data-testid="agreement-dialog-reason" />
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
