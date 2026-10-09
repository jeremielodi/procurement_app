// src/components/SupplierPortal/SupplierOrderDetail.jsx
// Portail fournisseur — un bon de commande : lignes, acheteur, livraison, PDF ; confirmer (date de livraison prévue,
// référence) ou décliner (motif). Une confirmation est définitive ; après un refus, la commande peut encore être confirmée.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Eye, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import BlobPdfViewer from '../Common/BlobPdfViewer';
import { supplierPortalService } from '../../services/supplierPortalService';
import { OrderResponseBadge } from './SupplierOrderList';
import { t, getLocale } from '../../i18n';

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale()) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtNum = (n, digits = 2) => new Intl.NumberFormat(getLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n) || 0);
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const ERROR_CODES = ['ALREADY_CONFIRMED', 'NOT_RESPONDABLE', 'REASON_REQUIRED', 'INVALID_DATE', 'DATE_IN_PAST'];

export default function SupplierOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPdf, setShowPdf] = useState(false);
  const [mode, setMode] = useState(null); // 'confirm' | 'decline'
  const [form, setForm] = useState({ deliveryDate: '', reference: '', comment: '' });
  const [busy, setBusy] = useState(false);

  const load = () => supplierPortalService.getOrder(id).then(r => setOrder(r.data)).catch(() => setOrder(null)).finally(() => setLoading(false));
  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-blue-500" /></div>;
  if (!order) return <div className="p-6 text-gray-500">{t('portal.orders.notFound')}</div>;

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'decline' && !form.comment.trim()) { toast.error(t('po.supplierConfirmation.err.REASON_REQUIRED')); return; }
    setBusy(true);
    try {
      if (mode === 'confirm') {
        await supplierPortalService.confirmOrder(order.id, { deliveryDate: form.deliveryDate || undefined, reference: form.reference || undefined, comment: form.comment || undefined });
        toast.success(t('portal.orders.confirmedToast'));
      } else {
        await supplierPortalService.declineOrder(order.id, form.comment);
        toast.success(t('portal.orders.declinedToast'));
      }
      setMode(null);
      await load();
    } catch (err) {
      const d = err.response?.data || {};
      toast.error(ERROR_CODES.includes(d.code) ? t(`po.supplierConfirmation.err.${d.code}`) : (d.message || t('common.errorOccurred')));
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate('/supplier/orders')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> {t('portal.orders.title')}</button>
        <button onClick={() => setShowPdf(true)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"><Eye size={16} /> {t('portal.orders.pdf')}</button>
      </div>
      {showPdf && <BlobPdfViewer title={order.po_number} fileName={`${order.po_number}.pdf`} fetchPdf={() => supplierPortalService.getOrderPdf(order.id)} onClose={() => setShowPdf(false)} />}

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900"><ClipboardList className="text-blue-600" /> {order.po_number}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('portal.orders.fromBuyer', { buyer: order.buyer_name || '—', date: fmtDate(order.order_date) })}</p>
        </div>
        <OrderResponseBadge order={order} />
      </div>

      {/* Réponse attendue */}
      {order.awaiting_response && !mode && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">{order.supplier_response === 'DECLINED' ? t('portal.orders.declinedCanConfirm') : t('portal.orders.pleaseConfirm')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => { setMode('confirm'); setForm({ deliveryDate: order.delivery_date ? String(order.delivery_date).slice(0, 10) : '', reference: '', comment: '' }); }}
              className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-white hover:bg-teal-700" data-testid="order-confirm">
              <CheckCircle2 size={16} /> {t('portal.orders.confirm')}
            </button>
            {order.supplier_response !== 'DECLINED' && (
              <button onClick={() => { setMode('decline'); setForm({ deliveryDate: '', reference: '', comment: '' }); }}
                className="flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-red-700 hover:bg-red-50" data-testid="order-decline">
                <XCircle size={16} /> {t('portal.orders.decline')}
              </button>
            )}
          </div>
        </div>
      )}

      {mode && (
        <form onSubmit={submit} className={`space-y-4 rounded-xl border p-4 text-sm ${mode === 'confirm' ? 'border-teal-200 bg-teal-50/50' : 'border-red-200 bg-red-50/50'}`}>
          <h2 className="font-semibold text-gray-900">{mode === 'confirm' ? t('portal.orders.confirmTitle') : t('portal.orders.declineTitle')}</h2>
          {mode === 'confirm' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-gray-700">{t('po.supplierConfirmation.promisedDelivery')}</span>
                <input type="date" min={today()} value={form.deliveryDate} onChange={set('deliveryDate')} className={inputCls} data-testid="order-delivery-date" />
              </label>
              <label className="block">
                <span className="mb-1 block text-gray-700">{t('portal.orders.yourReference')}</span>
                <input value={form.reference} onChange={set('reference')} maxLength={100} className={inputCls} />
              </label>
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-gray-700">{mode === 'decline' ? `${t('po.supplierConfirmation.reasonLabel')} *` : t('po.supplierConfirmation.commentLabel')}</span>
            <textarea rows={3} value={form.comment} onChange={set('comment')} maxLength={2000} className={inputCls} data-testid="order-comment"
              placeholder={mode === 'decline' ? t('portal.orders.declinePlaceholder') : t('po.supplierConfirmation.commentPlaceholder')} />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode(null)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 hover:bg-gray-50">{t('common.cancel')}</button>
            <button type="submit" disabled={busy} className={`rounded-lg px-4 py-2 text-white disabled:opacity-50 ${mode === 'confirm' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-red-600 hover:bg-red-700'}`} data-testid="order-submit">
              {busy ? t('po.saving') : mode === 'confirm' ? t('portal.orders.confirm') : t('portal.orders.sendDecline')}
            </button>
          </div>
        </form>
      )}

      {order.supplier_response && (
        <div className={`rounded-lg border p-3 text-sm ${order.supplier_response === 'CONFIRMED' ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
          {order.supplier_response === 'CONFIRMED'
            ? t('portal.orders.confirmedOn', { date: fmtDateTime(order.supplier_responded_at), delivery: fmtDate(order.confirmed_delivery_date) })
            : t('portal.orders.declinedOn', { date: fmtDateTime(order.supplier_responded_at) })}
          {order.supplier_comment && <> — « {order.supplier_comment} »</>}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {[
          [t('portal.orders.buyer'), <><b>{order.buyer_name}</b><div className="text-xs text-gray-500">{[order.buyer_phone, order.buyer_email].filter(Boolean).join(' · ')}</div></>],
          [t('portal.orders.requestedDelivery'), <b>{fmtDate(order.delivery_date)}</b>],
          [t('portal.orders.shippingAddress'), <span className="whitespace-pre-line">{order.shipping_address || order.buyer_address || '—'}</span>],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-3 text-sm"><div className="mb-1 text-xs text-gray-500">{label}</div>{value}</div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t('portal.orders.item')}</th>
              <th className="px-4 py-2 text-right">{t('portal.orders.quantity')}</th>
              <th className="px-4 py-2 text-right">{t('portal.orders.unitPrice')}</th>
              <th className="px-4 py-2 text-right">{t('portal.orders.total')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {order.items.map(i => (
              <tr key={i.id}>
                <td className="px-4 py-2">{i.item_description}</td>
                <td className="px-4 py-2 text-right">{fmtQty(i.quantity)}</td>
                <td className="px-4 py-2 text-right">{fmtNum(i.unit_price)}</td>
                <td className="px-4 py-2 text-right font-medium">{fmtNum(i.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-gray-50">
              <td colSpan={3} className="px-4 py-2 text-right font-semibold">{t('portal.orders.amount')}</td>
              <td className="px-4 py-2 text-right font-bold">{fmtNum(order.total_amount)} {order.currency}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
