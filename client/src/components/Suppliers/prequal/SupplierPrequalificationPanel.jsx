// Onglet « Préqualification » de la fiche fournisseur :
// identification, localisations, documents (vérifiés un à un par l'entreprise), décision par catégorie.
// Règle : un fournisseur n'est préqualifiable que si TOUS ses documents attendus sont déposés ET vérifiés.
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, RotateCcw, MapPin, FileText, Tags, AlertTriangle, Contact, ShieldCheck, Eye, Upload } from 'lucide-react';
import { supplierService } from '../../../services/supplierService';
import { EXPECTED_DOCS, DOC_LABELS, SUPPLIER_TYPE_LABELS, PREQ_STATUS, docAccept, checkDocFile, openDocument } from '../../../utils/supplierDocs';
import { t, withLabel, getLocale } from '../../../i18n';

const REVIEW = withLabel('docReview', {
  VERIFIED: { cls: 'bg-green-100 text-green-800' },
  REJECTED: { cls: 'bg-red-100 text-red-800' },
  PENDING: { cls: 'bg-yellow-100 text-yellow-800' },
});

const Card = ({ icon: Icon, title, children, right }) => (
  <div className="bg-white rounded-lg shadow">
    <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2"><Icon size={20} />{title}</h2>
      {right}
    </div>
    <div className="p-6">{children}</div>
  </div>
);

const Info = ({ label, value }) => (
  <div>
    <p className="text-xs text-gray-500">{label}</p>
    <p className="text-sm font-medium text-gray-800">{value || '—'}</p>
  </div>
);

/** Ligne de motif (refus de document ou de catégorie) */
function ReasonInput({ placeholder, onConfirm, onCancel }) {
  const [text, setText] = useState('');
  return (
    <div className="w-full flex gap-2 mt-2">
      <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={placeholder}
        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
      <button type="button" disabled={!text.trim()} onClick={() => onConfirm(text.trim())}
        className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm disabled:opacity-50">{t('prequal.confirm')}</button>
      <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border text-sm">{t('common.cancel')}</button>
    </div>
  );
}

/**
 * canReview : vérifier les documents et décider de la préqualification (PREQUALIFY_SUPPLIERS)
 * canUpload : déposer les documents d'un fournisseur saisi à la main (MANAGE_SUPPLIERS)
 */
