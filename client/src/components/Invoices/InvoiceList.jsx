import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, Search, RefreshCw, Eye, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { invoiceService } from '../../services/invoiceService';

const STATUS_LABELS = {
  DRAFT:          { label: 'Brouillon',   cls: 'bg-gray-100 text-gray-700' },
  SUBMITTED:      { label: 'Soumise',     cls: 'bg-blue-100 text-blue-700' },
  APPROVED:       { label: 'Approuvée',   cls: 'bg-green-100 text-green-700' },
  REJECTED:       { label: 'Rejetée',     cls: 'bg-red-100 text-red-700' },
  PAID:           { label: 'Payée',       cls: 'bg-purple-100 text-purple-700' },
  PARTIALLY_PAID: { label: 'Paiement partiel', cls: 'bg-orange-100 text-orange-700' },
};

const MATCH_LABELS = {
  PENDING:        { label: 'En attente', icon: AlertTriangle, cls: 'text-yellow-600' },
  MATCHED:        { label: 'Rapprochée', icon: CheckCircle,   cls: 'text-green-600' },
  PRICE_MISMATCH: { label: 'Écart prix', icon: XCircle,       cls: 'text-red-600' },
  NO_GRN:         { label: 'Sans GRN',   icon: XCircle,       cls: 'text-red-600' },
  GRN_PARTIAL:    { label: 'GRN partiel',icon: AlertTriangle, cls: 'text-orange-600' },
  MISMATCH:       { label: 'Non conforme',icon: XCircle,      cls: 'text-red-600' },
};

export default function InvoiceList() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [matchFilter, setMatchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await invoiceService.getAll({
        status: statusFilter || undefined,
        matchStatus: matchFilter || undefined,
        page, limit: 20
      });
      setInvoices(res.data || []);
      setPagination(res.pagination || {});
    } catch {
      toast.error('Erreur lors du chargement des factures');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter, matchFilter, page]);

  const filtered = invoices.filter(inv =>
    !search ||
    inv.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
    inv.po_number?.toLowerCase().includes(search.toLowerCase()) ||
    inv.supplier_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Factures Fournisseurs</h1>
          <p className="text-gray-500 text-sm mt-1">Saisie et rapprochement 3 voies (PO + GRN + Facture)</p>
        </div>
        <button
          onClick={() => navigate('/invoices/new')}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} /> Nouvelle facture
        </button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="N° facture, commande, fournisseur…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Tous statuts</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={matchFilter} onChange={e => { setMatchFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Tous rapprochements</option>
          {Object.entries(MATCH_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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
            <FileText size={40} className="mb-2 opacity-40" />
            <p>Aucune facture trouvée</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['N° Facture', 'Commande', 'Fournisseur', 'Montant', 'Date', 'Rapprochement', 'Statut', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(inv => {
                const s = STATUS_LABELS[inv.status] || STATUS_LABELS.DRAFT;
                const m = MATCH_LABELS[inv.match_status] || MATCH_LABELS.PENDING;
                const MatchIcon = m.icon;
                return (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-blue-600">{inv.po_number || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{inv.supplier_name || '—'}</td>
                    <td className="px-4 py-3 font-medium">{parseFloat(inv.total_amount || 0).toLocaleString()} {inv.currency}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('fr-FR') : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 text-xs font-medium ${m.cls}`}>
                        <MatchIcon size={14} /> {m.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => navigate(`/invoices/${inv.id}`)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600">
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
