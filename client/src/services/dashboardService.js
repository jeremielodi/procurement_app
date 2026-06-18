// src/services/dashboardService.js
import apiClient from './api';

export const dashboardService = {
  /**
   * Récupérer toutes les données du tableau de bord
   */
  async getDashboardData(period = 'month') {
    const response = await apiClient.get('/dashboard', {
      params: { period }
    });
    return response.data;
  },

  /**
   * Récupérer les statistiques globales
   */
  async getStats() {
    const response = await apiClient.get('/dashboard/stats');
    return response.data;
  },

  /**
   * Récupérer les données des graphiques
   */
  async getChartData(period = 'month') {
    const response = await apiClient.get('/dashboard/charts', {
      params: { period }
    });
    return response.data;
  },

  /**
   * Récupérer les réquisitions récentes
   */
  async getRecentRequisitions(limit = 10) {
    const response = await apiClient.get('/dashboard/recent-requisitions', {
      params: { limit }
    });
    return response.data;
  },

  /**
   * Récupérer les activités récentes
   */
  async getRecentActivities(limit = 10) {
    const response = await apiClient.get('/dashboard/recent-activities', {
      params: { limit }
    });
    return response.data;
  },

  /**
   * Récupérer les KPI
   */
  async getKPIs() {
    const response = await apiClient.get('/dashboard/kpis');
    return response.data;
  },

  /**
   * Récupérer les alertes
   */
  async getAlerts() {
    const response = await apiClient.get('/dashboard/alerts');
    return response.data;
  },

  /**
   * Récupérer le résumé par département
   */
  async getDepartmentSummary() {
    const response = await apiClient.get('/dashboard/department-summary');
    return response.data;
  },

  /**
   * Récupérer le résumé par fournisseur
   */
  async getSupplierSummary() {
    const response = await apiClient.get('/dashboard/supplier-summary');
    return response.data;
  },

  /**
   * Récupérer les statistiques par projet
   */
  async getProjectStats() {
    const response = await apiClient.get('/dashboard/project-stats');
    return response.data;
  },

  /**
   * Exporter les données du tableau de bord
   */
  async exportDashboardData(format = 'json') {
    const response = await apiClient.get('/dashboard/export', {
      params: { format },
      responseType: format === 'csv' ? 'blob' : 'json'
    });
    return response.data;
  }
};