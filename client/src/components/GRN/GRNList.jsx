import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, Search, RefreshCw, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { grnService } from '../../services/grnService';

const STATUS_LABELS = {
  DRAFT: { label: 'Brouillon', cls: 'bg-gray-100 text-gray-700' },
  PENDING: { label: 'En attente', cls: 'bg-yellow-100 text-yellow-700' },
  PARTIAL: { label: 'Partielle', cls: 'bg-orange-100 text-orange-700' },
  COMPLETE: { label: 'Complète', cls: 'bg-green-100 text-green-700' },
};

export default function GRNList() {
  const navigate = useNavigate();
  const [grns, setGrns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await grnService.getAll({ status: statusFilter || undefined, page, limit: 20 });
      setGrns(res.data || []);
      setPagination(res.pagination || {});
    } catch (e) {
      toast.error('Erreur lors du chargement des GRN');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter, page]);

  const filtered = grns.filter(g =>
    !search ||
    g.grn_number?.toLowerCase().includes(search.toLowerCase()) ||
    g.po_number?.toLowerCase().includes(search.toLowerCase()) ||
    g.supplier_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bons de Réception (GRN)</h1>
          <p className="text-gray-500 text-sm mt-1">Gestion des réceptions de marchandises</p>
        </div>
        <button
          onClick={() => navigate('/goods-receipts/new')}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Nouveau GRN
        </button>
      </div>

      {/* Filtres */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Rechercher GRN, commande…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={load} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? 'animate-spin text-blue-500' : 'text-gray-500'} />
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <RefreshCw size={24} className="animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Package size={40} className="mb-2 opacity-40" />
            <p>Aucun bon de réception trouvé</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['N° GRN', 'Commande', 'Fournisseur', 'Date réception', 'Réceptionné par', 'Statut', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(grn => {
                const s = STATUS_LABELS[grn.status] || STATUS_LABELS.DRAFT;
                return (
                  <tr key={grn.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">{grn.grn_number}</td>
                    <td className="px-4 py-3 text-blue-600">{grn.po_number || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{grn.supplier_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {grn.receipt_date ? new Date(grn.receipt_date).toLocaleDateString('fr-FR') : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{grn.received_by_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/goods-receipts/${grn.id}`)}
                        className="p-1.5 hover:bg-blue-50 rounded text-blue-600"
                        title="Voir"
                      >
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

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: pagination.pages }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`w-8 h-8 rounded text-sm ${p === page ? 'bg-blue-600 text-white' : 'border border-gray-300 hover:bg-gray-50'}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
