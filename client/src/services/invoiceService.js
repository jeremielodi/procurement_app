import api from './api';

export const invoiceService = {
  getAll: async (params = {}) => {
    const response = await api.get('/invoices', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get(`/invoices/${id}`);
    return response.data;
  },
  // Erreurs métier (DUPLICATE_INVOICE…) affichées par le formulaire
  create: async (data) => {
    const response = await api.post('/invoices', data, { skipErrorToast: true });
    return response.data;
  },
  runMatch: async (id) => {
    const response = await api.post(`/invoices/${id}/match`);
    return response.data;
  },
  approve: async (id, data = {}) => {
    const response = await api.post(`/invoices/${id}/approve`, data);
    return response.data;
  },
  reject: async (id, data) => {
    const response = await api.post(`/invoices/${id}/reject`, data);
    return response.data;
  }
};
