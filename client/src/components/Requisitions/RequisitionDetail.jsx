// src/components/Requisitions/RequisitionDetail.jsx
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  FileText,
  Package,
  DollarSign,
  Calendar,
  User,
  Building2,
  Hash,
  Tag,
  ListChecks,
  History,
  Download,
  Printer,
  Send,
  RefreshCw,
  Eye,
  FileCheck,
  MessageSquare,
  Paperclip,
  ExternalLink,
  ListTodo,
  Gavel
} from 'lucide-react'
import requisitionService from '../../services/requisitionService'
import { purchaseOrderService } from '../../services/purchaseOrderService'
import { workflowService } from '../../services/workflowService'
import { taskService } from '../../services/taskService'
import { uploadService } from '../../services/uploadService'
import StatusBadge from '../Common/StatusBadge'
import LoadingSpinner from '../Common/LoadingSpinner'
import ErrorAlert from '../Common/ErrorAlert'
import Modal from '../Common/Modal'
import PdfViewer from '../Common/PdfViewer'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters'
import toast from 'react-hot-toast'
import RequisitionViewer from './RequisitionViewer';
import RequisitionTimeline from './RequisitionTimeline'
import WorkflowTrackerModal from './WorkflowTrackerModal'
import { tenderService } from '../../services/tenderService'
import { usePermissions } from '../../hooks/usePermissions'
import { t } from '../../i18n'

export default function RequisitionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showWorkflowModal, setShowWorkflowModal] = useState(false)
  const [cancellationReason, setCancellationReason] = useState('')
  const [activeTab, setActiveTab] = useState('details')
  const [pendingTasksCount, setPendingTasksCount] = useState(0)
  const [viewerAttachmentId, setViewerAttachmentId] = useState(null)
  const [viewerFileName, setViewerFileName] = useState(null)
  const [showViewer, setShowViewer] = useState(false);

  // Récupérer les détails de la réquisition
  const { data: requisitionData, isLoading, error, refetch } = useQuery({
    queryKey: ['requisition', id],
    queryFn: () => requisitionService.getById(id),
    enabled: !!id
  })

  // Appel d'offres lié (procurement uniquement)
  const { hasPermission } = usePermissions()
  const canManageTenders = hasPermission('MANAGE_TENDERS')
  const { data: tenderData } = useQuery({
    queryKey: ['requisition-tender', id],
    queryFn: () => tenderService.getByRequisition(id),
    enabled: !!id && canManageTenders
  })
  const linkedTender = tenderData?.data

  // Récupérer les commandes associées
  const { data: purchaseOrdersData } = useQuery({
    queryKey: ['purchase-orders', { requisition_id: id }],
    queryFn: () => purchaseOrderService.getAll({ requisitionId: id }),
    enabled: !!id
  })

  // Récupérer l'historique du workflow
  const { data: workflowHistoryData } = useQuery({
    queryKey: ['workflow-history', requisitionData?.data?.process_instance_id],
    queryFn: () => workflowService.getProcessHistory(requisitionData?.data?.process_instance_id),
    enabled: !!requisitionData?.data?.process_instance_id
  })

  // Récupérer les tâches en attente
  const { data: tasksData } = useQuery({
    queryKey: ['process-tasks', requisitionData?.data?.process_instance_id],
    queryFn: () => taskService.getTasksByProcess(requisitionData?.data?.process_instance_id),
    enabled: !!requisitionData?.data?.process_instance_id,
    onSuccess: (data) => {
      const pendingCount = data?.data?.filter(tk => tk.status === 'PENDING').length || 0
      setPendingTasksCount(pendingCount)
    }
  })

  const requisition = requisitionData?.data
  const purchaseOrders = purchaseOrdersData?.data || []
  
  // CORRECTION: Extraire correctement les données d'historique
  const workflowHistory = workflowHistoryData?.data || workflowHistoryData || []
  
  // Extraire les activités, tâches et processus de l'historique
  const historyTasks = workflowHistory.tasks || []

  // Mutation pour annuler la réquisition
  const cancelMutation = useMutation({
    mutationFn: (data) => requisitionService.cancel(requisition?.id, data.reason),
    onSuccess: () => {
      queryClient.invalidateQueries(['requisition', id])
      toast.success(t('reqDetail.cancelled'))
      setShowCancelModal(false)
      setCancellationReason('')
    },
    onError: (error) => {
      toast.error(error.message || t('reqDetail.cancelError'))
    }
  })

  // Mutation pour supprimer la réquisition
  const deleteMutation = useMutation({
    mutationFn: () => requisitionService.delete(id),
    onSuccess: () => {
      toast.success(t('requisitions.deleted'))
      navigate('/requisitions')
    },
    onError: (error) => {
      toast.error(error.message || t('requisitions.deleteError'))
    }
  })

  // Mutation pour soumettre la réquisition
  const submitMutation = useMutation({
    mutationFn: () => requisitionService.submit(requisition?.id),
    onSuccess: () => {
      queryClient.invalidateQueries(['requisition', id])
      toast.success(t('requisitions.submitted'))
    },
    onError: (error) => {
      toast.error(error.message || t('requisitions.submitError'))
    }
  })

  // Télécharger un fichier
  const handleDownloadFile = async (attachmentId, fileName) => {
    try {
      const blob = await uploadService.downloadFile(attachmentId)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', fileName)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success(t('pdf.downloadStarted'))
    } catch (error) {
      toast.error(t('pdf.downloadError'))
    }
  }

  // Voir le PDF
  const handleViewPdf = (attachmentId, fileName) => {
    setViewerAttachmentId(attachmentId)
    setViewerFileName(fileName)
  }

  
  // Version avec gestion d'erreur 404
