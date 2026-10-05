// src/services/supplierService.js
// Fournisseurs (partagés entre les entreprises) — les évaluations sont propres à chaque entreprise.
import api from './api'

const unavailable = (what) => Promise.reject(new Error(`${what} : fonctionnalité pas encore disponible`))

export const supplierService = {
  // Liste complète (y compris les fournisseurs inscrits non préqualifiés) ; prequalifiedOnly pour les choix de commande
  getAll: async ({ prequalifiedOnly = false } = {}) => {
    const response = await api.get('/suppliers', { params: prequalifiedOnly ? {} : { all: 1 } })
    return response.data
  },

  getPrequalified: async () => {
    const response = await api.get('/suppliers')
    return response.data
  },

  getById: async (id) => {
    const response = await api.get(`/suppliers/${id}`)
    return response.data
  },

  create: async (data) => {
    const response = await api.post('/suppliers', data)
    return response.data
  },

  update: async (id, data) => {
    const response = await api.put(`/suppliers/${id}`, data)
    return response.data
  },

  delete: async (id) => {
    const response = await api.delete(`/suppliers/${id}`)
    return response.data
  },

  bulkDelete: async (ids) => {
    const results = await Promise.allSettled(ids.map(id => api.delete(`/suppliers/${id}`)))
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed) throw new Error(`${failed} fournisseur(s) non supprimé(s) (historique ou compte portail)`)
    return { success: true }
  },

  prequalify: async (id, prequalified = true) => {
    const response = await api.post(`/suppliers/${id}/prequalify`, { prequalified })
    return response.data
  },

  // Évaluations faites par mon entreprise
  getEvaluations: async (id) => {
    const response = await api.get(`/suppliers/${id}/evaluations`)
    return response.data
  },

  rateSupplier: async (id, rating, comment) => {
    const response = await api.post(`/suppliers/${id}/evaluations`, { rating, comment })
    return response.data
  },

  // Non implémentés côté serveur : erreur explicite plutôt qu'un plantage
  // ---------- Documents de préqualification ----------
  getDocumentBlob: async (supplierId, documentId) => {
    const response = await api.get(`/suppliers/${supplierId}/documents/${documentId}/file`, { responseType: 'blob' })
    return response.data
  },

  // Fournisseurs saisis par un acheteur uniquement (les inscrits gèrent leurs documents)
  uploadDocument: async (supplierId, docType, file) => {
    const fd = new FormData()
    fd.append('file', file)
    const response = await api.put(`/suppliers/${supplierId}/documents/${docType}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    return response.data
  },

  // ---------- Préqualification (mon entreprise, par catégorie) ----------
  setPrequalification: async (supplierId, { categoryId, status, comment }) => {
    const response = await api.put(`/suppliers/${supplierId}/prequalification`, { categoryId, status, comment })
    return response.data
  },

  listPrequalified: async (filters = {}) => {
    const response = await api.get('/suppliers/prequalified', { params: filters })
    return response.data
  },

  exportPrequalified: async (filters = {}) => {
    const response = await api.get('/suppliers/prequalified/export', { params: filters, responseType: 'blob' })
    return response.data
  },

  uploadDocuments: async () => unavailable('Documents du fournisseur'),
  exportToExcel: async () => unavailable('Export Excel des fournisseurs'),
  exportToPDF: async () => unavailable('Export PDF des fournisseurs'),
}

export default supplierService
