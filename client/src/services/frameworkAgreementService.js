// src/services/frameworkAgreementService.js — contrats / accords-cadres (migration 69)
import api from './api';

const data = (r) => r.data;
const quiet = { skipErrorToast: true };

export const frameworkAgreementService = {
  // scope : all (VIEW_FRAMEWORK_AGREEMENTS) | toValidate | involved ; status (séparés par des virgules), supplierId, projectId, search, page
  list: (params = {}) => api.get('/framework-agreements', { params }).then(data),
  counts: () => api.get('/framework-agreements/counts').then(data),
  get: (id) => api.get(`/framework-agreements/${id}`).then(data),
  // Méthode d'achat : contrats utilisables pour la réquisition (actifs, en cours, ouverts au projet, reste > 0)
  usable: (requisitionId) => api.get('/framework-agreements/usable', { params: { requisitionId } }).then(data),
  // Bon de commande : contrat retenu pour la réquisition (null si aucun) + bordereau avec quantités commandées
  forRequisition: (requisitionId) => api.get(`/framework-agreements/by-requisition/${requisitionId}`).then(data),
  // Fournisseur et bordereau repris d'un appel d'offres attribué
  tenderPrefill: (tenderId, supplierId) => api.get('/framework-agreements/tender-prefill', { params: { tenderId, supplierId }, ...quiet }).then(data),
  // { title, description, contractReference, supplierId, tenderId, startDate, endDate, ceilingAmount, currencyId,
  //   allowOffList, projectIds, items: [{ stockItemId, description, unitId, unitPrice, maxQuantity, requisitionItemId }] }
  create: (payload) => api.post('/framework-agreements', payload, quiet).then(data),
  update: (id, payload) => api.put(`/framework-agreements/${id}`, payload, quiet).then(data),
  submit: (id) => api.post(`/framework-agreements/${id}/submit`, {}, quiet).then(data),
  decide: (id, decision, comment) => api.post(`/framework-agreements/${id}/decision`, { decision, comment }, quiet).then(data),
  // action : suspend | reactivate | close | cancel
  changeStatus: (id, action, reason) => api.post(`/framework-agreements/${id}/${action}`, { reason }, quiet).then(data),
};
