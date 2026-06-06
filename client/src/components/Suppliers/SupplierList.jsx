// src/components/Suppliers/SupplierList.jsx
import React, { useState } from 'react'
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
  CheckCircle,
  XCircle,
  Mail,
  Phone,
  MapPin,
  Star,
  Shield,
  Building2,
  MoreVertical,
  FileSpreadsheet,
  Printer,
  ChevronLeft,
  ChevronRight,
  Users,
  Award,
  TrendingUp,
  AlertCircle
} from 'lucide-react'
import { supplierService } from '../../services/supplierService'
import StatusBadge from '../Common/StatusBadge'
import LoadingSpinner from '../Common/LoadingSpinner'
import ErrorAlert from '../Common/ErrorAlert'
import Modal from '../Common/Modal'
import { formatCurrency } from '../../utils/formatters'
import toast from 'react-hot-toast'

const statusOptions = [
  { value: 'all', label: 'Tous les statuts' },
  { value: 'ACTIVE', label: 'Actif' },
  { value: 'INACTIVE', label: 'Inactif' }
]

const prequalificationOptions = [
  { value: 'all', label: 'Tous' },
  { value: 'true', label: 'Préqualifiés' },
  { value: 'false', label: 'Non préqualifiés' }
]

const ratingOptions = [
  { value: 'all', label: 'Toutes notes' },
  { value: '4.5', label: '4.5+ (Excellent)' },
  { value: '3.5', label: '3.5+ (Bon)' },
  { value: '2.5', label: '2.5+ (Moyen)' },
  { value: '0', label: '< 2.5 (À améliorer)' }
]

