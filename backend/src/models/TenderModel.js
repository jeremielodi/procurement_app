// backend/src/models/TenderModel.js
const db = require('../config/database');
const tenant = require('../utils/tenant');

// Statut calculé à partir des dates : OPEN en base devient UPCOMING / CLOSED selon NOW()
const EFFECTIVE_STATUS_SQL = `
  CASE
    WHEN t.status <> 'OPEN' THEN t.status
    WHEN NOW() < t.start_date THEN 'UPCOMING'
    WHEN NOW() > t.end_date THEN 'CLOSED'
    ELSE 'OPEN'
  END`;

class TenderModel {

  async getAll({ status, search } = {}) {
    let sql = `
      SELECT t.*, ${EFFECTIVE_STATUS_SQL} AS effective_status,
             r.requisition_number, r.title AS requisition_title, r.estimated_amount,
             c.format_key AS currency_code,
             s.name AS awarded_supplier_name,
             mc.name AS category_name, loc.name AS location_name,
             (SELECT COUNT(*) FROM tender_submissions ts WHERE ts.tender_id = t.id)::int AS submission_count
      FROM tenders t
      JOIN requisitions r ON r.id = t.requisition_id
      LEFT JOIN currency c ON c.id = r.currency_id
      LEFT JOIN suppliers s ON s.id = t.awarded_supplier_id
      LEFT JOIN market_categories mc ON mc.id = t.category_id
      LEFT JOIN locations loc ON loc.id = t.location_id
      WHERE 1=1`;
    const params = [];
    sql += tenant.filter('t.enterprise_id', params);
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (t.tender_number ILIKE $${params.length} OR t.title ILIKE $${params.length} OR r.requisition_number ILIKE $${params.length})`;
    }
    sql = `SELECT * FROM (${sql}) x`;
    if (status) {
      params.push(status);
      sql += ` WHERE x.effective_status = $${params.length}`;
    }
    sql += ' ORDER BY x.created_at DESC';
    return db.select(sql, params);
  }

  async getById(id) {
    return db.one(
      `SELECT t.*, ${EFFECTIVE_STATUS_SQL} AS effective_status,
              r.requisition_number, r.title AS requisition_title, r.description AS requisition_description,
              r.estimated_amount, r.process_instance_id,
              c.format_key AS currency_code, c.symbol AS currency_symbol,
              d.name AS department_name, p.name AS project_name,
              s.name AS awarded_supplier_name,
              u.first_name || ' ' || u.last_name AS created_by_name,
              e.name AS enterprise_name, e.logo_path AS enterprise_logo_path,
              mc.name AS category_name, loc.name AS location_name
       FROM tenders t
       JOIN requisitions r ON r.id = t.requisition_id
       LEFT JOIN currency c ON c.id = r.currency_id
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN suppliers s ON s.id = t.awarded_supplier_id
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN enterprise e ON e.id = t.enterprise_id
       LEFT JOIN market_categories mc ON mc.id = t.category_id
       LEFT JOIN locations loc ON loc.id = t.location_id
       WHERE t.id = $1`,
      [id]
    );
  }

  async getByRequisition(requisitionId) {
    return db.one(
      `SELECT t.*, ${EFFECTIVE_STATUS_SQL} AS effective_status
       FROM tenders t WHERE t.requisition_id = $1 AND t.status <> 'CANCELLED'
       ORDER BY t.created_at DESC LIMIT 1`,
      [requisitionId]
    );
  }

  async getByNumber(tenderNumber) {
    // Numéro unique par entreprise
    const params = [tenderNumber];
    return db.one(`SELECT id FROM tenders WHERE LOWER(tender_number) = LOWER($1)${tenant.filter('enterprise_id', params)}`, params);
  }

  async getItems(requisitionId) {
    return db.select(
      `SELECT id, item_description, quantity, frequency, specifications
       FROM requisition_items WHERE requisition_id = $1 ORDER BY id`,
      [requisitionId]
    );
  }

  async create(data) {
    return db.one(
      `INSERT INTO tenders
         (tender_number, requisition_id, task_id, title, description,
          start_date, end_date, max_delivery_days, status, created_by, audience, category_id, location_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', $9, $10, $11, $12)
       RETURNING *`,
      [data.tenderNumber, data.requisitionId, data.taskId || null, data.title, data.description || null,
       data.startDate, data.endDate, data.maxDeliveryDays, data.createdBy,
       data.audience, data.categoryId, data.locationId]
    );
  }

  async update(id, data) {
    return db.update('tenders', {
      title: data.title,
      description: data.description || null,
      start_date: data.startDate,
      end_date: data.endDate,
      max_delivery_days: data.maxDeliveryDays,
      audience: data.audience,
      category_id: data.categoryId,
      location_id: data.locationId,
      updated_at: new Date()
    }, 'id', id);
  }

  async setStatus(id, fields) {
    return db.update('tenders', { ...fields, updated_at: new Date() }, 'id', id);
  }

  // ---------- Soumissions ----------

  async getSubmissions(tenderId) {
    const submissions = await db.select(
      `SELECT ts.*, s.name AS supplier_name, s.supplier_code, s.email AS supplier_email,
              s.phone AS supplier_phone, s.logo_path
       FROM tender_submissions ts
       JOIN suppliers s ON s.id = ts.supplier_id
       WHERE ts.tender_id = $1
       ORDER BY ts.total_amount ASC`,
      [tenderId]
    );
    if (submissions.length === 0) return [];
    const items = await db.select(
      `SELECT tsi.* FROM tender_submission_items tsi
       JOIN tender_submissions ts ON ts.id = tsi.submission_id
       WHERE ts.tender_id = $1`,
      [tenderId]
    );
    return submissions.map(s => ({ ...s, items: items.filter(i => i.submission_id === s.id) }));
  }

  async getSubmission(tenderId, supplierId) {
    const submission = await db.one(
      'SELECT * FROM tender_submissions WHERE tender_id = $1 AND supplier_id = $2',
      [tenderId, supplierId]
    );
    if (!submission) return null;
    submission.items = await db.select(
      'SELECT * FROM tender_submission_items WHERE submission_id = $1',
      [submission.id]
    );
    return submission;
  }

  /**
   * Crée ou remplace la soumission d'un fournisseur.
   * items : [{ requisitionItemId, unitPrice, comment }] — quantités prises depuis la réquisition.
   */
  async upsertSubmission(tenderId, supplierId, { deliveryDays, notes, items }, reqItems) {
    const byId = new Map(reqItems.map(i => [String(i.id), i]));
    const lines = items.map(i => {
      const ri = byId.get(String(i.requisitionItemId));
      const qty = parseFloat(ri.quantity) * parseFloat(ri.frequency || 1);
      const unitPrice = parseFloat(i.unitPrice);
      return { requisitionItemId: ri.id, unitPrice, totalPrice: qty * unitPrice, comment: i.comment || null };
    });
    const totalAmount = lines.reduce((s, l) => s + l.totalPrice, 0);

    const existing = await db.one(
      'SELECT id FROM tender_submissions WHERE tender_id = $1 AND supplier_id = $2',
      [tenderId, supplierId]
    );

    const transaction = db.transaction();
    let submissionId = existing?.id;
    if (existing) {
      transaction.addUpdateQuery('tender_submissions', {
        delivery_days: deliveryDays,
        notes: notes || null,
        total_amount: totalAmount,
        updated_at: new Date()
      }, 'id', existing.id);
      transaction.addDeleteQuery('tender_submission_items', 'submission_id', existing.id);
      for (const l of lines) {
        transaction.addInsertQuery('tender_submission_items', {
          submission_id: existing.id,
          requisition_item_id: l.requisitionItemId,
          unit_price: l.unitPrice,
          total_price: l.totalPrice,
          comment: l.comment
        });
      }
      await transaction.execute();
    } else {
      const created = await db.one(
        `INSERT INTO tender_submissions (tender_id, supplier_id, delivery_days, notes, total_amount)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenderId, supplierId, deliveryDays, notes || null, totalAmount]
      );
      submissionId = created.id;
      for (const l of lines) {
        transaction.addInsertQuery('tender_submission_items', {
          submission_id: submissionId,
          requisition_item_id: l.requisitionItemId,
          unit_price: l.unitPrice,
          total_price: l.totalPrice,
          comment: l.comment
        });
      }
      try {
        await transaction.execute();
      } catch (e) {
        await db.delete('tender_submissions', 'id', submissionId);
        throw e;
      }
    }
    return { id: submissionId, totalAmount, updated: !!existing };
  }

  // ---------- Vue fournisseur ----------

  async getForSupplier(supplierId) {
    return db.select(
      `SELECT * FROM (
         SELECT t.id, t.tender_number, t.title, t.description, t.start_date, t.end_date,
                t.max_delivery_days, ${EFFECTIVE_STATUS_SQL} AS effective_status,
                t.audience, mc.name AS category_name, loc.name AS location_name,
                (t.awarded_supplier_id = $1) AS is_awarded_to_me,
                c.format_key AS currency_code,
                e.id AS enterprise_id, e.name AS enterprise_name, e.logo_path AS enterprise_logo_path,
                ts.id AS my_submission_id, ts.total_amount AS my_total, ts.updated_at AS my_submitted_at
         FROM tenders t
         JOIN requisitions r ON r.id = t.requisition_id
         LEFT JOIN currency c ON c.id = r.currency_id
         LEFT JOIN tender_submissions ts ON ts.tender_id = t.id AND ts.supplier_id = $1
         LEFT JOIN enterprise e ON e.id = t.enterprise_id
         LEFT JOIN market_categories mc ON mc.id = t.category_id
         LEFT JOIN locations loc ON loc.id = t.location_id
         WHERE t.status <> 'CANCELLED' AND COALESCE(e.is_active, TRUE)
           AND (ts.id IS NOT NULL OR supplier_eligible_for_tender($1, t.id))
       ) x
       ORDER BY x.end_date DESC`,
      [supplierId]
    );
  }

  /** Fournisseurs inscrits actifs ; avec un AO : seulement ceux qui y sont éligibles */
  async countRegisteredSuppliers(tenderId = null) {
    const r = await db.one(
      `SELECT COUNT(*)::int AS count FROM suppliers s
       JOIN users u ON u.id = s.user_id
       WHERE u.is_active = true AND s.status = 'ACTIVE'
         AND ($1::int IS NULL OR supplier_eligible_for_tender(s.id, $1))`,
      [tenderId]
    );
    return r.count;
  }

  async getRegisteredSupplierRecipients(tenderId = null) {
    return db.select(
      `SELECT s.id, s.name, s.email AS supplier_email, u.id AS user_id, u.email AS user_email, u.language
       FROM suppliers s JOIN users u ON u.id = s.user_id
       WHERE u.is_active = true AND s.status = 'ACTIVE'
         AND ($1::int IS NULL OR supplier_eligible_for_tender(s.id, $1))`,
      [tenderId]
    );
  }

  // ---------- AO réservé : candidats et invitations ----------

  /**
   * Fournisseurs que l'acheteur peut inviter : préqualifiés par l'entreprise courante dans la catégorie,
   * actifs, desservant la localisation (si définie). has_account = peut se connecter au portail pour soumettre.
   */
  async getCandidates({ categoryId, locationId }) {
    const params = [categoryId, locationId || null];
    return db.select(
      `SELECT s.id, s.supplier_code, s.name, s.supplier_type, s.rating,
              (u.id IS NOT NULL AND u.is_active) AS has_account,
              ARRAY(SELECT l.name FROM supplier_locations sl JOIN locations l ON l.id = sl.location_id
                    WHERE sl.supplier_id = s.id ORDER BY l.name) AS location_names
       FROM supplier_prequalifications sp
       JOIN suppliers s ON s.id = sp.supplier_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE sp.category_id = $1 AND sp.status = 'APPROVED' AND s.status = 'ACTIVE'
         AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM supplier_locations sl WHERE sl.supplier_id = s.id AND sl.location_id = $2))
         ${tenant.filter('sp.enterprise_id', params)}
       ORDER BY s.name`,
      params
    );
  }

  async getInvitations(tenderId) {
    return db.select(
      `SELECT ti.supplier_id, ti.invited_at, s.supplier_code, s.name AS supplier_name, s.supplier_type,
              (u.id IS NOT NULL AND u.is_active) AS has_account,
              EXISTS (SELECT 1 FROM tender_submissions ts WHERE ts.tender_id = ti.tender_id AND ts.supplier_id = ti.supplier_id) AS submitted
       FROM tender_invitations ti
       JOIN suppliers s ON s.id = ti.supplier_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE ti.tender_id = $1
       ORDER BY s.name`,
      [tenderId]
    );
  }

  /**
   * Remplace la liste des invités : ajoute les nouveaux, retire les autres SAUF ceux qui ont déjà soumis.
   * Renvoie { added, removed, kept } (ids).
   */
  async setInvitations(tenderId, supplierIds, userId) {
    const wanted = new Set(supplierIds.map(Number));
    const current = await this.getInvitations(tenderId);
    const currentIds = new Set(current.map(i => i.supplier_id));
    const added = [...wanted].filter(id => !currentIds.has(id));
    const removable = current.filter(i => !wanted.has(i.supplier_id) && !i.submitted).map(i => i.supplier_id);
    const kept = current.filter(i => !wanted.has(i.supplier_id) && i.submitted).map(i => i.supplier_id);
    for (const id of added) {
      await db.exec(
        `INSERT INTO tender_invitations (tender_id, supplier_id, invited_by) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [tenderId, id, userId]
      );
    }
    if (removable.length) {
      await db.exec('DELETE FROM tender_invitations WHERE tender_id = $1 AND supplier_id = ANY($2::int[])', [tenderId, removable]);
    }
    return { added, removed: removable, kept };
  }

  async isSupplierEligible(supplierId, tenderId) {
    const r = await db.one('SELECT supplier_eligible_for_tender($1, $2) AS ok', [supplierId, tenderId]);
    return !!r?.ok;
  }
}

module.exports = new TenderModel();
