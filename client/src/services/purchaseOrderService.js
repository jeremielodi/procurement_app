// src/services/purchaseOrderService.js
import api from './api'

export const purchaseOrderService = {
  // Récupérer toutes les commandes
  getAll: async (params = {}) => {
    const response = await api.get('/purchase-orders', { params })
    return response.data
  },

  // Récupérer une commande par ID
  getById: async (id) => {
    const response = await api.get(`/purchase-orders/${id}`)
    return response.data
  },

  // Créer une nouvelle commande
  create: async (data) => {
    const response = await api.post('/purchase-orders', data)
    return response.data
  },

  // Mettre à jour une commande
  update: async (id, data) => {
    const response = await api.put(`/purchase-orders/${id}`, data)
    return response.data
  },

  // Approuver une commande
  approve: async (id, approverId) => {
    const response = await api.post(`/purchase-orders/${id}/approve`, { approverId })
    return response.data
  },

  // Rejeter une commande
  reject: async (id, reason) => {
    const response = await api.post(`/purchase-orders/${id}/reject`, { reason })
    return response.data
  },

  // Générer un PDF de la commande
  generatePDF: async (id) => {
    const response = await api.get(`/purchase-orders/${id}/pdf`, {
      responseType: 'blob'
    })
    return response.data
  },

  // Envoyer la commande au fournisseur
  send: async (id) => {
    const response = await api.post(`/purchase-orders/${id}/send`)
    return response.data
  },

  // Soumettre pour approbation (DRAFT → PO_PENDING)
  submit: async (id) => {
    const response = await api.post(`/purchase-orders/${id}/submit`)
    return response.data
  },

  // Supprimer une commande
  delete: async (id) => {
    const response = await api.delete(`/purchase-orders/${id}`)
    return response.data
  },

  // Récupérer les statistiques des commandes
  getStats: async () => {
    const response = await api.get('/purchase-orders/stats')
    return response.data
  }
}