export default function SupplierList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  
  // États pour les filtres
  const [filters, setFilters] = useState({
    status: 'all',
    prequalified: 'all',
    minRating: 'all',
    search: ''
  })
  const [showFilters, setShowFilters] = useState(false)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20
  })
  const [selectedSuppliers, setSelectedSuppliers] = useState([])
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const [showPrequalifyModal, setShowPrequalifyModal] = useState(false)
  const [supplierToDelete, setSupplierToDelete] = useState(null)
  const [supplierToPrequalify, setSupplierToPrequalify] = useState(null)

  // Récupérer les fournisseurs
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['suppliers', filters, pagination],
    queryFn: () => supplierService.getAll({
      ...filters,
      page: pagination.page,
      limit: pagination.limit,
      ...(filters.status !== 'all' && { status: filters.status }),
      ...(filters.prequalified !== 'all' && { prequalified: filters.prequalified === 'true' }),
      ...(filters.minRating !== 'all' && { minRating: parseFloat(filters.minRating) }),
      ...(filters.search && { search: filters.search })
    })
  })

  // Mutation pour supprimer un fournisseur
  const deleteMutation = useMutation({
    mutationFn: (id) => supplierService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['suppliers'])
      toast.success('Fournisseur supprimé avec succès')
      setShowDeleteModal(false)
      setSupplierToDelete(null)
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la suppression')
    }
  })

  // Mutation pour supprimer plusieurs fournisseurs
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => supplierService.bulkDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries(['suppliers'])
      toast.success(`${selectedSuppliers.length} fournisseur(s) supprimé(s)`)
      setShowBulkDeleteModal(false)
      setSelectedSuppliers([])
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la suppression')
    }
  })

  // Mutation pour préqualifier un fournisseur
  const prequalifyMutation = useMutation({
    mutationFn: (id) => supplierService.prequalify(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['suppliers'])
      toast.success('Fournisseur préqualifié avec succès')
      setShowPrequalifyModal(false)
      setSupplierToPrequalify(null)
    },
    onError: (error) => {
      toast.error(error.message || 'Erreur lors de la préqualification')
    }
  })

  const suppliers = data?.data || []
  const totalPages = data?.pagination?.pages || 1
  const totalItems = data?.pagination?.total || 0

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPagination(prev => ({ ...prev, page: 1 }))
  }

  const handleResetFilters = () => {
    setFilters({
      status: 'all',
      prequalified: 'all',
      minRating: 'all',
      search: ''
    })
    setPagination({ page: 1, limit: 20 })
  }

  const handleSelectSupplier = (id) => {
    setSelectedSuppliers(prev =>
      prev.includes(id)
        ? prev.filter(item => item !== id)
        : [...prev, id]
    )
  }

  const handleSelectAll = () => {
    if (selectedSuppliers.length === suppliers.length) {
      setSelectedSuppliers([])
    } else {
      setSelectedSuppliers(suppliers.map(s => s.id))
    }
  }

  const handleExport = async (format = 'excel') => {
    try {
      if (format === 'excel') {
        const blob = await supplierService.exportToExcel(filters)
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `suppliers_${new Date().toISOString()}.xlsx`)
        document.body.appendChild(link)
        link.click()
        link.remove()
        toast.success('Export Excel réussi')
      } else if (format === 'pdf') {
        const blob = await supplierService.exportToPDF(filters)
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `suppliers_${new Date().toISOString()}.pdf`)
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

  const getRatingStars = (rating) => {
    const fullStars = Math.floor(rating)
    const hasHalfStar = rating % 1 >= 0.5
    const stars = []
    
    for (let i = 0; i < fullStars; i++) {
      stars.push(<Star key={i} size={14} className="fill-yellow-500 text-yellow-500" />)
    }
    if (hasHalfStar) {
      stars.push(<Star key="half" size={14} className="fill-yellow-500 text-yellow-500" />)
    }
    const emptyStars = 5 - stars.length
    for (let i = 0; i < emptyStars; i++) {
      stars.push(<Star key={`empty-${i}`} size={14} className="text-gray-300" />)
    }
    return stars
  }

  if (isLoading && !data) {
    return (
      <div className="flex justify-center items-center h-96">
        <LoadingSpinner size="lg" text="Chargement des fournisseurs..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorAlert
          title="Erreur de chargement"
          message="Impossible de charger les fournisseurs"
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
          <h1 className="text-2xl font-bold text-gray-800">Fournisseurs</h1>
          <p className="text-gray-500 mt-1">
            Gérez votre catalogue de fournisseurs
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/suppliers/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={18} />
            Nouveau fournisseur
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
                placeholder="Rechercher par nom, email, téléphone..."
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
            {(filters.status !== 'all' || filters.prequalified !== 'all' || filters.minRating !== 'all') && (
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
                <FileSpreadsheet size={16} className="inline mr-2" />
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
                {statusOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                value={filters.prequalified}
                onChange={(e) => handleFilterChange('prequalified', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {prequalificationOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                value={filters.minRating}
                onChange={(e) => handleFilterChange('minRating', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {ratingOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
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
      {selectedSuppliers.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-4 flex justify-between items-center">
          <span className="text-sm text-blue-700">
            {selectedSuppliers.length} fournisseur(s) sélectionné(s)
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
              onClick={() => setSelectedSuppliers([])}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Tableau des fournisseurs */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedSuppliers.length === suppliers.length && suppliers.length > 0}
                    onChange={handleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fournisseur
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Note
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Dépenses
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-gray-500">
                    <Building2 className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                    <p>Aucun fournisseur trouvé</p>
                    <Link
                      to="/suppliers/new"
                      className="mt-2 inline-flex items-center text-blue-600 hover:text-blue-800"
                    >
                      <Plus size={16} className="mr-1" />
                      Ajouter un fournisseur
                    </Link>
                   </td>
                 </tr>
              ) : (
                suppliers.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedSuppliers.includes(supplier.id)}
                        onChange={() => handleSelectSupplier(supplier.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <Building2 size={20} className="text-blue-600" />
                          </div>
                        </div>
                        <div>
                          <Link
                            to={`/suppliers/${supplier.id}`}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800"
                          >
                            {supplier.name}
                          </Link>
                          <div className="text-xs text-gray-500">
                            Code: {supplier.supplier_code}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {supplier.email && (
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <Mail size={14} />
                          <span className="truncate max-w-[150px]">{supplier.email}</span>
                        </div>
                      )}
                      {supplier.phone && (
                        <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                          <Phone size={14} />
                          {supplier.phone}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <StatusBadge 
                          status={supplier.status === 'ACTIVE' ? 'SUPPLIER_ACTIVE' : 'SUPPLIER_INACTIVE'} 
                          size="sm" 
                        />
                        {supplier.prequalified && (
                          <StatusBadge status="SUPPLIER_PREQUALIFIED" size="sm" />
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <div className="flex">
                          {getRatingStars(supplier.rating || 0)}
                        </div>
                        <span className="text-sm font-medium ml-1">
                          {supplier.rating ? supplier.rating.toFixed(1) : '-'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-semibold text-gray-900">
                        {formatCurrency(supplier.total_spent || 0, 'USD')}
                      </div>
                      <div className="text-xs text-gray-500">
                        {supplier.order_count || 0} commandes
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/suppliers/${supplier.id}`}
                          className="text-gray-400 hover:text-blue-600 transition-colors"
                          title="Voir"
                        >
                          <Eye size={18} />
                        </Link>
                        <Link
                          to={`/suppliers/${supplier.id}/edit`}
                          className="text-gray-400 hover:text-green-600 transition-colors"
                          title="Modifier"
                        >
                          <Edit size={18} />
                        </Link>
                        {!supplier.prequalified && supplier.status === 'ACTIVE' && (
                          <button
                            onClick={() => {
                              setSupplierToPrequalify(supplier)
                              setShowPrequalifyModal(true)
                            }}
                            className="text-gray-400 hover:text-purple-600 transition-colors"
                            title="Préqualifier"
                          >
                            <Shield size={18} />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSupplierToDelete(supplier)
                            setShowDeleteModal(true)
                          }}
                          className="text-gray-400 hover:text-red-600 transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 size={18} />
                        </button>
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
              {Math.min(pagination.page * pagination.limit, totalItems)} sur {totalItems} fournisseurs
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
                      className={`w-10 h-10 rounded-lg transition-colors ${
                        pagination.page === pageNum
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
          setSupplierToDelete(null)
        }}
        title="Supprimer le fournisseur"
        type="danger"
        confirmText="Supprimer"
        cancelText="Annuler"
        onConfirm={() => deleteMutation.mutate(supplierToDelete?.id)}
        isLoading={deleteMutation.isPending}
      >
        <p>Êtes-vous sûr de vouloir supprimer le fournisseur <strong>{supplierToDelete?.name}</strong> ?</p>
        <p className="text-sm text-gray-500 mt-2">Cette action est irréversible.</p>
      </Modal>

      {/* Modal de suppression groupée */}
      <Modal
        isOpen={showBulkDeleteModal}
        onClose={() => setShowBulkDeleteModal(false)}
        title="Supprimer plusieurs fournisseurs"
        type="danger"
        confirmText="Supprimer"
        cancelText="Annuler"
        onConfirm={() => bulkDeleteMutation.mutate(selectedSuppliers)}
        isLoading={bulkDeleteMutation.isPending}
      >
        <p>Êtes-vous sûr de vouloir supprimer <strong>{selectedSuppliers.length}</strong> fournisseur(s) ?</p>
        <p className="text-sm text-gray-500 mt-2">Cette action est irréversible.</p>
      </Modal>

      {/* Modal de préqualification */}
      <Modal
        isOpen={showPrequalifyModal}
        onClose={() => {
          setShowPrequalifyModal(false)
          setSupplierToPrequalify(null)
        }}
        title="Préqualifier le fournisseur"
        type="success"
        confirmText="Confirmer"
        cancelText="Annuler"
        onConfirm={() => prequalifyMutation.mutate(supplierToPrequalify?.id)}
        isLoading={prequalifyMutation.isPending}
      >
        <p>Êtes-vous sûr de vouloir préqualifier le fournisseur <strong>{supplierToPrequalify?.name}</strong> ?</p>
        <p className="text-sm text-gray-500 mt-2">Le fournisseur sera ajouté à la liste des fournisseurs préqualifiés.</p>
      </Modal>
    </div>
  )
}