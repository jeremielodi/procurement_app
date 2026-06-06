// src/services/requisitionService.js
import api from './api'

export const requisitionService = {
  // Récupérer toutes les réquisitions
  getAll: async (params = {}) => {
    const response = await api.get('/requisitions', { params })
    return response.data
  },

  // Récupérer une réquisition par ID
  getById: async (id) => {
    const response = await api.get(`/requisitions/${id}`)
    return response.data
  },

  // Créer une nouvelle réquisition
  create: async (data) => {
    const response = await api.post('/requisitions', data)
    return response.data
  },

  // Mettre à jour une réquisition
  update: async (id, data) => {
    const response = await api.put(`/requisitions/${id}`, data)
    return response.data
  },

  delete: async (id) => {
    const response = await api.delete(`/requisitions/${id}`)
    return response.data
  },
  // Ajouter l'historique du workflow
  addWorkflowHistory: async (data) => {
    const response = await api.post('/requisitions/history', data)
    return response.data
  },
}