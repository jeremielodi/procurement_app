// backend/src/models/PurchaseOrderModel.js
const db = require('../config/database');
const tenant = require('../utils/tenant');
const { getEnterpriseCurrencyCode } = require('../utils/enterpriseCurrency');

// Statut de livraison d'un PO (suivi des réceptions, vue v_po_item_delivery) :
// DELIVERED = tout accepté, PARTIALLY_DELIVERED = au moins une quantité acceptée, NOT_DELIVERED sinon
const DELIVERY_STATUS_SQL = (alias) => `(
  SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    WHEN BOOL_AND(d.quantity_remaining <= 0) THEN 'DELIVERED'
    WHEN BOOL_OR(d.quantity_accepted > 0) THEN 'PARTIALLY_DELIVERED'
    ELSE 'NOT_DELIVERED' END
  FROM v_po_item_delivery d WHERE d.purchase_order_id = ${alias}.id)`;

// Lignes du PO avec article et suivi des livraisons (quantités en nombres : DECIMAL → float8)
const PO_ITEMS_SQL = `
  SELECT pi.id, pi.purchase_order_id, pi.item_description, pi.quantity::float8 AS quantity, pi.unit_price,
         pi.total_amount, pi.specifications, pi.created_at, pi.stock_item_id, pi.requisition_item_id,
         d.quantity_received::float8 AS delivered_received, d.quantity_accepted::float8 AS delivered_accepted,
         d.quantity_rejected::float8 AS delivered_rejected, d.quantity_remaining::float8 AS quantity_remaining,
         d.receipt_count::int AS receipt_count, d.last_receipt_date,
         si.code AS item_code, si.name AS item_name, si.unit, si.is_stockable, si.track_lots, si.track_expiry, si.track_serials
  FROM purchase_order_items pi
  JOIN v_po_item_delivery d ON d.po_item_id = pi.id
  LEFT JOIN stock_items si ON si.id = pi.stock_item_id
  WHERE pi.purchase_order_id = $1
  ORDER BY pi.id`;

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
    const currencyId = await this.resolveCurrencyId(poData);

    const transaction = db.transaction();

    transaction.addInsertReturningQuery('purchase_orders', {
      po_number: poNumber,
      requisition_id: poData.requisitionId,
      task_id: poData.taskId || null,
      supplier_id: poData.supplierId,
      order_date: poData.orderDate || new Date(),
      delivery_date: poData.deliveryDate,
      shipping_address: poData.shippingAddress,
      total_amount: poData.totalAmount,
      currency_id: currencyId,
      status: 'PO_PENDING',
      created_by: poData.createdBy,
      created_at: new Date(),
      updated_at: new Date()
    }, 'id');

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
          specifications: item.specifications || null,
          // Article du catalogue et ligne de réquisition d'origine (gestion de stock, traçabilité)
          stock_item_id: item.stockItemId || null,
          requisition_item_id: item.requisitionItemId || null
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
   * Suivi des livraisons d'un PO : lignes (commandé / reçu / accepté / rejeté / reste) et réceptions
   */
  async getDelivery(id) {
    const po = await db.one(`SELECT po.id, po.po_number, ${DELIVERY_STATUS_SQL('po')} AS delivery_status FROM purchase_orders po WHERE po.id = $1`, [id]);
    if (!po) return null;
    const items = await db.select(PO_ITEMS_SQL, [id]);
    const receipts = await db.select(
      `SELECT g.id, g.grn_number, g.receipt_date, g.status, w.name AS warehouse_name,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS received_by_name,
              COALESCE(SUM(gi.quantity_accepted), 0)::float8 AS quantity_accepted,
              COALESCE(SUM(gi.quantity_rejected), 0)::float8 AS quantity_rejected
       FROM goods_receipt_notes g
       LEFT JOIN goods_receipt_items gi ON gi.grn_id = g.id
       LEFT JOIN warehouses w ON w.id = g.warehouse_id
       LEFT JOIN users u ON u.id = g.received_by
       WHERE g.po_id = $1
       GROUP BY g.id, w.name, u.first_name, u.last_name
       ORDER BY g.created_at`,
      [id]
    );
    const sum = (k) => items.reduce((s, i) => s + (Number(i[k]) || 0), 0);
    return {
      poId: po.id, poNumber: po.po_number, deliveryStatus: po.delivery_status,
      totals: { ordered: sum('quantity'), accepted: sum('delivered_accepted'), rejected: sum('delivered_rejected'), remaining: sum('quantity_remaining') },
      items, receipts,
    };
  }

  /**
   * Devise du PO (currency_id) : code envoyé (ex. 'USD') → devise de la réquisition → devise de l'entreprise
   */
  async resolveCurrencyId(poData) {
    if (poData.currencyId) return poData.currencyId;

    if (poData.currency) {
      const row = await db.one('SELECT id FROM currency WHERE format_key = $1', [poData.currency]);
      if (row) return row.id;
    }

    if (poData.requisitionId) {
      const row = await db.one('SELECT currency_id FROM requisitions WHERE id = $1', [poData.requisitionId]);
      if (row?.currency_id) return row.currency_id;
    }

    const row = await db.one(
      'SELECT c.id FROM currency c WHERE c.format_key = $1',
      [await getEnterpriseCurrencyCode()]
    );
    return row?.id;
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
        su.language as supplier_language,
        u.first_name as created_by_name,
        u.email as created_by_email,
        c.format_key as currency,
        ${DELIVERY_STATUS_SQL('po')} AS delivery_status
      FROM purchase_orders po
      LEFT JOIN requisitions r ON po.requisition_id = r.id
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN users su ON su.id = s.user_id -- compte portail du fournisseur : langue des emails
      LEFT JOIN users u ON po.created_by = u.id
      LEFT JOIN currency c ON po.currency_id = c.id
      WHERE po.id = $1
    `, [id]);
    
    if (!po) return null;
    
    const items = await db.select(PO_ITEMS_SQL, [id]);
    
    const deliveries = await db.select(`
      SELECT * FROM deliveries 
      WHERE po_id = $1 
      ORDER BY delivery_date DESC
    `, [id]);
    
    // approvals.entity_id is UUID; PO ids are INTEGER — cast to text for comparison
    let approvals = [];
    try {
      approvals = await db.select(`
        SELECT
          a.*,
          u.first_name,
          u.last_name
        FROM approvals a
        LEFT JOIN users u ON a.approver_id = u.id
        WHERE a.entity_type = 'purchase_order' AND a.entity_id::text = $1::text
        ORDER BY a.approved_at DESC
      `, [String(id)]);
    } catch (_) { /* non-fatal */ }

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
        r.requisition_number,
        c.format_key as currency,
        ${DELIVERY_STATUS_SQL('po')} AS delivery_status
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN requisitions r ON po.requisition_id = r.id
      LEFT JOIN currency c ON po.currency_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;
    // Multi-entreprise : uniquement les données de l'entreprise courante
    sql += tenant.filter('po.enterprise_id', params);
    paramCount = params.length + 1;
    
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
    // Multi-entreprise : uniquement les données de l'entreprise courante
    sql += tenant.filter('enterprise_id', params);
    paramCount = params.length + 1;
    
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
    // approvals.entity_id is UUID; PO ids are INTEGER — insert is best-effort
    try {
      await db.insert('approvals', {
        entity_type: 'purchase_order',
        entity_id: id,
        approver_id: approverId,
        status: 'APPROVED',
        comments: comments,
        approved_at: new Date()
      });
    } catch (_) { /* non-fatal */ }
    return { success: true };
  }

  /**
   * Rejeter une commande
   */
  async reject(id, approverId, reason) {
    await this.updateStatus(id, 'PO_REJECTED', approverId);
    // approvals.entity_id is UUID; PO ids are INTEGER — insert is best-effort
    try {
      await db.insert('approvals', {
        entity_type: 'purchase_order',
        entity_id: id,
        approver_id: approverId,
        status: 'REJECTED',
        comments: reason,
        approved_at: new Date()
      });
    } catch (_) { /* non-fatal */ }
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
    const p = [];
    const scope = `WHERE 1=1${tenant.filter('enterprise_id', p)}`;
    // Total des commandes
    const total = await db.one(`SELECT COUNT(*) as count FROM purchase_orders ${scope}`, p);
    
    // Par statut
    const byStatus = await db.select(`
      SELECT status, COUNT(*) as count 
      FROM purchase_orders ${scope}
      GROUP BY status
    `, p);
    
    // Montant total
    const totalAmount = await db.one(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM purchase_orders ${scope}
    `, p);
    
    // Commandes du mois
    const monthlyOrders = await db.one(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM purchase_orders ${scope}
      AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
      AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
    `, p);
    
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