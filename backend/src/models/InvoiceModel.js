// backend/src/models/InvoiceModel.js
const db = require('../config/database');
const { getEnterpriseCurrencyCode } = require('../utils/enterpriseCurrency');

const PRICE_TOLERANCE = 0.02; // 2%

class InvoiceModel {

  async generateInvoiceNumber() {
    const year = new Date().getFullYear();
    const result = await db.one(
      `SELECT COUNT(*) AS count FROM invoices
       WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const seq = String(parseInt(result.count) + 1).padStart(4, '0');
    return `INV-${year}-${seq}`;
  }

  /**
   * 3-way matching: PO ↔ GRN ↔ Invoice
   * Returns { match_status, match_details }
   */
  async runThreeWayMatch(invoiceId) {
    const invoice = await this.findById(invoiceId, { withMatch: false });
    if (!invoice) return { match_status: 'PENDING', match_details: {} };

    const details = { checks: [], passed: true };

    // --- Check 1: PO exists and amount ≤ PO total (with tolerance) ---
    if (!invoice.po_id) {
      details.checks.push({ check: 'po_exists', passed: false, message: 'Aucune commande liée' });
      details.passed = false;
    } else {
      const po = await db.one('SELECT total_amount, status FROM purchase_orders WHERE id = $1', [invoice.po_id]);
      const maxAllowed = parseFloat(po.total_amount) * (1 + PRICE_TOLERANCE);
      const amountOk = parseFloat(invoice.total_amount) <= maxAllowed;
      details.checks.push({
        check: 'amount_vs_po',
        passed: amountOk,
        po_amount: po.total_amount,
        invoice_amount: invoice.total_amount,
        tolerance_pct: PRICE_TOLERANCE * 100,
        message: amountOk
          ? `Montant facture (${invoice.total_amount}) ≤ PO (${po.total_amount}) + tolérance ${PRICE_TOLERANCE * 100}%`
          : `Montant facture (${invoice.total_amount}) > PO (${po.total_amount}) + tolérance`
      });
      if (!amountOk) details.passed = false;

      const poApproved = ['PO_APPROVED', 'PO_SENT', 'PO_CONFIRMED'].includes(po.status);
      details.checks.push({
        check: 'po_approved',
        passed: poApproved,
        po_status: po.status,
        message: poApproved ? 'Commande approuvée' : `Commande non approuvée (${po.status})`
      });
      if (!poApproved) details.passed = false;
    }

    // --- Check 2: GRN exists and is COMPLETE ---
    if (!invoice.grn_id) {
      details.checks.push({ check: 'grn_exists', passed: false, message: 'Aucun bon de réception (GRN) lié' });
      details.passed = false;
    } else {
      const grn = await db.one('SELECT status FROM goods_receipt_notes WHERE id = $1', [invoice.grn_id]);
      const grnOk = grn?.status === 'COMPLETE';
      details.checks.push({
        check: 'grn_complete',
        passed: grnOk,
        grn_status: grn?.status,
        message: grnOk ? 'Réception complète (aucun rejet)' : `Réception incomplète (${grn?.status})`
      });
      if (!grnOk) details.passed = false;
    }

    const matchStatus = details.passed ? 'MATCHED' : (
      details.checks.find(c => c.check === 'amount_vs_po' && !c.passed) ? 'PRICE_MISMATCH' :
      details.checks.find(c => c.check === 'grn_exists'  && !c.passed) ? 'NO_GRN' :
      details.checks.find(c => c.check === 'grn_complete' && !c.passed) ? 'GRN_PARTIAL' :
      'MISMATCH'
    );

    const matchDetails = JSON.stringify(details);
    await db.exec(
      `UPDATE invoices SET match_status = $1, match_details = $2, matched_at = NOW()
       WHERE id = $3`,
      [matchStatus, matchDetails, invoiceId]
    );

    return { match_status: matchStatus, match_details: details, invoiceValid: details.passed };
  }

  async create({ invoiceNumber, poId, grnId, supplierId, invoiceDate, dueDate,
                 subtotal, taxAmount, totalAmount, currency, notes, createdBy,
                 processInstanceId, camundaTaskId }) {
    const number = invoiceNumber || await this.generateInvoiceNumber();
    const defaultCurrency = await getEnterpriseCurrencyCode();

    const inv = await db.one(
      `INSERT INTO invoices
         (invoice_number, po_id, grn_id, supplier_id, invoice_date, due_date,
          subtotal, tax_amount, total_amount, currency, notes,
          created_by, process_instance_id, camunda_task_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, invoice_number`,
      [number, poId||null, grnId||null, supplierId||null,
       invoiceDate, dueDate||null,
       subtotal||0, taxAmount||0, totalAmount,
       currency||defaultCurrency, notes||null,
       createdBy||null, processInstanceId||null, camundaTaskId||null]
    );

    // Run 3-way match immediately
    const matchResult = await this.runThreeWayMatch(inv.id);

    return { id: inv.id, invoiceNumber: inv.invoice_number, ...matchResult };
  }

  async findById(id, { withMatch = true } = {}) {
    const inv = await db.one(
      `SELECT inv.*,
              po.po_number, po.total_amount AS po_amount, po.currency AS po_currency,
              grn.grn_number, grn.status AS grn_status,
              s.name AS supplier_name, s.email AS supplier_email,
              u.first_name || ' ' || u.last_name AS created_by_name
       FROM invoices inv
       LEFT JOIN purchase_orders    po  ON inv.po_id = po.id
       LEFT JOIN goods_receipt_notes grn ON inv.grn_id = grn.id
       LEFT JOIN suppliers           s   ON inv.supplier_id = s.id
       LEFT JOIN users               u   ON inv.created_by = u.id
       WHERE inv.id = $1`,
      [id]
    );
    if (!inv) return null;
    if (inv.match_details && typeof inv.match_details === 'string') {
      try { inv.match_details = JSON.parse(inv.match_details); } catch { /**/ }
    }
    return inv;
  }

  async findAll({ poId, grnId, status, matchStatus, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    let i = 1;

    if (poId)        { where += ` AND inv.po_id = $${i++}`;          params.push(poId); }
    if (grnId)       { where += ` AND inv.grn_id = $${i++}`;         params.push(grnId); }
    if (status)      { where += ` AND inv.status = $${i++}`;         params.push(status); }
    if (matchStatus) { where += ` AND inv.match_status = $${i++}`;   params.push(matchStatus); }

    params.push(limit, offset);

    return db.select(
      `SELECT inv.id, inv.invoice_number, inv.status, inv.match_status,
              inv.total_amount, inv.currency, inv.invoice_date, inv.due_date,
              inv.created_at,
              po.po_number, s.name AS supplier_name
       FROM invoices inv
       LEFT JOIN purchase_orders po ON inv.po_id = po.id
       LEFT JOIN suppliers       s  ON inv.supplier_id = s.id
       ${where}
       ORDER BY inv.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params
    );
  }

  async count({ status, matchStatus } = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    let i = 1;
    if (status)      { where += ` AND status = $${i++}`;       params.push(status); }
    if (matchStatus) { where += ` AND match_status = $${i++}`; params.push(matchStatus); }
    const result = await db.one(`SELECT COUNT(*) AS count FROM invoices ${where}`, params);
    return parseInt(result.count);
  }

  async updateStatus(id, status, extra = {}) {
    const fields = { status, updated_at: new Date(), ...extra };
    return db.update('invoices', fields, 'id', id);
  }

  async approve(id, userId, comments) {
    return db.exec(
      `UPDATE invoices SET status='APPROVED', updated_at=NOW()
       WHERE id = $1`,
      [id]
    );
  }

  async reject(id, userId, reason) {
    return db.exec(
      `UPDATE invoices SET status='REJECTED', rejection_reason=$1, updated_at=NOW()
       WHERE id = $2`,
      [reason, id]
    );
  }
}

module.exports = new InvoiceModel();
