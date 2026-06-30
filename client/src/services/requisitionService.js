// src/services/requisitionService.js
import api from './api'

class RequisitionService {
  // Récupérer toutes les réquisitions
  async getAll(params = {}) {
    const response = await api.get('/requisitions', { params })
    return response.data
  }

  async getProcessVariables(processInstanceId) {
    const response = await api.get(`/workflow/process/${processInstanceId}/variables`)
    return response.data
  }
  // Récupérer une réquisition par ID
  async getById(id) {
    const response = await api.get(`/requisitions/${id}`)
    return response.data
  }

  async generatePDF(id) {
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
  }

  // Créer une nouvelle réquisition
  async create(data) {
    const response = await api.post('/requisitions', data)
    return response.data
  }

  // Mettre à jour une réquisition
  async update(id, data) {
    const response = await api.put(`/requisitions/${id}`, data)
    return response.data
  }

  async delete(id) {
    const response = await api.delete(`/requisitions/${id}`)
    return response.data
  }
  // Ajouter l'historique du workflow
  async addWorkflowHistory(data) {
    const response = await api.post('/requisitions/history', data)
    return response.data
  }


  getStatusOptions() {
    return [
      { value: 'all', label: 'Tous les statuts' },
      { value: 'DRAFT', label: 'Brouillon' },
      { value: 'PENDING', label: 'En attente' },
      { value: 'BUDGET_CHECKED', label: 'Budget vérifié' },
      { value: 'APPROVED', label: 'Approuvé' },
      { value: 'REJECTED', label: 'Rejeté' },
      { value: 'IN_PROGRESS', label: 'En cours' },
      { value: 'COMPLETED', label: 'Terminé' },
      { value: 'CANCELLED', label: 'Annulé' },
      { value: 'CLASSIFIED_DIRECT_PURCHASE', label: 'Achat direct', },
      { value: 'CLASSIFIED_MULTIPLE_QUOTATIONS', label: 'Multiples devis', },
      { value: 'CLASSIFIED_RFP', label: "Appel d'offres", },
      { value: 'CLASSIFIED_SOLE_SOURCE', label: 'Source unique', }
    ];
  }

  getStatusOptionLabel = (val) => {
    let list = this.getStatusOptions().filter(op => op.value === val);
    if (list.length) {
      return list[0].label;
    }
    return val;
  }
}
const requisitionService = new RequisitionService();
export default requisitionService; 