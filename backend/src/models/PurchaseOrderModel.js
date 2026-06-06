// backend/src/models/PurchaseOrderModel.js
const db = require('../config/database');

class PurchaseOrderModel {
  /**
   * Créer une commande d'achat
   */
  async create(poData) {
    const year = new Date().getFullYear();
    const countResult = await db.one(
      "SELECT COUNT(*) as count FROM purchase_orders WHERE EXTRACT(YEAR FROM created_at) = $1",
      [year]
    );
    const poNumber = `PO-${year}-${String(parseInt(countResult.count) + 1).padStart(4, '0')}`;
    
    const transaction = db.transaction();
    
    transaction.addInsertQuery('purchase_orders', {
      po_number: poNumber,
      requisition_id: poData.requisitionId,
      supplier_id: poData.supplierId,
      order_date: poData.orderDate || new Date(),
      delivery_date: poData.deliveryDate,
      shipping_address: poData.shippingAddress,
      total_amount: poData.totalAmount,
      currency: poData.currency || 'USD',
      status: poData.status || 'DRAFT',
      created_by: poData.createdBy,
      created_at: new Date(),
      updated_at: new Date()
    });
    
    const results = await transaction.execute();
    const poId = results[0][0]?.id || results[0][0]?.purchase_order_id;
    
    // Ajouter les items si présents
    if (poData.items && poData.items.length > 0) {
      const itemTransaction = db.transaction();
      for (const item of poData.items) {
        itemTransaction.addInsertQuery('purchase_order_items', {
          purchase_order_id: poId,
          item_description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_amount: item.quantity * item.unitPrice,
          specifications: item.specifications || null
        });
      }
      await itemTransaction.execute();
    }
    
    return {
      id: poId,
      poNumber,
      success: true
    };
  }

  /**
   * Récupérer une commande par ID
   */
  async findById(id) {
    const po = await db.one(`
      SELECT 
        po.*,
        r.requisition_number,
        r.title as requisition_title,
        s.name as supplier_name,
        s.supplier_code,
        s.email as supplier_email,
        s.phone as supplier_phone,
        s.address as supplier_address,
        u.first_name as created_by_name,
        u.email as created_by_email
      FROM purchase_orders po
      LEFT JOIN requisitions r ON po.requisition_id = r.id
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN users u ON po.created_by = u.id
      WHERE po.id = $1
    `, [id]);
    
    if (!po) return null;
    
    const items = await db.select(`
      SELECT * FROM purchase_order_items 
      WHERE purchase_order_id = $1
    `, [id]);
    
    const deliveries = await db.select(`
      SELECT * FROM deliveries 
      WHERE po_id = $1 
      ORDER BY delivery_date DESC
    `, [id]);
    
    const approvals = await db.select(`
      SELECT 
        a.*,
        u.first_name,
        u.last_name,
        u.role
      FROM approvals a
      LEFT JOIN users u ON a.approver_id = u.id
      WHERE a.entity_type = 'purchase_order' AND a.entity_id = $1
      ORDER BY a.approved_at DESC
    `, [id]);
    
    return {
      ...po,
      items,
      deliveries,
      approvals
    };
  }

  /**
   * Récupérer toutes les commandes avec filtres
   */
  async findAll(filters = {}) {
    let sql = `
      SELECT 
        po.*,
        s.name as supplier_name,
        s.supplier_code,
        r.requisition_number
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN requisitions r ON po.requisition_id = r.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;
    
    if (filters.status && filters.status !== 'all') {
      sql += ` AND po.status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }
    
    if (filters.supplierId) {
      sql += ` AND po.supplier_id = $${paramCount}`;
      params.push(filters.supplierId);
      paramCount++;
    }
    
    if (filters.requisitionId) {
      sql += ` AND po.requisition_id = $${paramCount}`;
      params.push(filters.requisitionId);
      paramCount++;
    }
    
