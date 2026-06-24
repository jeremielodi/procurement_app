import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, ClipboardCheck, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { sanService } from '../../services/sanService';
import api from '../../services/api';

export default function SANForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const poId   = searchParams.get('poId');
  const taskId = searchParams.get('taskId');

  const [po, setPO] = useState(null);
  const [comments, setComments] = useState('');
  const [serviceAccepted, setServiceAccepted] = useState(null); // null = not chosen yet
  const [loading, setLoading] = useState(false);
  const [loadingPO, setLoadingPO] = useState(false);

  useEffect(() => {
    if (poId) fetchPO(poId);
  }, [poId]);

  async function fetchPO(id) {
    setLoadingPO(true);
    try {
      const res = await api.get(`/purchase-orders/${id}`);
      setPO(res.data?.data);
    } catch {
      toast.error('Impossible de charger la commande');
    } finally {
      setLoadingPO(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!poId) { toast.error('Aucune commande sélectionnée'); return; }
    if (serviceAccepted === null) { toast.error('Veuillez indiquer si le service est accepté ou rejeté'); return; }

    setLoading(true);
    try {
      const res = await sanService.create({
        poId,
        comments,
        serviceAccepted,
        taskId: taskId || undefined
      });
      if (res.success) {
        toast.success(`SAN ${res.data.sanNumber} créé — ${res.data.serviceAccepted ? 'Accepté' : 'Rejeté'}`);
        navigate(`/service-acceptance-notes/${res.data.id}`);
      } else {
        toast.error(res.message || 'Erreur création SAN');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> Retour
      </button>

      <div className="flex items-center gap-3 mb-6">
        <ClipboardCheck size={28} className="text-purple-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Nouvelle Note d'Acceptation de Service (SAN)</h1>
          {po && <p className="text-gray-500 text-sm">Commande {po.po_number} — {po.supplier_name}</p>}
        </div>
      </div>

      {!poId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 text-sm text-yellow-800">
          Accédez à cette page depuis une commande avec GRN conforme pour pré-remplir les informations.
        </div>
      )}

      {loadingPO && <div className="text-center text-gray-500 py-4">Chargement de la commande…</div>}

      {po && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6 text-sm">
          <div className="grid grid-cols-3 gap-4">
            <div><span className="font-medium text-purple-700">Commande</span><br /><span>{po.po_number}</span></div>
            <div><span className="font-medium text-purple-700">Fournisseur</span><br /><span>{po.supplier_name}</span></div>
            <div><span className="font-medium text-purple-700">Objet</span><br /><span>{po.description || po.title || '—'}</span></div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Décision d'acceptation */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">
            Décision d'acceptation du service *
          </label>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setServiceAccepted(true)}
              className={`flex items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all ${
                serviceAccepted === true
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 hover:border-green-300 text-gray-500'
              }`}
            >
              <CheckCircle size={24} />
              <div className="text-left">
                <div className="font-semibold">Accepter</div>
                <div className="text-xs opacity-75">Le service est conforme</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setServiceAccepted(false)}
              className={`flex items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all ${
                serviceAccepted === false
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-200 hover:border-red-300 text-gray-500'
              }`}
            >
              <XCircle size={24} />
              <div className="text-left">
                <div className="font-semibold">Rejeter</div>
                <div className="text-xs opacity-75">Non-conformité constatée</div>
              </div>
            </button>
          </div>
        </div>

        {/* Commentaires */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Commentaires / Observations
            {serviceAccepted === false && <span className="text-red-500 ml-1">(motif de rejet requis)</span>}
          </label>
          <textarea
            rows={4}
            required={serviceAccepted === false}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder={serviceAccepted === false
              ? 'Décrivez les non-conformités constatées…'
              : 'Observations sur la prestation reçue…'}
            value={comments}
            onChange={e => setComments(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            Annuler
          </button>
          <button
            type="submit"
            disabled={loading || !poId || serviceAccepted === null}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium"
          >
            {loading ? 'Enregistrement…' : <><Save size={16} /> Enregistrer le SAN</>}
          </button>
        </div>
      </form>
    </div>
  );
}
