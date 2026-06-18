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

  /**
   * Récupérer les alertes
   */
  async getAlerts(req, res) {
    try {
      const alerts = await dashboardModel.getAlerts();
      
      res.json({
        success: true,
        data: alerts
      });
    } catch (error) {
      console.error('Error getting alerts:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des alertes',
        error: error.message
      });
    }
  }

  /**
   * Récupérer les statistiques par projet
   */
  async getProjectStats(req, res) {
    try {
      const stats = await dashboardModel.getProjectStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting project stats:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des statistiques par projet',
        error: error.message
      });
    }
  }

  /**
   * Récupérer toutes les données du tableau de bord en une seule requête
   */
  async getDashboardData(req, res) {
    try {
      const { period = 'month' } = req.query;
      
      // Récupérer toutes les données en parallèle
      const [
        stats,
        chartData,
        recentRequisitions,
        recentActivities,
        kpis,
        alerts,
        departmentSummary,
        supplierSummary,
        projectStats
      ] = await Promise.all([
        dashboardModel.getStats(),
        dashboardModel.getChartData(period),
        dashboardModel.getRecentRequisitions(10),
        dashboardModel.getRecentActivities(10),
        dashboardModel.getKPIs(),
        dashboardModel.getAlerts(),
        dashboardModel.getDepartmentSummary(),
        dashboardModel.getSupplierSummary(),
        dashboardModel.getProjectStats()
      ]);
      
      res.json({
        success: true,
        data: {
          stats,
          chartData,
          recentRequisitions,
          recentActivities,
          kpis,
          alerts,
          departmentSummary,
          supplierSummary,
          projectStats,
          period
        }
      });
    } catch (error) {
      console.error('Error getting dashboard data:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données du tableau de bord',
        error: error.message
      });
    }
  }

  /**
   * Exporter les données du tableau de bord
   */
  async exportDashboardData(req, res) {
    try {
      const { format = 'json' } = req.query;
      
      const data = await dashboardModel.getChartData('year');
      
      if (format === 'json') {
        res.json({
          success: true,
          data: data
        });
      } else if (format === 'csv') {
        // Convertir les données en CSV
        const csvData = this.convertToCSV(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=dashboard-export-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csvData);
      } else {
        res.status(400).json({
          success: false,
          message: 'Format non supporté. Utilisez json ou csv'
        });
      }
    } catch (error) {
      console.error('Error exporting dashboard data:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'exportation des données',
        error: error.message
      });
    }
  }

  /**
   * Convertir les données en CSV
   */
  convertToCSV(data) {
    // Implémentation simplifiée de conversion en CSV
    const rows = [];
    
    // En-têtes
    rows.push('Période,Réquisitions,Montant,Approuvé,Terminé,Rejeté,En attente');
    
    // Données mensuelles
    if (data.monthlyTrend) {
      data.monthlyTrend.forEach(item => {
        rows.push(`${item.period},${item.requisitions},${item.amount},${item.approved},${item.completed},${item.rejected},${item.pending}`);
      });
    }
    
    return rows.join('\n');
  }
}

module.exports = new DashboardController();