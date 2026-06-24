const db = require('../config/database');

class ServiceAcceptanceModel {

  async generateSANNumber() {
    const year = new Date().getFullYear();
    const result = await db.one(
      `SELECT COUNT(*) AS count FROM service_acceptance_notes
       WHERE EXTRACT(YEAR FROM COALESCE(acceptance_date, created_at)) = $1`,
      [year]
    );
    const seq = String(parseInt(result.count) + 1).padStart(4, '0');
    return `SAN-${year}-${seq}`;
  }

  async create({ poId, grnId, acceptedBy, comments, serviceAccepted }) {
    const sanNumber = await this.generateSANNumber();
    const status = serviceAccepted === false ? 'REJECTED' : 'ACCEPTED';

    const san = await db.one(
      `INSERT INTO service_acceptance_notes
         (san_number, po_id, acceptance_date, accepted_by, status, comments)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, $5)
       RETURNING id, san_number, status`,
      [sanNumber, poId, acceptedBy || null, status, comments || null]
    );

    return { id: san.id, sanNumber: san.san_number, status: san.status, serviceAccepted: status === 'ACCEPTED' };
  }

  async findById(id) {
    return db.one(
      `SELECT san.*,
              po.po_number, po.total_amount AS po_amount, po.supplier_id,
              s.name AS supplier_name,
              u.first_name || ' ' || u.last_name AS accepted_by_name,
              r.id AS requisition_id, r.requisition_number
       FROM service_acceptance_notes san
       LEFT JOIN purchase_orders po ON san.po_id = po.id
       LEFT JOIN suppliers        s  ON po.supplier_id = s.id
       LEFT JOIN users            u  ON san.accepted_by = u.id
       LEFT JOIN requisitions     r  ON po.requisition_id = r.id
       WHERE san.id = $1`,
      [id]
    );
  }

  async findAll({ poId, status, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    let i = 1;

    if (poId)   { where += ` AND san.po_id = $${i++}`;   params.push(poId); }
    if (status) { where += ` AND san.status = $${i++}`;  params.push(status); }

    params.push(limit, offset);

    return db.select(
      `SELECT san.id, san.san_number, san.status, san.acceptance_date, san.comments,
              san.created_at, san.po_id,
              po.po_number,
              s.name AS supplier_name,
              u.first_name || ' ' || u.last_name AS accepted_by_name
       FROM service_acceptance_notes san
       LEFT JOIN purchase_orders po ON san.po_id = po.id
       LEFT JOIN suppliers        s  ON po.supplier_id = s.id
       LEFT JOIN users            u  ON san.accepted_by = u.id
       ${where}
       ORDER BY san.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      params
    );
  }

  async count({ status } = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    let i = 1;
    if (status) { where += ` AND status = $${i++}`; params.push(status); }
    const result = await db.one(
      `SELECT COUNT(*) AS count FROM service_acceptance_notes ${where}`, params
    );
    return parseInt(result.count);
  }

  async findByPOId(poId) {
    return db.select(
      `SELECT san.*, u.first_name || ' ' || u.last_name AS accepted_by_name
       FROM service_acceptance_notes san
       LEFT JOIN users u ON san.accepted_by = u.id
       WHERE san.po_id = $1
       ORDER BY san.created_at DESC`,
      [poId]
    );
  }
}

module.exports = new ServiceAcceptanceModel();
