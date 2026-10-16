import api from './api';
import { getLang } from '../i18n';

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
  },
  // PDF dans la langue de l'interface
  getPDF: async (id) => {
    const response = await api.get(`/invoices/${id}/pdf`, { params: { lang: getLang() }, responseType: 'blob' });
    return response.data;
  },
  // Téléchargement direct (sans aperçu)
  downloadPDF: async (id, invoiceNumber) => {
    const blob = await invoiceService.getPDF(id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoiceNumber || 'INV'}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
