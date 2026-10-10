import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FileText, Search, RefreshCw, Eye, CheckCircle, XCircle, AlertTriangle, CheckSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { invoiceService } from '../../services/invoiceService';
import { t, withLabel, getLocale } from '../../i18n';
import SearchSelect from '../Common/SearchSelect';

const STATUS_LABELS = withLabel('invoiceStatus', {
  DRAFT:          { cls: 'bg-gray-100 text-gray-700' },
  SUBMITTED:      { cls: 'bg-blue-100 text-blue-700' },
  APPROVED:       { cls: 'bg-green-100 text-green-700' },
  REJECTED:       { cls: 'bg-red-100 text-red-700' },
  PAID:           { cls: 'bg-purple-100 text-purple-700' },
  PARTIALLY_PAID: { cls: 'bg-orange-100 text-orange-700' },
});

const MATCH_LABELS = withLabel('matchStatus', {
  PENDING:        { icon: AlertTriangle, cls: 'text-yellow-600' },
  MATCHED:        { icon: CheckCircle,   cls: 'text-green-600' },
  PRICE_MISMATCH: { icon: XCircle,       cls: 'text-red-600' },
  NO_GRN:         { icon: XCircle,       cls: 'text-red-600' },
  GRN_PARTIAL:    { icon: AlertTriangle, cls: 'text-orange-600' },
  MISMATCH:       { icon: XCircle,       cls: 'text-red-600' },
});

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
      toast.error(t('invoice.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter, matchFilter, page]);

  const filtered = invoices.filter(inv =>
    !search ||
    inv.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
    inv.supplier_invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
    inv.po_number?.toLowerCase().includes(search.toLowerCase()) ||
    inv.supplier_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('invoice.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('invoice.subtitle')}</p>
        </div>
        {/* Pas de création ici : le document se crée depuis la tâche de la réquisition (rattachement garanti) */}
        <Link to="/tasks" title={t('workflowOnly.listHint')}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
          <CheckSquare size={16} /> {t('nav.myTasks')}
        </Link>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('invoice.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <SearchSelect value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('invoice.allStatuses')}</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </SearchSelect>
        <SearchSelect value={matchFilter} onChange={e => { setMatchFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('invoice.allMatches')}</option>
          {Object.entries(MATCH_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </SearchSelect>
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
            <p>{t('invoice.none')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {t('invoice.cols', { returnObjects: true }).map((h, i) => (
                  <th key={i} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
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
                    <td className="px-4 py-3 font-mono font-medium">{inv.invoice_number}
                      {inv.supplier_invoice_number && <div className="text-xs font-normal text-gray-500">{t('invoice.supplierNumberShort', { number: inv.supplier_invoice_number })}</div>}
                    </td>
                    <td className="px-4 py-3 text-blue-600">{inv.po_number || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{inv.supplier_name || '—'}</td>
                    <td className="px-4 py-3 font-medium">{parseFloat(inv.total_amount || 0).toLocaleString(getLocale())} {inv.currency}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString(getLocale()) : '—'}</td>
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
