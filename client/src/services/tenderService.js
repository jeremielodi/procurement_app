import api from './api';

export const tenderService = {
  getAll: async (params = {}) => {
    const response = await api.get('/tenders', { params });
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get(`/tenders/${id}`);
    return response.data;
  },
  // Nombre de fournisseurs qui verront l'AO selon sa diffusion
  eligibleCount: async ({ audience, categoryId, locationId }) => {
    const response = await api.get('/tenders/eligible-count', {
      params: { audience, ...(categoryId ? { categoryId } : {}), ...(locationId ? { locationId } : {}) },
    });
    return response.data;
  },
  // Préqualifiés invitables pour un AO réservé
  getCandidates: async ({ categoryId, locationId }) => {
    const response = await api.get('/tenders/candidates', { params: { categoryId, ...(locationId ? { locationId } : {}) } });
    return response.data;
  },
  getByRequisition: async (requisitionId) => {
    const response = await api.get(`/tenders/by-requisition/${requisitionId}`);
    return response.data;
  },
  // Erreurs (questions : code + n° de question) traduites par l'écran
  create: async (data) => {
    const response = await api.post('/tenders', data, { skipErrorToast: true });
    return response.data;
  },
  update: async (id, data) => {
    const response = await api.put(`/tenders/${id}`, data, { skipErrorToast: true });
    return response.data;
  },
  close: async (id) => {
    const response = await api.post(`/tenders/${id}/close`);
    return response.data;
  },
  cancel: async (id) => {
    const response = await api.post(`/tenders/${id}/cancel`);
    return response.data;
  },
  award: async (id, supplierId, comment) => {
    const response = await api.post(`/tenders/${id}/award`, { supplierId, comment });
    return response.data;
  },
  // AO « par article » : items = [{ requisitionItemId, supplierId }] (erreurs traduites par l'écran)
  awardPerItem: async (id, items, comment) => {
    const response = await api.post(`/tenders/${id}/award`, { items, comment }, { skipErrorToast: true });
    return response.data;
  },
  // Bibliothèque de questions aux fournisseurs (erreurs traduites par l'écran)
  getQuestionTemplates: async (all = false) => {
    const response = await api.get('/tender-question-templates', { params: all ? { all: 1 } : {} });
    return response.data;
  },
  createQuestionTemplate: async (data) => {
    const response = await api.post('/tender-question-templates', data, { skipErrorToast: true });
    return response.data;
  },
  updateQuestionTemplate: async (id, data) => {
    const response = await api.put(`/tender-question-templates/${id}`, data, { skipErrorToast: true });
    return response.data;
  },
  deleteQuestionTemplate: async (id) => {
    const response = await api.delete(`/tender-question-templates/${id}`);
    return response.data;
  },
  // Document joint par un fournisseur à une réponse (après la clôture)
  getAnswerFile: async (id, fileId) => {
    const response = await api.get(`/tenders/${id}/answer-files/${fileId}`, { responseType: 'blob' });
    return response.data;
  },
  downloadComparison: async (id, tenderNumber) => {
    const response = await api.get(`/tenders/${id}/export/excel`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comparatif_${String(tenderNumber).replace(/[^\w.-]+/g, '_')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }
};
