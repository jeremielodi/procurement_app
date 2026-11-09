// src/services/stockRequestService.js — demandes internes au magasin (migration 56)
import api from './api';

const data = (r) => r.data;

export const stockRequestService = {
  // scope : mine | toValidate | toServe | all (VIEW_STOCK) ; status, warehouseId, search, page, limit
  list: (params = {}) => api.get('/stock-requests', { params }).then(data),
  get: (id) => api.get(`/stock-requests/${id}`).then(data),
  counts: () => api.get('/stock-requests/counts').then(data),
  // Dépôts, départements, projets ; validation exigée par l'entreprise
  options: () => api.get('/stock-requests/options').then(data),
  // Articles stockables avec la quantité disponible dans le dépôt
  items: (warehouseId, q) => api.get('/stock-requests/items', { params: { warehouseId, q } }).then(data),
  create: (payload) => api.post('/stock-requests', payload, { skipErrorToast: true }).then(data),
  validate: (id, payload) => api.post(`/stock-requests/${id}/validate`, payload, { skipErrorToast: true }).then(data),
  reject: (id, reason) => api.post(`/stock-requests/${id}/reject`, { reason }, { skipErrorToast: true }).then(data),
  cancel: (id, reason) => api.post(`/stock-requests/${id}/cancel`, { reason }, { skipErrorToast: true }).then(data),
  close: (id, reason) => api.post(`/stock-requests/${id}/close`, { reason }, { skipErrorToast: true }).then(data),
  // Option de l'entreprise (« Mon entreprise ») : validation exigée
  getSettings: () => api.get('/enterprises/current/stock-requests').then(data),
  setSettings: (validationRequired) => api.put('/enterprises/current/stock-requests', { validationRequired }).then(data),
};
