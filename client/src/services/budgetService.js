// src/services/budgetService.js
import api from './api';
import { getLang } from '../i18n';

export const budgetService = {
    getAll: async (params = {}) => {
        const response = await api.get('/budget', { params });
        return response.data;
    },

    getById: async (id) => {
        const response = await api.get(`/budget/${id}`);
        return response.data;
    },

    create: async (data) => {
        const response = await api.post('/budget', data);
        return response.data;
    },

    update: async (id, data) => {
        const response = await api.put(`/budget/${id}`, data);
        return response.data;
    },

    delete: async (id) => {
        const response = await api.delete(`/budget/${id}`);
        return response.data;
    },

    addExpense: async (data) => {
        const response = await api.post('/budget/expenses', data);
        return response.data;
    },

    getSummary: async () => {
        const response = await api.get('/budget/summary');
        return response.data;
    },

    getByProject: async (projectId) => {
        const response = await api.get('/budget', { params: { projectId } });
        return response.data;
    },

    /** Registre paginé : { data, pagination, totals } (page, limit, search, fundingSource, projectId, withoutProject, status, sort, order) */
    getRegister: async (params = {}) => {
        const response = await api.get('/budget', { params: { page: 1, ...params } });
        return response.data;
    },

    getFundingSources: async () => {
        const response = await api.get('/budget/funding-sources');
        return response.data;
    },

    /** Export Excel du registre (mêmes filtres que la liste), réimportable */
    exportRegister: async (params = {}) => {
        const response = await api.get('/budget/export', { params: { ...params, lang: getLang() }, responseType: 'blob' });
        return response.data;
    },

    // Import Excel / CSV : modèle (xlsx | csv, langue de l'interface), aperçu puis confirmation (même fichier)
    importTemplate: async (format = 'xlsx') => {
        const response = await api.get('/budget/import/template', { params: { format, lang: getLang() }, responseType: 'blob' });
        return response.data;
    },

    importFile: async (file, { confirm = false } = {}) => {
        const fd = new FormData();
        fd.append('file', file);
        if (confirm) fd.append('confirm', '1');
        const response = await api.post('/budget/import', fd, { headers: { 'Content-Type': 'multipart/form-data' }, skipErrorToast: true });
        return response.data;
    },

    search: async (filters) => {
        const response = await api.get('/budget/search', { params: filters });
        return response.data;
    }
};