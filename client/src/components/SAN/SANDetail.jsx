import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, CheckCircle, XCircle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { sanService } from '../../services/sanService';

const STATUS_CONFIG = {
  ACCEPTED: { label: 'Accepté',  icon: CheckCircle, cls: 'text-green-700 bg-green-50 border-green-200' },
  REJECTED: { label: 'Rejeté',   icon: XCircle,     cls: 'text-red-700 bg-red-50 border-red-200' },
  DRAFT:    { label: 'Brouillon', icon: Clock,       cls: 'text-gray-700 bg-gray-50 border-gray-200' },
};

export default function SANDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [san, setSan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sanService.getById(id)
      .then(r => setSan(r.data))
      .catch(() => { toast.error('SAN introuvable'); navigate('/service-acceptance-notes'); })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex justify-center items-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
    </div>
  );
  if (!san) return null;

  const sc = STATUS_CONFIG[san.status] || STATUS_CONFIG.DRAFT;
  const StatusIcon = sc.icon;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button onClick={() => navigate('/service-acceptance-notes')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> Retour aux SAN
      </button>

      {/* Header */}
      <div className={`flex items-center justify-between p-4 rounded-xl border mb-6 ${sc.cls}`}>
        <div className="flex items-center gap-3">
          <ClipboardCheck size={28} />
          <div>
            <h1 className="text-xl font-bold">{san.san_number}</h1>
            <p className="text-sm opacity-80">
              {san.po_number && (
                <Link to={`/purchase-orders/${san.po_id}`} className="underline">
                  Commande {san.po_number}
                </Link>
              )}
              {san.supplier_name && ` — ${san.supplier_name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-semibold">
          <StatusIcon size={18} /> {sc.label}
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Date acceptation', value: san.acceptance_date ? new Date(san.acceptance_date).toLocaleDateString('fr-FR') : '—' },
          { label: 'Validé par', value: san.accepted_by_name || '—' },
          { label: 'Commande', value: san.po_number || '—' },
          { label: 'Fournisseur', value: san.supplier_name || '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="font-semibold text-gray-900 text-sm">{value}</p>
          </div>
        ))}
      </div>

      {/* Liens */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {san.po_id && (
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Commande liée</p>
            <Link to={`/purchase-orders/${san.po_id}`}
              className="text-blue-600 underline text-sm font-medium hover:text-blue-800">
              {san.po_number}
            </Link>
          </div>
        )}
        {san.requisition_id && (
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Réquisition</p>
            <Link to={`/requisitions/${san.requisition_id}`}
              className="text-blue-600 underline text-sm font-medium hover:text-blue-800">
              {san.requisition_number}
            </Link>
          </div>
        )}
      </div>

      {/* Commentaires */}
      {san.comments ? (
        <div className={`rounded-xl border p-4 mb-6 ${san.status === 'REJECTED' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
          <p className={`text-xs font-semibold uppercase mb-2 ${san.status === 'REJECTED' ? 'text-red-700' : 'text-gray-600'}`}>
            {san.status === 'REJECTED' ? 'Motif de rejet' : 'Commentaires'}
          </p>
          <p className="text-sm text-gray-800">{san.comments}</p>
        </div>
      ) : null}

      {/* Résultat */}
      {san.status === 'ACCEPTED' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle size={20} className="text-green-600 shrink-0" />
          <div>
            <p className="font-semibold text-green-800 text-sm">Service accepté</p>
            <p className="text-xs text-green-700">Le processus peut continuer vers la facturation.</p>
          </div>
        </div>
      )}
      {san.status === 'REJECTED' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <XCircle size={20} className="text-red-600 shrink-0" />
          <div>
            <p className="font-semibold text-red-800 text-sm">Service rejeté</p>
            <p className="text-xs text-red-700">Une action corrective est requise de la part du fournisseur.</p>
          </div>
        </div>
      )}
    </div>
  );
}