export default function SupplierPrequalificationPanel({ supplier, canReview, canUpload, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [rejectingDoc, setRejectingDoc] = useState(null);
  const [rejectingCat, setRejectingCat] = useState(null);
  const type = supplier.supplier_type || 'COMPANY';
  const docsByType = Object.fromEntries((supplier.documents || []).map(d => [d.doc_type, d]));
  const dossier = supplier.dossier || { missing: [], toVerify: [], rejected: [], complete: false };
  const uploadAllowed = canUpload && !supplier.self_registered;

  const run = async (key, fn) => {
    setBusy(key);
    try {
      const res = await fn();
      if (res?.message) toast.success(res.message);
      onChanged?.();
      return true;
    } catch (_) { return false; /* toast via intercepteur */ } finally {
      setBusy(null);
    }
  };

  const review = (doc, status, comment) => run(`doc-${doc.id}`, () => supplierService.reviewDocument(supplier.id, doc.id, { status, comment }))
    .then(ok => ok && setRejectingDoc(null));
  const decide = (categoryId, status, comment) => run(`cat-${categoryId}`, () => supplierService.setPrequalification(supplier.id, { categoryId, status, comment }))
    .then(ok => ok && setRejectingCat(null));
  const upload = (docType, e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const problem = checkDocFile(docType, f);
    if (problem) return toast.error(problem);
    run(`up-${docType}`, () => supplierService.uploadDocument(supplier.id, docType, f));
  };

  const dossierMessage = [
    dossier.missing.length && t('prequal.notUploaded', { list: dossier.missing.map(dt => DOC_LABELS[dt]).join(', ') }),
    dossier.rejected.length && t('prequal.refused', { list: dossier.rejected.map(dt => DOC_LABELS[dt]).join(', ') }),
    dossier.toVerify.length && t('prequal.toVerify', { list: dossier.toVerify.map(dt => DOC_LABELS[dt]).join(', ') }),
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-6">
      {dossier.complete ? (
        <div className="flex gap-3 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
          <ShieldCheck size={18} className="shrink-0 mt-0.5" />
          <p>{t('prequal.complete')}</p>
        </div>
      ) : (
        <div className="flex gap-3 p-4 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 text-sm">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <p>{t('prequal.impossible', { details: dossierMessage })}
            {dossier.missing.length > 0 && supplier.self_registered ? t('prequal.mustUpload') : ''}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card icon={Contact} title={t('prequal.identification')}>
          <div className="grid grid-cols-2 gap-4">
            <Info label={t('prequal.type')} value={SUPPLIER_TYPE_LABELS[type]} />
            <Info label={t('prequal.supplierCode')} value={supplier.supplier_code} />
            {type === 'COMPANY' && <>
              <Info label={t('supplierFields.registrationNumber')} value={supplier.registration_number} />
              <Info label={t('supplierFields.taxId')} value={supplier.tax_id} />
              <Info label={t('supplierFields.idNat')} value={supplier.id_nat} />
            </>}
            <Info label={t('supplierFields.idDocumentNumber')} value={supplier.id_document_number} />
            <Info label={t('supplierFields.bankName')} value={supplier.bank_name} />
            <Info label={t('supplierFields.bankAccount')} value={supplier.bank_account} />
          </div>
        </Card>

        <Card icon={MapPin} title={t('prequal.locations')}>
          {(supplier.locations || []).length ? (
            <div className="flex flex-wrap gap-2">
              {supplier.locations.map(l => (
                <span key={l.id} className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-800 text-sm">{l.name}</span>
              ))}
            </div>
          ) : <p className="text-sm text-gray-500">{t('prequal.noLocation')}</p>}
        </Card>
      </div>

      <Card icon={FileText} title={t('prequal.documents')}
        right={<span className="text-xs text-gray-500">{t('prequal.compareHint')}</span>}>
        <div className="divide-y">
          {EXPECTED_DOCS[type].map(dt => {
            const doc = docsByType[dt];
            const st = doc ? REVIEW[doc.review_status || 'PENDING'] : null;
            return (
              <div key={dt} className="py-3 flex flex-wrap items-center justify-between gap-3" data-testid={`review-${dt}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{DOC_LABELS[dt]}</p>
                  {doc ? (
                    <p className="text-xs text-gray-500">
                      <span className={`px-2 py-0.5 rounded-full mr-1 ${st.cls}`}>{st.label}</span>
                      {t('prequal.uploadedOn', { file: doc.file_name, date: new Date(doc.uploaded_at).toLocaleDateString(getLocale()) })}
                      {doc.reviewed_at && <> · {t(doc.review_status === 'VERIFIED' ? 'prequal.verifiedOn' : 'prequal.refusedOn', { date: new Date(doc.reviewed_at).toLocaleDateString(getLocale()) })}{doc.reviewed_by_name ? t('prequal.byName', { name: doc.reviewed_by_name }) : ''}</>}
                      {doc.review_comment && <> · « {doc.review_comment} »</>}
                    </p>
                  ) : <p className="text-xs text-orange-600">{t('prequal.notUploadedOne')}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {doc && (
                    <button type="button" onClick={() => openDocument(() => supplierService.getDocumentBlob(supplier.id, doc.id))}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">
                      <Eye size={14} /> {t('prequal.consult')}
                    </button>
                  )}
                  {doc && canReview && doc.review_status !== 'VERIFIED' && (
                    <button type="button" disabled={busy === `doc-${doc.id}`} onClick={() => review(doc, 'VERIFIED')}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50">
                      <CheckCircle size={14} /> {t('prequal.verify')}
                    </button>
                  )}
                  {doc && canReview && doc.review_status !== 'REJECTED' && (
                    <button type="button" onClick={() => setRejectingDoc(doc.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-sm hover:bg-red-50">
                      <XCircle size={14} /> {t('prequal.refuse')}
                    </button>
                  )}
                  {doc?.review_status && canReview && (
                    <button type="button" onClick={() => review(doc, null)} title={t('prequal.undoReview')}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><RotateCcw size={16} /></button>
                  )}
                  {uploadAllowed && (
                    <label className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm cursor-pointer hover:bg-gray-50">
                      <Upload size={14} /> {doc ? t('prequal.replace') : t('prequal.upload')}
                      <input type="file" accept={docAccept(dt)} className="hidden" onChange={(e) => upload(dt, e)} />
                    </label>
                  )}
                </div>
                {doc && rejectingDoc === doc.id && (
                  <ReasonInput placeholder={t('prequal.refuseReason')}
                    onConfirm={(c) => review(doc, 'REJECTED', c)} onCancel={() => setRejectingDoc(null)} />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card icon={Tags} title={t('prequal.byCategory')}>
        {(supplier.prequalification || []).length === 0 ? (
          <p className="text-sm text-gray-500">{t('prequal.noCategory')}</p>
        ) : (
          <div className="divide-y">
            {supplier.prequalification.map(p => {
              const st = PREQ_STATUS[p.status || 'PENDING'];
              return (
                <div key={p.category_id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800">{p.category_name}</p>
                    <p className="text-xs text-gray-500">
                      <span className={`px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                      {p.decided_at && <> · {new Date(p.decided_at).toLocaleDateString(getLocale())}{p.decided_by_name ? t('prequal.byName', { name: p.decided_by_name }) : ''}</>}
                      {p.comment && <> · « {p.comment} »</>}
                    </p>
                  </div>
                  {canReview && (
                    <div className="flex items-center gap-2">
                      {p.status !== 'APPROVED' && (
                        <button type="button" disabled={busy === `cat-${p.category_id}` || !dossier.complete} onClick={() => decide(p.category_id, 'APPROVED')}
                          title={dossier.complete ? t('prequal.declare') : t('prequal.allDocsRequired')}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
                          <CheckCircle size={14} /> {t('prequal.prequalify')}
                        </button>
                      )}
                      {p.status !== 'REJECTED' && (
                        <button type="button" disabled={busy === `cat-${p.category_id}`} onClick={() => setRejectingCat(p.category_id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-sm hover:bg-red-50">
                          <XCircle size={14} /> {t('common.reject')}
                        </button>
                      )}
                      {p.status && (
                        <button type="button" disabled={busy === `cat-${p.category_id}`} onClick={() => decide(p.category_id, null)} title={t('prequal.reset')}
                          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><RotateCcw size={16} /></button>
                      )}
                    </div>
                  )}
                  {rejectingCat === p.category_id && (
                    <ReasonInput placeholder={t('prequal.rejectReason')}
                      onConfirm={(c) => decide(p.category_id, 'REJECTED', c)} onCancel={() => setRejectingCat(null)} />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!canReview && (
          <p className="text-xs text-gray-500 mt-3">{t('prequal.adminOnly')}</p>
        )}
      </Card>
    </div>
  );
}
