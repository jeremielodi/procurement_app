// backend/src/models/RequisitionModel.js
const db = require('../config/database');
const { requisitionVisibilitySql } = require('../utils/projectAccess');
const tenant = require('../utils/tenant');
const util = require('../config/util');
const { v4: uuidv4 } = require('uuid');

// Avancement global du cycle procure-to-pay (colonne « Avancement » de la liste)
// Source de vérité : la fin du processus GoFlow (événement de fin atteint par la dernière tâche).
// Sans processus : terminé si tous les bons de commande non rejetés ont une facture payée.
const processEndedAt = (endEvent) => `EXISTS (
           SELECT 1 FROM workflow_history wh
           WHERE r.process_instance_id IS NOT NULL AND wh.process_instance_id = r.process_instance_id
             AND wh.action = 'TASK_COMPLETED' AND wh.comments LIKE '%"next_element":"${endEvent}"%')`;

const PROGRESS_STATUS_SQL = `
  CASE
    WHEN r.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN r.status = 'REJECTED' THEN 'REJECTED'
    WHEN r.status = 'COMPLETED' THEN 'COMPLETED'
    WHEN ${processEndedAt('Event_Completed')} THEN 'COMPLETED'
    WHEN ${processEndedAt('Event_Rejected')} THEN 'REJECTED'
    WHEN r.process_instance_id IS NOT NULL THEN 'IN_PROGRESS'
    -- Hors workflow (aucun processus GoFlow) : terminée quand tous les PO actifs ont une facture payée,
    -- même si la réquisition est restée en brouillon (même règle que RequisitionTimelineService)
    WHEN EXISTS (
           SELECT 1 FROM purchase_orders po
           WHERE po.requisition_id = r.id AND po.status NOT IN ('PO_REJECTED', 'REJECTED', 'CANCELLED'))
     AND NOT EXISTS (
           SELECT 1 FROM purchase_orders po
           WHERE po.requisition_id = r.id AND po.status NOT IN ('PO_REJECTED', 'REJECTED', 'CANCELLED')
             AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.po_id = po.id AND i.status = 'PAID'))
    THEN 'COMPLETED'
    WHEN r.status = 'DRAFT' THEN 'DRAFT'
    ELSE 'IN_PROGRESS'
  END`;

// Méthodes d'achat (Gateway_MethodDecision) et seuils de montant
const PROCUREMENT_METHODS = ['DIRECT_PURCHASE', 'MULTIPLE_QUOTATIONS', 'RFP', 'SOLE_SOURCE'];
const METHOD_RIGOR = { DIRECT_PURCHASE: 1, MULTIPLE_QUOTATIONS: 2, RFP: 3 };
const DIRECT_PURCHASE_THRESHOLD = 5000;
const QUOTATION_THRESHOLD = 25000;

class RequisitionModel {

