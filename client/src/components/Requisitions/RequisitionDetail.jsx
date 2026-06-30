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
  ListTodo
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
      const pendingCount = data?.data?.filter(t => t.status === 'PENDING').length || 0
      setPendingTasksCount(pendingCount)
    }
  })

  const requisition = requisitionData?.data
  const purchaseOrders = purchaseOrdersData?.data || []
  
  // CORRECTION: Extraire correctement les données d'historique
  const workflowHistory = workflowHistoryData?.data || workflowHistoryData || []
  
  // Extraire les activités, tâches et processus de l'historique
  const activities = workflowHistory.activities || []
  const historyTasks = workflowHistory.tasks || []

  // Mutation pour annuler la réquisition
  const cancelMutation = useMutation({
    mutationFn: (data) => requisitionService.cancel(requisition?.id, data.reason),
    onSuccess: () => {
      queryClient.invalidateQueries(['requisition', id])
      toast.success('Réquisition annulée avec succès')
      setShowCancelModal(false)
      setCancellationReason('')
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de l\'annulation')
    }
  })

  // Mutation pour supprimer la réquisition
  const deleteMutation = useMutation({
    mutationFn: () => requisitionService.delete(id),
    onSuccess: () => {
      toast.success('Réquisition supprimée avec succès')
      navigate('/requisitions')
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la suppression')
    }
  })

  // Mutation pour soumettre la réquisition
  const submitMutation = useMutation({
    mutationFn: () => requisitionService.submit(requisition?.id),
    onSuccess: () => {
      queryClient.invalidateQueries(['requisition', id])
      toast.success('Réquisition soumise avec succès')
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la soumission')
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
      toast.success('Téléchargement démarré')
    } catch (error) {
      toast.error('Erreur lors du téléchargement')
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
    toast.error('Réquisition non disponible');
    return;
  }

  try {
    toast.loading('Génération du PDF en cours...', { id: 'pdf-generation' });
    
    const response = await requisitionService.generatePDF(requisition.id);
    
    // Vérifier que la réponse est bien un blob
    if (!response || !(response instanceof Blob)) {
      console.error('Invalid response:', response);
      throw new Error('La réponse du serveur n\'est pas valide');
    }
    
    // Vérifier que le blob n'est pas vide
    if (response.size === 0) {
      throw new Error('Le PDF généré est vide');
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
    
    toast.success('PDF généré avec succès', { id: 'pdf-generation' });
  } catch (error) {
    console.error('Error generating PDF:', error);
    
    // Afficher le message d'erreur
    let errorMessage = 'Erreur lors de la génération du PDF';
    if (error.response?.status === 404) {
      errorMessage = 'Réquisition non trouvée';
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
        <LoadingSpinner size="lg" text="Chargement de la réquisition..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorAlert
          title="Erreur de chargement"
          message="Impossible de charger les détails de la réquisition"
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
        <h3 className="text-lg font-medium text-gray-900">Réquisition non trouvée</h3>
        <p className="mt-1 text-gray-500">La réquisition que vous recherchez n'existe pas.</p>
        <button
          onClick={() => navigate('/requisitions')}
          className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <ArrowLeft size={18} className="mr-2" />
          Retour à la liste
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
  const historyItems = historyTasks.length > 0 ? historyTasks : (requisition.history || [])

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
              Créée le {formatDateTime(requisition.created_at)} par {requisition.first_name} {requisition.last_name}
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
              Tâches
              {pendingTasksCount > 0 && (
                <span className="ml-1 bg-white text-orange-600 text-xs font-bold px-2 py-0.5 rounded-full">
                  {pendingTasksCount}
                </span>
              )}
            </Link>
          )}

          <button
           onClick={() => setShowViewer(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download size={18} />
            PDF
          </button>
          
          {requisition.process_instance_id && (
            <button
              onClick={handleViewWorkflow}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <RefreshCw size={18} />
              Voir le workflow
            </button>
          )}
          
          {canSubmit && (
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <Send size={18} />
              {submitMutation.isPending ? 'Soumission...' : 'Soumettre'}
            </button>
          )}
          
          {canEdit && (
            <Link
              to={`/requisitions/${requisition.id}/edit`}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Edit size={18} />
              Modifier
            </Link>
          )}
          
          {canDelete && (
            <button
              onClick={() => setShowDeleteModal(true)}
              className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={18} />
              Supprimer
            </button>
          )}
          
          {canCancel && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="flex items-center gap-2 px-4 py-2 border border-orange-300 text-orange-600 rounded-lg hover:bg-orange-50 transition-colors"
            >
              <XCircle size={18} />
              Annuler
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
                {pendingTasksCount} tâche(s) en attente de traitement
              </p>
              <p className="text-xs text-orange-600 mt-1">
                Cliquez sur le bouton "Tâches" pour traiter les étapes en attente
              </p>
            </div>
            <Link
              to={`/requisitions/${requisition.id}/tasks`}
              className="ml-auto px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm"
            >
              Voir les tâches
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
            Détails
          </button>
          <button
            onClick={() => setActiveTab('items')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'items'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Articles
          </button>
          <button
            onClick={() => setActiveTab('purchase-orders')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'purchase-orders'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Commandes ({purchaseOrders.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Historique
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
                    Description
                  </h2>
                </div>
                <div className="p-6">
                  <p className="text-gray-700 whitespace-pre-wrap">
                    {requisition.description || 'Aucune description fournie.'}
                  </p>
                  {requisition.justification && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-1">Justification:</p>
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
                      Pièces jointes ({requisition.attachments.length})
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
                              {(attachment.file_size / 1024).toFixed(2)} KB - Ajouté le {formatDate(attachment.uploaded_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {/* Bouton visualiser pour PDF */}
                          {attachment.mime_type === 'application/pdf' && (
                            <button
                              onClick={() => handleViewPdf(attachment.id, attachment.file_name)}
                              className="p-2 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                              title="Visualiser"
                            >
                              <Eye size={18} />
                            </button>
                          )}
                          {/* Bouton télécharger */}
                          <button
                            onClick={() => handleDownloadFile(attachment.id, attachment.file_name)}
                            className="p-2 text-gray-500 hover:text-green-600 rounded-lg hover:bg-green-50 transition-colors"
                            title="Télécharger"
                          >
                            <Download size={18} />
                          </button>
                          {/* Lien externe */}
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 text-gray-500 hover:text-purple-600 rounded-lg hover:bg-purple-50 transition-colors"
                            title="Ouvrir dans un nouvel onglet"
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
                  <h2 className="text-lg font-semibold text-gray-800">Informations</h2>
                </div>
                <div className="p-6 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500 flex items-center gap-1">
                      <Hash size={14} />
                      Département:
                    </span>
                    <span className="text-sm font-medium">{requisition.department_name || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500 flex items-center gap-1">
                      <Tag size={14} />
                      Code projet:
                    </span>
                    <span className="text-sm font-medium">{requisition.project_name || '-'}</span>
                  </div>
                
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Montant estimé:</span>
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
                    Demandeur
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
                Articles de la réquisition
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Quantité</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Prix unitaire</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {requisition.items?.map((item, index) => {
                    return (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-800">
                            {item.item_description || item.description || 'Non spécifié'}
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
                      Total
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
                Commandes associées
              </h2>
            </div>
            {purchaseOrders.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500">Aucune commande associée à cette réquisition.</p>
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
                          Créée le {formatDate(po.created_at)}
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
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <History size={20} />
                Historique des actions
              </h2>
            </div>
            {historyItems.length === 0 ? (
              <div className="p-12 text-center">
                <History className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500">Aucun historique disponible.</p>
              </div>
            ) : (
              <div className="flow-root">
                <ul className="-mb-8">
                  {historyItems.map((history, index) => (
                    <li key={index} className="relative pb-8">
                      {index < (historyItems.length - 1) && (
                        <span
                          className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200"
                          aria-hidden="true"
                        />
                      )}
                      <div className="relative flex space-x-3">
                        <div>
                          <span className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center ring-8 ring-white">
                            <Clock className="h-4 w-4 text-blue-600" />
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-500">
                            <span className="font-medium text-gray-900">
                              {history.action || history.taskName || history.activityName || 'Action'}
                            </span>
                            {' '}par {history.performed_by_name || history.assignee || 'Système'}
                          </div>
                          <div className="mt-1 text-sm text-gray-700">
                            {history.comments || 'Aucun commentaire'}
                          </div>
                          <div className="mt-1 text-xs text-gray-400">
                            {formatDateTime(history.performed_at || history.startTime || history.endTime || history.created_at)}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modales */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Supprimer la réquisition"
        type="danger"
        confirmText="Supprimer"
        cancelText="Annuler"
        onConfirm={() => deleteMutation.mutate()}
        isLoading={deleteMutation.isPending}
      >
        <p>Êtes-vous sûr de vouloir supprimer la réquisition <strong>{requisition.requisition_number}</strong> ?</p>
        <p className="text-sm text-gray-500 mt-2">Cette action est irréversible.</p>
      </Modal>

      <Modal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Annuler la réquisition"
        type="warning"
        confirmText="Annuler"
        cancelText="Retour"
        onConfirm={() => cancelMutation.mutate({ reason: cancellationReason })}
        isLoading={cancelMutation.isPending}
      >
        <div className="space-y-4">
          <p>Êtes-vous sûr de vouloir annuler la réquisition <strong>{requisition.requisition_number}</strong> ?</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Motif de l'annulation
            </label>
            <textarea
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              placeholder="Veuillez indiquer la raison de l'annulation..."
              required
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showWorkflowModal}
        onClose={() => setShowWorkflowModal(false)}
        title="Workflow du processus"
        size="xl"
        confirmText="Fermer"
        cancelText=""
        onConfirm={() => setShowWorkflowModal(false)}
      >
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {activities.length > 0 ? (
            activities.map((activity, index) => (
              <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex-shrink-0">
                  {activity.endTime ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : activity.startTime ? (
                    <Clock className="h-5 w-5 text-yellow-500" />
                  ) : (
                    <Clock className="h-5 w-5 text-gray-400" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {activity.activityName || activity.activityType || 'Activité'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Type: {activity.activityType || 'Inconnu'}
                  </p>
                  {activity.startTime && (
                    <p className="text-xs text-gray-400 mt-1">
                      Débuté le: {formatDateTime(activity.startTime)}
                    </p>
                  )}
                  {activity.endTime && (
                    <p className="text-xs text-gray-400">
                      Terminé le: {formatDateTime(activity.endTime)}
                    </p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-gray-500 py-8">
              Aucune activité de workflow disponible
            </div>
          )}
        </div>

      </Modal>

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