// src/services/supplierService.js
import api from './api'

export const supplierService = {
  getAll: async () => {
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

  getPrequalified: async () => {
    const response = await api.get('/suppliers/prequalified')
    return response.data
  },
}