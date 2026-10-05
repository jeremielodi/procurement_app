// src/components/SupplierPortal/SupplierTenderDetail.jsx
// Saisie / modification de l'offre du fournisseur + PDF à cacheter
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, FileDown, Clock, Lock, Award, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supplierPortalService } from '../../services/supplierPortalService';
import { fmtDateTime, fmtMoney, timeLeft } from '../../utils/tenderStatus';
import { enterpriseLogoUrl } from '../../contexts/EnterpriseContext';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

export default function SupplierTenderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tender, setTender] = useState(null);
  const [prices, setPrices] = useState({});     // itemId → { unitPrice, comment }
  const [deliveryDays, setDeliveryDays] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const hydrate = (t) => {
    setTender(t);
    const sub = t.mySubmission;
    const map = {};
    (sub?.items || []).forEach(l => {
      map[l.requisition_item_id] = { unitPrice: String(parseFloat(l.unit_price)), comment: l.comment || '' };
    });
    setPrices(map);
    setDeliveryDays(sub ? String(sub.delivery_days) : '');
    setNotes(sub?.notes || '');
  };

  useEffect(() => {
    supplierPortalService.getTender(id).then(res => hydrate(res.data)).catch(() => {});
  }, [id]);

  useEffect(() => () => pdfUrl && URL.revokeObjectURL(pdfUrl), [pdfUrl]);

  const total = useMemo(() => (tender?.items || []).reduce((s, i) => {
    const p = parseFloat(prices[i.id]?.unitPrice);
    return s + (isNaN(p) ? 0 : p * parseFloat(i.quantity) * parseFloat(i.frequency || 1));
  }, 0), [prices, tender]);

  if (!tender) return <div className="flex justify-center items-center h-64"><RefreshCw className="animate-spin text-blue-500" /></div>;

  const editable = tender.effective_status === 'OPEN';
  const cur = tender.currency_code || '';
  const left = editable ? timeLeft(tender.end_date) : null;
  const pricedCount = tender.items.filter(i => prices[i.id]?.unitPrice !== undefined && prices[i.id]?.unitPrice !== '').length;

  const setPrice = (itemId, key, value) =>
    setPrices(p => ({ ...p, [itemId]: { ...(p[itemId] || {}), [key]: value } }));

  const submit = async (e) => {
    e.preventDefault();
    const days = parseInt(deliveryDays);
    if (!days || days <= 0) return toast.error('Indiquez votre délai de livraison');
    if (days > tender.max_delivery_days) return toast.error(`Délai maximum : ${tender.max_delivery_days} jours`);
    if (pricedCount === 0) return toast.error("Saisissez le prix d'au moins un item");
    const bad = tender.items.find(i => prices[i.id]?.unitPrice && (isNaN(parseFloat(prices[i.id].unitPrice)) || parseFloat(prices[i.id].unitPrice) < 0));
    if (bad) return toast.error(`Prix invalide pour « ${bad.item_description} »`);

    setSaving(true);
    try {
      const res = await supplierPortalService.submit(tender.id, {
        deliveryDays: days,
        notes,
        items: tender.items
          .filter(i => prices[i.id]?.unitPrice !== undefined && prices[i.id]?.unitPrice !== '')
          .map(i => ({ requisitionItemId: i.id, unitPrice: parseFloat(prices[i.id].unitPrice), comment: prices[i.id].comment || null })),
      });
      toast.success(res.message);
      hydrate({ ...tender, mySubmission: res.data });
    } catch (_) { /* toast */ } finally {
      setSaving(false);
    }
  };

  const openPdf = async () => {
    setPdfLoading(true);
    try {
      const blob = await supplierPortalService.getSubmissionPdf(tender.id);
      setPdfUrl(URL.createObjectURL(blob));
    } catch (_) { /* toast */ } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/supplier/tenders')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div>
            <span className="font-mono text-sm text-blue-700">{tender.tender_number}</span>
            <h1 className="text-2xl font-bold text-gray-900">{tender.title}</h1>
            {tender.enterprise_name && (
          <div className="flex items-center gap-2 mt-1 text-sm text-gray-700" data-testid="buyer">
            {tender.enterprise_logo_path && <img src={enterpriseLogoUrl({ id: tender.enterprise_id, logo_path: tender.enterprise_logo_path })} alt="" className="h-5 w-5 object-contain" />}
            <span>Acheteur : <b>{tender.enterprise_name}</b></span>
          </div>
        )}
            {(tender.category_name || tender.location_name) && (
              <p className="text-sm text-gray-500 mt-1">
                {[tender.category_name, tender.location_name && `Livraison : ${tender.location_name}`].filter(Boolean).join(' · ')}
                {tender.audience === 'PREQUALIFIED' && <span className="ml-2 text-green-700">· réservé aux fournisseurs préqualifiés</span>}
              </p>
            )}
          </div>
        </div>
        {tender.mySubmission && (
          <button onClick={openPdf} disabled={pdfLoading}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
            <FileDown size={16} /> {pdfLoading ? 'Génération…' : 'Télécharger mon offre (PDF)'}
          </button>
        )}
      </div>

      {tender.is_awarded_to_me && (
        <div className="p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 flex items-center gap-2">
          <Award size={18} /> Félicitations, votre offre a été retenue. Vous recevrez le bon de commande par email.
        </div>
      )}
      {editable ? (
        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-center gap-2">
          <Clock size={16} /> Soumissions ouvertes jusqu'au <b>{fmtDateTime(tender.end_date)}</b>{left && <> (reste {left})</>}. Vous pouvez modifier votre offre jusque-là.
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-gray-100 border border-gray-200 text-sm text-gray-700 flex items-center gap-2">
          <Lock size={16} />
          {tender.effective_status === 'UPCOMING'
            ? <>Les soumissions ouvriront le <b>{fmtDateTime(tender.start_date)}</b>.</>
            : <>Soumissions clôturées le {fmtDateTime(tender.end_date)}.</>}
        </div>
      )}

      {tender.description && <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-700 whitespace-pre-line">{tender.description}</div>}

      <form onSubmit={submit} className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Désignation</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Quantité</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600 w-40">Prix unitaire ({cur})</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Total ({cur})</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600 w-56">Commentaire (marque, modèle…)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tender.items.map(i => {
                const qty = parseFloat(i.quantity) * parseFloat(i.frequency || 1);
                const p = parseFloat(prices[i.id]?.unitPrice);
                return (
                  <tr key={i.id}>
                    <td className="px-3 py-2">
                      {i.item_description}
                      {i.specifications && <div className="text-xs text-gray-500">{i.specifications}</div>}
                    </td>
                    <td className="px-3 py-2 text-right">{qty}</td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" disabled={!editable} aria-label={`Prix ${i.item_description}`}
                        className={`${inputCls} text-right`} value={prices[i.id]?.unitPrice ?? ''}
                        onChange={e => setPrice(i.id, 'unitPrice', e.target.value)} />
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{isNaN(p) ? '—' : fmtMoney(p * qty)}</td>
                    <td className="px-3 py-2">
                      <input disabled={!editable} className={inputCls} value={prices[i.id]?.comment ?? ''}
                        onChange={e => setPrice(i.id, 'comment', e.target.value)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-blue-50">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right font-semibold">Total de l'offre ({pricedCount}/{tender.items.length} items chiffrés)</td>
                <td className="px-3 py-2 text-right font-bold" data-testid="offer-total">{fmtMoney(total, cur)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="deliveryDays">
              Délai de livraison (jours) * <span className="text-gray-500 font-normal">max {tender.max_delivery_days}</span>
            </label>
            <input id="deliveryDays" type="number" min="1" max={tender.max_delivery_days} disabled={!editable}
              className={inputCls} value={deliveryDays} onChange={e => setDeliveryDays(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="notes">Remarques (validité de l'offre, conditions…)</label>
            <textarea id="notes" rows={2} disabled={!editable} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">
            {tender.mySubmission ? <>Dernière soumission : {fmtDateTime(tender.mySubmission.updated_at)}</> : 'Aucune soumission enregistrée'}
          </span>
          {editable && (
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              <Send size={16} /> {saving ? 'Envoi…' : tender.mySubmission ? 'Mettre à jour mon offre' : 'Soumettre mon offre'}
            </button>
          )}
        </div>
      </form>

      {pdfUrl && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-xl w-full max-w-5xl h-[90vh] flex flex-col">
            <div className="flex justify-between items-center px-4 py-3 border-b">
              <span className="font-semibold">Mon offre — à imprimer, cacheter, signer et renvoyer</span>
              <div className="flex gap-2">
                <a href={pdfUrl} download={`offre_${tender.tender_number.replace(/[^\w.-]+/g, '_')}.pdf`}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm"><FileDown size={14} /> Télécharger</a>
                <button onClick={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }} className="p-1.5 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
            </div>
            <iframe key={pdfUrl} src={pdfUrl} title="Mon offre PDF" className="flex-1 w-full" />
          </div>
        </div>
      )}
    </div>
  );
}
