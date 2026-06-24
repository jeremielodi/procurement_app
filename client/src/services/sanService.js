import api from './api';

export const sanService = {
  getAll: async (params = {}) => {
    const response = await api.get('/service-acceptance-notes', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get(`/service-acceptance-notes/${id}`);
    return response.data;
  },
  getByPO: async (poId) => {
    const response = await api.get(`/purchase-orders/${poId}/service-acceptance-notes`);
    return response.data;
  },
  create: async (data) => {
    const response = await api.post('/service-acceptance-notes', data);
    return response.data;
  },
};
