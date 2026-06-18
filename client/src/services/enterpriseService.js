// src/services/enterpriseService.js
import api from './api';

export const enterpriseService = {
  /**
   * Récupérer toutes les entreprises
   */
  getAll: async (params = {}) => {
    const response = await api.get('/enterprises', { params });
    return response.data;
  },

  /**
   * Récupérer une entreprise par UUID
   */
  getById: async (uuid) => {
    const response = await api.get(`/enterprises/${uuid}`);
    return response.data;
  },

  /**
   * Récupérer une entreprise par code
   */
  getByCode: async (code) => {
    const response = await api.get(`/enterprises/code/${code}`);
    return response.data;
  },

  /**
   * Récupérer l'entreprise par défaut
   */
  getDefault: async () => {
    const response = await api.get('/enterprises/default');
    return response.data;
  },

  /**
   * Créer une entreprise
   */
  create: async (data) => {
    const response = await api.post('/enterprises', data);
    return response.data;
  },

  /**
   * Mettre à jour une entreprise
   */
  update: async (uuid, data) => {
    const response = await api.put(`/enterprises/${uuid}`, data);
    return response.data;
  },

  /**
   * Supprimer une entreprise
   */
  delete: async (uuid) => {
    const response = await api.delete(`/enterprises/${uuid}`);
    return response.data;
  }
};