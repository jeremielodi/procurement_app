// src/services/workflowService.js
import api from './api';

export const workflowService = {
  // Récupérer l'historique d'un processus
  getProcessHistory: async (processInstanceId) => {
    const response = await api.get(`/workflow/process/${processInstanceId}/history`);
    return response.data;
  },
  
  // Récupérer le statut d'un processus
  getProcessStatus: async (processInstanceId) => {
    const response = await api.get(`/workflow/process/${processInstanceId}/status`);
    return response.data;
  },
  
  // Récupérer les tâches d'un processus
  getProcessTasks: async (processInstanceId) => {
    const response = await api.get(`/workflow/process/${processInstanceId}/tasks`);
    return response.data;
  },
  
  // Suspendre un processus
  suspendProcess: async (processInstanceId) => {
    const response = await api.post(`/workflow/process/${processInstanceId}/suspend`);
    return response.data;
  },
  
  // Reprendre un processus
  resumeProcess: async (processInstanceId) => {
    const response = await api.post(`/workflow/process/${processInstanceId}/resume`);
    return response.data;
  },
  
  // Supprimer un processus
  deleteProcess: async (processInstanceId, reason = null) => {
    const response = await api.delete(`/workflow/process/${processInstanceId}`, { data: { reason } });
    return response.data;
  }
};