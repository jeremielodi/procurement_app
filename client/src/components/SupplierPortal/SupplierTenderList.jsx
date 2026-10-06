// src/components/SupplierPortal/SupplierTenderList.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gavel, RefreshCw, CheckCircle, Clock, Award } from 'lucide-react';
import { supplierPortalService } from '../../services/supplierPortalService';
import { TENDER_STATUS, fmtDateTime, fmtMoney, timeLeft } from '../../utils/tenderStatus';
import { enterpriseLogoUrl } from '../../contexts/EnterpriseContext';
import { t } from '../../i18n';

const SUPPLIER_LABEL = { ...TENDER_STATUS, AWARDED: { get label() { return t('portal.awarded'); }, cls: 'bg-gray-100 text-gray-700' } };

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

  const open = tenders.filter(tn => tn.effective_status === 'OPEN' || tn.effective_status === 'UPCOMING');
  const past = tenders.filter(tn => !open.includes(tn));

  const Card = ({ tn }) => {
    const st = tn.is_awarded_to_me
      ? { label: t('portal.offerWon'), cls: 'bg-green-100 text-green-700' }
      : SUPPLIER_LABEL[tn.effective_status] || SUPPLIER_LABEL.OPEN;
    const left = tn.effective_status === 'OPEN' ? timeLeft(tn.end_date) : null;
    return (
      <button onClick={() => navigate(`/supplier/tenders/${tn.id}`)} data-testid="supplier-tender-card"
        className="text-left bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-400 hover:shadow-sm transition">
        <div className="flex justify-between items-start gap-2">
          <span className="font-mono text-sm text-blue-700">{tn.tender_number}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
            {tn.is_awarded_to_me && <Award size={12} className="inline mr-1" />}{st.label}
          </span>
        </div>
        <h3 className="font-semibold text-gray-900 mt-2">{tn.title}</h3>
        {tn.enterprise_name && (
          <div className="flex items-center gap-2 mt-1 text-sm text-gray-700" data-testid="buyer">
            {tn.enterprise_logo_path && <img src={enterpriseLogoUrl({ id: tn.enterprise_id, logo_path: tn.enterprise_logo_path })} alt="" className="h-5 w-5 object-contain" />}
            <span>{t('portal.buyerLabel')} <b>{tn.enterprise_name}</b></span>
          </div>
        )}
        <div className="text-sm text-gray-600 mt-2 space-y-1">
          <div className="flex items-center gap-1"><Clock size={14} /> {t('portal.closingLabel', { date: fmtDateTime(tn.end_date) })}
            {left && <span className="text-green-600 ml-1">{t('portal.remaining', { time: left })}</span>}</div>
          {tn.effective_status === 'UPCOMING' && <div>{t('portal.openingLabel', { date: fmtDateTime(tn.start_date) })}</div>}
          <div>{t('portal.maxDelivery', { days: tn.max_delivery_days })}</div>
          {(tn.category_name || tn.location_name) && (
            <div className="text-gray-500">{[tn.category_name, tn.location_name && t('portal.deliveryAt', { location: tn.location_name })].filter(Boolean).join(' · ')}</div>
          )}
          {tn.audience === 'PREQUALIFIED' && <div className="text-green-700 text-xs">{t('portal.reservedPrequalified')}</div>}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 text-sm">
          {tn.my_submission_id
            ? <span className="text-green-700 flex items-center gap-1"><CheckCircle size={14} /> {t('portal.offerSubmitted', { amount: fmtMoney(tn.my_total, tn.currency_code) })}</span>
            : <span className="text-gray-500">{t('portal.noSubmissionYet')}</span>}
        </div>
      </button>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Gavel size={22} /> {t('tenders.title')}</h1>
          <p className="text-gray-500 text-sm">{t('portal.listHint')}</p>
        </div>
        <button onClick={load} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          <RefreshCw size={16} className={loading ? 'animate-spin text-blue-500' : 'text-gray-500'} />
        </button>
      </div>

      <section>
        <h2 className="font-semibold text-gray-800 mb-3">{t('portal.ongoing')}</h2>
        {open.length === 0
          ? <p className="text-gray-400 text-sm">{t('portal.noOpen')}</p>
          : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{open.map(tn => <Card key={tn.id} tn={tn} />)}</div>}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="font-semibold text-gray-800 mb-3">{t('portal.finished')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{past.map(tn => <Card key={tn.id} tn={tn} />)}</div>
        </section>
      )}
    </div>
  );
}
