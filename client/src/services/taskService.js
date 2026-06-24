// src/services/taskService.js
import api from './api';

export const taskService = {
  getUserTasks: async (assignee) => {
    const response = await api.get('/tasks/user', { params: { assignee } });
    return response.data;
  },

  getTasksByProcess: async (processInstanceId) => {
    const response = await api.get(`/tasks/process/${processInstanceId}`);
    return response.data;
  },

  claimTask: async (taskId, userId) => {
    const response = await api.post(`/tasks/${taskId}/claim`, { userId });
    return response.data;
  },

  /**
   * Complete a Camunda user task and sync the DB.
   *
   * @param {string} taskId
   * @param {object} body - { variables, comment?, taskDefinitionKey?, requisitionId?, estimatedAmount? }
   */
  completeTask: async (taskId, body) => {
    const response = await api.post(`/tasks/${taskId}/complete`, body);
    return response.data;
  },

  getTaskForm: async (taskId) => {
    const response = await api.get(`/tasks/${taskId}/form`);
    return response.data;
  }
};
