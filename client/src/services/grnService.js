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
  updateStatus: async (id, status) => {
    const response = await api.patch(`/goods-receipts/${id}/status`, { status });
    return response.data;
  }
};
