import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, PackageCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { grnService } from '../../services/grnService';
import api from '../../services/api';
import { t, getLocale } from '../../i18n';

export default function GRNForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const poId   = searchParams.get('poId');
  const taskId = searchParams.get('taskId');

  const [po, setPO] = useState(null);
  const [poItems, setPOItems] = useState([]);
  const [grnItems, setGrnItems] = useState([]);
  const [observations, setObservations] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPO, setLoadingPO] = useState(false);

  useEffect(() => {
    if (poId) fetchPO(poId);
  }, [poId]);

  async function fetchPO(id) {
    setLoadingPO(true);
    try {
      const res = await api.get(`/purchase-orders/${id}`);
      const data = res.data?.data;
      setPO(data);
      const items = data?.items || [];
      setGrnItems(items.map(it => ({
        item_description: it.description || it.item_description || '',
        quantity_ordered: it.quantity || 1,
        quantity_received: it.quantity || 0,
        quantity_accepted: it.quantity || 0,
        quantity_rejected: 0,
        rejection_reason: ''
      })));
      setPOItems(items);
    } catch {
      toast.error(t('grn.loadPoError'));
    } finally {
      setLoadingPO(false);
    }
  }

  function updateItem(index, field, value) {
    setGrnItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      // Auto-compute quantity_accepted = received - rejected
      if (field === 'quantity_received' || field === 'quantity_rejected') {
        const received = field === 'quantity_received' ? parseInt(value) || 0 : parseInt(next[index].quantity_received) || 0;
        const rejected = field === 'quantity_rejected' ? parseInt(value) || 0 : parseInt(next[index].quantity_rejected) || 0;
        next[index].quantity_accepted = Math.max(0, received - rejected);
      }
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!poId) { toast.error(t('grn.noPo')); return; }

    setLoading(true);
    try {
      const res = await grnService.create({ poId, grnItems, observations, taskId: taskId || undefined });
      if (res.success) {
        toast.success(t('grn.created', { number: res.data.grnNumber, status: t(`grnStatus.${res.data.status}`, { defaultValue: res.data.status }) }));
        navigate(`/goods-receipts/${res.data.id}`);
      } else {
        toast.error(res.message || t('grn.createError'));
      }
    } catch (e) {
      toast.error(e.response?.data?.message || t('po.createError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> {t('common.back')}
      </button>

      <div className="flex items-center gap-3 mb-6">
        <PackageCheck size={28} className="text-blue-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('grn.newTitle')}</h1>
          {po && <p className="text-gray-500 text-sm">{t('grn.poRef', { number: po.po_number, supplier: po.supplier_name })}</p>}
        </div>
      </div>

      {!poId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 text-sm text-yellow-800">
          {t('grn.fromPoHint')}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* PO Info */}
        {po && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
            <div className="grid grid-cols-3 gap-4">
              <div><span className="font-medium text-blue-700">{t('grn.order')}</span><br /><span>{po.po_number}</span></div>
              <div><span className="font-medium text-blue-700">{t('common.supplier')}</span><br /><span>{po.supplier_name}</span></div>
              <div><span className="font-medium text-blue-700">{t('grn.poAmount')}</span><br /><span>{po.total_amount?.toLocaleString(getLocale())} {po.currency}</span></div>
            </div>
          </div>
        )}

        {/* Articles */}
        {loadingPO ? (
          <div className="text-center text-gray-500 py-8">{t('grn.loadingItems')}</div>
        ) : grnItems.length > 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="font-medium text-gray-700">{t('grn.itemsToReceive')}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {t('grn.formCols', { returnObjects: true }).map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {grnItems.map((item, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <input
                          className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                          value={item.item_description}
                          onChange={e => updateItem(i, 'item_description', e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2 text-center font-medium text-gray-600">{item.quantity_ordered}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min="0" max={item.quantity_ordered}
                          className="w-20 border border-gray-200 rounded px-2 py-1 text-sm text-center"
                          value={item.quantity_received}
                          onChange={e => updateItem(i, 'quantity_received', e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min="0"
                          className="w-20 border border-blue-200 rounded px-2 py-1 text-sm text-center bg-blue-50"
                          value={item.quantity_accepted}
                          readOnly
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min="0"
                          className="w-20 border border-gray-200 rounded px-2 py-1 text-sm text-center"
                          value={item.quantity_rejected}
                          onChange={e => updateItem(i, 'quantity_rejected', e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                          placeholder={item.quantity_rejected > 0 ? t('grn.reasonRequired') : ''}
                          value={item.rejection_reason}
                          onChange={e => updateItem(i, 'rejection_reason', e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : poId && !loadingPO ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-500 text-center">
            {t('grn.noItems')}
          </div>
        ) : null}

        {/* Observations */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('grn.observations')}</label>
          <textarea
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('grn.observationsPlaceholder')}
            value={observations}
            onChange={e => setObservations(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={loading || !poId}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? t('po.saving') : <><Save size={16} /> {t('grn.save')}</>}
          </button>
        </div>
      </form>
    </div>
  );
}
