// src/components/Suppliers/SupplierDetail.jsx
import React, { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Mail,
  Phone,
  MapPin,
  Globe,
  Building2,
  FileText,
  Calendar,
  DollarSign,
  Package,
  Star,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  Download,
  Printer,
  RefreshCw,
  Eye,
  FileCheck,
  Shield,
  Award,
  Clock,
  User,
  Link as LinkIcon,
  CreditCard,
  Briefcase,
  Users,
  MessageSquare,
  ExternalLink
} from 'lucide-react'
import { supplierService } from '../../services/supplierService'
import { purchaseOrderService } from '../../services/purchaseOrderService'
import StatusBadge from '../Common/StatusBadge'
import LoadingSpinner from '../Common/LoadingSpinner'
import ErrorAlert from '../Common/ErrorAlert'
import Modal from '../Common/Modal'
import { formatDate, formatDateTime } from '../../utils/formatters'
import { useCurrency } from '../../contexts/EnterpriseContext'
import toast from 'react-hot-toast'

export default function SupplierDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { formatAmount } = useCurrency()
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showPrequalifyModal, setShowPrequalifyModal] = useState(false)
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [ratingValue, setRatingValue] = useState(5)
  const [ratingComment, setRatingComment] = useState('')
  const [activeTab, setActiveTab] = useState('details')

  // Récupérer les détails du fournisseur
  const { data: supplierData, isLoading, error, refetch } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => supplierService.getById(id),
    enabled: !!id
  })

  // Récupérer les commandes du fournisseur
  const { data: purchaseOrdersData } = useQuery({
    queryKey: ['purchase-orders', { supplier_id: id }],
    queryFn: () => purchaseOrderService.getAll({ supplier_id: id, limit: 50 }),
    enabled: !!id
  })

  // Récupérer l'historique des évaluations
  const { data: evaluationsData } = useQuery({
    queryKey: ['supplier-evaluations', id],
    queryFn: () => supplierService.getEvaluations(id),
    enabled: !!id
  })

  const supplier = supplierData?.data
  const purchaseOrders = purchaseOrdersData?.data || []
  const evaluations = evaluationsData?.data || []

  // Mutation pour préqualifier le fournisseur
  const prequalifyMutation = useMutation({
    mutationFn: () => supplierService.prequalify(supplier.id),
    onSuccess: () => {
      queryClient.invalidateQueries(['supplier', id])
      toast.success('Fournisseur préqualifié avec succès')
      setShowPrequalifyModal(false)
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la préqualification')
    }
  })

  // Mutation pour évaluer le fournisseur
  const rateMutation = useMutation({
    mutationFn: (data) => supplierService.rateSupplier(supplier.id, data.rating, data.comment),
    onSuccess: () => {
      queryClient.invalidateQueries(['supplier', id])
      queryClient.invalidateQueries(['supplier-evaluations', id])
      toast.success('Évaluation enregistrée avec succès')
      setShowRatingModal(false)
      setRatingValue(5)
      setRatingComment('')
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de l\'évaluation')
    }
  })

  // Mutation pour supprimer le fournisseur
  const deleteMutation = useMutation({
    mutationFn: () => supplierService.delete(id),
    onSuccess: () => {
      toast.success('Fournisseur supprimé avec succès')
      navigate('/suppliers')
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la suppression')
    }
  })

  const calculateTotalSpent = () => {
    return purchaseOrders.reduce((sum, po) => sum + (po.total_amount || 0), 0)
  }

  const calculateAverageRating = () => {
    if (evaluations.length === 0) return supplier?.rating || 0
    const sum = evaluations.reduce((acc, eval1) => acc + (eval1.rating || 0), 0)
    return (sum / evaluations.length).toFixed(1)
  }

  const getPerformanceLevel = function(rating) {
    if (rating >= 4.5) return { label: 'Excellent', color: 'text-green-600', bg: 'bg-green-100' }
    if (rating >= 3.5) return { label: 'Bon', color: 'text-blue-600', bg: 'bg-blue-100' }
    if (rating >= 2.5) return { label: 'Moyen', color: 'text-yellow-600', bg: 'bg-yellow-100' }
    return { label: 'À améliorer', color: 'text-red-600', bg: 'bg-red-100' }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <LoadingSpinner size="lg" text="Chargement du fournisseur..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorAlert
          title="Erreur de chargement"
          message="Impossible de charger les détails du fournisseur"
          details={error.message}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  if (!supplier) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900">Fournisseur non trouvé</h3>
        <p className="mt-1 text-gray-500">Le fournisseur que vous recherchez n'existe pas.</p>
        <button
          onClick={() => navigate('/suppliers')}
          className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <ArrowLeft size={18} className="mr-2" />
          Retour à la liste
        </button>
      </div>
    )
  }

  const averageRating = calculateAverageRating()
  const performance = getPerformanceLevel(averageRating)
  const totalSpent = calculateTotalSpent()
  const canPrequalify = !supplier.prequalified && supplier.status === 'ACTIVE'

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/suppliers')}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-800">
                {supplier.name}
              </h1>
              <StatusBadge status={supplier.prequalified ? 'SUPPLIER_PREQUALIFIED' : 'SUPPLIER_ACTIVE'} size="lg" />
              {supplier.status === 'ACTIVE' ? (
                <StatusBadge status="SUPPLIER_ACTIVE" size="lg" />
              ) : (
                <StatusBadge status="SUPPLIER_INACTIVE" size="lg" />
              )}
            </div>
            <p className="text-gray-500 mt-1">
              Code: {supplier.supplier_code}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/suppliers/${supplier.id}/edit`}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Edit size={18} />
            Modifier
          </Link>
          {canPrequalify && (
            <button
              onClick={() => setShowPrequalifyModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Shield size={18} />
              Préqualifier
            </button>
          )}
          <button
            onClick={() => setShowRatingModal(true)}
            className="flex items-center gap-2 px-4 py-2 border border-yellow-500 text-yellow-600 rounded-lg hover:bg-yellow-50 transition-colors"
          >
            <Star size={18} />
            Évaluer
          </button>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
          >
            <Trash2 size={18} />
            Supprimer
          </button>
        </div>
      </div>

      {/* Cartes de statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total dépensé</p>
              <p className="text-2xl font-bold text-gray-800">
                {formatAmount(totalSpent)}
              </p>
            </div>
            <DollarSign className="h-8 w-8 text-green-500" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Commandes</p>
              <p className="text-2xl font-bold text-blue-600">
                {purchaseOrders.length}
              </p>
            </div>
            <Package className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Note moyenne</p>
              <div className="flex items-center gap-1">
                <p className="text-2xl font-bold text-yellow-600">
                  {averageRating}
                </p>
                <Star size={18} className="text-yellow-500 fill-yellow-500" />
              </div>
            </div>
            <Award className="h-8 w-8 text-yellow-500" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Performance</p>
              <p className={`text-xl font-bold ${performance.color}`}>
                {performance.label}
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-purple-500" />
          </div>
        </div>
      </div>

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
            Informations
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
            onClick={() => setActiveTab('evaluations')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'evaluations'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Évaluations ({evaluations.length})
          </button>
        </nav>
      </div>

      {/* Contenu des tabs */}
      {activeTab === 'details' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Colonne de gauche - Informations de contact */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Building2 size={20} />
                  Informations générales
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-500">Nom complet</label>
                    <p className="font-medium text-gray-800">{supplier.name}</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">Code fournisseur</label>
                    <p className="font-medium text-gray-800">{supplier.supplier_code}</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">N° d'enregistrement</label>
                    <p className="text-gray-800">{supplier.registration_number || '-'}</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">N° TVA</label>
                    <p className="text-gray-800">{supplier.tax_id || '-'}</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">Site web</label>
                    {supplier.website ? (
                      <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 flex items-center gap-1">
                        {supplier.website}
                        <ExternalLink size={14} />
                      </a>
                    ) : (
                      <p className="text-gray-800">-</p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm text-gray-500">Date d'ajout</label>
                    <p className="text-gray-800">{formatDate(supplier.created_at)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact */}
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Users size={20} />
                  Contact
                </h2>
              </div>
              <div className="p-6 space-y-3">
                {supplier.email && (
                  <div className="flex items-center gap-3">
                    <Mail size={18} className="text-gray-400" />
                    <a href={`mailto:${supplier.email}`} className="text-blue-600 hover:text-blue-800">
                      {supplier.email}
                    </a>
                  </div>
                )}
                {supplier.phone && (
                  <div className="flex items-center gap-3">
                    <Phone size={18} className="text-gray-400" />
                    <a href={`tel:${supplier.phone}`} className="text-gray-700">
                      {supplier.phone}
                    </a>
                  </div>
                )}
                {supplier.address && (
                  <div className="flex items-start gap-3">
                    <MapPin size={18} className="text-gray-400 mt-0.5" />
                    <p className="text-gray-700">{supplier.address}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Colonne de droite - Certifications et statuts */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Shield size={20} />
                  Certifications & Statuts
                </h2>
              </div>
              <div className="p-6 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Préqualifié</span>
                  {supplier.prequalified ? (
                    <CheckCircle size={18} className="text-green-500" />
                  ) : (
                    <XCircle size={18} className="text-gray-400" />
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Due diligence</span>
                  {supplier.due_diligence_completed ? (
                    <CheckCircle size={18} className="text-green-500" />
                  ) : (
                    <Clock size={18} className="text-yellow-500" />
                  )}
                </div>
                {supplier.due_diligence_date && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Date due diligence</span>
                    <span className="text-sm">{formatDate(supplier.due_diligence_date)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Évaluation */}
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Star size={20} />
                  Évaluation
                </h2>
              </div>
              <div className="p-6 text-center">
                <div className="text-4xl font-bold text-yellow-600 mb-2">
                  {averageRating}
                </div>
                <div className="flex justify-center gap-1 mb-2">
                  {[1, 2, 3, 4, 5].map(star => (
                    <Star
                      key={star}
                      size={24}
                      className={`${star <= averageRating ? 'fill-yellow-500 text-yellow-500' : 'text-gray-300'}`}
                    />
                  ))}
                </div>
                <p className={`text-sm font-medium ${performance.color} ${performance.bg} inline-block px-3 py-1 rounded-full mt-2`}>
                  {performance.label}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'purchase-orders' && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Package size={20} />
              Historique des commandes
            </h2>
          </div>
          {purchaseOrders.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-500">Aucune commande associée à ce fournisseur.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">N° Commande</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Montant</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {purchaseOrders.map((po) => (
                    <tr key={po.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <Link to={`/purchase-orders/${po.id}`} className="text-blue-600 hover:text-blue-800">
                          {po.po_number}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatDate(po.order_date)}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold">
                        {formatAmount(po.total_amount)}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={po.status} size="sm" />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Link to={`/purchase-orders/${po.id}`} className="text-gray-400 hover:text-blue-600">
                          <Eye size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'evaluations' && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <MessageSquare size={20} />
              Historique des évaluations
            </h2>
          </div>
          {evaluations.length === 0 ? (
            <div className="p-12 text-center">
              <Star className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <p className="text-gray-500">Aucune évaluation enregistrée.</p>
              <button
                onClick={() => setShowRatingModal(true)}
                className="mt-2 text-blue-600 hover:text-blue-800"
              >
                Évaluer ce fournisseur
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {evaluations.map((evaluation) => (
                <div key={evaluation.id} className="p-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map(star => (
                            <Star
                              key={star}
                              size={16}
                              className={`${star <= evaluation.rating ? 'fill-yellow-500 text-yellow-500' : 'text-gray-300'}`}
                            />
                          ))}
                        </div>
                        <span className="text-sm font-medium text-gray-800">
                          {evaluation.rating}/5
                        </span>
                      </div>
                      {evaluation.comment && (
                        <p className="text-gray-600 mt-2">{evaluation.comment}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        Évalué par {evaluation.evaluator_name} le {formatDateTime(evaluation.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal de suppression */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Supprimer le fournisseur"
        type="danger"
        confirmText="Supprimer"
        cancelText="Annuler"
        onConfirm={() => deleteMutation.mutate()}
        isLoading={deleteMutation.isPending}
      >
        <p>Êtes-vous sûr de vouloir supprimer le fournisseur <strong>{supplier.name}</strong> ?</p>
        <p className="text-sm text-gray-500 mt-2">Cette action est irréversible.</p>
      </Modal>

      {/* Modal de préqualification */}
      <Modal
        isOpen={showPrequalifyModal}
        onClose={() => setShowPrequalifyModal(false)}
        title="Préqualifier le fournisseur"
        type="success"
        confirmText="Confirmer"
        cancelText="Annuler"
        onConfirm={() => prequalifyMutation.mutate()}
        isLoading={prequalifyMutation.isPending}
      >
        <p>Êtes-vous sûr de vouloir préqualifier le fournisseur <strong>{supplier.name}</strong> ?</p>
        <p className="text-sm text-gray-500 mt-2">Le fournisseur sera ajouté à la liste des fournisseurs préqualifiés.</p>
      </Modal>

      {/* Modal d'évaluation */}
      <Modal
        isOpen={showRatingModal}
        onClose={() => {
          setShowRatingModal(false)
          setRatingValue(5)
          setRatingComment('')
        }}
        title="Évaluer le fournisseur"
        type="info"
        confirmText="Enregistrer"
        cancelText="Annuler"
        onConfirm={() => rateMutation.mutate({ rating: ratingValue, comment: ratingComment })}
        isLoading={rateMutation.isPending}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Note (1-5)
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRatingValue(star)}
                  className="focus:outline-none"
                >
                  <Star
                    size={32}
                    className={`${star <= ratingValue ? 'fill-yellow-500 text-yellow-500' : 'text-gray-300'} transition-colors hover:scale-110`}
                  />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Commentaire
            </label>
            <textarea
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              rows="4"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Partagez votre expérience avec ce fournisseur..."
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}