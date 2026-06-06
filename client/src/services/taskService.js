// src/services/taskService.js
import api from './api';

export const taskService = {
  // Récupérer les tâches d'un utilisateur par son email
  getUserTasks: async (assignee) => {
    const response = await api.get('/tasks/user', { params: { assignee } });
    return response.data;
  },
  
  // Récupérer les tâches par processus
  getTasksByProcess: async (processInstanceId) => {
    const response = await api.get(`/tasks/process/${processInstanceId}`);
    return response.data;
  },
  
  // Réclamer une tâche (avec email)
  claimTask: async (taskId, userId) => {
    const response = await api.post(`/tasks/${taskId}/claim`, { userId });
    return response.data;
  },
  
  // Compléter une tâche
  completeTask: async (taskId, variables) => {
    const response = await api.post(`/tasks/${taskId}/complete`, { variables });
    return response.data;
  },
  
  // Récupérer le formulaire d'une tâche
  getTaskForm: async (taskId) => {
    const response = await api.get(`/tasks/${taskId}/form`);
    return response.data;
  }
};