// src/components/SupplierPortal/SupplierTenderList.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gavel, RefreshCw, CheckCircle, Clock, Award } from 'lucide-react';
import { supplierPortalService } from '../../services/supplierPortalService';
import { TENDER_STATUS, fmtDateTime, fmtMoney, timeLeft } from '../../utils/tenderStatus';
import { enterpriseLogoUrl } from '../../contexts/EnterpriseContext';

const SUPPLIER_LABEL = { ...TENDER_STATUS, AWARDED: { label: 'Attribué', cls: 'bg-gray-100 text-gray-700' } };

export default function SupplierTenderList() {
  const navigate = useNavigate();
  const [tenders, setTenders] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await supplierPortalService.getTenders();
      setTenders(res.data || []);
    } catch (_) { /* toast */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const open = tenders.filter(t => t.effective_status === 'OPEN' || t.effective_status === 'UPCOMING');
  const past = tenders.filter(t => !open.includes(t));

  const Card = ({ t }) => {
    const st = t.is_awarded_to_me
      ? { label: 'Offre retenue', cls: 'bg-green-100 text-green-700' }
      : SUPPLIER_LABEL[t.effective_status] || SUPPLIER_LABEL.OPEN;
    const left = t.effective_status === 'OPEN' ? timeLeft(t.end_date) : null;
    return (
      <button onClick={() => navigate(`/supplier/tenders/${t.id}`)} data-testid="supplier-tender-card"
        className="text-left bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-400 hover:shadow-sm transition">
        <div className="flex justify-between items-start gap-2">
          <span className="font-mono text-sm text-blue-700">{t.tender_number}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
            {t.is_awarded_to_me && <Award size={12} className="inline mr-1" />}{st.label}
          </span>
        </div>
        <h3 className="font-semibold text-gray-900 mt-2">{t.title}</h3>
        {t.enterprise_name && (
          <div className="flex items-center gap-2 mt-1 text-sm text-gray-700" data-testid="buyer">
            {t.enterprise_logo_path && <img src={enterpriseLogoUrl({ id: t.enterprise_id, logo_path: t.enterprise_logo_path })} alt="" className="h-5 w-5 object-contain" />}
            <span>Acheteur : <b>{t.enterprise_name}</b></span>
          </div>
        )}
        <div className="text-sm text-gray-600 mt-2 space-y-1">
          <div className="flex items-center gap-1"><Clock size={14} /> Clôture : {fmtDateTime(t.end_date)}
            {left && <span className="text-green-600 ml-1">(reste {left})</span>}</div>
          {t.effective_status === 'UPCOMING' && <div>Ouverture : {fmtDateTime(t.start_date)}</div>}
          <div>Livraison max : {t.max_delivery_days} jours</div>
          {(t.category_name || t.location_name) && (
            <div className="text-gray-500">{[t.category_name, t.location_name && `Livraison : ${t.location_name}`].filter(Boolean).join(' · ')}</div>
          )}
          {t.audience === 'PREQUALIFIED' && <div className="text-green-700 text-xs">Réservé aux fournisseurs préqualifiés</div>}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 text-sm">
          {t.my_submission_id
            ? <span className="text-green-700 flex items-center gap-1"><CheckCircle size={14} /> Offre soumise : {fmtMoney(t.my_total, t.currency_code)}</span>
            : <span className="text-gray-500">Pas encore de soumission</span>}
        </div>
      </button>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Gavel size={22} /> Appels d'offres</h1>
          <p className="text-gray-500 text-sm">Saisissez vos prix avant la date limite. Vous pouvez modifier votre offre tant que l'appel d'offres est ouvert.</p>
        </div>
        <button onClick={load} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? 'animate-spin text-blue-500' : 'text-gray-500'} />
        </button>
      </div>

      <section>
        <h2 className="font-semibold text-gray-800 mb-3">En cours</h2>
        {open.length === 0
          ? <p className="text-gray-400 text-sm">Aucun appel d'offres ouvert pour le moment.</p>
          : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{open.map(t => <Card key={t.id} t={t} />)}</div>}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="font-semibold text-gray-800 mb-3">Terminés</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{past.map(t => <Card key={t.id} t={t} />)}</div>
        </section>
      )}
    </div>
  );
}
