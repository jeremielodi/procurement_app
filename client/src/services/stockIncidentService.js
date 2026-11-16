// src/services/stockIncidentService.js — rapports d'incident sur les articles détenus (migration 68)
import api from './api';
import { getLang } from '../i18n';

const data = (r) => r.data;

export const stockIncidentService = {
  // scope : mine | toValidate | all (VIEW_STOCK) ; status, type, search, page, limit
  list: (params = {}) => api.get('/stock-incidents', { params }).then(data),
  get: (id) => api.get(`/stock-incidents/${id}`).then(data),
  counts: () => api.get('/stock-incidents/counts').then(data),
  // { holderId? (magasin), incidentType, incidentDate, incidentPlace, circumstances, policeReference, lines: [{ issueLineId, quantity }] }
  create: (payload) => api.post('/stock-incidents', payload, { skipErrorToast: true }).then(data),
  validate: (id, payload) => api.post(`/stock-incidents/${id}/validate`, payload, { skipErrorToast: true }).then(data),
  reject: (id, reason) => api.post(`/stock-incidents/${id}/reject`, { reason }, { skipErrorToast: true }).then(data),
  cancel: (id, reason) => api.post(`/stock-incidents/${id}/cancel`, { reason }, { skipErrorToast: true }).then(data),
  pdf: (id) => api.get(`/stock-incidents/${id}/pdf`, { params: { lang: getLang() }, responseType: 'blob' }).then(data),
};
