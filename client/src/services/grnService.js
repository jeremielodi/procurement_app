import api from './api';

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
  create: async (data) => {
    const response = await api.post('/goods-receipts', data);
    return response.data;
  },
  getPDF: async (id) => {
    const response = await api.get(`/goods-receipts/${id}/pdf`, { responseType: 'blob' });
    return response.data;
  },
  // Téléchargement direct (sans aperçu)
  downloadPDF: async (id, grnNumber) => {
    const response = await api.get(`/goods-receipts/${id}/pdf`, { responseType: 'blob' });
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
