// backend/src/models/DashboardModel.js
const db = require('../config/database');

class DashboardModel {
  /**
   * Récupérer les statistiques globales
   */
  async getStats() {
    try {
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

      // Réquisitions en attente d'approbation
      const pendingApprovals = await db.one(
        "SELECT COUNT(*) as count FROM requisitions WHERE status = 'PENDING'"
      );

      // Réquisitions approuvées ce mois
      const approvedThisMonth = await db.one(`
        SELECT COUNT(*) as count 
        FROM requisitions 
        WHERE status = 'APPROVED' 
        AND EXTRACT(MONTH FROM approved_at) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM approved_at) = EXTRACT(YEAR FROM CURRENT_DATE)
      `);

      // Montant total des commandes
      const totalOrderAmount = await db.one(
        "SELECT COALESCE(SUM(total_amount), 0) as total FROM purchase_orders"
      );
      
      return {
        requisitions: {
          total: parseInt(totalRequisitions.count),
          byStatus: requisitionsByStatus,
          pendingApprovals: parseInt(pendingApprovals.count),
          approvedThisMonth: parseInt(approvedThisMonth.count)
        },
        amount: {
          total: parseFloat(totalAmount.total),
          ordersTotal: parseFloat(totalOrderAmount.total)
        },
        suppliers: {
          active: parseInt(activeSuppliers.count)
        },
        orders: {
          total: parseInt(totalOrders.count)
        }
      };
    } catch (error) {
      console.error('Error in getStats:', error);
      throw error;
    }
  }

