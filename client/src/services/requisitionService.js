// src/services/requisitionService.js
import api from './api'

export const requisitionService = {
  // Récupérer toutes les réquisitions
  getAll: async (params = {}) => {
    const response = await api.get('/requisitions', { params })
    return response.data
  },

  // Récupérer une réquisition par ID
  getById: async (id) => {
    const response = await api.get(`/requisitions/${id}`)
    return response.data
  },

    generatePDF: async (id) => {
    try {
      const response = await api.get(`requisitions/${id}/export/pdf`, {
        responseType: 'blob'
      });
      
      // Vérification supplémentaire
      if (!response || !response.data) {
        throw new Error('Réponse vide du serveur');
      }
      
      // Si c'est déjà un blob, le retourner
      if (response.data instanceof Blob) {
        // Vérifier que ce n'est pas un blob d'erreur JSON
        if (response.data.type === 'application/json') {
          const text = await response.data.text();
          try {
            const error = JSON.parse(text);
            throw new Error(error.message || 'Erreur serveur');
          } catch (e) {
            throw new Error('Erreur lors de la génération du PDF');
          }
        }
        return response.data;
      }
      
      // Si c'est un ArrayBuffer, le convertir en blob
      if (response.data instanceof ArrayBuffer) {
        return new Blob([response.data], { type: 'application/pdf' });
      }
      
      throw new Error('Format de réponse inattendu');
      
    } catch (error) {
      console.error('PDF generation error:', error);
      throw error;
    }
  },

  // Créer une nouvelle réquisition
  create: async (data) => {
    const response = await api.post('/requisitions', data)
    return response.data
  },

  // Mettre à jour une réquisition
  update: async (id, data) => {
    const response = await api.put(`/requisitions/${id}`, data)
    return response.data
  },

  delete: async (id) => {
    const response = await api.delete(`/requisitions/${id}`)
    return response.data
  },
  // Ajouter l'historique du workflow
  addWorkflowHistory: async (data) => {
    const response = await api.post('/requisitions/history', data)
    return response.data
  },
}