// src/components/Tenders/TenderForm.jsx
// Création d'un appel d'offres lié à une réquisition.
// Accès depuis la TaskList (Activity_RFPProcess) : ?taskId=&requisitionId=
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Gavel, Send, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { tenderService } from '../../services/tenderService';
import requisitionService from '../../services/requisitionService';
import { toLocalInput, fmtMoney } from '../../utils/tenderStatus';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function TenderForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const taskId = params.get('taskId') || '';
  const [requisitionId, setRequisitionId] = useState(params.get('requisitionId') || '');
  const [requisition, setRequisition] = useState(null);
  const [choices, setChoices] = useState([]);
  // AO déjà publié pour la réquisition choisie (un seul AO actif par réquisition)
  const [existingTender, setExistingTender] = useState(null);
  // requisition_id → AO actif, pour signaler les réquisitions déjà couvertes dans la liste
  const [tenderByReq, setTenderByReq] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    tenderNumber: '',
    title: '',
    description: '',
    startDate: toLocalInput(new Date()),
    endDate: toLocalInput(new Date(Date.now() + 7 * 86400000)),
    maxDeliveryDays: 30,
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Liste des réquisitions candidates (classées RFP par défaut)
  useEffect(() => {
    if (params.get('requisitionId')) return;
    requisitionService.getAll(showAll ? { limit: 200 } : { status: 'CLASSIFIED_RFP', limit: 200 })
      .then(res => setChoices(res.data || []))
      .catch(() => {});
  }, [showAll]);

  useEffect(() => {
    tenderService.getAll()
      .then(res => setTenderByReq(Object.fromEntries(
        (res.data || []).filter(t => t.effective_status !== 'CANCELLED').map(t => [t.requisition_id, t])
      )))
      .catch(() => {});
  }, []);

  // Réquisition choisie : AO déjà existant → avertissement bloquant ; sinon pré-remplir
  useEffect(() => {
    setExistingTender(null);
    if (!requisitionId) { setRequisition(null); return; }
    (async () => {
      try {
        const existing = await tenderService.getByRequisition(requisitionId);
        if (existing.data) setExistingTender(existing.data);
        const res = await requisitionService.getById(requisitionId);
        setRequisition(res.data);
        setForm(f => ({ ...f, title: f.title || res.data.title || '', description: f.description || res.data.description || '' }));
      } catch (_) { /* toast via intercepteur */ }
    })();
  }, [requisitionId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!requisitionId) return toast.error('Choisissez une réquisition');
    if (!form.tenderNumber.trim()) return toast.error("Saisissez le numéro de l'appel d'offres");
    if (new Date(form.endDate) <= new Date(form.startDate)) return toast.error('La date de fin doit être après la date de début');
    setSubmitting(true);
    try {
      const res = await tenderService.create({
        ...form,
        requisitionId,
        taskId: taskId || undefined,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
        maxDeliveryDays: parseInt(form.maxDeliveryDays),
      });
      toast.success(`Appel d'offres publié — ${res.notifiedSuppliers} fournisseur(s) notifié(s)`);
      navigate(`/tenders/${res.data.id}`);
    } catch (_) {
      // toast via intercepteur
    } finally {
      setSubmitting(false);
    }
  };

  const items = requisition?.items || [];

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Gavel size={22} /> Nouvel appel d'offres</h1>
          <p className="text-gray-500 text-sm">Les fournisseurs inscrits seront notifiés dès la publication.</p>
        </div>
      </div>

      {taskId && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          Tâche « Appel d'offres (RFP) » : elle sera complétée lors de l'attribution du marché, après la clôture des soumissions.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">Réquisition liée</h2>
          {params.get('requisitionId') ? (
            <p className="text-sm">
              <span className="font-mono font-medium text-blue-700">{requisition?.requisition_number || '…'}</span>
              {requisition && <> — {requisition.title}</>}
            </p>
          ) : (
            <div className="flex gap-3 items-center">
              <select value={requisitionId} onChange={e => setRequisitionId(e.target.value)} className={inputCls} data-testid="requisition-select">
                <option value="">— Choisir une réquisition —</option>
                {choices.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.requisition_number} — {r.title}{tenderByReq[r.id] ? ` ⚠ AO existant : ${tenderByReq[r.id].tender_number}` : ''}
                  </option>
                ))}
              </select>
              <label className="text-sm text-gray-600 whitespace-nowrap flex items-center gap-1">
                <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
                Toutes les réquisitions
              </label>
            </div>
          )}
          {!params.get('requisitionId') && !showAll && choices.length === 0 && (
            <p className="text-xs text-gray-500">Aucune réquisition classée « Appel d'offres ». Cochez « Toutes les réquisitions » pour élargir.</p>
          )}

          {existingTender && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-300 text-sm text-red-800 flex items-start gap-2" data-testid="existing-tender-warning">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div>
                Un appel d'offres existe déjà pour cette réquisition :{' '}
                <Link to={`/tenders/${existingTender.id}`} className="font-semibold underline">{existingTender.tender_number}</Link>.
                Il n'est pas possible d'en créer un second. Pour relancer, annulez d'abord l'appel d'offres existant.
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div>
            <div className="text-xs text-gray-500 mb-1">{items.length} article(s) à chiffrer</div>
            {/* Au-delà de ~10 articles, la liste défile (en-tête fixe) */}
            <div className="max-h-[440px] overflow-y-auto border border-gray-100 rounded" data-testid="tender-items-scroll">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600 w-10">N°</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Item à chiffrer par les fournisseurs</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Quantité</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Estimation interne</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((i, idx) => (
                  <tr key={i.id}>
                    <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                    <td className="px-3 py-2">{i.item_description}{i.specifications && <div className="text-xs text-gray-500">{i.specifications}</div>}</td>
                    <td className="px-3 py-2 text-right">{parseFloat(i.quantity) * parseFloat(i.frequency || 1)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{i.total_amount ? fmtMoney(i.total_amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="tenderNumber">N° de l'appel d'offres *</label>
            <input id="tenderNumber" className={inputCls} value={form.tenderNumber} maxLength={50}
              placeholder="ex. AO/2026/012" onChange={e => set('tenderNumber', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="maxDeliveryDays">Délai de livraison maximum (jours) *</label>
            <input id="maxDeliveryDays" type="number" min="1" className={inputCls} value={form.maxDeliveryDays}
              onChange={e => set('maxDeliveryDays', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="title">Objet *</label>
            <input id="title" className={inputCls} value={form.title} onChange={e => set('title', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="description">Description / conditions</label>
            <textarea id="description" rows={3} className={inputCls} value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="startDate">Ouverture des soumissions *</label>
            <input id="startDate" type="datetime-local" className={inputCls} value={form.startDate} onChange={e => set('startDate', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="endDate">Date limite de soumission *</label>
            <input id="endDate" type="datetime-local" className={inputCls} value={form.endDate} onChange={e => set('endDate', e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Annuler</button>
          <button type="submit" disabled={submitting || !requisitionId || !!existingTender}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            <Send size={16} /> {submitting ? 'Publication…' : 'Publier et notifier les fournisseurs'}
          </button>
        </div>
      </form>
    </div>
  );
}
