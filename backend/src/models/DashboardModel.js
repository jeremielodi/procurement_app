// backend/src/models/DashboardModel.js - Version corrigée
const db = require('../config/database');

class DashboardModel {
  /**
   * Récupérer les statistiques globales
   */
  async getStats() {
    // Total des réquisitions
    const totalRequisitions = await db.one(
      "SELECT COUNT(*) as count FROM requisitions"
    );
    
    // Réquisitions par statut
    const requisitionsByStatus = await db.select(
      "SELECT status, COUNT(*) as count FROM requisitions GROUP BY status"
    );
    
    // Montant total des réquisitions
    const totalAmount = await db.one(
      "SELECT COALESCE(SUM(estimated_amount), 0) as total FROM requisitions"
    );
    
    // Nombre de fournisseurs actifs
    const activeSuppliers = await db.one(
      "SELECT COUNT(*) as count FROM suppliers WHERE status = 'ACTIVE'"
    );
    
    // Nombre de commandes
    const totalOrders = await db.one(
      "SELECT COUNT(*) as count FROM purchase_orders"
    );
    
    return {
      requisitions: {
        total: parseInt(totalRequisitions.count),
        byStatus: requisitionsByStatus
      },
      amount: {
        total: parseFloat(totalAmount.total)
      },
      suppliers: {
        active: parseInt(activeSuppliers.count)
      },
      orders: {
        total: parseInt(totalOrders.count)
      }
    };
  }

  /**
   * Récupérer les données pour les graphiques
   */
  async getChartData(period = 'month') {
    let dateFormat;
    let interval;
    
    switch (period) {
      case 'week':
        dateFormat = 'YYYY-MM-DD';
        interval = '7 days';
        break;
      case 'year':
        dateFormat = 'YYYY-MM';
        interval = '12 months';
        break;
      case 'month':
      default:
        dateFormat = 'YYYY-MM-DD';
        interval = '30 days';
        break;
    }
    
    // Tendances mensuelles des réquisitions
    const monthlyTrend = await db.select(`
      SELECT 
        TO_CHAR(created_at, $1) as period,
        COUNT(*) as requisitions,
        COALESCE(SUM(estimated_amount), 0) as amount,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed
      FROM requisitions
      WHERE created_at >= NOW() - INTERVAL '${interval}'
      GROUP BY TO_CHAR(created_at, $1)
      ORDER BY period ASC
    `, [dateFormat]);
    
    // Distribution par statut
    const statusDistribution = await db.select(`
      SELECT 
        status as name,
        COUNT(*) as value
      FROM requisitions
      GROUP BY status
    `);
    
    // Ajouter les couleurs par statut
    const statusColors = {
      'DRAFT': '#9CA3AF',
      'PENDING': '#F59E0B',
      'BUDGET_CHECKED': '#3B82F6',
      'APPROVED': '#10B981',
      'REJECTED': '#EF4444',
      'IN_PROGRESS': '#8B5CF6',
      'COMPLETED': '#10B981',
      'CANCELLED': '#6B7280'
    };
    
    const statusDistributionWithColors = statusDistribution.map(item => ({
      name: item.name,
      value: parseInt(item.value),
      color: statusColors[item.name] || '#6B7280'
    }));
    
    // Données par département
    const departmentData = await db.select(`
      SELECT 
        department,
        COUNT(*) as count,
        COALESCE(SUM(estimated_amount), 0) as amount
      FROM requisitions
      WHERE department IS NOT NULL
      GROUP BY department
      ORDER BY amount DESC
    `);
    
    // Top fournisseurs
    const topSuppliers = await db.select(`
      SELECT 
        s.name,
        s.supplier_code,
        COUNT(po.id) as orders,
        COALESCE(SUM(po.total_amount), 0) as amount,
        COALESCE(s.rating, 0) as rating
      FROM suppliers s
      LEFT JOIN purchase_orders po ON po.supplier_id = s.id
      GROUP BY s.id, s.name, s.supplier_code, s.rating
      ORDER BY amount DESC
      LIMIT 5
    `);
    
    // Méthodes d'achat
    const procurementMethods = await db.select(`
      SELECT 
        CASE 
          WHEN estimated_amount <= 5000 THEN 'DIRECT_PURCHASE'
          WHEN estimated_amount <= 25000 THEN 'MULTIPLE_QUOTATIONS'
          WHEN estimated_amount > 25000 THEN 'RFP'
          ELSE 'OTHER'
        END as method,
        COUNT(*) as count,
        COALESCE(SUM(estimated_amount), 0) as amount
      FROM requisitions
      GROUP BY method
    `);
    
    const methodLabels = {
      'DIRECT_PURCHASE': 'Achat direct',
      'MULTIPLE_QUOTATIONS': 'Multiples devis',
      'RFP': 'Appel d\'offres',
      'SOLE_SOURCE': 'Source unique',
      'OTHER': 'Autre'
    };
    
    const procurementMethodsData = procurementMethods.map(item => ({
      name: methodLabels[item.method] || item.method,
      value: parseInt(item.count),
      amount: parseFloat(item.amount)
    }));
    
    // Performance metrics
    const performanceMetrics = await this.getPerformanceMetrics();
    
    // Budget summary
    const budgetSummary = await this.getBudgetSummary();
    
    return {
      monthlyTrend,
      statusDistribution: statusDistributionWithColors,
      departmentData,
      topSuppliers,
      procurementMethods: procurementMethodsData,
      performanceMetrics,
      budgetSummary
    };
  }

