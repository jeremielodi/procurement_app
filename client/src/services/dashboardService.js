// src/services/dashboardService.js
import api from './api'

export const dashboardService = {
  // Récupérer les statistiques globales
  getStats: async () => {
    const response = await api.get('/dashboard/stats')
    return response.data
  },

  // Récupérer les données pour les graphiques
  getChartData: async (period = 'month') => {
    const response = await api.get(`/dashboard/charts?period=${period}`)
    return response.data
  },

  // Récupérer les réquisitions récentes
  getRecentRequisitions: async (limit = 10) => {
    const response = await api.get(`/dashboard/recent-requisitions?limit=${limit}`)
    return response.data
  },

  // Récupérer les activités récentes
  getRecentActivities: async (limit = 10) => {
    const response = await api.get(`/dashboard/recent-activities?limit=${limit}`)
    return response.data
  },

  // Récupérer le résumé par département
  getDepartmentSummary: async () => {
    const response = await api.get('/dashboard/department-summary')
    return response.data
  },

  // Récupérer le résumé par fournisseur
  getSupplierSummary: async () => {
    const response = await api.get('/dashboard/supplier-summary')
    return response.data
  }
}