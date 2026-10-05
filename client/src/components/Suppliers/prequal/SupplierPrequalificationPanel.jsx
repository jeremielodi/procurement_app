// Onglet « Préqualification » de la fiche fournisseur :
// type et identifiants, localisations desservies, documents, décision de mon entreprise par catégorie.
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, RotateCcw, MapPin, FileText, Tags, AlertTriangle, Contact } from 'lucide-react';
import { supplierService } from '../../../services/supplierService';
import { EXPECTED_DOCS, DOC_LABELS, SUPPLIER_TYPE_LABELS, PREQ_STATUS, openDocument } from '../../../utils/supplierDocs';
import DocumentField from './DocumentField';

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

export default function SupplierPrequalificationPanel({ supplier, canManage, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(null); // { categoryId, comment }
  const type = supplier.supplier_type || 'COMPANY';
  const docsByType = Object.fromEntries((supplier.documents || []).map(d => [d.doc_type, d]));
  const missing = supplier.missing_documents || [];
  const canUpload = canManage && !supplier.self_registered;

  const decide = async (categoryId, status, comment) => {
    setBusy(categoryId);
    try {
      const res = await supplierService.setPrequalification(supplier.id, { categoryId, status, comment });
      toast.success(res.message);
      setRejecting(null);
      onChanged?.();
    } catch (_) { /* toast */ } finally {
      setBusy(null);
    }
  };

  const upload = async (docType, file) => {
    try {
      await supplierService.uploadDocument(supplier.id, docType, file);
      toast.success(`${DOC_LABELS[docType]} enregistré`);
      onChanged?.();
    } catch (_) { /* toast */ }
  };

  return (
    <div className="space-y-6">
      {missing.length > 0 && (
        <div className="flex gap-3 p-4 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 text-sm">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <p>Documents non fournis : <b>{missing.map(t => DOC_LABELS[t]).join(', ')}</b>. Ils ne sont pas obligatoires :
            à vous d'apprécier avant de préqualifier.{supplier.self_registered ? ' Le fournisseur peut les déposer depuis son portail.' : ''}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card icon={Contact} title="Identification">
          <div className="grid grid-cols-2 gap-4">
            <Info label="Type" value={SUPPLIER_TYPE_LABELS[type]} />
            <Info label="Code fournisseur" value={supplier.supplier_code} />
            {type === 'COMPANY' && <>
              <Info label="N° RCCM" value={supplier.registration_number} />
              <Info label="N° d'impôt (NIF)" value={supplier.tax_id} />
              <Info label="N° ID Nat" value={supplier.id_nat} />
            </>}
            <Info label="N° pièce d'identité" value={supplier.id_document_number} />
            <Info label="Banque" value={supplier.bank_name} />
            <Info label="N° de compte" value={supplier.bank_account} />
          </div>
        </Card>

        <Card icon={MapPin} title="Localisations desservies">
          {(supplier.locations || []).length ? (
            <div className="flex flex-wrap gap-2">
              {supplier.locations.map(l => (
                <span key={l.id} className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-800 text-sm">{l.name}</span>
              ))}
            </div>
          ) : <p className="text-sm text-gray-500">Aucune localisation déclarée</p>}
        </Card>
      </div>

      <Card icon={FileText} title="Documents"
        right={!supplier.self_registered ? null : <span className="text-xs text-gray-500">Déposés par le fournisseur</span>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {EXPECTED_DOCS[type].map(t => canUpload ? (
            <DocumentField key={t} type={t} existing={docsByType[t]} onFile={upload}
              onView={(doc) => openDocument(() => supplierService.getDocumentBlob(supplier.id, doc.id))} />
          ) : (
            <div key={t} className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">{DOC_LABELS[t]}</p>
                <p className="text-xs truncate">
                  {docsByType[t]
                    ? <span className="text-gray-600">{docsByType[t].file_name} · {new Date(docsByType[t].uploaded_at).toLocaleDateString('fr-FR')}</span>
                    : <span className="text-gray-400">Non fourni</span>}
                </p>
              </div>
              {docsByType[t] && (
                <button onClick={() => openDocument(() => supplierService.getDocumentBlob(supplier.id, docsByType[t].id))}
                  className="text-sm text-blue-600 hover:underline shrink-0">Consulter</button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card icon={Tags} title="Préqualification par catégorie (mon entreprise)">
        {(supplier.prequalification || []).length === 0 ? (
          <p className="text-sm text-gray-500">Le fournisseur n'a déclaré aucune catégorie de marché.</p>
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
                      {p.decided_at && <> · {new Date(p.decided_at).toLocaleDateString('fr-FR')}{p.decided_by_name ? ` par ${p.decided_by_name}` : ''}</>}
                      {p.comment && <> · « {p.comment} »</>}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-2">
                      {p.status !== 'APPROVED' && (
                        <button disabled={busy === p.category_id} onClick={() => decide(p.category_id, 'APPROVED')}
                          title="Préqualifier dans cette catégorie"
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50">
                          <CheckCircle size={14} /> Préqualifier
                        </button>
                      )}
                      {p.status !== 'REJECTED' && (
                        <button disabled={busy === p.category_id} onClick={() => setRejecting({ categoryId: p.category_id, comment: '' })}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-sm hover:bg-red-50">
                          <XCircle size={14} /> Rejeter
                        </button>
                      )}
                      {p.status && (
                        <button disabled={busy === p.category_id} onClick={() => decide(p.category_id, null)} title="Remettre en attente"
                          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><RotateCcw size={16} /></button>
                      )}
                    </div>
                  )}
                  {rejecting?.categoryId === p.category_id && (
                    <div className="w-full flex gap-2">
                      <input autoFocus value={rejecting.comment} onChange={e => setRejecting(r => ({ ...r, comment: e.target.value }))}
                        placeholder="Motif du rejet (obligatoire)" className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
                      <button disabled={!rejecting.comment.trim()} onClick={() => decide(p.category_id, 'REJECTED', rejecting.comment)}
                        className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm disabled:opacity-50">Confirmer</button>
                      <button onClick={() => setRejecting(null)} className="px-3 py-1.5 rounded-lg border text-sm">Annuler</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
