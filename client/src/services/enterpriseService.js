// src/services/enterpriseService.js — entreprises clientes de procureApp
import api from './api';

// Formulaire (avec logo optionnel) → multipart
function toFormData(data, logo) {
  const fd = new FormData();
  Object.entries(data).forEach(([k, v]) => {
    if (v !== undefined && v !== null) fd.append(k, v);
  });
  if (logo) fd.append('logo', logo);
  return fd;
}
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

export const enterpriseService = {
  // Super admin : toutes les entreprises ; utilisateur : la sienne (tableau d'un élément)
  getAll: async (params = {}) => {
    const response = await api.get('/enterprises', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get(`/enterprises/${id}`);
    return response.data;
  },
  // Entreprise de l'utilisateur connecté
  getCurrent: async () => {
    const response = await api.get('/enterprises/current');
    return response.data;
  },
  updateCurrent: async (data, logo) => {
    const response = await api.put('/enterprises/current', toFormData(data, logo), multipart);
    return response.data;
  },
  // --- Super admin ---
  create: async (data, logo) => {
    const response = await api.post('/enterprises', toFormData(data, logo), multipart);
    return response.data;
  },
  update: async (id, data, logo) => {
    const response = await api.put(`/enterprises/${id}`, toFormData(data, logo), multipart);
    return response.data;
  },
  setActive: async (id, isActive) => {
    const response = await api.patch(`/enterprises/${id}/active`, { isActive });
    return response.data;
  },
  delete: async (id) => {
    const response = await api.delete(`/enterprises/${id}`);
    return response.data;
  },
  addAdmin: async (id, admin) => {
    const response = await api.post(`/enterprises/${id}/admins`, admin);
    return response.data;
  },
};

export default enterpriseService;
