import api from './api';
import { getLang } from '../i18n';

export const supplierLogoUrl = (supplier) =>
  supplier?.logo_path ? `/api/public/suppliers/${supplier.id}/logo?v=${encodeURIComponent(supplier.logo_path)}` : null;

export const supplierPortalService = {
  // Public : multipart (logo optionnel)
  register: async (formData) => {
    const response = await api.post('/auth/register-supplier', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },
  getDashboard: async () => {
    const response = await api.get('/supplier-portal/dashboard');
    return response.data;
  },
  getMe: async () => {
    const response = await api.get('/supplier-portal/me');
    return response.data;
  },
  updateMe: async (formData) => {
    const response = await api.put('/supplier-portal/me', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },
  getMyDocumentBlob: async (documentId) => {
    const response = await api.get(`/supplier-portal/me/documents/${documentId}/file`, { responseType: 'blob' });
    return response.data;
  },
  getTenders: async () => {
    const response = await api.get('/supplier-portal/tenders');
    return response.data;
  },
  // Bons de commande reçus : liste (status=TO_CONFIRM : à confirmer), détail, PDF, confirmation / refus
  getOrders: async (params = {}) => {
    const response = await api.get('/supplier-portal/orders', { params });
    return response.data;
  },
  getOrder: async (id) => {
    const response = await api.get(`/supplier-portal/orders/${id}`);
    return response.data;
  },
  getOrderPdf: async (id) => {
    const response = await api.get(`/supplier-portal/orders/${id}/pdf`, { params: { lang: getLang() }, responseType: 'blob' });
    return response.data;
  },
  confirmOrder: async (id, payload) => {
    const response = await api.post(`/supplier-portal/orders/${id}/confirm`, payload, { skipErrorToast: true });
    return response.data;
  },
  declineOrder: async (id, comment) => {
    const response = await api.post(`/supplier-portal/orders/${id}/decline`, { comment }, { skipErrorToast: true });
    return response.data;
  },
  getTender: async (id) => {
    const response = await api.get(`/supplier-portal/tenders/${id}`);
    return response.data;
  },
  submit: async (id, data) => {
    const response = await api.put(`/supplier-portal/tenders/${id}/submission`, data);
    return response.data;
  },
  getSubmissionPdf: async (id) => {
    const response = await api.get(`/supplier-portal/tenders/${id}/submission/pdf`, { params: { lang: getLang() }, responseType: 'blob' });
    return response.data;
  }
};
