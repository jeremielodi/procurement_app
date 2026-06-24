import api from './api';

export const paymentService = {
  getAll: async (params = {}) => {
    const response = await api.get('/payments', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get(`/payments/${id}`);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/payments', data);
    return response.data;
  },
  approve: async (id) => {
    const response = await api.post(`/payments/${id}/approve`);
    return response.data;
  },
  updateStatus: async (id, status) => {
    const response = await api.patch(`/payments/${id}/status`, { status });
    return response.data;
  },
  getPdfUrl: (id) => `${api.defaults.baseURL}/payments/${id}/pdf`,
  generatePDF: async (id) => {
    const response = await api.get(`/payments/${id}/pdf`, { responseType: 'blob' });
    if (!response || !response.data) throw new Error('Réponse vide du serveur');
    return response.data;
  },
};
