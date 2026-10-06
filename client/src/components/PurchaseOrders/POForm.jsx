import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, ShoppingCart, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { purchaseOrderService } from '../../services/purchaseOrderService';
import requisitionService from '../../services/requisitionService';
import { supplierService } from '../../services/supplierService';
import { useCurrency } from '../../contexts/EnterpriseContext';
import { t, getLocale } from '../../i18n';

export default function POForm() {
  const { requisitionId, taskId } = useParams();
  const navigate = useNavigate();
  const { currency } = useCurrency();

  const [requisition, setRequisition] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingReq, setLoadingReq] = useState(false);

  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);

  useEffect(() => {
    // Bons de commande : fournisseurs préqualifiés uniquement (comportement inchangé)
    supplierService.getAll({ prequalifiedOnly: true })
      .then(r => setSuppliers(r.data || r || []))
      .catch(() => toast.error(t('po.loadSuppliersError')));
  }, []);

  useEffect(() => {
    if (!requisitionId) return;
    setLoadingReq(true);
    requisitionService.getById(requisitionId)
      .then(r => {
        const req = r.data || r;
        setRequisition(req);
        setShippingAddress(req.delivery_address || '');
        const reqItems = (req.items || []).map(it => ({
          description: it.item_description || it.description || '',
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.unit_price) || 0,
          specifications: it.specifications || ''
        }));
        setItems(reqItems.length ? reqItems : [emptyItem()]);
      })
      .catch(() => toast.error(t('po.loadRequisitionError')))
      .finally(() => setLoadingReq(false));
  }, [requisitionId]);

  function emptyItem() {
    return { description: '', quantity: 1, unitPrice: 0, specifications: '' };
  }

  function updateItem(i, field, value) {
    setItems(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  }

  function removeItem(i) {
    setItems(prev => prev.filter((_, idx) => idx !== i));
  }

  const totalAmount = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!supplierId) { toast.error(t('po.selectSupplier')); return; }
    if (items.length === 0) { toast.error(t('po.addItemRequired')); return; }

    setLoading(true);
    try {
      const res = await purchaseOrderService.create({
        requisitionId,
        taskId: taskId || undefined,
        supplierId: Number(supplierId),
        orderDate,
        deliveryDate: deliveryDate || null,
        shippingAddress,
        notes,
        currency: currency.code,
        totalAmount,
        items
      });

      if (res.success) {
        toast.success(t('po.created', { number: res.data.poNumber }));
        navigate(`/purchase-orders/${res.data.id}`);
      } else {
        toast.error(res.message || t('po.createError'));
      }
    } catch (err) {
      toast.error(err.response?.data?.message || t('po.createError'));
    } finally {
      setLoading(false);
    }
  }

  if (loadingReq) {
    return (
      <div className="p-6 flex items-center justify-center min-h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
        <ArrowLeft size={16} /> {t('common.back')}
      </button>

      <div className="flex items-center gap-3 mb-6">
        <ShoppingCart size={28} className="text-green-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('po.newTitle')}</h1>
          {requisition && (
            <p className="text-gray-500 text-sm">
              {t('po.requisitionRef', { number: requisition.requisition_number, title: requisition.title })}
            </p>
          )}
        </div>
      </div>

      {/* Réquisition info */}
      {requisition && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <span className="font-medium text-blue-700">{t('common.requisition')}</span>
              <p>{requisition.requisition_number}</p>
            </div>
            <div>
              <span className="font-medium text-blue-700">{t('po.requester')}</span>
              <p>{requisition.requester_username || requisition.requester_name || '—'}</p>
            </div>
            <div>
              <span className="font-medium text-blue-700">{t('po.department')}</span>
              <p>{requisition.department_name || requisition.department_code || '—'}</p>
            </div>
            <div>
              <span className="font-medium text-blue-700">{t('po.estimatedAmount')}</span>
              <p>{Number(requisition.estimated_amount || 0).toLocaleString(getLocale())} {currency.code}</p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* En-tête PO */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">{t('po.generalInfo')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('common.supplier')} <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={supplierId}
                onChange={e => setSupplierId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('po.selectSupplierPlaceholder')}</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('po.orderDate')}</label>
              <input
                type="date"
                value={orderDate}
                onChange={e => setOrderDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('po.expectedDelivery')}</label>
              <input
                type="date"
                value={deliveryDate}
                onChange={e => setDeliveryDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('po.shippingAddress')}</label>
              <input
                type="text"
                value={shippingAddress}
                onChange={e => setShippingAddress(e.target.value)}
                placeholder={t('po.shippingPlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.notes')}</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('po.notesPlaceholder')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Articles */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">{t('po.items')}</h2>
            <button
              type="button"
              onClick={() => setItems(prev => [...prev, emptyItem()])}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
            >
              <Plus size={14} /> {t('common.add')}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {[t('common.description'), t('po.qty'), t('common.unitPrice'), t('common.total'), ''].map((h, i) => (
                    <th key={i} className="text-left px-3 py-2 font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <input
                        required
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                        placeholder={t('po.itemDescription')}
                        value={item.description}
                        onChange={e => updateItem(i, 'description', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" min="1" required
                        className="w-20 border border-gray-200 rounded px-2 py-1 text-sm text-center"
                        value={item.quantity}
                        onChange={e => updateItem(i, 'quantity', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" min="0" step="0.01" required
                        className="w-28 border border-gray-200 rounded px-2 py-1 text-sm text-right"
                        value={item.unitPrice}
                        onChange={e => updateItem(i, 'unitPrice', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-right text-gray-700 whitespace-nowrap">
                      {((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)).toLocaleString(getLocale())} {currency.code}
                    </td>
                    <td className="px-3 py-2">
                      {items.length > 1 && (
                        <button type="button" onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-semibold text-gray-700">{t('common.total')}</td>
                  <td className="px-3 py-2 font-bold text-gray-900 text-right whitespace-nowrap">
                    {totalAmount.toLocaleString(getLocale())} {currency.code}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            <Save size={16} />
            {loading ? t('po.saving') : t('po.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