  /**
   * Récupérer les données pour les graphiques
   */
  async getChartData(period = 'month') {
    try {
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
          COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected,
          COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending
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
        ORDER BY value DESC
      `);
      
      // Couleurs par statut
      const statusColors = {
        'DRAFT': '#9CA3AF',
        'PENDING': '#F59E0B',
        'BUDGET_CHECKED': '#3B82F6',
        'APPROVED': '#10B981',
        'REJECTED': '#EF4444',
        'IN_PROGRESS': '#8B5CF6',
        'COMPLETED': '#10B981',
        'CANCELLED': '#6B7280',
        'SUBMITTED': '#60A5FA',
        'PROCESSING': '#A78BFA'
      };
      
      const statusDistributionWithColors = statusDistribution.map(item => ({
        name: this.getStatusLabel(item.name),
        value: parseInt(item.value),
        color: statusColors[item.name] || '#6B7280',
        rawStatus: item.name
      }));
      
      // Données par département
      const departmentData = await db.select(`
        SELECT 
          d.name as department_name,
          d.code as department_code,
          COUNT(r.id) as count,
          COALESCE(SUM(r.estimated_amount), 0) as amount,
          COUNT(CASE WHEN r.status = 'APPROVED' THEN 1 END) as approved_count
        FROM requisitions r
        LEFT JOIN departments d ON r.department_id = d.id
        WHERE r.department_id IS NOT NULL
        GROUP BY d.id, d.name, d.code
        ORDER BY amount DESC
        LIMIT 10
      `);
      
      // Top fournisseurs
      const topSuppliers = await db.select(`
        SELECT 
          s.id,
          s.name,
          s.supplier_code,
          COUNT(po.id) as orders,
          COALESCE(SUM(po.total_amount), 0) as amount,
          COALESCE(s.rating, 0) as rating,
          s.prequalified
        FROM suppliers s
        LEFT JOIN purchase_orders po ON po.supplier_id = s.id
        GROUP BY s.id, s.name, s.supplier_code, s.rating, s.prequalified
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
            WHEN EXISTS (
              SELECT 1 FROM sole_source_justifications ssj 
              WHERE ssj.requisition_id = requisitions.id
            ) THEN 'SOLE_SOURCE'
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
      
      const methodColors = {
        'DIRECT_PURCHASE': '#10B981',
        'MULTIPLE_QUOTATIONS': '#3B82F6',
        'RFP': '#8B5CF6',
        'SOLE_SOURCE': '#F59E0B',
        'OTHER': '#6B7280'
      };
      
      const procurementMethodsData = procurementMethods.map(item => ({
        name: methodLabels[item.method] || item.method,
        value: parseInt(item.count),
        amount: parseFloat(item.amount),
        color: methodColors[item.method] || '#6B7280',
        rawMethod: item.method
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
    } catch (error) {
      console.error('Error in getChartData:', error);
      throw error;
    }
  }

  /**
   * Obtenir le libellé du statut
   */
  getStatusLabel(status) {
    const labels = {
      'DRAFT': 'Brouillon',
      'PENDING': 'En attente',
      'BUDGET_CHECKED': 'Vérifié budget',
      'APPROVED': 'Approuvé',
      'REJECTED': 'Rejeté',
      'IN_PROGRESS': 'En cours',
      'COMPLETED': 'Terminé',
      'CANCELLED': 'Annulé',
      'SUBMITTED': 'Soumis',
      'PROCESSING': 'En traitement'
    };
    return labels[status] || status;
  }

  /**
   * Récupérer le résumé budgétaire
   */
  async getBudgetSummary() {
    try {
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
      
      const byProject = await db.select(`
        SELECT 
          p.name as project_name,
          p.code as project_code,
          COUNT(ba.id) as count,
          COALESCE(SUM(ba.allocated_amount), 0) as allocated,
          COALESCE(SUM(ba.utilized_amount), 0) as utilized,
          COALESCE(SUM(ba.remaining_amount), 0) as remaining
        FROM budget_allocations ba
        LEFT JOIN projects p ON ba.project_id = p.id
        WHERE ba.is_active = true
        GROUP BY p.id, p.name, p.code
        ORDER BY allocated DESC
        LIMIT 10
      `);
      
      return {
        summary: {
          totalBudgets: parseInt(summary.total_budgets),
          totalAllocated: parseFloat(summary.total_allocated),
          totalUtilized: parseFloat(summary.total_utilized),
          totalRemaining: parseFloat(summary.total_remaining),
          utilizationRate: summary.total_allocated > 0 
            ? (summary.total_utilized / summary.total_allocated) * 100 
            : 0
        },
        byFundingSource,
        byProject
      };
    } catch (error) {
      console.error('Error in getBudgetSummary:', error);
      throw error;
    }
  }

  /**
   * Récupérer les métriques de performance
   */
  async getPerformanceMetrics() {
    try {
      // Délai moyen de traitement (en heures)
      const avgProcessingTime = await db.one(`
        SELECT COALESCE(AVG(
          EXTRACT(EPOCH FROM (COALESCE(approved_at, completed_at, updated_at, created_at) - created_at))/3600
        ), 0) as avg_hours
        FROM requisitions
        WHERE status IN ('COMPLETED', 'APPROVED')
      `);
      
      // Délai moyen par étape - Version corrigée sans fonction de fenêtre dans l'agrégation
      const stepDelays = await db.select(`
        WITH step_times AS (
          SELECT 
            task_name,
            process_instance_id,
            performed_at,
            LAG(performed_at) OVER (PARTITION BY process_instance_id ORDER BY performed_at) as prev_performed_at
          FROM workflow_history
          WHERE entity_type = 'requisition'
        )
        SELECT 
          task_name,
          COALESCE(AVG(
            EXTRACT(EPOCH FROM (performed_at - prev_performed_at))/3600
          ), 0) as avg_hours
        FROM step_times
        WHERE prev_performed_at IS NOT NULL
        GROUP BY task_name
        ORDER BY avg_hours DESC
        LIMIT 5
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
      
      // Conformité budgétaire
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
        SELECT 
          COALESCE(AVG(rating), 0) as avg_rating,
          COUNT(*) as total_evaluations
        FROM supplier_evaluations
        WHERE rating IS NOT NULL
      `);
      
      // Taux de réapprobation (réquisitions rejetées puis approuvées)
      const reapprovalRate = await db.one(`
        SELECT 
          COUNT(DISTINCT r1.id) as reapproved,
          COUNT(DISTINCT r2.id) as total_rejected
        FROM requisitions r1
        JOIN requisitions r2 ON r1.id = r2.id
        WHERE r1.status = 'APPROVED' 
        AND EXISTS (
          SELECT 1 FROM workflow_history wh 
          WHERE wh.entity_id = r1.id 
          AND wh.action = 'REJECTED'
        )
      `);
      
      const reapprovalRateValue = reapprovalRate.total_rejected > 0
        ? (reapprovalRate.reapproved / reapprovalRate.total_rejected) * 100
        : 0;
      
      return {
        averageProcessingTime: parseFloat(avgProcessingTime.avg_hours).toFixed(1),
        onTimeDelivery: parseFloat(onTimeRate).toFixed(0),
        budgetCompliance: parseFloat(complianceRate).toFixed(0),
        supplierSatisfaction: parseFloat(supplierSatisfaction.avg_rating).toFixed(1),
        totalSupplierEvaluations: parseInt(supplierSatisfaction.total_evaluations),
        reapprovalRate: parseFloat(reapprovalRateValue).toFixed(0),
        stepDelays: stepDelays.map(d => ({
          task_name: d.task_name,
          avg_hours: parseFloat(d.avg_hours || 0).toFixed(1)
        }))
      };
    } catch (error) {
      console.error('Error in getPerformanceMetrics:', error);
      throw error;
    }
  }

  /**
   * Récupérer les réquisitions récentes
   */
  async getRecentRequisitions(limit = 10) {
    try {
      return await db.select(`
        SELECT 
          r.id,
          r.requisition_number,
          r.title,
          r.department_id,
          d.name as department_name,
          r.estimated_amount,
          r.currency_id,
          c.symbol as currency_symbol,
          r.status,
          r.created_at,
          r.submitted_at,
          r.approved_at,
          u.first_name,
          u.last_name,
          u.email as requester_email,
          p.name as project_name
        FROM requisitions r
        LEFT JOIN users u ON r.requester_id = u.id
        LEFT JOIN departments d ON r.department_id = d.id
        LEFT JOIN projects p ON r.project_id = p.id
        LEFT JOIN currency c ON r.currency_id = c.id
        ORDER BY r.created_at DESC
        LIMIT $1
      `, [limit]);
    } catch (error) {
      console.error('Error in getRecentRequisitions:', error);
      throw error;
    }
  }

  /**
   * Récupérer les activités récentes
   */
  async getRecentActivities(limit = 10) {
    try {
      return await db.select(`
        SELECT 
          wh.id,
          wh.process_instance_id,
          wh.entity_type,
          wh.entity_id,
          wh.task_name,
          wh.action,
          wh.comments,
          wh.performed_at,
          r.requisition_number,
          r.title as requisition_title,
          u.first_name,
          u.last_name,
          u.email as performer_email
        FROM workflow_history wh
        LEFT JOIN requisitions r ON r.id = wh.entity_id AND wh.entity_type = 'requisition'
        LEFT JOIN users u ON u.id = wh.performed_by
        ORDER BY wh.performed_at DESC
        LIMIT $1
      `, [limit]);
    } catch (error) {
      console.error('Error in getRecentActivities:', error);
      throw error;
    }
  }

  /**
   * Récupérer le résumé par département
   */
  async getDepartmentSummary() {
    try {
      return await db.select(`
        SELECT 
          d.id,
          d.name as department_name,
          d.code as department_code,
          COUNT(r.id) as requisition_count,
          COALESCE(SUM(r.estimated_amount), 0) as total_amount,
          COUNT(CASE WHEN r.status = 'APPROVED' THEN 1 END) as approved_count,
          COUNT(CASE WHEN r.status = 'PENDING' THEN 1 END) as pending_count,
          COUNT(CASE WHEN r.status = 'REJECTED' THEN 1 END) as rejected_count,
          COUNT(CASE WHEN r.status = 'COMPLETED' THEN 1 END) as completed_count,
          COALESCE(AVG(CASE WHEN r.approved_at IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (r.approved_at - r.submitted_at))/3600 
          END), 0) as avg_approval_hours
        FROM departments d
        LEFT JOIN requisitions r ON r.department_id = d.id
        GROUP BY d.id, d.name, d.code
        ORDER BY total_amount DESC
      `);
    } catch (error) {
      console.error('Error in getDepartmentSummary:', error);
      throw error;
    }
  }

  /**
   * Récupérer le résumé par fournisseur
   */
  async getSupplierSummary() {
    try {
      return await db.select(`
        SELECT 
          s.id,
          s.name,
          s.supplier_code,
          s.prequalified,
          s.rating,
          s.status,
          COUNT(DISTINCT po.id) as order_count,
          COALESCE(SUM(po.total_amount), 0) as total_spent,
          COUNT(DISTINCT r.id) as requisition_count,
          AVG(se.rating) as avg_evaluation_rating,
          COUNT(DISTINCT se.id) as evaluation_count
        FROM suppliers s
        LEFT JOIN purchase_orders po ON po.supplier_id = s.id
        LEFT JOIN requisitions r ON r.id = po.requisition_id
        LEFT JOIN supplier_evaluations se ON se.supplier_id = s.id
        GROUP BY s.id, s.name, s.supplier_code, s.prequalified, s.rating, s.status
        ORDER BY total_spent DESC
        LIMIT 10
      `);
    } catch (error) {
      console.error('Error in getSupplierSummary:', error);
      throw error;
    }
  }

  /**
   * Récupérer les KPI
   */
  async getKPIs() {
    try {
      const currentYear = new Date().getFullYear();
      const lastYear = currentYear - 1;
      
      // Comparaison année en cours vs année précédente
      const currentYearStats = await db.one(`
        SELECT 
          COUNT(*) as requisitions,
          COALESCE(SUM(estimated_amount), 0) as amount,
          COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved
        FROM requisitions
        WHERE EXTRACT(YEAR FROM created_at) = $1
      `, [currentYear]);
      
      const lastYearStats = await db.one(`
        SELECT 
          COUNT(*) as requisitions,
          COALESCE(SUM(estimated_amount), 0) as amount,
          COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved
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
      
      // Délai moyen d'approbation (en jours)
      const avgApprovalDays = await db.one(`
        SELECT COALESCE(AVG(
          EXTRACT(EPOCH FROM (approved_at - submitted_at))/86400
        ), 0) as avg_days
        FROM requisitions
        WHERE submitted_at IS NOT NULL AND approved_at IS NOT NULL
      `);
      
      // Réquisitions par mois cette année
      const monthlyRequisitions = await db.select(`
        SELECT 
          EXTRACT(MONTH FROM created_at) as month,
          COUNT(*) as count,
          COALESCE(SUM(estimated_amount), 0) as amount
        FROM requisitions
        WHERE EXTRACT(YEAR FROM created_at) = $1
        GROUP BY EXTRACT(MONTH FROM created_at)
        ORDER BY month ASC
      `, [currentYear]);
      
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
          },
          approval: {
            current: parseInt(currentYearStats.approved),
            previous: parseInt(lastYearStats.approved)
          }
        },
        approvalRate: parseFloat(approvalRateValue).toFixed(1),
        conversionRate: parseFloat(conversionRateValue).toFixed(1),
        avgApprovalDays: parseFloat(avgApprovalDays.avg_days).toFixed(1),
        monthlyRequisitions: monthlyRequisitions.map(m => ({
          month: parseInt(m.month),
          count: parseInt(m.count),
          amount: parseFloat(m.amount)
        }))
      };
    } catch (error) {
      console.error('Error in getKPIs:', error);
      throw error;
    }
  }

  /**
   * Récupérer les données pour les alertes
   */
  async getAlerts() {
    try {
      // Réquisitions en attente depuis plus de 5 jours
      const pendingOverdue = await db.select(`
        SELECT 
          id,
          requisition_number,
          title,
          created_at,
          EXTRACT(EPOCH FROM (NOW() - created_at))/86400 as days_pending
        FROM requisitions
        WHERE status = 'PENDING'
        AND created_at < NOW() - INTERVAL '5 days'
        ORDER BY created_at ASC
        LIMIT 10
      `);

      // Budgets avec utilisation > 80%
      const budgetAlerts = await db.select(`
        SELECT 
          id,
          entity_code,
          description,
          allocated_amount,
          utilized_amount,
          remaining_amount,
          (utilized_amount / NULLIF(allocated_amount, 0) * 100) as utilization_rate
        FROM budget_allocations
        WHERE is_active = true
        AND allocated_amount > 0
        AND (utilized_amount / NULLIF(allocated_amount, 0) * 100) > 80
        ORDER BY utilization_rate DESC
        LIMIT 10
      `);

      // Fournisseurs avec évaluation basse
      const supplierAlerts = await db.select(`
        SELECT 
          s.id,
          s.name,
          s.supplier_code,
          COALESCE(AVG(se.rating), 0) as avg_rating,
          COUNT(se.id) as evaluation_count,
          COUNT(po.id) as order_count
        FROM suppliers s
        LEFT JOIN supplier_evaluations se ON se.supplier_id = s.id
        LEFT JOIN purchase_orders po ON po.supplier_id = s.id
        GROUP BY s.id, s.name, s.supplier_code
        HAVING COALESCE(AVG(se.rating), 0) < 3.0
        ORDER BY avg_rating ASC
        LIMIT 10
      `);

      return {
        pendingOverdue: pendingOverdue.map(p => ({
          ...p,
          days_pending: parseFloat(p.days_pending).toFixed(1)
        })),
        budgetAlerts: budgetAlerts.map(b => ({
          ...b,
          utilization_rate: parseFloat(b.utilization_rate).toFixed(1)
        })),
        supplierAlerts: supplierAlerts.map(s => ({
          ...s,
          avg_rating: parseFloat(s.avg_rating || 0).toFixed(1)
        }))
      };
    } catch (error) {
      console.error('Error in getAlerts:', error);
      throw error;
    }
  }

  /**
   * Récupérer les statistiques par projet
   */
  async getProjectStats() {
    try {
      return await db.select(`
        SELECT 
          p.id,
          p.code as project_code,
          p.name as project_name,
          p.status as project_status,
          COUNT(r.id) as requisition_count,
          COALESCE(SUM(r.estimated_amount), 0) as total_requisition_amount,
          COUNT(CASE WHEN r.status = 'APPROVED' THEN 1 END) as approved_count,
          COUNT(CASE WHEN r.status = 'PENDING' THEN 1 END) as pending_count,
          COUNT(po.id) as order_count,
          COALESCE(SUM(po.total_amount), 0) as total_order_amount,
          COALESCE(SUM(ba.allocated_amount), 0) as budget_allocated,
          COALESCE(SUM(ba.utilized_amount), 0) as budget_utilized,
          COALESCE(SUM(ba.remaining_amount), 0) as budget_remaining
        FROM projects p
        LEFT JOIN requisitions r ON r.project_id = p.id
        LEFT JOIN purchase_orders po ON po.requisition_id = r.id
        LEFT JOIN budget_allocations ba ON ba.project_id = p.id
        GROUP BY p.id, p.code, p.name, p.status
        ORDER BY total_requisition_amount DESC
      `);
    } catch (error) {
      console.error('Error in getProjectStats:', error);
      throw error;
    }
  }
}

module.exports = new DashboardModel();