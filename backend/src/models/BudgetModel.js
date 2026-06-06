// backend/src/models/BudgetModel.js
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class BudgetModel {
  async create(data) {
    const {
      entityCode, loc, fundingSource, subProject, functionCode,
      description, allocatedAmount, projectId, createdBy
    } = data;
    
    const id = uuidv4();
    
    await db.insert('budget_allocations', {
      id,
      entity_code: entityCode,
      loc,
      funding_source: fundingSource,
      sub_project: subProject,
      function_code: functionCode,
      description,
      allocated_amount: allocatedAmount,
      utilized_amount: 0,
      project_id: projectId || null,
      is_active: true,
      created_by: createdBy,
      created_at: new Date(),
      updated_at: new Date()
    });
    
    return { success: true, id };
  }

  async findAll(filters = {}) {
    let sql = `
      SELECT b.*, 
             p.name as project_name, p.code as project_code,
             u.first_name as created_by_name, u.last_name as created_by_last
      FROM budget_allocations b
      LEFT JOIN projects p ON b.project_id = p.id
      LEFT JOIN users u ON b.created_by = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;
    
    if (filters.entityCode) {
      sql += ` AND b.entity_code ILIKE $${paramCount}`;
      params.push(`%${filters.entityCode}%`);
      paramCount++;
    }
    
    if (filters.fundingSource) {
      sql += ` AND b.funding_source = $${paramCount}`;
      params.push(filters.fundingSource);
      paramCount++;
    }
    
    if (filters.projectId) {
      sql += ` AND b.project_id = $${paramCount}`;
      params.push(filters.projectId);
      paramCount++;
    }
    
    if (filters.is_active !== undefined && filters.is_active !== 'all') {
      sql += ` AND b.is_active = $${paramCount}`;
      params.push(filters.is_active === 'true');
      paramCount++;
    }
    
    sql += ` ORDER BY b.created_at DESC`;
    
    if (filters.limit) {
      sql += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(filters.limit, filters.offset || 0);
    }
    
    return await db.select(sql, params);
  }

  async findById(id) {
    const budget = await db.one(`
      SELECT b.*, 
             p.name as project_name, p.code as project_code,
             u.first_name as created_by_name, u.last_name as created_by_last
      FROM budget_allocations b
      LEFT JOIN projects p ON b.project_id = p.id
      LEFT JOIN users u ON b.created_by = u.id
      WHERE b.id = $1
    `, [id]);
    
    if (!budget) return null;
    
    const expenses = await db.select(`
      SELECT e.*, 
             r.requisition_number,
             po.po_number
      FROM budget_expenses e
      LEFT JOIN requisitions r ON e.requisition_id = r.id
      LEFT JOIN purchase_orders po ON e.purchase_order_id = po.id
      WHERE e.budget_id = $1
      ORDER BY e.expense_date DESC
    `, [id]);
    
    return { ...budget, expenses };
  }

  async update(id, data) {
    const { loc, fundingSource, subProject, functionCode, description, allocatedAmount, projectId, isActive } = data;
    
    await db.update('budget_allocations', {
      loc,
      funding_source: fundingSource,
      sub_project: subProject,
      function_code: functionCode,
      description,
      allocated_amount: allocatedAmount,
      project_id: projectId || null,
      is_active: isActive,
      updated_at: new Date()
    }, 'id', id);
    
    return { success: true };
  }

  async delete(id) {
    return await db.delete('budget_allocations', 'id', id);
  }

  async addExpense(data) {
    const { budgetId, requisitionId, purchaseOrderId, amount, description, createdBy } = data;
    const id = uuidv4();
    
    const transaction = db.transaction();
    
    transaction.addInsertQuery('budget_expenses', {
      id,
      budget_id: budgetId,
      requisition_id: requisitionId,
      purchase_order_id: purchaseOrderId,
      amount,
      description,
      expense_date: new Date(),
      created_by: createdBy,
      created_at: new Date()
    });
    
    // Mettre à jour le montant utilisé
    transaction.addUpdateQuery('budget_allocations', {
      utilized_amount: db.raw('utilized_amount + ' + amount),
      updated_at: new Date()
    }, 'id', budgetId);
    
    await transaction.execute();
    
    return { success: true, id };
  }

  async getSummary() {
    const summary = await db.one(`
      SELECT 
        COUNT(*) as total_budgets,
        COALESCE(SUM(allocated_amount), 0) as total_allocated,
        COALESCE(SUM(utilized_amount), 0) as total_utilized,
        COALESCE(SUM(allocated_amount - utilized_amount), 0) as total_remaining
      FROM budget_allocations
      WHERE is_active = true
    `);
    
    const byFundingSource = await db.select(`
      SELECT 
        funding_source,
        COUNT(*) as count,
        COALESCE(SUM(allocated_amount), 0) as allocated,
        COALESCE(SUM(utilized_amount), 0) as utilized
      FROM budget_allocations
      WHERE is_active = true AND funding_source IS NOT NULL
      GROUP BY funding_source
      ORDER BY allocated DESC
    `);
    
    return { summary, byFundingSource };
  }

  /**
   * Rechercher des lignes budgétaires avec filtres
   */
  async searchBudgetLines(filters) {
    let sql = `
      SELECT b.id, b.entity_code, b.loc, b.funding_source, b.sub_project, 
             b.function_code, b.description, b.allocated_amount, 
             b.utilized_amount, b.remaining_amount,
             p.name as project_name, p.code as project_code
      FROM budget_allocations b
      LEFT JOIN projects p ON b.project_id = p.id
      WHERE b.is_active = true
    `;
    const params = [];
    let paramCount = 1;
    
    if (filters.search) {
      sql += ` AND (
        b.entity_code ILIKE $${paramCount} OR 
        b.description ILIKE $${paramCount} OR 
        b.loc ILIKE $${paramCount} OR 
        b.sub_project ILIKE $${paramCount}
      )`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }
    
    if (filters.fundingSource && filters.fundingSource !== 'all') {
      sql += ` AND b.funding_source = $${paramCount}`;
      params.push(filters.fundingSource);
      paramCount++;
    }
    
    if (filters.projectId) {
      sql += ` AND b.project_id = $${paramCount}`;
      params.push(filters.projectId);
      paramCount++;
    }
    
    sql += ` ORDER BY b.entity_code LIMIT 50`;
    
    return await db.select(sql, params);
  }

  /**
   * Vérifier le budget (version avec budget_allocations)
   */
  async checkBudgetWithAllocation(budgetLineId, requestedAmount) {
    const budget = await db.one(
      `SELECT id, entity_code, allocated_amount, utilized_amount, remaining_amount
       FROM budget_allocations 
       WHERE id = $1 AND is_active = true`,
      [budgetLineId]
    );
    
    if (!budget) {
      return {
        budgetAvailable: false,
        availableAmount: 0,
        message: 'Ligne budgétaire non trouvée'
      };
    }
    
    const budgetAvailable = budget.remaining_amount >= requestedAmount;
    
    return {
      budgetAvailable,
      availableAmount: budget.remaining_amount,
      budgetId: budget.id,
      entityCode: budget.entity_code,
      message: budgetAvailable 
        ? `Budget suffisant: ${budget.remaining_amount} disponible`
        : `Budget insuffisant: besoin de ${requestedAmount}, disponible: ${budget.remaining_amount}`
    };
  }
}

module.exports = new BudgetModel();