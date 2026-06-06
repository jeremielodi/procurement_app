// backend/src/models/RequisitionModel.js
const db = require('../config/database');
const util = require('../config/util');
const { v4: uuidv4 } = require('uuid');

class RequisitionModel {

  /**
   * Créer une nouvelle réquisition
   */
  async create(requisitionData) {
    const { 
      title, description, department, projectId, projectCode,
      estimatedAmount, currency, requesterId, priority, justification,
      items
    } = requisitionData;

    const year = new Date().getFullYear();
    const countResult = await db.select(
      "SELECT COUNT(*) as count FROM requisitions WHERE EXTRACT(YEAR FROM created_at) = $1",
      [year]
    );
    const requisitionNumber = `REQ-${year}-${String(parseInt(countResult[0].count) + 1).padStart(4, '0')}-${util.generate3DigitText()}`;

    const transaction = db.transaction();
    const requisitionId = uuidv4();
    
    try {
      // Insérer la réquisition
      transaction.addInsertQuery('requisitions', {
        id: requisitionId,
        requisition_number: requisitionNumber,
        title,
        description,
        department,
        project_code: projectCode,
        estimated_amount: estimatedAmount,
        currency: currency || 'USD',
        requester_id: requesterId,
        status: 'DRAFT',
        priority,
        justification,
        created_at: new Date(),
        updated_at: new Date()
      });

      await transaction.execute();
 
      // Insérer les articles avec leurs lignes budgétaires
      const itemTransaction = db.transaction();
      for (const item of items) {
        let budgetLineCode = null;
        if (item.budgetLineId) {
          const budget = await db.one('SELECT entity_code FROM budget_allocations WHERE id = $1', [item.budgetLineId]);
          budgetLineCode = budget?.entity_code;
        }
        
        const itemTotal = (item.quantity || 0) * (item.frequency || 1) * (item.unitPrice || 0);
        
        itemTransaction.addInsertQuery('requisition_items', {
          requisition_id: requisitionId,
          item_description: item.description,
          quantity: item.quantity,
          frequency: item.frequency || 1,
          unit_price: item.unitPrice,
          total_amount: itemTotal,
          specifications: item.specifications || null,
          budget_line_id: item.budgetLineId || null,
          budget_line_code: budgetLineCode
        });
      }
      
      await itemTransaction.execute();
      
      return {
        id: requisitionId,
        requisitionNumber,
        success: true
      };
    } catch (error) {
      console.error('Error creating requisition:', error);
      throw error;
    }
  }

  /**
   * Récupérer les projets actifs
   */
  async getActiveProjects() {
    return await db.select(`
      SELECT id, code, name, project_manager_id, status
      FROM projects 
      WHERE is_active = true AND status = 'ACTIVE'
      ORDER BY name
    `);
  }

  /**
   * Récupérer les lignes budgétaires par projet
   */
  async getBudgetLinesByProject(projectId) {
    let sql = `
      SELECT b.id, b.entity_code, b.loc, b.funding_source, b.sub_project, 
             b.function_code, b.description, b.allocated_amount, 
             b.utilized_amount, b.remaining_amount
      FROM budget_allocations b
      WHERE b.is_active = true
    `;
    const params = [];
    
    if (projectId) {
      sql += ` AND b.project_id = $1`;
      params.push(projectId);
    }
    
    sql += ` ORDER BY b.entity_code`;
    
    return await db.select(sql, params);
  }

  /**
   * Rechercher des lignes budgétaires
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
   * Vérifier le budget disponible sur une ligne budgétaire
   */
  async checkBudgetAvailability(budgetLineId, requestedAmount) {
    const budget = await db.one(`
      SELECT id, entity_code, allocated_amount, utilized_amount, remaining_amount
      FROM budget_allocations 
      WHERE id = $1
    `, [budgetLineId]);
    
    if (!budget) {
      return {
        available: false,
        availableAmount: 0,
        message: 'Ligne budgétaire non trouvée'
      };
    }
    
    const isAvailable = budget.remaining_amount >= requestedAmount;
    
    return {
      available: isAvailable,
      availableAmount: budget.remaining_amount,
      budgetId: budget.id,
      entityCode: budget.entity_code,
      message: isAvailable 
        ? `Budget suffisant: ${budget.remaining_amount} disponible`
        : `Budget insuffisant: besoin de ${requestedAmount}, disponible: ${budget.remaining_amount}`
    };
  }

