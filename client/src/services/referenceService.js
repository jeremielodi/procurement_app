// src/services/referenceService.js — localisations et catégories de marché (référentiels de la plateforme)
import api from './api';

const crud = (path) => ({
  // ?all=1 : y compris inactives (écran d'administration)
  list: async (all = false) => (await api.get(`/${path}`, { params: all ? { all: 1 } : {} })).data,
  // Version publique (inscription fournisseur, portail fournisseur) : actives uniquement
  listPublic: async () => (await api.get(`/public/${path}`)).data,
  create: async (data) => (await api.post(`/${path}`, data)).data,
  update: async (id, data) => (await api.put(`/${path}/${id}`, data)).data,
  remove: async (id) => (await api.delete(`/${path}/${id}`)).data,
});

export const locationService = crud('locations');
export const categoryService = crud('market-categories');
