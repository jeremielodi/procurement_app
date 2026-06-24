import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Plus, Search, RefreshCw, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { paymentService } from '../../services/paymentService';
import { useCurrency } from '../../contexts/EnterpriseContext';

const STATUS_LABELS = {
  PENDING:    { label: 'En attente',  cls: 'bg-yellow-100 text-yellow-700' },
  PROCESSING: { label: 'En cours',   cls: 'bg-blue-100 text-blue-700' },
  PAID:       { label: 'Payé',       cls: 'bg-green-100 text-green-700' },
  FAILED:     { label: 'Échoué',     cls: 'bg-red-100 text-red-700' },
  CANCELLED:  { label: 'Annulé',     cls: 'bg-gray-100 text-gray-700' },
};

const METHOD_LABELS = {
  BANK_TRANSFER: 'Virement bancaire',
  CHECK:         'Chèque',
  CASH:          'Espèces',
  MOBILE_MONEY:  'Mobile Money',
};

export default function PaymentList() {
  const navigate = useNavigate();
  const { formatAmount } = useCurrency();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await paymentService.getAll({ status: statusFilter || undefined, page, limit: 20 });
      setPayments(res.data || []);
      setPagination(res.pagination || {});
    } catch {
      toast.error('Erreur lors du chargement des paiements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter, page]);

  const filtered = payments.filter(p =>
    !search ||
    p.payment_number?.toLowerCase().includes(search.toLowerCase()) ||
    p.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
    p.po_number?.toLowerCase().includes(search.toLowerCase()) ||
    p.supplier_name?.toLowerCase().includes(search.toLowerCase())
  );

  const totalAmount = filtered.reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Paiements</h1>
          <p className="text-gray-500 text-sm mt-1">Suivi des paiements fournisseurs</p>
        </div>
        <button
          onClick={() => navigate('/payments/new')}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} /> Nouveau paiement
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total paiements', value: formatAmount(totalAmount), cls: 'text-gray-900' },
          { label: 'En attente', value: filtered.filter(p => p.status === 'PENDING').length, cls: 'text-yellow-600' },
          { label: 'Payés', value: filtered.filter(p => p.status === 'PAID').length, cls: 'text-green-600' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-xl font-bold ${cls}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="N° paiement, facture…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Tous statuts</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={load} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? 'animate-spin text-blue-500' : 'text-gray-500'} />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <RefreshCw size={24} className="animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <CreditCard size={40} className="mb-2 opacity-40" />
            <p>Aucun paiement trouvé</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['N° Paiement', 'Facture', 'Fournisseur', 'Montant', 'Méthode', 'Date', 'Statut', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(pay => {
                const s = STATUS_LABELS[pay.status] || STATUS_LABELS.PENDING;
                return (
                  <tr key={pay.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium">{pay.payment_number}</td>
                    <td className="px-4 py-3 text-blue-600">{pay.invoice_number || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{pay.supplier_name || '—'}</td>
                    <td className="px-4 py-3 font-semibold">{formatAmount(pay.amount)}</td>
                    <td className="px-4 py-3 text-gray-500">{METHOD_LABELS[pay.payment_method] || pay.payment_method}</td>
                    <td className="px-4 py-3 text-gray-500">{pay.payment_date ? new Date(pay.payment_date).toLocaleDateString('fr-FR') : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => navigate(`/payments/${pay.id}`)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600">
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pagination.pages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: pagination.pages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`w-8 h-8 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'border border-gray-300 hover:bg-gray-50'}`}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
