import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, ClipboardCheck, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { sanService } from '../../services/sanService';
import api from '../../services/api';
import { t } from '../../i18n';

export default function SANForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const poId   = searchParams.get('poId');
  const taskId = searchParams.get('taskId');

  const [po, setPO] = useState(null);
  const [comments, setComments] = useState('');
  const [serviceAccepted, setServiceAccepted] = useState(null); // null = not chosen yet
  const [loading, setLoading] = useState(false);
  const [loadingPO, setLoadingPO] = useState(false);

  useEffect(() => {
    if (poId) fetchPO(poId);
  }, [poId]);

  async function fetchPO(id) {
    setLoadingPO(true);
    try {
      const res = await api.get(`/purchase-orders/${id}`);
      setPO(res.data?.data);
    } catch {
      toast.error(t('grn.loadPoError'));
    } finally {
      setLoadingPO(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!poId) { toast.error(t('grn.noPo')); return; }
    if (serviceAccepted === null) { toast.error(t('san.chooseDecision')); return; }

    setLoading(true);
    try {
      const res = await sanService.create({
        poId,
        comments,
        serviceAccepted,
        taskId: taskId || undefined
      });
      if (res.success) {
        toast.success(t('san.created', { number: res.data.sanNumber, decision: t(res.data.serviceAccepted ? 'sanStatus.ACCEPTED' : 'sanStatus.REJECTED') }));
        navigate(`/service-acceptance-notes/${res.data.id}`);
      } else {
        toast.error(res.message || t('san.createError'));
      }
    } catch (e) {
      toast.error(e.response?.data?.message || t('po.createError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> {t('common.back')}
      </button>

      <div className="flex items-center gap-3 mb-6">
        <ClipboardCheck size={28} className="text-purple-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('san.newTitle')}</h1>
          {po && <p className="text-gray-500 text-sm">{t('grn.poRef', { number: po.po_number, supplier: po.supplier_name })}</p>}
        </div>
      </div>

      {!poId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 text-sm text-yellow-800">
          {t('san.fromPoHint')}
        </div>
      )}

      {loadingPO && <div className="text-center text-gray-500 py-4">{t('san.loadingPo')}</div>}

      {po && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6 text-sm">
          <div className="grid grid-cols-3 gap-4">
            <div><span className="font-medium text-purple-700">{t('san.order')}</span><br /><span>{po.po_number}</span></div>
            <div><span className="font-medium text-purple-700">{t('common.supplier')}</span><br /><span>{po.supplier_name}</span></div>
            <div><span className="font-medium text-purple-700">{t('san.subject')}</span><br /><span>{po.description || po.title || '—'}</span></div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Décision d'acceptation */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">
            {t('san.decision')}
          </label>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setServiceAccepted(true)}
              className={`flex items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all ${
                serviceAccepted === true
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 hover:border-green-300 text-gray-500'
              }`}
            >
              <CheckCircle size={24} />
              <div className="text-left">
                <div className="font-semibold">{t('san.accept')}</div>
                <div className="text-xs opacity-75">{t('san.acceptHint')}</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setServiceAccepted(false)}
              className={`flex items-center justify-center gap-3 p-4 rounded-xl border-2 transition-all ${
                serviceAccepted === false
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-200 hover:border-red-300 text-gray-500'
              }`}
            >
              <XCircle size={24} />
              <div className="text-left">
                <div className="font-semibold">{t('san.reject')}</div>
                <div className="text-xs opacity-75">{t('san.rejectHint')}</div>
              </div>
            </button>
          </div>
        </div>

        {/* Commentaires */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('san.commentsLabel')}
            {serviceAccepted === false && <span className="text-red-500 ml-1">{t('san.reasonRequired')}</span>}
          </label>
          <textarea
            rows={4}
            required={serviceAccepted === false}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder={serviceAccepted === false
              ? t('san.rejectPlaceholder')
              : t('san.acceptPlaceholder')}
            value={comments}
            onChange={e => setComments(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={loading || !poId || serviceAccepted === null}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium"
          >
            {loading ? t('po.saving') : <><Save size={16} /> {t('san.save')}</>}
          </button>
        </div>
      </form>
    </div>
  );
}
