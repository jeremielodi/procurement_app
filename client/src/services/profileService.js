// src/services/profileService.js
import api from './api';

export const profileService = {
  getAll: async () => {
    const response = await api.get('/profiles');
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(`/profiles/${id}`);
    return response.data;
  },

  create: async (data) => {
    const response = await api.post('/profiles', data);
    return response.data;
  },

  update: async (id, data) => {
    const response = await api.put(`/profiles/${id}`, data);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(`/profiles/${id}`);
    return response.data;
  },

  getPermissions: async () => {
    const response = await api.get('/profiles/permissions');
    return response.data;
  },

  assignPermission: async (profileId, permissionId) => {
    const response = await api.post(`/profiles/${profileId}/permissions/${permissionId}`);
    return response.data;
  },

  removePermission: async (profileId, permissionId) => {
    const response = await api.delete(`/profiles/${profileId}/permissions/${permissionId}`);
    return response.data;
  },

  getProfilePermissions: async (profileId) => {
    const response = await api.get(`/profiles/${profileId}/permissions`);
    return response.data;
  }
};