// src/services/currencyService.js
import api from './api';

export const currencyService = {
  /**
   * Récupérer toutes les devises
   * GET /api/currencies
   */
  getAll: async () => {
    const response = await api.get('/currencies');
    return response.data;
  },

  /**
   * Récupérer les devises actives (utilisées)
   * GET /api/currencies/active
   */
  getActive: async () => {
    const response = await api.get('/currencies/active');
    return response.data;
  },

  /**
   * Récupérer la devise par défaut (USD)
   * GET /api/currencies/default
   */
  getDefault: async () => {
    const response = await api.get('/currencies/default');
    return response.data;
  },

  /**
   * Récupérer une devise par son ID
   * GET /api/currencies/:id
   */
  getById: async (id) => {
    const response = await api.get(`/currencies/${id}`);
    return response.data;
  },

  /**
   * Récupérer une devise par son code (format_key)
   * GET /api/currencies/code/:code
   */
  getByCode: async (code) => {
    const response = await api.get(`/currencies/code/${code}`);
    return response.data;
  },

  /**
   * Créer une nouvelle devise
   * POST /api/currencies
   */
  create: async (data) => {
    const response = await api.post('/currencies', data);
    return response.data;
  },

  /**
   * Mettre à jour une devise
   * PUT /api/currencies/:id
   */
  update: async (id, data) => {
    const response = await api.put(`/currencies/${id}`, data);
    return response.data;
  },

  /**
   * Supprimer une devise
   * DELETE /api/currencies/:id
   */
  delete: async (id) => {
    const response = await api.delete(`/currencies/${id}`);
    return response.data;
  },

  /**
   * Formater un montant selon une devise (côté frontend)
   */
  formatAmount: (value, currencyCode, locale = 'fr-FR') => {
    if (value === null || value === undefined || isNaN(value)) {
      return '-';
    }

    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
    } catch (error) {
      console.error('Error formatting amount:', error);
      return `${Number(value).toFixed(2)} ${currencyCode || 'USD'}`;
    }
  },

  /**
   * Obtenir le symbole d'une devise
   */
  getSymbol: async (currencyId) => {
    try {
      let currency;
      if (typeof currencyId === 'string') {
        const response = await api.get(`/currencies/code/${currencyId}`);
        currency = response.data.data;
      } else {
        const response = await api.get(`/currencies/${currencyId}`);
        currency = response.data.data;
      }
      return currency?.symbol || currencyId || '$';
    } catch (error) {
      console.error('Error getting currency symbol:', error);
      return '$';
    }
  },

  /**
   * Vérifier si une devise est utilisée
   * GET /api/currencies/:id/used
   */
  isUsed: async (id) => {
    const response = await api.get(`/currencies/${id}/used`);
    return response.data;
  }
};

export default currencyService;