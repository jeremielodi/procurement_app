// src/components/Stock/StockIncidentDetail.jsx
// Fiche d'un rapport d'incident : circonstances, articles, décision. Actions selon les droits renvoyés par l'API :
// valider (responsabilité de l'employé oui / non obligatoire + commentaire) / rejeter (motif) — chef du projet, son
// intérimaire ou l'administrateur ; retirer (détenteur ou déclarant, tant qu'il attend). PDF à signer.
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, Check, X, Undo2, RefreshCw, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import BlobPdfViewer from '../Common/BlobPdfViewer';
import { stockIncidentService } from '../../services/stockIncidentService';
import { IncidentStatusBadge, IncidentTypeBadge } from './StockIncidentList';
import { incidentError } from './StockIncidentForm';
import { HiddenLinesNotice } from './StockNature';
import { t, getLocale, useTranslation } from '../../i18n';

const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '—');
const fmtDate = (d) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T00:00:00` : d).toLocaleDateString(getLocale()) : '—');
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function StockIncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lang } = useTranslation();
  const [inc, setInc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // 'validate' | 'reject' | 'cancel'
  const [reason, setReason] = useState('');
  const [liable, setLiable] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPdf, setShowPdf] = useState(false);

  const load = () => {
    setLoading(true);
    stockIncidentService.get(id).then(res => setInc(res.data)).catch(() => setInc(null)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [id, lang]);

  const open = (kind) => { setReason(''); setLiable(null); setDialog(kind); };
  const act = async () => {
    setBusy(true);
    try {
      if (dialog === 'validate') await stockIncidentService.validate(inc.id, { employeeLiable: liable, comment: reason });
      else if (dialog === 'reject') await stockIncidentService.reject(inc.id, reason);
      else await stockIncidentService.cancel(inc.id, reason);
      toast.success(t(`stockIncidents.done.${dialog}`));
      setDialog(null);
      load();
    } catch (err) {
      toast.error(incidentError(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !inc) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!inc) return <div className="p-6 text-gray-500">{t('stockIncidents.notFound')}</div>;
  const confirmDisabled = (dialog === 'validate' && liable === null) || (dialog === 'reject' && !reason.trim());
  const reportedByOther = String(inc.reported_by) !== String(inc.holder_id);

  return (
    <div className="max-w-5xl space-y-5 p-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('common.back')}</button>
      {showPdf && <BlobPdfViewer title={inc.incident_number} fileName={`${inc.incident_number}.pdf`} fetchPdf={() => stockIncidentService.pdf(inc.id)} onClose={() => setShowPdf(false)} />}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-gray-900">
            <ShieldAlert className="text-red-600" /> {inc.incident_number} <IncidentTypeBadge type={inc.incident_type} /> <IncidentStatusBadge status={inc.status} />
          </h1>
          <p className="text-sm text-gray-500">
            {t('stockIncidents.reportedByOn', { name: inc.reported_by_name, date: fmtDateTime(inc.reported_at) })}
            {reportedByOther && ` — ${t('stockIncidents.onBehalfOfHolder', { name: inc.holder_name })}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowPdf(true)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50" data-testid="incident-pdf"><FileText size={16} /> {t('stockIncidents.pdf')}</button>
          {inc.can_validate && <>
            <button onClick={() => open('validate')} className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700" data-testid="incident-validate"><Check size={16} /> {t('stockIncidents.actions.validate')}</button>
            <button onClick={() => open('reject')} className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50" data-testid="incident-reject"><X size={16} /> {t('stockIncidents.actions.reject')}</button>
          </>}
          {inc.can_cancel && <button onClick={() => open('cancel')} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50" data-testid="incident-cancel"><Undo2 size={16} /> {t('stockIncidents.actions.cancel')}</button>}
        </div>
      </div>

      {inc.status === 'PENDING' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-testid="incident-awaiting">
          {inc.validators?.length
            ? t('stockIncidents.awaiting', { names: inc.validators.map(v => v.name).join(', ') })
            : t('stockIncidents.awaitingNobody')}
        </div>
      )}
      {inc.status === 'VALIDATED' && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${inc.employee_liable ? 'border-red-200 bg-red-50 text-red-900' : 'border-green-200 bg-green-50 text-green-900'}`} data-testid="incident-decision">
          <div className="font-medium">
            {t('stockIncidents.validatedBy', { name: inc.validated_by_name, date: fmtDateTime(inc.validated_at) })}
            {inc.on_behalf_of_name && ` ${t('stockIncidents.actingFor', { name: inc.on_behalf_of_name })}`}
          </div>
          <div>{t(inc.employee_liable ? 'stockIncidents.liable' : 'stockIncidents.notLiable')}</div>
          {inc.decision_comment && <div className="mt-1 whitespace-pre-wrap">{inc.decision_comment}</div>}
          <div className="mt-1 text-xs opacity-80">{t(`stockIncidents.effect.${inc.incident_type}`)}</div>
        </div>
      )}
      {inc.status === 'REJECTED' && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{t('stockIncidents.rejectedBy', { name: inc.rejected_by_name, date: fmtDateTime(inc.rejected_at), reason: inc.reject_reason })}</div>}
      {inc.status === 'CANCELLED' && <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">{t('stockIncidents.cancelledOn', { name: inc.cancelled_by_name, date: fmtDateTime(inc.cancelled_at) })}{inc.cancel_reason ? ` — ${inc.cancel_reason}` : ''}</div>}

      <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><div className="text-xs text-gray-500">{t('stockIncidents.holder')}</div>{inc.holder_name}{inc.holder_position && <div className="text-xs text-gray-500">{inc.holder_position}</div>}</div>
        <div><div className="text-xs text-gray-500">{t('stockIncidents.incidentDate')}</div>{fmtDate(inc.incident_date)}</div>
        <div><div className="text-xs text-gray-500">{t('stockIncidents.place')}</div>{inc.incident_place || '—'}</div>
        <div><div className="text-xs text-gray-500">{t('stockIncidents.project')}</div>{inc.project_code ? `${inc.project_code} — ${inc.project_name}` : t('stockIncidents.noProject')}</div>
        {inc.police_reference && <div><div className="text-xs text-gray-500">{t('stockIncidents.policeReference')}</div>{inc.police_reference}</div>}
        <div className="sm:col-span-2 lg:col-span-3"><div className="text-xs text-gray-500">{t('stockIncidents.circumstances')}</div><p className="whitespace-pre-wrap">{inc.circumstances}</p></div>
      </div>

      <HiddenLinesNotice count={inc.hidden_line_count} />
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm" data-testid="incident-lines">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('stock.item')}</th>
              <th className="px-4 py-2">{t('stockIncidents.serialOrLot')}</th>
              <th className="px-4 py-2">{t('stockIncidents.issue')}</th>
              <th className="px-4 py-2 text-right">{t('stockIncidents.declared')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {inc.lines.map(l => (
              <tr key={l.id}>
                <td className="px-4 py-2"><b>{l.item_name}</b> <span className="font-mono text-xs text-gray-500">{l.item_code}</span></td>
                <td className="px-4 py-2 font-mono text-xs">
                  {l.unit_id ? l.serial_number : (l.lot_number || '—')}
                  {l.asset_tag && <div className="text-gray-500">{l.asset_tag}</div>}
                </td>
                <td className="px-4 py-2 text-xs">{l.issue_number}<div className="text-gray-500">{fmtDate(l.issued_at)} · {l.warehouse_name}</div></td>
                <td className="px-4 py-2 text-right">{fmtQty(l.quantity)} <span className="text-xs text-gray-400">{l.unit}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={!!dialog} onClose={() => setDialog(null)} title={dialog ? t(`stockIncidents.dialog.${dialog}`) : ''}
        onConfirm={act} isLoading={busy} confirmDisabled={confirmDisabled} confirmText={dialog ? t(`stockIncidents.actions.${dialog}`) : ''}>
        <div className="space-y-3 text-sm">
          {dialog === 'validate' && (
            <>
              <p className="text-gray-600">{t(`stockIncidents.validateHint.${inc.incident_type}`)}</p>
              <fieldset>
                <legend className="mb-1 font-medium text-gray-700">{t('stockIncidents.liabilityQuestion', { name: inc.holder_name })} *</legend>
                <div className="flex flex-wrap gap-4">
                  {[[true, 'liableOption'], [false, 'notLiableOption']].map(([v, key]) => (
                    <label key={key} className="flex items-center gap-2">
                      <input type="radio" name="liable" checked={liable === v} onChange={() => setLiable(v)} data-testid={`incident-liable-${v ? 'yes' : 'no'}`} />
                      {t(`stockIncidents.${key}`)}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">{t('stockIncidents.liabilityHint')}</p>
              </fieldset>
            </>
          )}
          {dialog === 'cancel' && <p className="text-gray-600">{t('stockIncidents.cancelHint')}</p>}
          {dialog === 'reject' && <p className="text-gray-600">{t('stockIncidents.rejectHint')}</p>}
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">{t(dialog === 'reject' ? 'stockIncidents.reasonRequired' : 'stockIncidents.comment')}</span>
            <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} className={inputCls} data-testid="incident-dialog-reason" />
          </label>
        </div>
      </Modal>
    </div>
  );
}
