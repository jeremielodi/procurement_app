// backend/src/models/GoodsReceiptModel.js
const db = require('../config/database');

class GoodsReceiptModel {

  async generateGRNNumber() {
    const year = new Date().getFullYear();
    const result = await db.one(
      `SELECT COUNT(*) AS count FROM goods_receipt_notes
       WHERE EXTRACT(YEAR FROM COALESCE(receipt_date, created_at)) = $1`,
      [year]
    );
    const seq = String(parseInt(result.count) + 1).padStart(4, '0');
    return `GRN-${year}-${seq}`;
  }

  /**
   * Create a GRN with its line items.
   * goods_receipt_notes.id is SERIAL → do NOT pass id in the insert.
   */
  async create({ poId, receivedBy, grnItems = [], observations }) {
    const grnNumber = await this.generateGRNNumber();

    const totalReceived = grnItems.reduce((s, i) => s + (parseInt(i.quantity_received) || 0), 0);
    const totalRejected = grnItems.reduce((s, i) => s + (parseInt(i.quantity_rejected) || 0), 0);

    const status = totalRejected > 0 ? 'PARTIAL' : (totalReceived > 0 ? 'COMPLETE' : 'PENDING');
    const grnCompliant = totalReceived > 0 && totalRejected === 0;

    const grn = await db.one(
      `INSERT INTO goods_receipt_notes
         (grn_number, po_id, receipt_date, received_by, status, observations)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, $5)
       RETURNING id, grn_number, status`,
      [grnNumber, poId, receivedBy || null, status, observations || null]
    );

    for (const item of grnItems) {
      await db.one(
        `INSERT INTO goods_receipt_items
           (grn_id, item_description, quantity_received, quantity_accepted, quantity_rejected, rejection_reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          grn.id,
          item.item_description || item.description || '-',
          parseInt(item.quantity_received) || 0,
          parseInt(item.quantity_accepted ?? item.quantity_received) || 0,
          parseInt(item.quantity_rejected) || 0,
          item.rejection_reason || null
        ]
      );
    }

    return { id: grn.id, grnNumber: grn.grn_number, status: grn.status, grnCompliant };
  }

  async findById(id) {
    const grn = await db.one(
      `SELECT grn.*,
              po.po_number, po.total_amount AS po_amount, po.requisition_id,
              s.name AS supplier_name,
              u.first_name || ' ' || u.last_name AS received_by_name
       FROM goods_receipt_notes grn
       LEFT JOIN purchase_orders po ON grn.po_id = po.id
       LEFT JOIN suppliers       s  ON po.supplier_id = s.id
       LEFT JOIN users           u  ON grn.received_by = u.id
       WHERE grn.id = $1`,
      [id]
    );
    if (!grn) return null;

    const items = await db.select(
      'SELECT * FROM goods_receipt_items WHERE grn_id = $1 ORDER BY id',
      [id]
    );

    return { ...grn, items };
  }

  async findAll({ poId, status, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    let i = 1;

    if (poId)   { where += ` AND grn.po_id = $${i++}`;    params.push(poId); }
    if (status) { where += ` AND grn.status = $${i++}`;   params.push(status); }

    params.push(limit, offset);

    return db.select(
      `SELECT grn.id, grn.grn_number, grn.status, grn.receipt_date, grn.observations,
              grn.created_at, grn.po_id,
              po.po_number, po.total_amount AS po_amount,
              s.name AS supplier_name,
              u.first_name || ' ' || u.last_name AS received_by_name
       FROM goods_receipt_notes grn
       LEFT JOIN purchase_orders po ON grn.po_id = po.id
       LEFT JOIN suppliers       s  ON po.supplier_id = s.id
       LEFT JOIN users           u  ON grn.received_by = u.id
       ${where}
       ORDER BY grn.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params
    );
  }

  async count({ poId, status } = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    let i = 1;
    if (poId)   { where += ` AND po_id = $${i++}`;  params.push(poId); }
    if (status) { where += ` AND status = $${i++}`; params.push(status); }
    const result = await db.one(
      `SELECT COUNT(*) AS count FROM goods_receipt_notes ${where}`, params
    );
    return parseInt(result.count);
  }

  async findByPOId(poId) {
    return db.select(
      `SELECT grn.*, u.first_name || ' ' || u.last_name AS received_by_name
       FROM goods_receipt_notes grn
       LEFT JOIN users u ON grn.received_by = u.id
       WHERE grn.po_id = $1
       ORDER BY grn.created_at DESC`,
      [poId]
    );
  }

  async updateStatus(id, status) {
    return db.exec(
      'UPDATE goods_receipt_notes SET status = $1 WHERE id = $2',
      [status, id]
    );
  }
}

module.exports = new GoodsReceiptModel();
