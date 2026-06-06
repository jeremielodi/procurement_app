// src/services/budgetService.js
import api from './api';

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

    search: async (filters) => {
        const response = await api.get('/budget/search', { params: filters });
        return response.data;
    }
};