  /**
   * Récupérer le résumé budgétaire
   */
  async getBudgetSummary() {
    const summary = await db.one(`
      SELECT 
        COUNT(*) as total_budgets,
        COALESCE(SUM(allocated_amount), 0) as total_allocated,
        COALESCE(SUM(utilized_amount), 0) as total_utilized,
        COALESCE(SUM(remaining_amount), 0) as total_remaining
      FROM budget_allocations
      WHERE is_active = true
    `);
    
    const byFundingSource = await db.select(`
      SELECT 
        funding_source,
        COUNT(*) as count,
        COALESCE(SUM(allocated_amount), 0) as allocated,
        COALESCE(SUM(utilized_amount), 0) as utilized,
        COALESCE(SUM(remaining_amount), 0) as remaining
      FROM budget_allocations
      WHERE is_active = true AND funding_source IS NOT NULL
      GROUP BY funding_source
      ORDER BY allocated DESC
    `);
    
    return {
      summary,
      byFundingSource
    };
  }

  /**
   * Récupérer les métriques de performance
   */
  async getPerformanceMetrics() {
    // Délai moyen de traitement (en heures)
    const avgProcessingTime = await db.one(`
      SELECT COALESCE(AVG(
        EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at, created_at) - created_at))/3600
      ), 0) as avg_hours
      FROM requisitions
      WHERE status IN ('COMPLETED', 'APPROVED')
    `);
    
    // Taux de livraison à temps
    const onTimeDelivery = await db.one(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN delivery_date <= order_date + INTERVAL '7 days' THEN 1 END) as on_time
      FROM purchase_orders
      WHERE delivery_date IS NOT NULL AND order_date IS NOT NULL
    `);
    
    const onTimeRate = onTimeDelivery.total > 0 
      ? (onTimeDelivery.on_time / onTimeDelivery.total) * 100 
      : 0;
    
    // Conformité budgétaire - utilisant budget_allocations
    const budgetCompliance = await db.one(`
      SELECT 
        COUNT(ri.id) as total,
        COUNT(CASE 
          WHEN ba.remaining_amount >= ri.total_amount THEN 1 
        END) as compliant
      FROM requisition_items ri
      LEFT JOIN budget_allocations ba ON ri.budget_line_id = ba.id
      WHERE ri.budget_line_id IS NOT NULL
    `);
    
    const complianceRate = budgetCompliance.total > 0
      ? (budgetCompliance.compliant / budgetCompliance.total) * 100
      : 0;
    
    // Satisfaction fournisseurs
    const supplierSatisfaction = await db.one(`
      SELECT COALESCE(AVG(rating), 0) as avg_rating
      FROM suppliers
      WHERE rating IS NOT NULL
    `);
    
    return {
      averageProcessingTime: parseFloat(avgProcessingTime.avg_hours).toFixed(1),
      onTimeDelivery: parseFloat(onTimeRate).toFixed(0),
      budgetCompliance: parseFloat(complianceRate).toFixed(0),
      supplierSatisfaction: parseFloat(supplierSatisfaction.avg_rating).toFixed(1)
    };
  }

  /**
   * Récupérer les réquisitions récentes
   */
  async getRecentRequisitions(limit = 10) {
    return await db.select(`
      SELECT 
        r.id,
        r.requisition_number,
        r.title,
        r.department,
        r.estimated_amount,
        r.currency,
        r.status,
        r.created_at,
        u.first_name,
        u.last_name
      FROM requisitions r
      LEFT JOIN users u ON r.requester_id = u.id
      ORDER BY r.created_at DESC
      LIMIT $1
    `, [limit]);
  }

  /**
   * Récupérer les activités récentes
   */
  async getRecentActivities(limit = 10) {
    return await db.select(`
      SELECT 
        wh.*,
        r.requisition_number,
        u.first_name,
        u.last_name
      FROM workflow_history wh
      LEFT JOIN requisitions r ON r.id = wh.entity_id AND wh.entity_type = 'requisition'
      LEFT JOIN users u ON u.id = wh.performed_by
      ORDER BY wh.performed_at DESC
      LIMIT $1
    `, [limit]);
  }

  /**
   * Récupérer le résumé par département
   */
  async getDepartmentSummary() {
    return await db.select(`
      SELECT 
        department,
        COUNT(*) as requisition_count,
        COALESCE(SUM(estimated_amount), 0) as total_amount,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved_count,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_count
      FROM requisitions
      WHERE department IS NOT NULL
      GROUP BY department
      ORDER BY total_amount DESC
    `);
  }

  /**
   * Récupérer le résumé par fournisseur
   */
  async getSupplierSummary() {
    return await db.select(`
      SELECT 
        s.name,
        s.supplier_code,
        s.prequalified,
        s.rating,
        COUNT(po.id) as order_count,
        COALESCE(SUM(po.total_amount), 0) as total_spent
      FROM suppliers s
      LEFT JOIN purchase_orders po ON po.supplier_id = s.id
      GROUP BY s.id, s.name, s.supplier_code, s.prequalified, s.rating
      ORDER BY total_spent DESC
      LIMIT 10
    `);
  }

  /**
   * Récupérer les KPI
   */
  async getKPIs() {
    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;
    
    // Comparaison année en cours vs année précédente
    const currentYearStats = await db.one(`
      SELECT 
        COUNT(*) as requisitions,
        COALESCE(SUM(estimated_amount), 0) as amount
      FROM requisitions
      WHERE EXTRACT(YEAR FROM created_at) = $1
    `, [currentYear]);
    
    const lastYearStats = await db.one(`
      SELECT 
        COUNT(*) as requisitions,
        COALESCE(SUM(estimated_amount), 0) as amount
      FROM requisitions
      WHERE EXTRACT(YEAR FROM created_at) = $1
    `, [lastYear]);
    
    const requisitionGrowth = lastYearStats.requisitions > 0
      ? ((currentYearStats.requisitions - lastYearStats.requisitions) / lastYearStats.requisitions) * 100
      : 0;
    
    const amountGrowth = lastYearStats.amount > 0
      ? ((currentYearStats.amount - lastYearStats.amount) / lastYearStats.amount) * 100
      : 0;
    
    // Taux d'approbation
    const approvalRate = await db.one(`
      SELECT 
        COUNT(CASE WHEN status IN ('APPROVED', 'COMPLETED') THEN 1 END) as approved,
        COUNT(*) as total
      FROM requisitions
    `);
    
    const approvalRateValue = approvalRate.total > 0
      ? (approvalRate.approved / approvalRate.total) * 100
      : 0;
    
    // Taux de conversion des réquisitions en commandes
    const conversionRate = await db.one(`
      SELECT 
        COUNT(DISTINCT po.requisition_id) as converted,
        COUNT(DISTINCT r.id) as total
      FROM requisitions r
      LEFT JOIN purchase_orders po ON po.requisition_id = r.id
    `);
    
    const conversionRateValue = conversionRate.total > 0
      ? (conversionRate.converted / conversionRate.total) * 100
      : 0;
    
    return {
      yearOverYear: {
        requisitions: {
          current: parseInt(currentYearStats.requisitions),
          previous: parseInt(lastYearStats.requisitions),
          growth: parseFloat(requisitionGrowth).toFixed(1)
        },
        amount: {
          current: parseFloat(currentYearStats.amount),
          previous: parseFloat(lastYearStats.amount),
          growth: parseFloat(amountGrowth).toFixed(1)
        }
      },
      approvalRate: parseFloat(approvalRateValue).toFixed(1),
      conversionRate: parseFloat(conversionRateValue).toFixed(1)
    };
  }
}

module.exports = new DashboardModel();