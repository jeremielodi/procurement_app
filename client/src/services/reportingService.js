// src/services/reportingService.js
import api from './api'

export const reportingService = {
  // Générer un rapport des réquisitions
  generateRequisitionReport: async (filters = {}) => {
    const response = await api.post('/reports/requisitions', filters, {
      responseType: 'blob'
    })
    return response.data
  },

  // Générer un rapport des commandes
  generatePurchaseOrderReport: async (filters = {}) => {
    const response = await api.post('/reports/purchase-orders', filters, {
      responseType: 'blob'
    })
    return response.data
  },

  // Générer un rapport des fournisseurs
  generateSupplierReport: async () => {
    const response = await api.get('/reports/suppliers', {
      responseType: 'blob'
    })
    return response.data
  },

  // Générer un rapport budgétaire
  generateBudgetReport: async (year) => {
    const response = await api.get(`/reports/budget?year=${year}`, {
      responseType: 'blob'
    })
    return response.data
  },

  // Exporter les données en Excel
  exportToExcel: async (type, filters = {}) => {
    const response = await api.post(`/reports/export/${type}`, filters, {
      responseType: 'blob'
    })
    return response.data
  }
}