// src/services/stockService.js — gestion de stock : dépôts, catalogue d'articles, soldes, mouvements
import api from './api';
import { getLang } from '../i18n';

const data = (r) => r.data;

export const warehouseService = {
  // all : y compris inactifs (écran de gestion des dépôts)
  list: (params = {}) => api.get('/warehouses', { params }).then(data),
  // Dépôts où l'utilisateur peut réceptionner (formulaire de bon de réception)
  mine: () => api.get('/warehouses/mine').then(data),
  get: (id) => api.get(`/warehouses/${id}`).then(data),
  create: (payload) => api.post('/warehouses', payload).then(data),
  update: (id, payload) => api.put(`/warehouses/${id}`, payload).then(data),
  setUsers: (id, userIds) => api.put(`/warehouses/${id}/users`, { userIds }).then(data),
};

export const stockItemService = {
  list: (params = {}) => api.get('/stock-items', { params }).then(data),
  // Autocomplétion (réquisition, réception) — ouverte à tous les utilisateurs de l'entreprise
  search: (q, limit = 15) => api.get('/stock-items/search', { params: { q, limit } }).then(data),
  get: (id) => api.get(`/stock-items/${id}`).then(data),
  create: (payload) => api.post('/stock-items', payload).then(data),
  update: (id, payload) => api.put(`/stock-items/${id}`, payload).then(data),
};

export const stockService = {
  summary: () => api.get('/stock/summary').then(data),
  balances: (params = {}) => api.get('/stock/balances', { params }).then(data),
  movements: (params = {}) => api.get('/stock/movements', { params }).then(data),
  exportBalances: (params = {}) =>
    api.get('/stock/balances/export', { params: { ...params, lang: getLang() }, responseType: 'blob' }).then(data),
};

// Suivi des livraisons d'un bon de commande (commandé / reçu / accepté / reste à livrer)
export const deliveryService = {
  get: (poId) => api.get(`/purchase-orders/${poId}/delivery`).then(data),
};

// Sorties de stock vers un utilisateur (bons de sortie)
export const stockIssueService = {
  // mine : bons dont je suis bénéficiaire (sans VIEW_STOCK, le serveur ne renvoie que ceux-là)
  list: (params = {}) => api.get('/stock-issues', { params }).then(data),
  get: (id) => api.get(`/stock-issues/${id}`).then(data),
  recipients: (q) => api.get('/stock-issues/recipients', { params: { q } }).then(data),
  // Dépôts (transfert) et départements actifs de l'entreprise
  destinations: () => api.get('/stock-issues/destinations').then(data),
  // Erreurs métier (stock insuffisant, dépôt…) affichées par le formulaire
  create: (payload) => api.post('/stock-issues', payload, { skipErrorToast: true }).then(data),
  acknowledge: (id, comment) => api.post(`/stock-issues/${id}/acknowledge`, { comment }).then(data),
  cancel: (id, reason) => api.post(`/stock-issues/${id}/cancel`, { reason }).then(data),
  pdf: (id) => api.get(`/stock-issues/${id}/pdf`, { params: { lang: getLang() }, responseType: 'blob' }).then(data),
};

// Équipements suivis par n° de série (ordinateurs…), détentions et retours en stock
export const equipmentService = {
  units: (params = {}) => api.get('/stock-units', { params }).then(data),
  unit: (id) => api.get(`/stock-units/${id}`).then(data),
  // Parc existant : { stockItemId, warehouseId, units: [{ serialNumber, assetTag }] }
  register: (payload) => api.post('/stock-units/register', payload, { skipErrorToast: true }).then(data),
  updateUnit: (id, payload) => api.put(`/stock-units/${id}`, payload).then(data),
  // { data: lignes détenues, user: { id, first_name, last_name, email, is_active } }
  holdings: (userId) => api.get('/stock-holdings', { params: { userId } }).then(data),
  departmentHoldings: (departmentId) => api.get('/stock-holdings', { params: { departmentId } }).then(data),
  myHoldings: () => api.get('/stock-holdings/mine').then(data),
};

export const stockReturnService = {
  list: (params = {}) => api.get('/stock-returns', { params }).then(data),
  get: (id) => api.get(`/stock-returns/${id}`).then(data),
  create: (payload) => api.post('/stock-returns', payload, { skipErrorToast: true }).then(data),
};
