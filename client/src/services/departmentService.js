// src/services/departmentService.js
import api from './api';

export const departmentService = {
  getAll: async (params = {}) => {
    const response = await api.get('/departments', { params });
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(`/departments/${id}`);
    return response.data;
  },

  create: async (data) => {
    const response = await api.post('/departments', data);
    return response.data;
  },

  update: async (id, data) => {
    const response = await api.put(`/departments/${id}`, data);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(`/departments/${id}`);
    return response.data;
  },

  getUsers: async () => {
    const response = await api.get('/departments/users');
    return response.data;
  }
};