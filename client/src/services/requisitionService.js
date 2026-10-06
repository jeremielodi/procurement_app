// src/services/requisitionService.js
import api from './api'
import { t, getLang } from '../i18n'

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

  // lang : 'fr' ou 'en' — langue du document (défaut : langue de l'interface)
  async generatePDF(id, lang = getLang()) {
    try {
      const response = await api.get(`requisitions/${id}/export/pdf`, {
        params: { lang },
        responseType: 'blob'
      });

      // Vérification supplémentaire
      if (!response || !response.data) {
        throw new Error(t('services.emptyResponse'));
      }

      // Si c'est déjà un blob, le retourner
      if (response.data instanceof Blob) {
        // Vérifier que ce n'est pas un blob d'erreur JSON
        if (response.data.type === 'application/json') {
          const text = await response.data.text();
          try {
            const error = JSON.parse(text);
            throw new Error(error.message || t('services.serverError'));
          } catch (e) {
            throw new Error(t('services.pdfError'));
          }
        }
        return response.data;
      }

      // Si c'est un ArrayBuffer, le convertir en blob
      if (response.data instanceof ArrayBuffer) {
        return new Blob([response.data], { type: 'application/pdf' });
      }

      throw new Error(t('services.unexpectedFormat'));

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
  // Suivi lisible du workflow (étapes + historique)
  async getTimeline(id) {
    const response = await api.get(`/requisitions/${id}/timeline`)
    return response.data
  }

  // Import d'articles depuis Excel/CSV → aperçu { items, errors }
  async importItems(file) {
    const fd = new FormData()
    fd.append('file', file)
    const response = await api.post('/requisitions/import-items', fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    return response.data
  }

  // Ajouter l'historique du workflow
  async addWorkflowHistory(data) {
    const response = await api.post('/requisitions/history', data)
    return response.data
  }


  getStatusOptions() {
    return [
      { value: 'all', label: t('requisitions.allStatuses') },
      ...['DRAFT', 'PENDING', 'BUDGET_CHECKED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
        'CLASSIFIED_DIRECT_PURCHASE', 'CLASSIFIED_MULTIPLE_QUOTATIONS', 'CLASSIFIED_RFP', 'CLASSIFIED_SOLE_SOURCE']
        .map(value => ({ value, label: t(`requisitionStatus.${value}`) }))
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