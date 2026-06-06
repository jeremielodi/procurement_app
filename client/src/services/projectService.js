// src/services/projectService.js
import api from './api';

export const projectService = {
  getAll: async (params = {}) => {
    const response = await api.get('/projects', { params });
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(`/projects/${id}`);
    return response.data;
  },

  create: async (data) => {
    const response = await api.post('/projects', data);
    return response.data;
  },

  update: async (id, data) => {
    const response = await api.put(`/projects/${id}`, data);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(`/projects/${id}`);
    return response.data;
  },

  getUsers: async () => {
    const response = await api.get('/projects/users');
    return response.data;
  },

  addMember: async (projectId, userId, role) => {
    const response = await api.post('/projects/members', { projectId, userId, role });
    return response.data;
  },

  removeMember: async (projectId, userId) => {
    const response = await api.delete(`/projects/members/${projectId}/${userId}`);
    return response.data;
  },

  getMembers: async (projectId) => {
    const response = await api.get(`/projects/${projectId}/members`);
    return response.data;
  }
};