// backend/src/controllers/DashboardController.js
const dashboardModel = require('../models/DashboardModel');

class DashboardController {
  /**
   * Récupérer les statistiques globales
   */
  async getStats(req, res) {
    try {
      const stats = await dashboardModel.getStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting dashboard stats:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des statistiques',
        error: error.message
      });
    }
  }

  /**
   * Récupérer les données pour les graphiques
   */
  async getChartData(req, res) {
    try {
      const { period = 'month' } = req.query;
      
      // Valider la période
      const validPeriods = ['week', 'month', 'year'];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({
          success: false,
          message: 'Période invalide. Utilisez week, month ou year'
        });
      }
      
      const chartData = await dashboardModel.getChartData(period);
      
      res.json({
        success: true,
        data: chartData,
        period: period
      });
    } catch (error) {
      console.error('Error getting chart data:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données des graphiques',
        error: error.message
      });
    }
  }

  /**
   * Récupérer les réquisitions récentes
   */
  async getRecentRequisitions(req, res) {
    try {
      const { limit = 10 } = req.query;
      const recentRequisitions = await dashboardModel.getRecentRequisitions(parseInt(limit));
      
      res.json({
        success: true,
        data: recentRequisitions,
        limit: parseInt(limit)
      });
    } catch (error) {
      console.error('Error getting recent requisitions:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des réquisitions récentes',
        error: error.message
      });
    }
  }

  /**
   * Récupérer les activités récentes
   */
  async getRecentActivities(req, res) {
    try {
      const { limit = 10 } = req.query;
      const recentActivities = await dashboardModel.getRecentActivities(parseInt(limit));
      
      res.json({
        success: true,
        data: recentActivities,
        limit: parseInt(limit)
      });
    } catch (error) {
      console.error('Error getting recent activities:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des activités récentes',
        error: error.message
      });
    }
  }

  /**
   * Récupérer le résumé par département
   */
  async getDepartmentSummary(req, res) {
    try {
      const summary = await dashboardModel.getDepartmentSummary();
      
      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      console.error('Error getting department summary:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération du résumé par département',
        error: error.message
      });
    }
  }

  /**
   * Récupérer le résumé par fournisseur
   */
  async getSupplierSummary(req, res) {
    try {
      const summary = await dashboardModel.getSupplierSummary();
      
      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      console.error('Error getting supplier summary:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération du résumé par fournisseur',
        error: error.message
      });
    }
  }

  /**
   * Récupérer les KPI
   */
  async getKPIs(req, res) {
    try {
      const kpis = await dashboardModel.getKPIs();
      
      res.json({
        success: true,
        data: kpis
      });
    } catch (error) {
      console.error('Error getting KPIs:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des KPI',
        error: error.message
      });
    }
  }
}

module.exports = new DashboardController();