// src/components/PurchaseOrders/POList.jsx
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Eye, Download, CheckCircle, XCircle, FileText } from 'lucide-react'
import { purchaseOrderService } from '../../services/purchaseOrderService'
import { formatCurrency, formatDate } from '../../utils/formatters'
import StatusBadge from '../Common/StatusBadge'
import LoadingSpinner from '../Common/LoadingSpinner'
import toast from 'react-hot-toast'

export default function POList() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['purchase-orders', filter, searchTerm],
    queryFn: () => purchaseOrderService.getAll({ status: filter, search: searchTerm }),
  })

  const approveMutation = useMutation({
    mutationFn: ({ id, approverId }) => purchaseOrderService.approve(id, approverId),
    onSuccess: () => {
      queryClient.invalidateQueries(['purchase-orders'])
      toast.success('Commande approuvée avec succès')
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => purchaseOrderService.reject(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries(['purchase-orders'])
      toast.success('Commande rejetée')
    },
  })

  const handleApprove = (id) => {
    if (window.confirm('Êtes-vous sûr de vouloir approuver cette commande ?')) {
      approveMutation.mutate({ id, approverId: 1 }) // À remplacer par l'ID de l'utilisateur connecté
    }
  }

  const handleReject = (id) => {
    const reason = prompt('Raison du rejet :')
    if (reason) {
      rejectMutation.mutate({ id, reason })
    }
  }

  const handleDownloadPDF = async (id, poNumber) => {
    try {
      const pdf = await purchaseOrderService.generatePDF(id)
      const url = window.URL.createObjectURL(new Blob([pdf]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `PO_${poNumber}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      toast.success('PDF téléchargé avec succès')
    } catch (error) {
      toast.error('Erreur lors du téléchargement du PDF')
    }
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <div className="text-red-500">Erreur: {error.message}</div>

  const purchaseOrders = data?.data || []

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Commandes d'achat</h1>
          <p className="text-gray-500 mt-1">Gérez toutes vos commandes d'achat</p>
        </div>
        <Link
          to="/purchase-orders/new"
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={20} className="mr-2" />
          Nouvelle commande
        </Link>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Rechercher par numéro ou fournisseur..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Tous les statuts</option>
            <option value="DRAFT">Brouillon</option>
            <option value="PENDING">En attente</option>
            <option value="APPROVED">Approuvé</option>
            <option value="REJECTED">Rejeté</option>
            <option value="COMPLETED">Terminé</option>
          </select>
        </div>
      </div>

      {/* Tableau des commandes */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  N° Commande
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fournisseur
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Montant
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {purchaseOrders.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                    Aucune commande trouvée
                  </td>
                </tr>
              ) : (
                purchaseOrders.map((po) => (
                  <tr key={po.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {po.po_number}
                      </div>
                      <div className="text-xs text-gray-500">
                        Réq: {po.requisition_number}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{po.supplier_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {formatDate(po.order_date)}
                      </div>
                      <div className="text-xs text-gray-400">
                        Livraison: {formatDate(po.delivery_date)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gray-900">
                        {formatCurrency(po.total_amount, po.currency)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={po.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <Link
                          to={`/purchase-orders/${po.id}`}
                          className="text-blue-600 hover:text-blue-800"
                          title="Voir détails"
                        >
                          <Eye size={18} />
                        </Link>
                        <button
                          onClick={() => handleDownloadPDF(po.id, po.po_number)}
                          className="text-green-600 hover:text-green-800"
                          title="Télécharger PDF"
                        >
                          <Download size={18} />
                        </button>
                        {po.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() => handleApprove(po.id)}
                              className="text-green-600 hover:text-green-800"
                              title="Approuver"
                            >
                              <CheckCircle size={18} />
                            </button>
                            <button
                              onClick={() => handleReject(po.id)}
                              className="text-red-600 hover:text-red-800"
                              title="Rejeter"
                            >
                              <XCircle size={18} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}