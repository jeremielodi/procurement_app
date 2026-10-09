import api from './api';
import { t, getLang } from '../i18n';

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
    const response = await api.post('/payments', data, { skipErrorToast: true }); // erreurs affichées par le formulaire
    return response.data;
  },
  approve: async (id) => {
    // Erreurs métier (séparation des tâches, coordonnées bancaires) affichées par la fiche
    const response = await api.post(`/payments/${id}/approve`, {}, { skipErrorToast: true });
    return response.data;
  },
  updateStatus: async (id, status) => {
    const response = await api.patch(`/payments/${id}/status`, { status });
    return response.data;
  },
  getPdfUrl: (id) => `${api.defaults.baseURL}/payments/${id}/pdf?lang=${getLang()}`,
  generatePDF: async (id) => {
    const response = await api.get(`/payments/${id}/pdf`, { params: { lang: getLang() }, responseType: 'blob' });
    if (!response || !response.data) throw new Error(t('services.emptyResponse'));
    return response.data;
  },
};
