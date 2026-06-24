// backend/src/models/PaymentModel.js
const db = require('../config/database');
const { getEnterpriseCurrencyCode } = require('../utils/enterpriseCurrency');

class PaymentModel {

  async generatePaymentNumber() {
    const year = new Date().getFullYear();
    const result = await db.one(
      `SELECT COUNT(*) AS count FROM payments
       WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const seq = String(parseInt(result.count) + 1).padStart(4, '0');
    return `PAY-${year}-${seq}`;
  }

  async create({ invoiceId, poId, paymentDate, amount, currency, paymentMethod,
                 reference, bankAccount, notes, createdBy, processInstanceId, camundaTaskId }) {
    const paymentNumber = await this.generatePaymentNumber();
    const defaultCurrency = await getEnterpriseCurrencyCode();

    const pay = await db.one(
      `INSERT INTO payments
         (payment_number, invoice_id, po_id, payment_date, amount, currency,
          payment_method, reference, bank_account, notes,
          created_by, process_instance_id, camunda_task_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, payment_number`,
      [
        paymentNumber,
        invoiceId || null, poId || null,
        paymentDate || null,
        amount, currency || defaultCurrency,
        paymentMethod || 'BANK_TRANSFER',
        reference || null, bankAccount || null,
        notes || null,
        createdBy || null,
        processInstanceId || null,
        camundaTaskId || null
      ]
    );

    // Mark linked invoice as PAID (if fully paid)
    if (invoiceId) {
      const invoice = await db.one('SELECT total_amount FROM invoices WHERE id = $1', [invoiceId]);
      if (invoice) {
        const paid = parseFloat(amount) >= parseFloat(invoice.total_amount);
        await db.exec(
          `UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2`,
          [paid ? 'PAID' : 'PARTIALLY_PAID', invoiceId]
        );
      }
    }

    return { id: pay.id, paymentNumber: pay.payment_number, status: 'PENDING', amount, currency: currency || defaultCurrency };
  }

  async findById(id) {
    return db.one(
      `SELECT pay.*,
              inv.invoice_number, inv.total_amount AS invoice_amount, inv.status AS invoice_status,
              po.po_number,
              s.name AS supplier_name,
              u.first_name || ' ' || u.last_name AS created_by_name
       FROM payments pay
       LEFT JOIN invoices        inv ON pay.invoice_id = inv.id
       LEFT JOIN purchase_orders po  ON COALESCE(pay.po_id, inv.po_id) = po.id
       LEFT JOIN suppliers       s   ON po.supplier_id = s.id
       LEFT JOIN users           u   ON pay.created_by = u.id
       WHERE pay.id = $1`,
      [id]
    );
  }

  async findAll({ invoiceId, poId, status, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    let i = 1;

    if (invoiceId) { where += ` AND pay.invoice_id = $${i++}`; params.push(invoiceId); }
    if (poId)      { where += ` AND pay.po_id = $${i++}`;      params.push(poId); }
    if (status)    { where += ` AND pay.status = $${i++}`;      params.push(status); }

    params.push(limit, offset);

    return db.select(
      `SELECT pay.id, pay.payment_number, pay.status, pay.amount, pay.currency,
              pay.payment_method, pay.payment_date, pay.reference, pay.created_at,
              inv.invoice_number, po.po_number,
              s.name AS supplier_name
       FROM payments pay
       LEFT JOIN invoices        inv ON pay.invoice_id = inv.id
       LEFT JOIN purchase_orders po  ON COALESCE(pay.po_id, inv.po_id) = po.id
       LEFT JOIN suppliers       s   ON po.supplier_id = s.id
       ${where}
       ORDER BY pay.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params
    );
  }

  async count({ status } = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    let i = 1;
    if (status) { where += ` AND status = $${i++}`; params.push(status); }
    const result = await db.one(`SELECT COUNT(*) AS count FROM payments ${where}`, params);
    return parseInt(result.count);
  }

  async updateStatus(id, status, extra = {}) {
    const fields = { status, updated_at: new Date(), ...extra };
    return db.update('payments', fields, 'id', id);
  }

  async approve(id, userId) {
    return db.exec(
      `UPDATE payments SET status='PAID', approved_by=$1, approved_at=NOW(), updated_at=NOW()
       WHERE id = $2`,
      [userId, id]
    );
  }
}

module.exports = new PaymentModel();
