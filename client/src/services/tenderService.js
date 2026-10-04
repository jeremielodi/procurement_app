import api from './api';

export const tenderService = {
  getAll: async (params = {}) => {
    const response = await api.get('/tenders', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get(`/tenders/${id}`);
    return response.data;
  },
  getByRequisition: async (requisitionId) => {
    const response = await api.get(`/tenders/by-requisition/${requisitionId}`);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/tenders', data);
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put(`/tenders/${id}`, data);
    return response.data;
  },
  close: async (id) => {
    const response = await api.post(`/tenders/${id}/close`);
    return response.data;
  },
  cancel: async (id) => {
    const response = await api.post(`/tenders/${id}/cancel`);
    return response.data;
  },
  award: async (id, supplierId, comment) => {
    const response = await api.post(`/tenders/${id}/award`, { supplierId, comment });
    return response.data;
  },
  downloadComparison: async (id, tenderNumber) => {
    const response = await api.get(`/tenders/${id}/export/excel`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comparatif_${String(tenderNumber).replace(/[^\w.-]+/g, '_')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }
};