  /**
   * Enregistrer une dépense
   */
  async addExpense(budgetId, requisitionId, purchaseOrderId, amount, description, createdBy) {
    const expenseId = uuidv4();
    
    const transaction = db.transaction();
    
    // Ajouter la dépense
    transaction.addInsertQuery('budget_expenses', {
      id: expenseId,
      budget_id: budgetId,
      requisition_id: requisitionId,
      purchase_order_id: purchaseOrderId,
      amount: amount,
      description: description,
      expense_date: new Date(),
      created_by: createdBy,
      created_at: new Date()
    });
    
    // Mettre à jour le montant utilisé dans budget_allocations
    transaction.addUpdateQuery('budget_allocations', {
      utilized_amount: db.raw('utilized_amount + ' + amount),
      updated_at: new Date()
    }, 'id', budgetId);
    
    await transaction.execute();
    
    return { success: true, expenseId };
  }

  async delete(id) {
    const transaction = db.transaction();
    transaction.addDeleteQuery("requisition_items", "requisition_id", id);
    transaction.addDeleteQuery("requisitions", "id", id);
    return transaction.execute();
  }
  
  /**
   * Mettre à jour le statut d'une réquisition
   */
  async updateStatus(id, status, processInstanceId = null) {
    const updateData = { 
      status,
      updated_at: new Date()
    };
    
    if (status === 'COMPLETED') {
      updateData.completed_at = new Date();
    } else if (status === 'APPROVED') {
      updateData.approved_at = new Date();
    } else if (status === 'REJECTED') {
      updateData.rejected_at = new Date();
    } else if (status === 'SUBMITTED') {
      updateData.submitted_at = new Date();
    }
    
    if (processInstanceId) {
      updateData.process_instance_id = processInstanceId;
    }
    
    return await db.update('requisitions', updateData, 'id', id);
  }

  /**
   * Récupérer une réquisition par ID
   */
  async findById(id) {
    const requisition = await db.one(
      `SELECT r.*, u.first_name, u.last_name, u.email 
       FROM requisitions r
       LEFT JOIN users u ON r.requester_id = u.id
       WHERE r.id = $1`,
      [id]
    );
    
    if (!requisition) return null;
    
    const items = await db.select(
      `SELECT ri.*, 
              b.entity_code as budget_line_code, 
              b.description as budget_line_description
       FROM requisition_items ri
       LEFT JOIN budget_allocations b ON ri.budget_line_id = b.id
       WHERE ri.requisition_id = $1`,
      [id]
    );
    
    const attachments = await db.select(
      "SELECT * FROM attachments WHERE entity_type = 'requisition' AND entity_id = $1",
      [id]
    );
    
    const history = await db.select(
      `SELECT * FROM workflow_history 
       WHERE entity_type = 'requisition' AND entity_id = $1 
       ORDER BY performed_at DESC`,
      [id]
    );
    
    return {
      ...requisition,
      items,
      attachments,
      history
    };
  }

  /**
   * Récupérer toutes les réquisitions avec filtres
   */
  async findAll(filters = {}) {
    let sql = `
      SELECT r.*, u.first_name, u.last_name
      FROM requisitions r
      LEFT JOIN users u ON r.requester_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;
    
    if (filters.status && filters.status != 'all') {
      sql += ` AND r.status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }
    
    if (filters.department && filters.department != 'all') {
      sql += ` AND r.department = $${paramCount}`;
      params.push(filters.department);
      paramCount++;
    }
    
    if (filters.fromDate) {
      sql += ` AND r.created_at >= $${paramCount}`;
      params.push(filters.fromDate);
      paramCount++;
    }
    
    if (filters.toDate) {
      sql += ` AND r.created_at <= $${paramCount}`;
      params.push(filters.toDate);
      paramCount++;
    }
    
