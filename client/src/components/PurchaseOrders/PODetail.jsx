// src/components/PurchaseOrders/PODetail.jsx
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Download,
  Printer,
  CheckCircle,
  XCircle,
  Send,
  Edit,
  Trash2,
  FileText,
  Package,
  Truck,
  DollarSign,
  Calendar,
  User,
  Building2,
  Mail,
  Phone,
  MapPin,
  Clock,
  AlertCircle,
  Eye,
  FileCheck,
  Info
} from 'lucide-react'
import { purchaseOrderService } from '../../services/purchaseOrderService'
import PODeliveryTracking, { DeliveryStatusBadge } from './PODeliveryTracking'
import SupplierConfirmationPanel from './SupplierConfirmationPanel'
import { supplierService } from '../../services/supplierService'
import requisitionService from '../../services/requisitionService'
import { grnService } from '../../services/grnService'
import { sanService } from '../../services/sanService'
import StatusBadge from '../Common/StatusBadge'
import LoadingSpinner from '../Common/LoadingSpinner'
import ErrorAlert from '../Common/ErrorAlert'
import Modal from '../Common/Modal'
import toast from 'react-hot-toast'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters'
import PurchaseOrderViewer from './PurchaseOrderViewer'
import { t } from '../../i18n'

export default function PODetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const taskId = searchParams.get('taskId') || null
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [showPdfViewer, setShowPdfViewer] = useState(false)
  const [poApprovalComment, setPoApprovalComment] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const canReject = rejectionReason.trim().length > 0

  // Récupérer les détails de la commande
  const { data: poData, isLoading, error, refetch: refetchPo } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => purchaseOrderService.getById(id),
    enabled: !!id
  })

  // Récupérer le fournisseur
  const { data: supplierData } = useQuery({
    queryKey: ['supplier', poData?.data?.supplier_id],
    queryFn: () => supplierService.getById(poData?.data?.supplier_id),
    enabled: !!poData?.data?.supplier_id
  })

  // Récupérer la réquisition associée
  const { data: requisitionData } = useQuery({
    queryKey: ['requisition', poData?.data?.requisition_id],
    queryFn: () => requisitionService.getById(poData?.data?.requisition_id),
    enabled: !!poData?.data?.requisition_id
  })

  // GRN et SAN liés à cette commande
  const { data: grnData } = useQuery({
    queryKey: ['grn-by-po', id],
    queryFn: () => grnService.getByPO(id),
    enabled: !!id
  })
  const { data: sanData } = useQuery({
    queryKey: ['san-by-po', id],
    queryFn: () => sanService.getByPO(id),
    enabled: !!id
  })

  const grns = grnData?.data || []
  const sans = sanData?.data || []

  const po = poData?.data
  const supplier = supplierData?.data
  const requisition = requisitionData?.data

  // Mutation pour approuver la commande
  const approveMutation = useMutation({
    mutationFn: (data) => purchaseOrderService.approve(po.id, { taskId, comments: data.comments }),
    onSuccess: () => {
      queryClient.invalidateQueries(['purchase-order', id])
      toast.success(t('po.approved'))
      setShowApproveModal(false)
      setPoApprovalComment('')
    },
    onError: (error) => {
      toast.error(error.message || t('po.approveError'))
    }
  })

  // Mutation pour rejeter la commande
  const rejectMutation = useMutation({
    mutationFn: (data) => purchaseOrderService.reject(po.id, { reason: data.reason, taskId }),
    onSuccess: () => {
      queryClient.invalidateQueries(['purchase-order', id])
      toast.success(t('po.rejected'))
      setShowRejectModal(false)
      setRejectionReason('')
    },
    onError: (error) => {
      toast.error(error.message || t('po.rejectError'))
    }
  })

  // Mutation pour envoyer la commande
  const sendMutation = useMutation({
    mutationFn: () => purchaseOrderService.send(po.id),
    onSuccess: () => {
      queryClient.invalidateQueries(['purchase-order', id])
      toast.success(t('po.sendOk'))
    },
    onError: (error) => {
      toast.error(error.message || t('po.sendError'))
    }
  })

  // Mutation pour supprimer la commande
  const deleteMutation = useMutation({
    mutationFn: () => purchaseOrderService.delete(id),
    onSuccess: () => {
      toast.success(t('po.deleted'))
      navigate('/purchase-orders')
    },
    onError: (error) => {
      toast.error(error.message || t('requisitions.deleteError'))
    }
  })

  const handleOpenPdfViewer = () => setShowPdfViewer(true)

  // Imprimer
  const handlePrint = () => {
    window.print()
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <LoadingSpinner size="lg" text={t('po.loading')} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorAlert
          title={t('requisitions.loadError')}
          message={t('po.loadErrorMsg')}
          details={error.message}
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }

  if (!po) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900">{t('po.notFound')}</h3>
        <p className="mt-1 text-gray-500">{t('po.notFoundMsg')}</p>
        <button
          onClick={() => navigate('/purchase-orders')}
          className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <ArrowLeft size={18} className="mr-2" />
          {t('reqDetail.backToList')}
        </button>
      </div>
    )
  }
  

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/purchase-orders')}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-800">
                {t('po.heading', { number: po.po_number })}
              </h1>
              <StatusBadge status={po.status} size="lg" />
            </div>
            <p className="text-gray-500 mt-1">
              {t('po.createdOn', { date: formatDateTime(po.created_at) })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleOpenPdfViewer}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download size={18} />
            PDF
          </button>
          
          {po.status === 'PO_DRAFT' && (
            <>
              <Link
                to={`/purchase-orders/${po.id}/edit`}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Edit size={18} />
                {t('common.edit')}
              </Link>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 size={18} />
                {t('common.delete')}
              </button>
            </>
          )}
         
          {(po.status === 'PO_PENDING' || po.status === 'DRAFT') && (
            <>
              <button
                onClick={() => setShowApproveModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <CheckCircle size={18} />
                {t('common.approve')}
              </button>
              <button
                onClick={() => setShowRejectModal(true)}
                className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              >
                <XCircle size={18} />
                {t('common.reject')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Colonne de gauche - Informations principales */}
        <div className="lg:col-span-2 space-y-6">
          {/* Articles commandés */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Package size={20} />
                {t('po.orderedItems')}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.description')}</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">{t('common.quantity')}</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('common.unitPrice')}</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('common.total')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {po.items?.map((item, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-800">
                        {item.item_code && <span className="mr-1 rounded bg-indigo-50 px-1 text-xs font-semibold text-indigo-700">{item.item_code}</span>}
                        {item.description || item.item_description}
                        {item.specifications && (
                          <p className="text-xs text-gray-500 mt-1">{item.specifications}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-800 text-center">
                        {item.quantity}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-800 text-right">
                        {formatCurrency(item.unit_price, po.currency)}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-gray-800 text-right">
                        {formatCurrency(item.quantity * item.unit_price, po.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan="3" className="px-6 py-4 text-right font-semibold text-gray-800">
                      {t('common.total')}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-lg text-blue-600">
                      {formatCurrency(po.total_amount, po.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Suivi des livraisons (réceptions GRN par ligne) */}
          <PODeliveryTracking poId={po.id} />

          {/* Historique des livraisons */}
          {po.deliveries && po.deliveries.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Truck size={20} />
                  {t('po.deliveryHistory')}
                </h2>
              </div>
              <div className="divide-y divide-gray-200">
                {po.deliveries.map((delivery, index) => (
                  <div key={index} className="p-6">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-gray-800">
                          {t('po.deliveryOf', { date: formatDate(delivery.date) })}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          {t('po.itemsDelivered', { count: delivery.quantity })}
                        </p>
                        {delivery.tracking_number && (
                          <p className="text-sm text-gray-500">
                            {t('po.tracking', { number: delivery.tracking_number })}
                          </p>
                        )}
                      </div>
                      <StatusBadge status={delivery.status} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Colonne de droite - Informations complémentaires */}
        <div className="space-y-6">
          {/* Informations fournisseur */}
          {supplier && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Building2 size={20} />
                  {t('common.supplier')}
                </h2>
              </div>
              <div className="p-6 space-y-3">
                <p className="font-medium text-gray-800">{supplier.name}</p>
                {supplier.email && (
                  <p className="flex items-center gap-2 text-sm text-gray-600">
                    <Mail size={14} />
                    {supplier.email}
                  </p>
                )}
                {supplier.phone && (
                  <p className="flex items-center gap-2 text-sm text-gray-600">
                    <Phone size={14} />
                    {supplier.phone}
                  </p>
                )}
                {supplier.address && (
                  <p className="flex items-center gap-2 text-sm text-gray-600">
                    <MapPin size={14} />
                    {supplier.address}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Confirmation du fournisseur (étape Activity_SupplierConfirmation) */}
          <SupplierConfirmationPanel po={po} autoOpen={searchParams.get('confirm') === '1'} onChanged={refetchPo} />

          {/* Informations de livraison */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Truck size={20} />
                {t('po.deliverySection')}
              </h2>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">{t('po.orderDateLabel')}</span>
                <span className="text-sm font-medium">{formatDate(po.order_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">{t('po.expectedDeliveryLabel')}</span>
                <span className="text-sm font-medium">
                  {po.delivery_date ? formatDate(po.delivery_date) : t('po.notDefined')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">{t('po.shippingAddressLabel')}</span>
                <span className="text-sm font-medium">{po.shipping_address || t('po.notSpecified')}</span>
              </div>
            </div>
          </div>

          {/* Réquisition associée */}
          {requisition && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <FileText size={20} />
                  {t('po.linkedRequisition')}
                </h2>
              </div>
              <div className="p-6">
                <Link
                  to={`/requisitions/${requisition.id}`}
                  className="block hover:bg-gray-50 -m-2 p-2 rounded-lg transition-colors"
                >
                  <p className="font-medium text-blue-600">{requisition.requisition_number}</p>
                  <p className="text-sm text-gray-500 mt-1">{requisition.title}</p>
                  <div className="mt-2">
                    <StatusBadge status={requisition.status} size="sm" />
                  </div>
                </Link>
              </div>
            </div>
          )}

          {/* Flux Procure-to-Pay */}
          {['PO_APPROVED', 'PO_SENT', 'PO_CONFIRMED', 'PO_RECEIVED', 'PO_COMPLETE'].includes(po.status) && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Truck size={16} />
                  {t('po.p2pFlow')}
                </h2>
              </div>
              <div className="p-4 space-y-3">
                {/* Note GoFlow */}
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-2.5">
                  <Info size={13} className="text-blue-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-700">
                    {t('po.p2pNoteBefore')} <strong>{t('po.taskList')}</strong>.
                  </p>
                </div>

                {/* GRN */}
                {grns.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1.5 flex items-center gap-1">
                      <Package size={12} /> {t('po.grns')}
                    </p>
                    <div className="space-y-1">
                      {grns.map(g => (
                        <Link
                          key={g.id}
                          to={`/goods-receipts/${g.id}`}
                          className="flex items-center justify-between px-2 py-1.5 rounded bg-gray-50 hover:bg-blue-50 text-xs"
                        >
                          <span className="font-mono text-gray-700">{g.grn_number}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            g.status === 'COMPLETE' ? 'bg-green-100 text-green-700' :
                            g.status === 'PARTIAL'  ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{t(`grnStatus.${g.status}`, { defaultValue: g.status })}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* SAN */}
                {sans.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1.5 flex items-center gap-1">
                      <FileCheck size={12} /> {t('po.sans')}
                    </p>
                    <div className="space-y-1">
                      {sans.map(s => (
                        <Link
                          key={s.id}
                          to={`/service-acceptance-notes/${s.id}`}
                          className="flex items-center justify-between px-2 py-1.5 rounded bg-gray-50 hover:bg-purple-50 text-xs"
                        >
                          <span className="font-mono text-gray-700">{s.san_number}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            s.status === 'ACCEPTED' ? 'bg-green-100 text-green-700' :
                            s.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{t(`sanStatus.${s.status}`, { defaultValue: s.status })}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Aucun document encore */}
                {grns.length === 0 && sans.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">
                    {t('po.noP2p')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Approbations */}
          {po.approvals && po.approvals.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <CheckCircle size={20} />
                  {t('po.approvals')}
                </h2>
              </div>
              <div className="divide-y divide-gray-200">
                {po.approvals.map((approval, index) => (
                  <div key={index} className="p-6">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-gray-800">{approval.approver_name}</p>
                        <p className="text-sm text-gray-500">{approval.role}</p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={approval.status} size="sm" />
                        <p className="text-xs text-gray-400 mt-1">
                          {formatDate(approval.date)}
                        </p>
                      </div>
                    </div>
                    {approval.comments && (
                      <p className="text-sm text-gray-600 mt-2">{approval.comments}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Visionneuse PDF */}
      {showPdfViewer && (
        <PurchaseOrderViewer
          poId={id}
          po={po}
          onClose={() => setShowPdfViewer(false)}
        />
      )}

      {/* Modal de confirmation de suppression */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title={t('po.deleteTitle')}
        type="danger"
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={() => deleteMutation.mutate()}
        isLoading={deleteMutation.isPending}
      >
        <p>{t('po.deleteConfirm')} <strong>{po.po_number}</strong> ?</p>
        <p className="text-sm text-gray-500 mt-2">{t('requisitions.irreversible')}</p>
      </Modal>

      {/* Modal d'approbation */}
      <Modal
        isOpen={showApproveModal}
        onClose={() => setShowApproveModal(false)}
        title={t('po.approveTitle')}
        type="success"
        confirmText={t('common.approve')}
        cancelText={t('common.cancel')}
        onConfirm={() => approveMutation.mutate({ comments: poApprovalComment })}
        isLoading={approveMutation.isPending}
      >
        <div className="space-y-4">
          <p>{t('po.approveConfirmNumber')} <strong>{po.po_number}</strong> ?</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.comment')} <span className="text-gray-400 font-normal">{t('po.optional')}</span></label>
            <textarea
              value={poApprovalComment}
              onChange={(e) => setPoApprovalComment(e.target.value)}
              rows="2"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              placeholder={t('po.notePlaceholder')}
            />
          </div>
        </div>
      </Modal>

      {/* Modal de rejet */}
      <Modal
        isOpen={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        title={t('po.rejectTitle')}
        type="danger"
        confirmText={t('common.reject')}
        cancelText={t('common.cancel')}
        onConfirm={() => rejectMutation.mutate({ reason: rejectionReason, taskId })}
        isLoading={rejectMutation.isPending}
        confirmDisabled={!canReject}
      >
        <div className="space-y-4">
          <p>{t('po.rejectConfirm')} <strong>{po.po_number}</strong> ?</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('po.rejectReason')} <span className="text-red-500">*</span>
            </label>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows="3"
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 ${
                rejectionReason.trim() ? 'border-gray-300' : 'border-red-300 bg-red-50'
              }`}
              placeholder={t('po.rejectPlaceholder')}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}