  /**
   * Créer une nouvelle réquisition
   */
  async create(requisitionData) {
    const { 
      title, description, departmentId, projectId, projectCode,
      estimatedAmount, currencyId, requesterId, priority, justification,
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
        department_id: departmentId,
        project_id: projectId,
        estimated_amount: estimatedAmount,
        currency_id: currencyId,
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
          budget_line_code: budgetLineCode,
          // Article du catalogue (facultatif : texte libre sinon) — repris dans le PO puis la réception
          stock_item_id: item.stockItemId || null
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
             b.function_code, b.activity_code, b.description, b.allocated_amount, 
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
             b.function_code, b.activity_code, b.description, b.allocated_amount, 
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
      WHERE id = $1 and is_active=true
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
      `SELECT r.*, 
        ${PROGRESS_STATUS_SQL} AS progress_status,
        u.first_name,
        u.last_name,
        u.email,
        d.code as department_code,
        d.name as department_name,
        p.code as project_code,
        p.name as project_name
       FROM requisitions r
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN users u ON r.requester_id = u.id
       WHERE r.id = $1`,
      [id]
    );
    
    if (!requisition) return null;
    
    const items = await db.select(
      `SELECT ri.*, 
              b.entity_code as budget_line_code, 
              b.description as budget_line_description,
              si.code AS item_code, si.name AS item_name, si.unit, si.is_stockable
       FROM requisition_items ri
       LEFT JOIN budget_allocations b ON ri.budget_line_id = b.id
       LEFT JOIN stock_items si ON si.id = ri.stock_item_id
       WHERE ri.requisition_id = $1
       ORDER BY ri.id`,
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
   * Filtres de la liste (entreprise, visibilité (viewerId), statut, département, priorité, processus, dates, avancement, recherche)
   * — partagés par findAll et countAll pour que le total de la pagination corresponde aux filtres.
   * Alias attendus : r (requisitions), d (departments), p (projects), u (users, demandeur).
   */
  listFilters(filters = {}) {
    let sql = '';
    const params = [];
    let paramCount = 1;
    // Multi-entreprise : uniquement les données de l'entreprise courante
    sql += tenant.filter('r.enterprise_id', params);
    // viewerId : ses propres réquisitions, plus celles des projets où il a un profil autre que demandeur (migration 30)
    if (filters.viewerId) sql += requisitionVisibilitySql('r', filters.viewerId, params);
    paramCount = params.length + 1;
    
    if (filters.status && filters.status != 'all') {
      sql += ` AND r.status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }
    
    if (filters.departmentId && filters.departmentId != 'all') {
      sql += ` AND r.department_id = $${paramCount}`;
      params.push(filters.departmentId);
      paramCount++;
    }
    if (filters.priority && filters.priority != 'all') {
      sql += ` AND r.priority = $${paramCount}`;
      params.push(filters.priority);
      paramCount++;
    }

    // Demandeur (liste proposée par listRequesters : demandeurs des réquisitions visibles)
    if (filters.requesterId && filters.requesterId != 'all') {
      sql += ` AND r.requester_id = $${paramCount}`;
      params.push(filters.requesterId);
      paramCount++;
    }


     if (filters.processInstanceId && filters.processInstanceId != 'all') {
      sql += ` AND r.process_instance_id = $${paramCount}`;
      params.push(filters.processInstanceId);
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
    
    if (filters.progress && filters.progress != 'all') {
      sql += ` AND (${PROGRESS_STATUS_SQL}) = $${paramCount}`;
      params.push(filters.progress);
      paramCount++;
    }

    // Recherche : n°, titre, description, département, projet, demandeur (insensible à la casse, % et _ littéraux)
    const search = String(filters.search || '').trim();
    if (search) {
      sql += ` AND (r.requisition_number ILIKE $${paramCount} OR r.title ILIKE $${paramCount} OR r.description ILIKE $${paramCount}
               OR d.name ILIKE $${paramCount} OR d.code ILIKE $${paramCount} OR p.name ILIKE $${paramCount} OR p.code ILIKE $${paramCount}
               OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $${paramCount})`;
      params.push(`%${search.replace(/[\\%_]/g, c => '\\' + c)}%`);
      paramCount++;
    }
    
    return { where: sql, params };
  }

  /**
   * Demandeurs proposés dans le filtre de la liste : tous les utilisateurs actifs de l'entreprise, plus les comptes
   * désactivés ayant des réquisitions visibles. count = nombre de réquisitions VISIBLES par l'utilisateur
   * (même cloisonnement que la liste : entreprise + visibilité par projet) — 0 si aucune.
   */
  async listRequesters(viewerId) {
    const params = [];
    let where = tenant.filter('r.enterprise_id', params);
    if (viewerId) where += requisitionVisibilitySql('r', viewerId, params);
    const userScope = tenant.filter('u.enterprise_id', params);
    return db.select(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_updated_at AS avatar_version, u.is_active,
              COALESCE(v.count, 0)::int AS count
       FROM users u
       LEFT JOIN (SELECT r.requester_id, COUNT(*) AS count FROM requisitions r WHERE 1=1${where} GROUP BY r.requester_id) v
              ON v.requester_id = u.id
       WHERE u.enterprise_id IS NOT NULL AND (u.is_active OR v.count > 0)${userScope}
       ORDER BY LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), u.email`,
      params
    );
  }

  /** Nombre de réquisitions correspondant aux filtres de la liste (sans pagination) */
  async countAll(filters = {}) {
    const { where, params } = this.listFilters(filters);
    const row = await db.one(
      `SELECT COUNT(*)::int AS total
       FROM requisitions r
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN users u ON r.requester_id = u.id
       WHERE 1=1${where}`,
      params
    );
    return row.total;
  }

  /**
   * Récupérer toutes les réquisitions avec filtres
   */
  async findAll(filters = {}) {
    let sql = `
      SELECT r.*, u.first_name, u.last_name, u.avatar_updated_at AS requester_avatar_version, 
        d.code as department_code,
        d.name as department_name,
        ${PROGRESS_STATUS_SQL} AS progress_status
      FROM requisitions r
      LEFT JOIN departments d ON d.id = r.department_id
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN users u ON r.requester_id = u.id
      WHERE 1=1
    `;
    const { where, params } = this.listFilters(filters);
    sql += where;
    let paramCount = params.length + 1;
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
   * Méthode minimale imposée par le montant : ≤ 5 000 achat direct, ≤ 25 000 devis multiples, au-delà appel d'offres
   */
  requiredProcurementMethod(estimatedAmount) {
    const amount = parseFloat(estimatedAmount) || 0;
    if (amount <= DIRECT_PURCHASE_THRESHOLD) return 'DIRECT_PURCHASE';
    if (amount <= QUOTATION_THRESHOLD) return 'MULTIPLE_QUOTATIONS';
    return 'RFP';
  }

  /**
   * Méthode choisie par les achats (Activity_DetermineType) : refusée si elle est moins exigeante que celle
   * imposée par le montant ; la source unique (justification obligatoire) reste toujours possible.
   * Renvoie null si le choix est valide, sinon un code d'erreur.
   */
  checkChosenMethod(method, estimatedAmount) {
    if (!PROCUREMENT_METHODS.includes(method)) return 'PROCUREMENT_METHOD_REQUIRED';
    if (method === 'SOLE_SOURCE') return null;
    const required = this.requiredProcurementMethod(estimatedAmount);
    return METHOD_RIGOR[method] < METHOD_RIGOR[required] ? 'METHOD_BELOW_THRESHOLD' : null;
  }

  /**
   * Méthode d'achat transmise au processus (worker classify_procurement) : c'est TOUJOURS celle choisie par
   * l'utilisateur à l'étape « Déterminer la méthode d'achat » (Activity_DetermineType, contrôlée à la complétion par
   * TaskController : obligatoire, au moins aussi exigeante que le montant). Le système ne la détermine jamais :
   * aucun calcul par montant, aucun historique en son nom ; seul le statut CLASSIFIED_* de la réquisition est mis à jour.
   * Choix absent ou inconnu → erreur (incident GoFlow) plutôt qu'une méthode inventée.
   */
  async applyChosenMethod(requisitionId, chosenMethod) {
    if (!PROCUREMENT_METHODS.includes(chosenMethod)) {
      throw Object.assign(
        new Error(`Méthode d'achat absente ou inconnue (${chosenMethod || 'vide'}) : elle doit être choisie à l'étape « Déterminer la méthode d'achat »`),
        { code: 'PROCUREMENT_METHOD_REQUIRED' }
      );
    }
    await this.updateStatus(requisitionId, `CLASSIFIED_${chosenMethod}`);
    return { procurementMethod: chosenMethod };
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

module.exports = new RequisitionModel();module.exports.PROGRESS_STATUS_SQL = PROGRESS_STATUS_SQL; // même règle d'avancement ailleurs (rapport quotidien)