    if (filters.search) {
      sql += ` AND (r.requisition_number ILIKE $${paramCount} OR r.title ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }
    
    sql += ` ORDER BY r.created_at DESC`;
    
    if (filters.limit) {
      sql += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(filters.limit, filters.offset || 0);
    }
    
    return await db.select(sql, params);
  }

  /**
   * Compter les réquisitions
   */
  async count(filters = {}) {
    let sql = `SELECT COUNT(*) as count FROM requisitions WHERE 1=1`;
    const params = [];
    let paramCount = 1;
    
    if (filters.status) {
      sql += ` AND status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }
    
    if (filters.department) {
      sql += ` AND department = $${paramCount}`;
      params.push(filters.department);
      paramCount++;
    }
    
    const result = await db.one(sql, params);
    return parseInt(result.count);
  }

  /**
   * Soumettre une réquisition
   */
  async submit(id) {
    return await this.updateStatus(id, 'PENDING');
  }

  /**
   * Approuver une réquisition
   */
  async approve(id, approverId, comments = null) {
    await this.updateStatus(id, 'APPROVED');
    
    await this.addWorkflowHistory({
      entityType: 'requisition',
      entityId: id,
      action: 'APPROVED',
      comments: comments,
      performedBy: approverId
    });
    
    return { success: true };
  }

  /**
   * Rejeter une réquisition
   */
  async reject(id, approverId, reason) {
    await db.update('requisitions', {
      status: 'REJECTED',
      rejected_at: new Date(),
      rejected_reason: reason,
      updated_at: new Date()
    }, 'id', id);
    
    await this.addWorkflowHistory({
      entityType: 'requisition',
      entityId: id,
      action: 'REJECTED',
      comments: reason,
      performedBy: approverId
    });
    
    return { success: true };
  }

  /**
   * Compléter une réquisition
   */
  async complete(id) {
    return await this.updateStatus(id, 'COMPLETED');
  }

  /**
   * Annuler une réquisition
   */
  async cancel(id, reason) {
    return await db.update('requisitions', {
      status: 'CANCELLED',
      updated_at: new Date()
    }, 'id', id);
  }

  /**
   * Classifier la méthode d'achat
   */
  async classifyProcurement(estimatedAmount, requisitionId) {
    const directPurchaseThreshold = 5000;
    const quotationThreshold = 25000;
    
    let procurementMethod = '';
    let classificationReason = '';
    
    if (parseFloat(estimatedAmount) <= directPurchaseThreshold) {
      procurementMethod = 'DIRECT_PURCHASE';
      classificationReason = 'Amount below direct purchase threshold';
    } else if (parseFloat(estimatedAmount) <= quotationThreshold) {
      procurementMethod = 'MULTIPLE_QUOTATIONS';
      classificationReason = 'Amount requires multiple quotations';
    } else {
      procurementMethod = 'RFP';
      classificationReason = 'Amount requires formal tender process';
    }
    
    const soleSource = await db.one(
      'SELECT * FROM sole_source_justifications WHERE requisition_id = $1 AND approved = true',
      [requisitionId]
    );
    
    if (soleSource) {
      procurementMethod = 'SOLE_SOURCE';
      classificationReason = 'Approved sole source justification';
    }
    
    await this.updateStatus(requisitionId, `CLASSIFIED_${procurementMethod}`);
    
    await this.addWorkflowHistory({
      entityType: 'requisition',
      entityId: requisitionId,
      action: `CLASSIFIED_${procurementMethod}`,
      comments: classificationReason
    });
    
    return { 
      procurementMethod, 
      classificationReason 
    };
  }

  /**
   * Ajouter une entrée dans l'historique du workflow
   */
  async addWorkflowHistory(historyData) {
    return await db.insert('workflow_history', {
      process_instance_id: historyData.processInstanceId,
      entity_type: historyData.entityType,
      entity_id: historyData.entityId,
      task_id: historyData.taskId,
      task_name: historyData.taskName,
      action: historyData.action,
      comments: historyData.comments,
      performed_by: historyData.performedBy,
      performed_at: new Date()
    });
  }
}

module.exports = new RequisitionModel();