    if (filters.search) {
      sql += ` AND (po.po_number ILIKE $${paramCount} OR s.name ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }
    
    if (filters.fromDate) {
      sql += ` AND po.order_date >= $${paramCount}`;
      params.push(filters.fromDate);
      paramCount++;
    }
    
    if (filters.toDate) {
      sql += ` AND po.order_date <= $${paramCount}`;
      params.push(filters.toDate);
      paramCount++;
    }
    
    sql += ` ORDER BY po.created_at DESC`;
    
    if (filters.limit) {
      sql += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(filters.limit, filters.offset || 0);
    }
    
    return await db.select(sql, params);
  }

  /**
   * Compter les commandes
   */
  async count(filters = {}) {
    let sql = `SELECT COUNT(*) as count FROM purchase_orders WHERE 1=1`;
    const params = [];
    let paramCount = 1;
    
    if (filters.status && filters.status !== 'all') {
      sql += ` AND status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }
    
    if (filters.supplierId) {
      sql += ` AND supplier_id = $${paramCount}`;
      params.push(filters.supplierId);
      paramCount++;
    }
    
    const result = await db.one(sql, params);
    return parseInt(result.count);
  }

  /**
   * Mettre à jour une commande
   */
  async update(id, poData) {
    const updateData = {
      ...poData,
      updated_at: new Date()
    };
    return await db.update('purchase_orders', updateData, 'id', id);
  }

  /**
   * Mettre à jour le statut d'une commande
   */
  async updateStatus(id, status, userId = null) {
    const updateData = { 
      status,
      updated_at: new Date()
    };
    
    if (status === 'APPROVED' && userId) {
      updateData.approved_by = userId;
      updateData.approved_at = new Date();
    }
    
    return await db.update('purchase_orders', updateData, 'id', id);
  }

  /**
   * Approuver une commande
   */
  async approve(id, approverId, comments = null) {
    await this.updateStatus(id, 'PO_APPROVED', approverId);
    
    // Ajouter à l'historique des approbations
    await db.insert('approvals', {
      entity_type: 'purchase_order',
      entity_id: id,
      approver_id: approverId,
      status: 'APPROVED',
      comments: comments,
      approved_at: new Date()
    });
    
    return { success: true };
  }

  /**
   * Rejeter une commande
   */
  async reject(id, approverId, reason) {
    await this.updateStatus(id, 'PO_REJECTED', approverId);
    
    // Ajouter à l'historique des approbations
    await db.insert('approvals', {
      entity_type: 'purchase_order',
      entity_id: id,
      approver_id: approverId,
      status: 'REJECTED',
      comments: reason,
      approved_at: new Date()
    });
    
    return { success: true };
  }

  /**
   * Envoyer la commande au fournisseur
   */
  async send(id) {
    await this.updateStatus(id, 'PO_SENT');
    return { success: true };
  }

  /**
   * Supprimer une commande
   */
  async delete(id) {
    // Supprimer d'abord les items associés
    await db.delete('purchase_order_items', 'purchase_order_id', id);
    // Supprimer la commande
    return await db.delete('purchase_orders', 'id', id);
  }

  /**
   * Récupérer les statistiques des commandes
   */
  async getStats() {
    // Total des commandes
    const total = await db.one("SELECT COUNT(*) as count FROM purchase_orders");
    
    // Par statut
    const byStatus = await db.select(`
      SELECT status, COUNT(*) as count 
      FROM purchase_orders 
      GROUP BY status
    `);
    
    // Montant total
    const totalAmount = await db.one(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM purchase_orders
    `);
    
    // Commandes du mois
    const monthlyOrders = await db.one(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM purchase_orders
      WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
      AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
    `);
    
    return {
      total: parseInt(total.count),
      byStatus,
      totalAmount: parseFloat(totalAmount.total),
      monthly: {
        count: parseInt(monthlyOrders.count),
        amount: parseFloat(monthlyOrders.amount)
      }
    };
  }

  /**
   * Générer le PDF d'une commande
   */
  async generatePDF(id) {
    const po = await this.findById(id);
    if (!po) throw new Error('Purchase order not found');
    
    // Ici vous pouvez utiliser une bibliothèque comme pdfmake ou puppeteer
    // Pour l'instant, on retourne les données
    return po;
  }
}

module.exports = new PurchaseOrderModel();