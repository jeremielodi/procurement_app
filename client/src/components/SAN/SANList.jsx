import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus, Search, RefreshCw, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { sanService } from '../../services/sanService';

const STATUS_LABELS = {
  DRAFT:    { label: 'Brouillon',  cls: 'bg-gray-100 text-gray-700' },
  ACCEPTED: { label: 'Accepté',   cls: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Rejeté',    cls: 'bg-red-100 text-red-700' },
};

export default function SANList() {
  const navigate = useNavigate();
  const [sans, setSans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await sanService.getAll({ status: statusFilter || undefined, page, limit: 20 });
      setSans(res.data || []);
      setPagination(res.pagination || {});
    } catch {
      toast.error('Erreur lors du chargement des SAN');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter, page]);

  const filtered = sans.filter(s =>
    !search ||
    s.san_number?.toLowerCase().includes(search.toLowerCase()) ||
    s.po_number?.toLowerCase().includes(search.toLowerCase()) ||
    s.supplier_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notes d'Acceptation de Service (SAN)</h1>
          <p className="text-gray-500 text-sm mt-1">Validation des services et prestations reçus</p>
        </div>
        <button
          onClick={() => navigate('/service-acceptance-notes/new')}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} /> Nouvelle SAN
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="Rechercher SAN, commande…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={load} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? 'animate-spin text-purple-500' : 'text-gray-500'} />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <RefreshCw size={24} className="animate-spin text-purple-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <ClipboardCheck size={40} className="mb-2 opacity-40" />
            <p>Aucune note d'acceptation trouvée</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['N° SAN', 'Commande', 'Fournisseur', 'Date acceptation', 'Validé par', 'Statut', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(san => {
                const s = STATUS_LABELS[san.status] || STATUS_LABELS.DRAFT;
                return (
                  <tr key={san.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">{san.san_number}</td>
                    <td className="px-4 py-3 text-blue-600">{san.po_number || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{san.supplier_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {san.acceptance_date ? new Date(san.acceptance_date).toLocaleDateString('fr-FR') : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{san.accepted_by_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/service-acceptance-notes/${san.id}`)}
                        className="p-1.5 hover:bg-purple-50 rounded text-purple-600"
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

      {pagination.pages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: pagination.pages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`w-8 h-8 rounded text-sm ${p === page ? 'bg-purple-600 text-white' : 'border border-gray-300 hover:bg-gray-50'}`}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
