// src/components/SupplierPortal/SupplierDashboard.jsx
// Tableau de bord fournisseur : uniquement ses appels d'offres, soumissions et résultats
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Gavel, Send, Trophy, CalendarClock, Building2, AlertCircle, CheckCircle, Clock, XCircle, Hourglass, ChevronRight
} from 'lucide-react';
import { supplierPortalService, supplierLogoUrl } from '../../services/supplierPortalService';
import { fmtDateTime, fmtMoney, timeLeft } from '../../utils/tenderStatus';

const RESULT = {
  WON:     { label: 'Retenue',        cls: 'bg-green-100 text-green-700', icon: Trophy },
  LOST:    { label: 'Non retenue',    cls: 'bg-gray-100 text-gray-600',   icon: XCircle },
  PENDING: { label: 'En évaluation',  cls: 'bg-yellow-100 text-yellow-800', icon: Hourglass },
};

function StatCard({ icon: Icon, label, value, hint, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
      <div className={`p-3 rounded-lg ${color}`}><Icon size={22} /></div>
      <div>
        <div className="text-sm text-gray-500">{label}</div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

export default function SupplierDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    supplierPortalService.getDashboard().then(r => setData(r.data)).catch(() => {});
  }, []);

  if (!data) {
    return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  const { supplier, stats, toDo, upcoming, results, missingProfile } = data;
  const logo = supplierLogoUrl(supplier);

  return (
    <div className="p-6 space-y-6" data-testid="supplier-dashboard">
      {/* Bienvenue */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
          {logo ? <img src={logo} alt="" className="max-w-full max-h-full object-contain" /> : <Building2 size={28} className="text-gray-300" />}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{supplier.name}</h1>
          <p className="text-gray-500 text-sm">
            Bienvenue{supplier.contact_name ? `, ${supplier.contact_name}` : ''} · Code fournisseur <span className="font-mono">{supplier.supplier_code}</span>
          </p>
        </div>
      </div>

      {missingProfile.length > 0 && (
        <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-200 text-sm text-yellow-800 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <AlertCircle size={16} /> Profil incomplet : {missingProfile.join(', ')}. Ces informations figurent sur vos offres PDF.
          </span>
          <Link to="/supplier/profile" className="font-medium underline whitespace-nowrap">Compléter</Link>
        </div>
      )}

      {/* Indicateurs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Gavel} label="Appels d'offres ouverts" value={stats.openTenders}
          hint={stats.toSubmit > 0 ? `${stats.toSubmit} sans offre de votre part` : 'Vous avez répondu à tous'} color="bg-blue-50 text-blue-600" />
        <StatCard icon={CalendarClock} label="À venir" value={stats.upcomingTenders} hint="Pas encore ouverts" color="bg-gray-100 text-gray-600" />
        <StatCard icon={Send} label="Offres soumises" value={stats.submissions} color="bg-indigo-50 text-indigo-600" />
        <StatCard icon={Trophy} label="Marchés remportés" value={stats.won}
          hint={stats.winRate !== null ? `Taux de succès : ${stats.winRate} %` : null} color="bg-green-50 text-green-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* À traiter */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-200 flex justify-between items-center">
            <h2 className="font-semibold text-gray-800">Appels d'offres ouverts</h2>
            <Link to="/supplier/tenders" className="text-sm text-blue-600 hover:underline">Tout voir</Link>
          </div>
          {toDo.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">Aucun appel d'offres ouvert pour le moment.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {toDo.map(t => (
                <li key={t.id}>
                  <button onClick={() => navigate(`/supplier/tenders/${t.id}`)}
                    className="w-full text-left px-5 py-3 hover:bg-gray-50 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-mono text-blue-700">{t.tender_number}</div>
                      <div className="font-medium text-gray-900 truncate">{t.title}</div>
                      {t.enterprise_name && <div className="text-xs text-gray-600">Acheteur : {t.enterprise_name}</div>}
                      <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Clock size={12} /> Clôture {fmtDateTime(t.end_date)} · reste {timeLeft(t.end_date) || '—'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {t.submitted
                        ? <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700 flex items-center gap-1"><CheckCircle size={12} /> {fmtMoney(t.my_total, t.currency_code)}</span>
                        : <span className="px-2 py-1 rounded-full text-xs bg-orange-100 text-orange-700">À soumettre</span>}
                      <ChevronRight size={16} className="text-gray-400" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {upcoming.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-100 text-sm text-gray-600">
              <div className="font-medium text-gray-700 mb-1">Prochainement</div>
              {upcoming.map(t => (
                <div key={t.id} className="flex justify-between">
                  <span>{t.tender_number} — {t.title}</span>
                  <span className="text-gray-500">ouvre le {fmtDateTime(t.start_date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Résultats */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-200">
            <h2 className="font-semibold text-gray-800">Résultats de mes offres</h2>
          </div>
          {results.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">Aucun résultat pour le moment.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {results.map(r => {
                const st = RESULT[r.result];
                const Icon = st.icon;
                return (
                  <li key={r.id}>
                    <button onClick={() => navigate(`/supplier/tenders/${r.id}`)}
                      className="w-full text-left px-5 py-3 hover:bg-gray-50 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-blue-700">{r.tender_number}</div>
                        <div className="font-medium text-gray-900 truncate">{r.title}</div>
                        {r.enterprise_name && <div className="text-xs text-gray-600">Acheteur : {r.enterprise_name}</div>}
                        <div className="text-xs text-gray-500">Mon offre : {fmtMoney(r.my_total, r.currency_code)}</div>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 shrink-0 ${st.cls}`}>
                        <Icon size={12} /> {st.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
