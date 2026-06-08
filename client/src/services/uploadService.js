// src/services/uploadService.js
import api from './api';

export const uploadService = {
  // Upload d'un fichier
  uploadFile: async (file, entityType, entityId) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entity_type', entityType);
    formData.append('entity_id', entityId);
    
    const response = await api.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Upload multiple fichiers
  uploadMultipleFiles: async (files, entityType, entityId) => {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });
    formData.append('entity_type', entityType);
    formData.append('entity_id', entityId);
    
    const response = await api.post('/upload/multiple', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Récupérer les fichiers d'une entité
  getFiles: async (entityType, entityId) => {
    const response = await api.get(`/upload/${entityType}/${entityId}`);
    return response.data;
  },

  // Supprimer un fichier
  deleteFile: async (fileId) => {
    const response = await api.delete(`/upload/${fileId}`);
    return response.data;
  },


    // Télécharger un fichier (avec authentification)
  downloadFile: async (fileId) => {
    const response = await api.get(`/upload/download/file/${fileId}`, {
      responseType: 'blob'
    });
    return response.data;
  }
};