const handleGeneratePDF = async () => {
  if (!requisition?.id) {
    toast.error(t('reqDetail.notAvailable'));
    return;
  }

  try {
    toast.loading(t('reqDetail.generatingPdf'), { id: 'pdf-generation' });
    
    const response = await requisitionService.generatePDF(requisition.id);
    
    // Vérifier que la réponse est bien un blob
    if (!response || !(response instanceof Blob)) {
      console.error('Invalid response:', response);
      throw new Error(t('reqDetail.invalidResponse'));
    }
    
    // Vérifier que le blob n'est pas vide
    if (response.size === 0) {
      throw new Error(t('pdf.empty'));
    }
    
    // Vérifier que le type est correct
    if (!response.type.includes('pdf') && !response.type.includes('octet-stream')) {
      console.warn('Unexpected content type:', response.type);
      // Continuer quand même, ça peut être un PDF
    }
    
    // Créer l'URL du blob
    const url = window.URL.createObjectURL(response);
    
    // Créer le lien de téléchargement
    const link = document.createElement('a');
    link.href = url;
    link.download = `Requisition_${requisition.requisition_number || 'document'}.pdf`;
    document.body.appendChild(link);
    link.click();
    
    // Nettoyer
    setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    }, 100);
    
    toast.success(t('reqDetail.pdfGenerated'), { id: 'pdf-generation' });
  } catch (error) {
    console.error('Error generating PDF:', error);
    
    // Afficher le message d'erreur
    let errorMessage = t('services.pdfError');
    if (error.response?.status === 404) {
      errorMessage = t('reqDetail.notFound');
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    toast.error(errorMessage, { id: 'pdf-generation' });
  }
};

  // Voir le workflow
  const handleViewWorkflow = () => {
    setShowWorkflowModal(true)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <LoadingSpinner size="lg" text={t('reqDetail.loading')} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorAlert
          title={t('requisitions.loadError')}
          message={t('reqDetail.loadErrorMsg')}
          details={error.message}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  if (!requisition) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900">{t('reqDetail.notFound')}</h3>
        <p className="mt-1 text-gray-500">{t('reqDetail.notFoundMsg')}</p>
        <button
          onClick={() => navigate('/requisitions')}
          className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <ArrowLeft size={18} className="mr-2" />
          {t('reqDetail.backToList')}
        </button>
      </div>
    )
  }

  const canEdit = requisition.status === 'DRAFT'
  const canSubmit = requisition.status === 'DRAFT'
  const canCancel = ['DRAFT', 'PENDING', 'BUDGET_CHECKED'].includes(requisition.status)
  const canDelete = requisition.status === 'DRAFT'
  const hasActiveProcess = requisition.process_instance_id && pendingTasksCount > 0

  // Générer les éléments d'historique pour l'affichage

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/requisitions')}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-800">
                {requisition.requisition_number}
              </h1>
              <StatusBadge status={requisitionService.getStatusOptionLabel(requisition.status)} size="lg" />
              {requisition.priority && (
                <StatusBadge status={`PRIORITY_${requisition.priority}`} size="lg" />
              )}
            </div>
            <p className="text-gray-500 mt-1">
              {t('reqDetail.createdBy', { date: formatDateTime(requisition.created_at), name: `${requisition.first_name || ''} ${requisition.last_name || ''}`.trim() })}
            </p>
          </div>
        </div>
        
        <div className="flex gap-2">
          {requisition.process_instance_id && (
            <Link
              to={`/requisitions/${requisition.id}/tasks`}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                hasActiveProcess
                  ? 'bg-orange-600 text-white hover:bg-orange-700'
                  : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <ListTodo size={18} />
              {t('reqDetail.tasks')}
              {pendingTasksCount > 0 && (
                <span className="ml-1 bg-white text-orange-600 text-xs font-bold px-2 py-0.5 rounded-full">
                  {pendingTasksCount}
                </span>
              )}
            </Link>
          )}

          {linkedTender && (
            <Link
              to={`/tenders/${linkedTender.id}`}
              className="flex items-center gap-2 px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors"
            >
              <Gavel size={18} />
              {t('reqDetail.tender', { number: linkedTender.tender_number })}
            </Link>
          )}

          <button
           onClick={() => setShowViewer(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download size={18} />
            PDF
          </button>
          
          <button
            onClick={handleViewWorkflow}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={18} />
            {t('reqDetail.viewWorkflow')}
          </button>
          
          {canSubmit && (
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <Send size={18} />
              {submitMutation.isPending ? t('reqDetail.submitting') : t('common.submit')}
            </button>
          )}
          
          {canEdit && (
            <Link
              to={`/requisitions/${requisition.id}/edit`}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Edit size={18} />
              {t('common.edit')}
            </Link>
          )}
          
          {canDelete && (
            <button
              onClick={() => setShowDeleteModal(true)}
              className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={18} />
              {t('common.delete')}
            </button>
          )}
          
          {canCancel && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="flex items-center gap-2 px-4 py-2 border border-orange-300 text-orange-600 rounded-lg hover:bg-orange-50 transition-colors"
            >
              <XCircle size={18} />
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>

      {/* Alertes - Message sur les tâches en attente */}
      {hasActiveProcess && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-orange-600" />
            <div>
              <p className="text-sm font-medium text-orange-800">
                {t('reqDetail.pendingTasks', { count: pendingTasksCount })}
              </p>
              <p className="text-xs text-orange-600 mt-1">
                {t('reqDetail.pendingTasksHint')}
              </p>
            </div>
            <Link
              to={`/requisitions/${requisition.id}/tasks`}
              className="ml-auto px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm"
            >
              {t('reqDetail.viewTasks')}
            </Link>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('details')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'details'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('reqDetail.details')}
          </button>
          <button
            onClick={() => setActiveTab('items')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'items'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('reqDetail.items')}
          </button>
          <button
            onClick={() => setActiveTab('purchase-orders')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'purchase-orders'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('reqDetail.orders', { count: purchaseOrders.length })}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('reqDetail.workflow')}
          </button>
        </nav>
      </div>

      {/* Contenu des tabs */}
      <div className="space-y-6">
        {activeTab === 'details' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Colonne de gauche - Informations principales */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-lg shadow">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <FileText size={20} />
                    {t('common.description')}
                  </h2>
                </div>
                <div className="p-6">
                  <p className="text-gray-700 whitespace-pre-wrap">
                    {requisition.description || t('reqDetail.noDescription')}
                  </p>
                  {requisition.justification && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-1">{t('reqDetail.justification')}</p>
                      <p className="text-sm text-gray-600">{requisition.justification}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Pièces jointes avec visualiseur PDF */}
              {requisition.attachments && requisition.attachments.length > 0 && (
                <div className="bg-white rounded-lg shadow">
                  <div className="p-6 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                      <Paperclip size={20} />
                      {t('reqDetail.attachments', { count: requisition.attachments.length })}
                    </h2>
                  </div>
                  <div className="divide-y divide-gray-200">
                    {requisition.attachments.map((attachment, index) => (
                      <div key={index} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-3">
                          {attachment.mime_type === 'application/pdf' ? (
                            <FileText size={20} className="text-red-500" />
                          ) : attachment.mime_type?.startsWith('image/') ? (
                            <FileText size={20} className="text-blue-500" />
                          ) : (
                            <FileText size={20} className="text-gray-400" />
                          )}
                          <div>
                            <p className="text-sm font-medium text-gray-700">{attachment.file_name}</p>
                            <p className="text-xs text-gray-400">
                              {t('reqDetail.attachmentMeta', { size: (attachment.file_size / 1024).toFixed(2), date: formatDate(attachment.uploaded_at) })}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {/* Bouton visualiser pour PDF */}
                          {attachment.mime_type === 'application/pdf' && (
                            <button
                              onClick={() => handleViewPdf(attachment.id, attachment.file_name)}
                              className="p-2 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                              title={t('reqDetail.preview')}
                            >
                              <Eye size={18} />
                            </button>
                          )}
                          {/* Bouton télécharger */}
                          <button
                            onClick={() => handleDownloadFile(attachment.id, attachment.file_name)}
                            className="p-2 text-gray-500 hover:text-green-600 rounded-lg hover:bg-green-50 transition-colors"
                            title={t('common.download')}
                          >
                            <Download size={18} />
                          </button>
                          {/* Lien externe */}
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 text-gray-500 hover:text-purple-600 rounded-lg hover:bg-purple-50 transition-colors"
                            title={t('reqDetail.openNewTab')}
                          >
                            <ExternalLink size={18} />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Colonne de droite - Informations complémentaires */}
            <div className="space-y-6">
              {/* Informations générales */}
              <div className="bg-white rounded-lg shadow">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-800">{t('reqDetail.information')}</h2>
                </div>
                <div className="p-6 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500 flex items-center gap-1">
                      <Hash size={14} />
                      {t('reqDetail.department')}
                    </span>
                    <span className="text-sm font-medium">{requisition.department_name || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500 flex items-center gap-1">
                      <Tag size={14} />
                      {t('reqDetail.projectCode')}
                    </span>
                    <span className="text-sm font-medium">{requisition.project_name || '-'}</span>
                  </div>
                
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">{t('reqDetail.estimatedAmount')}</span>
                    <span className="text-sm font-semibold text-blue-600">
                      {formatCurrency(requisition.estimated_amount, requisition.currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Demandeur */}
              <div className="bg-white rounded-lg shadow">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <User size={20} />
                    {t('reqDetail.requester')}
                  </h2>
                </div>
                <div className="p-6">
                  <p className="font-medium text-gray-800">
                    {requisition.first_name} {requisition.last_name}
                  </p>
                  {requisition.email && (
                    <p className="text-sm text-gray-500 mt-1">{requisition.email}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'items' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <ListChecks size={20} />
                {t('reqDetail.itemsTitle')}
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
                  {requisition.items?.map((item, index) => {
                    return (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-800">
                            {item.item_description || item.description || t('reqDetail.notSpecified')}
                          </div>
                          {item.specifications && (
                            <div className="text-xs text-gray-500 mt-1">{item.specifications}</div>
                          )}
                         </td>
                        <td className="px-6 py-4 text-sm text-gray-800 text-center">
                          {item.quantity || 0}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-800 text-right">
                          {formatCurrency(item.unit_price || item.unitPrice || 0, requisition.currency)}
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-800 text-right">
                          {formatCurrency(item.total_amount || item.totalAmount || 0, requisition.currency)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan="3" className="px-6 py-4 text-right font-semibold text-gray-800">
                      {t('common.total')}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-lg text-blue-600">
                      {formatCurrency(requisition.estimated_amount, requisition.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'purchase-orders' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Package size={20} />
                {t('reqDetail.relatedOrders')}
              </h2>
            </div>
            {purchaseOrders.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500">{t('reqDetail.noOrders')}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {purchaseOrders.map((po) => (
                  <Link
                    key={po.id}
                    to={`/purchase-orders/${po.id}`}
                    className="block p-6 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-blue-600">{po.po_number}</p>
                        <p className="text-sm text-gray-500 mt-1">
                          {t('reqDetail.createdOn', { date: formatDate(po.created_at) })}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={po.status} size="sm" />
                        <p className="text-sm font-semibold text-gray-800 mt-1">
                          {formatCurrency(po.total_amount, po.currency)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2 mb-4">
              <History size={20} />
              {t('reqDetail.historyTitle')}
            </h2>
            <RequisitionTimeline requisitionId={requisition.id} />
          </div>
        )}
      </div>

      {/* Modales */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title={t('requisitions.deleteTitle')}
        type="danger"
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={() => deleteMutation.mutate()}
        isLoading={deleteMutation.isPending}
      >
        <p>{t('requisitions.deleteConfirmBefore')} <strong>{requisition.requisition_number}</strong> ?</p>
        <p className="text-sm text-gray-500 mt-2">{t('requisitions.irreversible')}</p>
      </Modal>

      <Modal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title={t('reqDetail.cancelTitle')}
        type="warning"
        confirmText={t('reqDetail.cancelAction')}
        cancelText={t('common.back')}
        onConfirm={() => cancelMutation.mutate({ reason: cancellationReason })}
        isLoading={cancelMutation.isPending}
      >
        <div className="space-y-4">
          <p>{t('reqDetail.cancelConfirmBefore')} <strong>{requisition.requisition_number}</strong> ?</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('reqDetail.cancelReason')}
            </label>
            <textarea
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              placeholder={t('reqDetail.cancelReasonPlaceholder')}
              required
            />
          </div>
        </div>
      </Modal>

      <WorkflowTrackerModal
        requisition={showWorkflowModal ? requisition : null}
        onClose={() => setShowWorkflowModal(false)}
      />

      {/* Visualiseur PDF */}
      {viewerAttachmentId && (
        <PdfViewer
          attachmentId={viewerAttachmentId}
          fileName={viewerFileName}
          onClose={() => {
            setViewerAttachmentId(null)
            setViewerFileName(null)
          }}
        />
      )}

      {showViewer && (
        <RequisitionViewer
          requisitionId={id}
          onClose={() => setShowViewer(false)}
        />
      )}
    
    </div>
  )
}