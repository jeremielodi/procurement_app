import api from './api';
import { getLang } from '../i18n';

export const grnService = {
  getAll: async (params = {}) => {
    const response = await api.get('/goods-receipts', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get(`/goods-receipts/${id}`);
    return response.data;
  },
  getByPO: async (poId) => {
    const response = await api.get(`/purchase-orders/${poId}/goods-receipts`);
    return response.data;
  },
  // Erreurs métier (sur-livraison, dépôt, lot…) affichées par le formulaire : pas de toast automatique
  create: async (data) => {
    const response = await api.post('/goods-receipts', data, { skipErrorToast: true });
    return response.data;
  },
  // Annulation : écritures de stock inverses (refusée si le stock reçu a déjà été sorti)
  cancel: async (id, reason) => {
    const response = await api.post(`/goods-receipts/${id}/cancel`, { reason }, { skipErrorToast: true });
    return response.data;
  },
  getPDF: async (id) => {
    const response = await api.get(`/goods-receipts/${id}/pdf`, { params: { lang: getLang() }, responseType: 'blob' });
    return response.data;
  },
  // Téléchargement direct (sans aperçu)
  downloadPDF: async (id, grnNumber) => {
    const response = await api.get(`/goods-receipts/${id}/pdf`, { params: { lang: getLang() }, responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${grnNumber || 'GRN'}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  updateStatus: async (id, status) => {
    const response = await api.patch(`/goods-receipts/${id}/status`, { status });
    return response.data;
  }
};
