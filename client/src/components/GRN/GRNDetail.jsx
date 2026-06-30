import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Package, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { grnService } from '../../services/grnService';

const STATUS_CONFIG = {
  COMPLETE: { label: 'Complète', icon: CheckCircle, cls: 'text-green-600 bg-green-50 border-green-200' },
  PARTIAL:  { label: 'Partielle', icon: AlertTriangle, cls: 'text-orange-600 bg-orange-50 border-orange-200' },
  PENDING:  { label: 'En attente', icon: Clock, cls: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  DRAFT:    { label: 'Brouillon', icon: Clock, cls: 'text-gray-600 bg-gray-50 border-gray-200' },
};

export default function GRNDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [grn, setGrn] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    grnService.getById(id)
      .then(r => setGrn(r.data))
      .catch(() => toast.error('GRN introuvable'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }
  if (!grn) {
    return <div className="p-6 text-gray-500">GRN introuvable.</div>;
  }

  const status = STATUS_CONFIG[grn.status] || STATUS_CONFIG.DRAFT;
  const StatusIcon = status.icon;
  const totalReceived = (grn.items || []).reduce((s, i) => s + (i.quantity_received || 0), 0);
  const totalRejected = (grn.items || []).reduce((s, i) => s + (i.quantity_rejected || 0), 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> Retour
      </button>

      {/* Header */}
      <div className={`flex items-center justify-between p-4 rounded-xl border mb-6 ${status.cls}`}>
        <div className="flex items-center gap-3">
          <Package size={28} />
          <div>
            <h1 className="text-xl font-bold">{grn.grn_number}</h1>
            <p className="text-sm opacity-80">
              {grn.po_number && <Link to={`/purchase-orders/${grn.po_id}`} className="underline">Commande {grn.po_number}</Link>}
              {grn.supplier_name && ` — ${grn.supplier_name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-medium">
          <StatusIcon size={18} /> {status.label}
        </div>
      </div>

      {/* Info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Date réception', value: grn.receipt_date ? new Date(grn.receipt_date).toLocaleDateString('fr-FR') : '—' },
          { label: 'Réceptionné par', value: grn.received_by_name || '—' },
          { label: 'Qté totale reçue', value: totalReceived },
          { label: 'Qté rejetée', value: totalRejected, warn: totalRejected > 0 },
        ].map(({ label, value, warn }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`font-semibold ${warn ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Items */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h2 className="font-medium text-gray-700">Articles réceptionnés</h2>
        </div>
        {(grn.items || []).length === 0 ? (
          <p className="text-center text-gray-400 py-6 text-sm">Aucun article enregistré</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Article', 'Reçu', 'Accepté', 'Rejeté', 'Motif rejet'].map(h => (
                  <th key={h} className="text-left px-4 py-2 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {grn.items.map(item => (
                <tr key={item.id} className={item.quantity_rejected > 0 ? 'bg-red-50' : ''}>
                  <td className="px-4 py-2 text-gray-900">{item.item_description}</td>
                  <td className="px-4 py-2 text-center">{item.quantity_received}</td>
                  <td className="px-4 py-2 text-center text-green-700 font-medium">{item.quantity_accepted}</td>
                  <td className="px-4 py-2 text-center text-red-600 font-medium">{item.quantity_rejected || 0}</td>
                  <td className="px-4 py-2 text-gray-500 italic">{item.rejection_reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Observations */}
      {grn.observations && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-gray-700 mb-1">Observations</p>
          <p className="text-gray-600">{grn.observations}</p>
        </div>
      )}

      {/* Action: Create Invoice */}
      {/* {grn.status === 'COMPLETE' && (
        <div className="mt-6">
          <Link
            to={`/invoices/new?poId=${grn.po_id}&grnId=${grn.id}`}
            className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Saisir la facture pour cette réception →
          </Link>
        </div>
      )} */}
    </div>
  );
}
