// src/components/PurchaseOrders/SupplierConfirmationPanel.jsx
// Confirmation de la commande par le fournisseur (étape GoFlow Activity_SupplierConfirmation) :
// état (en attente / déclinée / confirmée), date de livraison promise, référence, source (portail ou achats),
// et saisie par les achats d'une réponse reçue par téléphone / email (CREATE_PURCHASE_ORDERS).
// autoOpen : arrivée depuis « Mes tâches » (?confirm=1) → la fenêtre de saisie s'ouvre directement.
import React, { useEffect, useState } from 'react'
import { PackageCheck, Clock, XCircle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../Common/Modal'
import { purchaseOrderService } from '../../services/purchaseOrderService'
import { usePermissions } from '../../hooks/usePermissions'
import { t, getLocale } from '../../i18n'

const AWAITING = ['PO_APPROVED', 'PO_SENT']
const VISIBLE = [...AWAITING, 'PO_CONFIRMED', 'PO_RECEIVED', 'PO_COMPLETE']
const ERROR_CODES = ['ALREADY_CONFIRMED', 'NOT_RESPONDABLE', 'REASON_REQUIRED', 'INVALID_DATE', 'DATE_IN_PAST']
const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(getLocale()) : '—')
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const today = () => new Date().toISOString().slice(0, 10)

export default function SupplierConfirmationPanel({ po, autoOpen = false, onChanged }) {
  const { hasPermission } = usePermissions()
  const canRecord = hasPermission('CREATE_PURCHASE_ORDERS')
  const awaiting = AWAITING.includes(po.status) && po.supplier_response !== 'CONFIRMED'
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ response: 'CONFIRMED', deliveryDate: '', reference: '', comment: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (autoOpen && awaiting && canRecord) setOpen(true) }, [autoOpen, awaiting, canRecord])

  if (!VISIBLE.includes(po.status)) return null
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const declined = po.supplier_response === 'DECLINED'
  const confirmed = po.supplier_response === 'CONFIRMED'

  const submit = async () => {
    if (form.response === 'DECLINED' && !form.comment.trim()) { toast.error(t('po.supplierConfirmation.err.REASON_REQUIRED')); return }
    setBusy(true)
    try {
      const res = await purchaseOrderService.supplierResponse(po.id, {
        response: form.response, deliveryDate: form.deliveryDate || undefined,
        reference: form.reference || undefined, comment: form.comment || undefined,
      })
      toast.success(form.response === 'CONFIRMED'
        ? (res.data?.taskCompleted ? t('po.supplierConfirmation.recordedTask') : t('po.supplierConfirmation.recorded'))
        : t('po.supplierConfirmation.declinedRecorded'))
      setOpen(false)
      onChanged?.()
    } catch (err) {
      const d = err.response?.data || {}
      toast.error(ERROR_CODES.includes(d.code) ? t(`po.supplierConfirmation.err.${d.code}`) : (d.message || t('common.errorOccurred')))
    } finally { setBusy(false) }
  }

  const tone = confirmed ? 'border-teal-200 bg-teal-50 text-teal-900' : declined ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
  const Icon = confirmed ? CheckCircle2 : declined ? XCircle : Clock
  const source = po.supplier_response_source === 'PORTAL' ? t('po.supplierConfirmation.viaPortal') : t('po.supplierConfirmation.viaProcurement')

  return (
    <div className="bg-white rounded-lg shadow" data-testid="supplier-confirmation">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><PackageCheck size={16} /> {t('po.supplierConfirmation.title')}</h2>
      </div>
      <div className="p-4 space-y-3 text-sm">
        <div className={`flex gap-2 rounded-lg border p-3 ${tone}`}>
          <Icon size={18} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">
              {confirmed ? t('po.supplierConfirmation.confirmed') : declined ? t('po.supplierConfirmation.declined') : t('po.supplierConfirmation.awaiting')}
            </div>
            {po.supplier_responded_at && <div className="text-xs opacity-80">{fmtDateTime(po.supplier_responded_at)} · {source}</div>}
            {!po.supplier_responded_at && po.sent_at && <div className="text-xs opacity-80">{t('po.supplierConfirmation.sentOn', { date: fmtDateTime(po.sent_at) })}</div>}
          </div>
        </div>
        {confirmed && (
          <dl className="space-y-1">
            <div className="flex justify-between gap-2"><dt className="text-gray-500">{t('po.supplierConfirmation.promisedDelivery')}</dt><dd className="font-medium">{fmtDate(po.confirmed_delivery_date)}</dd></div>
            {po.supplier_reference && <div className="flex justify-between gap-2"><dt className="text-gray-500">{t('po.supplierConfirmation.reference')}</dt><dd className="font-medium">{po.supplier_reference}</dd></div>}
          </dl>
        )}
        {po.supplier_comment && <p className="text-gray-700">{declined ? t('po.supplierConfirmation.reasonLabel') : t('po.supplierConfirmation.commentLabel')} : « {po.supplier_comment} »</p>}
        {awaiting && canRecord && (
          <button onClick={() => setOpen(true)} className="w-full rounded-lg border border-blue-300 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50" data-testid="record-supplier-response">
            {t('po.supplierConfirmation.record')}
          </button>
        )}
        {awaiting && <p className="text-xs text-gray-500">{t('po.supplierConfirmation.hint')}</p>}
      </div>

      <Modal isOpen={open} onClose={() => !busy && setOpen(false)} title={t('po.supplierConfirmation.recordTitle', { number: po.po_number })}
        size="md" confirmText={t('common.save')} onConfirm={submit} isLoading={busy}>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {['CONFIRMED', 'DECLINED'].map(r => (
              <button key={r} type="button" role="radio" aria-checked={form.response === r} onClick={() => setForm(f => ({ ...f, response: r }))}
                className={`rounded-lg border-2 px-3 py-2 font-medium ${form.response === r ? (r === 'CONFIRMED' ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-red-600 bg-red-50 text-red-800') : 'border-gray-200 text-gray-600'}`}>
                {t(`po.supplierConfirmation.responses.${r}`)}
              </button>
            ))}
          </div>
          {form.response === 'CONFIRMED' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-gray-700">{t('po.supplierConfirmation.promisedDelivery')}</span>
                <input type="date" min={today()} value={form.deliveryDate} onChange={set('deliveryDate')} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-gray-700">{t('po.supplierConfirmation.reference')}</span>
                <input value={form.reference} onChange={set('reference')} maxLength={100} className={inputCls} />
              </label>
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-gray-700">{form.response === 'DECLINED' ? `${t('po.supplierConfirmation.reasonLabel')} *` : t('po.supplierConfirmation.commentLabel')}</span>
            <textarea rows={3} value={form.comment} onChange={set('comment')} maxLength={2000} className={inputCls}
              placeholder={form.response === 'DECLINED' ? t('po.supplierConfirmation.reasonPlaceholder') : t('po.supplierConfirmation.commentPlaceholder')} />
          </label>
          <p className="text-xs text-gray-500">{form.response === 'CONFIRMED' ? t('po.supplierConfirmation.confirmEffect') : t('po.supplierConfirmation.declineEffect')}</p>
        </div>
      </Modal>
    </div>
  )
}
