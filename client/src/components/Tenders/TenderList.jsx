// src/components/Tenders/TenderList.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gavel, Plus, Search, RefreshCw, Eye, Users } from 'lucide-react';
import { tenderService } from '../../services/tenderService';
import { TENDER_STATUS, fmtDateTime, timeLeft } from '../../utils/tenderStatus';

export default function TenderList() {
  const navigate = useNavigate();
  const [tenders, setTenders] = useState([]);
  const [registered, setRegistered] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await tenderService.getAll({ status: status || undefined, search: search || undefined });
      setTenders(res.data || []);
      setRegistered(res.registeredSuppliers || 0);
    } catch (_) {
      // toast via intercepteur
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Appels d'offres</h1>
          <p className="text-gray-500 text-sm mt-1 flex items-center gap-1">
            <Users size={14} /> {registered} fournisseur(s) inscrit(s) sur le portail
          </p>
        </div>
        <button
          onClick={() => navigate('/tenders/new')}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} /> Nouvel appel d'offres
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <form className="relative flex-1 max-w-xs" onSubmit={e => { e.preventDefault(); load(); }}>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="N° AO, titre, réquisition… (Entrée)"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </form>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Tous les statuts</option>
          {Object.entries(TENDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={load} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? 'animate-spin text-blue-500' : 'text-gray-500'} />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-48"><RefreshCw size={24} className="animate-spin text-blue-500" /></div>
        ) : tenders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Gavel size={40} className="mb-2 opacity-40" />
            <p>Aucun appel d'offres</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['N° AO', 'Titre', 'Réquisition', 'Clôture', 'Délai max', 'Soumissions', 'Statut', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tenders.map(t => {
                const s = TENDER_STATUS[t.effective_status] || TENDER_STATUS.OPEN;
                const left = t.effective_status === 'OPEN' ? timeLeft(t.end_date) : null;
                return (
                  <tr key={t.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/tenders/${t.id}`)}>
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">{t.tender_number}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {t.title}
                      {(t.category_name || t.audience === 'PREQUALIFIED') && (
                        <div className="text-xs text-gray-500">
                          {[t.category_name, t.location_name].filter(Boolean).join(' · ')}
                          {t.audience === 'PREQUALIFIED' && <span className="ml-1 text-green-700">· préqualifiés</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-blue-600">{t.requisition_number}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {fmtDateTime(t.end_date)}
                      {left && <div className="text-xs text-green-600">reste {left}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{t.max_delivery_days} j</td>
                    <td className="px-4 py-3 text-gray-700">{t.submission_count}{t.audience === 'PREQUALIFIED' ? '' : ` / ${registered}`}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>
                      {t.awarded_supplier_name && <div className="text-xs text-gray-500 mt-1">{t.awarded_supplier_name}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <Eye size={16} className="text-blue-600" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
