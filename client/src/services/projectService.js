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

  // profileIds absent : tous ses profils de workflow sont activés sur le projet
  addMember: async (projectId, userId, role, profileIds) => {
    const response = await api.post('/projects/members', { projectId, userId, role, profileIds }, { skipErrorToast: true });
    return response.data;
  },

  // Profils de workflow (BPMN) exercés par un membre sur ce projet
  setMemberProfiles: async (projectId, userId, profileIds) => {
    const response = await api.put(`/projects/${projectId}/members/${userId}/profiles`, { profileIds }, { skipErrorToast: true });
    return response.data;
  },

  removeMember: async (projectId, userId) => {
    const response = await api.delete(`/projects/members/${projectId}/${userId}`);
    return response.data;
  },

  // Seuils d'approbation effectifs (projet, sinon entreprise, sinon défaut)
  getApprovalPolicy: async (projectId) => (await api.get(`/projects/${projectId}/approval-policy`)).data,

  getMembers: async (projectId) => {
    const response = await api.get(`/projects/${projectId}/members`);
    return response.data;
  }
};