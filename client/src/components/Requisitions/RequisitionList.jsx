// src/components/Requisitions/RequisitionList.jsx
import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  Filter,
  Download,
  RefreshCw,
  Eye,
  Edit,
  Trash2,
  Send,
  XCircle,
  CheckCircle,
  Clock,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Calendar,
  DollarSign,
  Building2,
  User,
  MoreVertical,
  FileSpreadsheet,
  Printer
} from 'lucide-react'
import requisitionService from '../../services/requisitionService'
import { departmentService } from '../../services/departmentService'
import StatusBadge from '../Common/StatusBadge'
import LoadingSpinner from '../Common/LoadingSpinner'
import ErrorAlert from '../Common/ErrorAlert'
import Modal from '../Common/Modal'
import { formatCurrency, formatDate } from '../../utils/formatters'
import toast from 'react-hot-toast'




const priorityOptions = [
  { value: 'all', label: 'Toutes priorités' },
  { value: 'LOW', label: 'Basse' },
  { value: 'MEDIUM', label: 'Moyenne' },
  { value: 'HIGH', label: 'Haute' },
  { value: 'URGENT', label: 'Urgent' }
]

export default function RequisitionList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // États pour les filtres
  const [filters, setFilters] = useState({
    status: 'all',
    priority: 'all',
    departmentId: 'all',
    search: '',
    fromDate: '',
    toDate: ''
  })
  const [showFilters, setShowFilters] = useState(false)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20
  })
  const [selectedRequisitions, setSelectedRequisitions] = useState([])
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const [requisitionToDelete, setRequisitionToDelete] = useState(null)

  // Récupérer les départements actifs
  const { data: departmentsData, isLoading: departmentsLoading } = useQuery({
    queryKey: ['active-departments'],
    queryFn: () => departmentService.getAll({ is_active: true })
  })

  const departments = departmentsData?.data || []

  // Créer les options de département pour le filtre
  const departmentOptions = [
    { value: 'all', label: 'Tous départements' },
    ...departments.map(dept => ({
      value: dept.id,
      label: `${dept.code} - ${dept.name}`
    }))
  ]

  // Récupérer les réquisitions
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['requisitions', filters, pagination],
    queryFn: () => requisitionService.getAll({
      ...filters,
      page: pagination.page,
      limit: pagination.limit,
      ...(filters.status !== 'all' && { status: filters.status }),
      ...(filters.priority !== 'all' && { priority: filters.priority }),
      ...(filters.departmentId !== 'all' && { departmentId: filters.departmentId }),
      ...(filters.search && { search: filters.search }),
      ...(filters.fromDate && { fromDate: filters.fromDate }),
      ...(filters.toDate && { toDate: filters.toDate })
    })
  })

  // Mutation pour supprimer une réquisition
  const deleteMutation = useMutation({
    mutationFn: (id) => requisitionService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['requisitions'])
      toast.success('Réquisition supprimée avec succès')
      setShowDeleteModal(false)
      setRequisitionToDelete(null)
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la suppression')
    }
  })

  // Mutation pour supprimer plusieurs réquisitions
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => requisitionService.bulkDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries(['requisitions'])
      toast.success(`${selectedRequisitions.length} réquisition(s) supprimée(s)`)
      setShowBulkDeleteModal(false)
      setSelectedRequisitions([])
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la suppression')
    }
  })

  // Mutation pour soumettre une réquisition
  const submitMutation = useMutation({
    mutationFn: (id) => requisitionService.submit(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['requisitions'])
      toast.success('Réquisition soumise avec succès')
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la soumission')
    }
  })

  const requisitions = data?.data || []
  const totalPages = data?.pagination?.pages || 1
  const totalItems = data?.pagination?.total || 0

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPagination(prev => ({ ...prev, page: 1 }))
  }

  const handleResetFilters = () => {
    setFilters({
      status: 'all',
      priority: 'all',
      departmentId: 'all',
      search: '',
      fromDate: '',
      toDate: ''
    })
    setPagination({ page: 1, limit: 20 })
  }

  const handleSelectRequisition = (id) => {
    setSelectedRequisitions(prev =>
      prev.includes(id)
        ? prev.filter(item => item !== id)
        : [...prev, id]
    )
  }

  const handleSelectAll = () => {
    if (selectedRequisitions.length === requisitions.length) {
      setSelectedRequisitions([])
    } else {
      setSelectedRequisitions(requisitions.map(r => r.id))
    }
  }

  const handleExport = async (format = 'excel') => {
    try {
      if (format === 'excel') {
        const blob = await requisitionService.exportToExcel(filters)
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `requisitions_${new Date().toISOString()}.xlsx`)
        document.body.appendChild(link)
        link.click()
        link.remove()
        toast.success('Export Excel réussi')
      } else if (format === 'pdf') {
        const blob = await requisitionService.exportToPDF(filters)
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `requisitions_${new Date().toISOString()}.pdf`)
        document.body.appendChild(link)
        link.click()
        link.remove()
        toast.success('Export PDF réussi')
      }
    } catch (error) {
      toast.error('Erreur lors de l\'export')
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const getDepartmentName = (departmentId) => {
    if (!departmentId) return '-'
    const dept = departments.find(d => d.id === departmentId)
    return dept ? `${dept.code} - ${dept.name}` : departmentId
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'APPROVED':
        return <CheckCircle size={14} className="text-green-500" />
      case 'REJECTED':
        return <XCircle size={14} className="text-red-500" />
      case 'PENDING':
        return <Clock size={14} className="text-yellow-500" />
      default:
        return <AlertCircle size={14} className="text-gray-400" />
    }
  }

  if (isLoading && !data) {
    return (
      <div className="flex justify-center items-center h-96">
        <LoadingSpinner size="lg" text="Chargement des réquisitions..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorAlert
          title="Erreur de chargement"
          message="Impossible de charger les réquisitions"
          details={error.message}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Réquisitions</h1>
          <p className="text-gray-500 mt-1">
            Gérez toutes vos demandes d'achat
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/requisitions/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={18} />
            Nouvelle réquisition
          </Link>
        </div>
      </div>

      {/* Barre de recherche et filtres */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Rechercher par numéro, titre ou département..."
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Filter size={18} />
            Filtres
            {(filters.status !== 'all' || filters.priority !== 'all' || filters.departmentId !== 'all' || filters.fromDate || filters.toDate) && (
              <span className="ml-1 w-2 h-2 bg-blue-600 rounded-full" />
            )}
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={18} />
            Rafraîchir
          </button>
          <div className="relative group">
            <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              <Download size={18} />
              Exporter
            </button>
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 hidden group-hover:block z-10">
              <button
                onClick={() => handleExport('excel')}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-t-lg"
              >
                <FileSpreadsheet size={16} className="inline mr-2" />
                Excel
              </button>
              <button
                onClick={() => handleExport('pdf')}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <FileText size={16} className="inline mr-2" />
                PDF
              </button>
              <button
                onClick={handlePrint}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-b-lg"
              >
                <Printer size={16} className="inline mr-2" />
                Imprimer
              </button>
            </div>
          </div>
        </div>

        {/* Filtres avancés */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {requisitionService.getStatusOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                value={filters.priority}
                onChange={(e) => handleFilterChange('priority', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {priorityOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                value={filters.departmentId}
                onChange={(e) => handleFilterChange('departmentId', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                disabled={departmentsLoading}
              >
                {departmentOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <input
                type="date"
                placeholder="Date début"
                value={filters.fromDate}
                onChange={(e) => handleFilterChange('fromDate', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                placeholder="Date fin"
                value={filters.toDate}
                onChange={(e) => handleFilterChange('toDate', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleResetFilters}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions groupées */}
      {selectedRequisitions.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-4 flex justify-between items-center">
          <span className="text-sm text-blue-700">
            {selectedRequisitions.length} réquisition(s) sélectionnée(s)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowBulkDeleteModal(true)}
              className="flex items-center gap-2 px-3 py-1 text-sm text-red-600 hover:bg-red-100 rounded-lg transition-colors"
            >
              <Trash2 size={16} />
              Supprimer
            </button>
            <button
              onClick={() => setSelectedRequisitions([])}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Tableau des réquisitions */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedRequisitions.length === requisitions.length && requisitions.length > 0}
                    onChange={handleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  N° Réquisition
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Titre
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Département
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Montant
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Priorité
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {requisitions.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-12 text-center text-gray-500">
                    <FileText className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                    <p>Aucune réquisition trouvée</p>
                    <Link
                      to="/requisitions/new"
                      className="mt-2 inline-flex items-center text-blue-600 hover:text-blue-800"
                    >
                      <Plus size={16} className="mr-1" />
                      Créer une réquisition
                    </Link>
                  </td>
                </tr>
              ) : (
                requisitions.map((requisition) => (
                  <tr key={requisition.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedRequisitions.includes(requisition.id)}
                        onChange={() => handleSelectRequisition(requisition.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link
                        to={`/requisitions/${requisition.id}`}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800"
                      >
                        {requisition.requisition_number}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 max-w-xs truncate">
                        {requisition.title}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <Building2 size={14} />
                        {getDepartmentName(requisition.department_id)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gray-900">
                        {formatCurrency(requisition.estimated_amount, requisition.currency)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <Calendar size={14} />
                        {formatDate(requisition.created_at)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={requisitionService.getStatusOptionLabel(requisition.status)} size="sm" />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={`PRIORITY_${requisition.priority}`} size="sm" />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/requisitions/${requisition.id}`}
                          className="text-gray-400 hover:text-blue-600 transition-colors"
                          title="Voir"
                        >
                          <Eye size={18} />
                        </Link>
                        {requisition.status === 'DRAFT' && (
                          <>
                            <Link
                              to={`/requisitions/${requisition.id}/edit`}
                              className="text-gray-400 hover:text-green-600 transition-colors"
                              title="Modifier"
                            >
                              <Edit size={18} />
                            </Link>
                            <button
                              onClick={() => submitMutation.mutate(requisition.id)}
                              className="text-gray-400 hover:text-purple-600 transition-colors"
                              title="Soumettre"
                            >
                              <Send size={18} />
                            </button>
                            <button
                              onClick={() => {
                                setRequisitionToDelete(requisition)
                                setShowDeleteModal(true)
                              }}
                              className="text-gray-400 hover:text-red-600 transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        )}
                        {requisition.process_instance_id && (
                          <Link
                            to={`/requisitions/${requisition.id}/workflow`}
                            className="text-gray-400 hover:text-orange-600 transition-colors"
                            title="Workflow"
                          >
                            <Clock size={18} />
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
            <div className="text-sm text-gray-500">
              Affichage de {(pagination.page - 1) * pagination.limit + 1} à{' '}
              {Math.min(pagination.page * pagination.limit, totalItems)} sur {totalItems} résultats
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="p-2 border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="flex gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum
                  if (totalPages <= 5) {
                    pageNum = i + 1
                  } else if (pagination.page <= 3) {
                    pageNum = i + 1
                  } else if (pagination.page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i
                  } else {
                    pageNum = pagination.page - 2 + i
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPagination(prev => ({ ...prev, page: pageNum }))}
                      className={`w-10 h-10 rounded-lg transition-colors ${pagination.page === pageNum
                          ? 'bg-blue-600 text-white'
                          : 'border border-gray-300 hover:bg-gray-50'
                        }`}
                    >
                      {pageNum}
                    </button>
                  )
                })}
              </div>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page === totalPages}
                className="p-2 border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de confirmation de suppression */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false)
          setRequisitionToDelete(null)
        }}
        title="Supprimer la réquisition"
        type="danger"
        confirmText="Supprimer"
        cancelText="Annuler"
        onConfirm={() => deleteMutation.mutate(requisitionToDelete?.id)}
        isLoading={deleteMutation.isPending}
      >
        <p>Êtes-vous sûr de vouloir supprimer la réquisition <strong>{requisitionToDelete?.requisition_number}</strong> ?</p>
        <p className="text-sm text-gray-500 mt-2">Cette action est irréversible.</p>
      </Modal>

      {/* Modal de suppression groupée */}
      <Modal
        isOpen={showBulkDeleteModal}
        onClose={() => setShowBulkDeleteModal(false)}
        title="Supprimer plusieurs réquisitions"
        type="danger"
        confirmText="Supprimer"
        cancelText="Annuler"
        onConfirm={() => bulkDeleteMutation.mutate(selectedRequisitions)}
        isLoading={bulkDeleteMutation.isPending}
      >
        <p>Êtes-vous sûr de vouloir supprimer <strong>{selectedRequisitions.length}</strong> réquisition(s) ?</p>
        <p className="text-sm text-gray-500 mt-2">Cette action est irréversible.</p>
      </Modal>
    </div>
  )
}