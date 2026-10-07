// backend/src/models/StockIssueModel.js
// Bons de sortie : articles remis à un utilisateur de l'entreprise depuis un dépôt.
// Création ATOMIQUE (db.withTransaction) : soldes verrouillés (FOR UPDATE), lots alloués FEFO
// (péremption la plus proche d'abord, lots périmés exclus) sauf lot imposé, mouvements ISSUE.
// Annulation = mouvements ISSUE_REVERSAL (retour en stock), jamais de suppression.
const db = require('../config/database');
const tenant = require('../utils/tenant');
const stockModel = require('./StockModel');
const warehouseModel = require('./WarehouseModel');

const EPS = 1e-9;
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n) => Number(n.toFixed(4)).toString();

const HEADER_SQL = `
  SELECT si.*, w.code AS warehouse_code, w.name AS warehouse_name, l.name AS warehouse_location,
         TRIM(COALESCE(r.first_name, '') || ' ' || COALESCE(r.last_name, '')) AS recipient_name, r.email AS recipient_email,
         TRIM(COALESCE(ib.first_name, '') || ' ' || COALESCE(ib.last_name, '')) AS issued_by_name,
         TRIM(COALESCE(cb.first_name, '') || ' ' || COALESCE(cb.last_name, '')) AS cancelled_by_name,
         p.code AS project_code, p.name AS project_name
  FROM stock_issues si
  JOIN warehouses w ON w.id = si.warehouse_id
  JOIN locations l ON l.id = w.location_id
  JOIN users r ON r.id = si.recipient_id
  LEFT JOIN users ib ON ib.id = si.issued_by
  LEFT JOIN users cb ON cb.id = si.cancelled_by
  LEFT JOIN projects p ON p.id = si.project_id`;

class StockIssueModel {
  /**
   * @param {object} data     { warehouseId, recipientId, projectId, purpose, lines: [{ stockItemId, lotId?, quantity }] }
   * @param {object} context  { userId } — doit avoir accès au dépôt
   */
  async create({ warehouseId, recipientId, projectId, purpose, lines = [] }, { userId }) {
    if (!Array.isArray(lines) || !lines.length) throw fail(400, 'NO_LINES', 'Ajoutez au moins un article');

    const warehouse = (await warehouseModel.accessibleFor(userId)).find(w => String(w.id) === String(warehouseId));
    if (!warehouse) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès à ce dépôt');

    return db.withTransaction(async (tx) => {
      const recipient = await tx.one(
        `SELECT u.id, u.enterprise_id, u.is_active,
                EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id = 'prof_supplier') AS is_supplier
         FROM users u WHERE u.id = $1`,
        [recipientId]
      );
      if (!recipient || !recipient.is_active || recipient.is_supplier || String(recipient.enterprise_id) !== String(warehouse.enterprise_id)) {
        throw fail(400, 'RECIPIENT_INVALID', 'Bénéficiaire introuvable ou inactif');
      }

      // ---- Allocation des quantités (soldes verrouillés)
      const used = new Map(); // balance id → quantité déjà allouée dans ce bon
      const allocations = [];
      const today = new Date().toISOString().slice(0, 10);
      for (const [index, raw] of lines.entries()) {
        const item = await tx.one(
          'SELECT id, enterprise_id, code, name, unit, is_stockable, track_lots, track_serials FROM stock_items WHERE id = $1',
          [raw.stockItemId]
        );
        if (!item || String(item.enterprise_id) !== String(warehouse.enterprise_id)) throw fail(400, 'ITEM_NOT_FOUND', 'Article introuvable', { line: index });
        if (!item.is_stockable) throw fail(400, 'ITEM_NOT_STOCKABLE', `${item.name} : article non stocké`, { line: index });

        if (item.track_serials) {
          const unitIds = [...new Set((raw.unitIds || []).map(String))];
          if (!unitIds.length) throw fail(400, 'UNITS_REQUIRED', `${item.name} : choisissez les équipements (n° de série) à remettre`, { line: index });
          const units = await tx.select(
            `SELECT id, serial_number, status, condition, warehouse_id, stock_item_id FROM stock_units
             WHERE id::text = ANY($1::text[]) FOR UPDATE`,
            [unitIds]
          );
          for (const id of unitIds) {
            const u = units.find(x => String(x.id) === id);
            if (!u || String(u.stock_item_id) !== String(item.id) || u.status !== 'IN_STOCK' || String(u.warehouse_id) !== String(warehouse.id) || u.condition !== 'GOOD' || used.has(`unit:${id}`)) {
              throw fail(400, 'UNIT_UNAVAILABLE', `${item.name} : équipement ${u?.serial_number || id} indisponible (pas en stock dans ce dépôt, endommagé ou déjà choisi)`, { line: index });
            }
            used.set(`unit:${id}`, 1);
            allocations.push({ item, lotId: null, unitId: u.id, quantity: 1 });
          }
          continue;
        }

        const quantity = num(raw.quantity);
        if (!(quantity > EPS)) throw fail(400, 'INVALID_QUANTITY', 'Quantité invalide', { line: index });

        const params = [item.id, warehouse.id];
        let sql = `
          SELECT b.id, b.lot_id, b.quantity, lt.lot_number, lt.expiry_date
          FROM stock_balances b LEFT JOIN stock_lots lt ON lt.id = b.lot_id
          WHERE b.stock_item_id = $1 AND b.warehouse_id = $2 AND b.quantity > 0`;
        if (raw.lotId) {
          params.push(raw.lotId);
          sql += ' AND b.lot_id = $3';
        } else if (item.track_lots) {
          sql += ` AND (lt.expiry_date IS NULL OR lt.expiry_date >= CURRENT_DATE)`;
        } else {
          sql += ' AND b.lot_id IS NULL';
        }
        // FEFO : péremption la plus proche d'abord, puis lot le plus ancien
        sql += ' ORDER BY lt.expiry_date NULLS LAST, lt.created_at NULLS LAST FOR UPDATE OF b';
        const balances = await tx.select(sql, params);

        if (raw.lotId) {
          const lot = balances[0];
          if (lot?.expiry_date && new Date(lot.expiry_date).toISOString().slice(0, 10) < today) {
            throw fail(400, 'LOT_EXPIRED', `${item.name} : lot ${lot.lot_number} périmé`, { line: index });
          }
        }

        let remaining = quantity;
        for (const b of balances) {
          const free = num(b.quantity) - (used.get(b.id) || 0);
          if (free <= EPS) continue;
          const take = Math.min(free, remaining);
          used.set(b.id, (used.get(b.id) || 0) + take);
          allocations.push({ item, lotId: b.lot_id, quantity: take });
          remaining -= take;
          if (remaining <= EPS) break;
        }
        if (remaining > EPS) {
          const available = quantity - remaining;
          throw fail(400, 'STOCK_INSUFFICIENT',
            `${item.name} : ${fmt(quantity)} ${item.unit} demandé(s), ${fmt(available)} disponible(s)${item.track_lots && !raw.lotId ? ' (lots non périmés)' : ''}`,
            { line: index, available });
        }
      }

      // ---- Bon et mouvements
      const issue = await tx.one(
        `INSERT INTO stock_issues (enterprise_id, warehouse_id, recipient_id, project_id, purpose, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, issue_number`,
        [warehouse.enterprise_id, warehouse.id, recipient.id, projectId || null, purpose ? String(purpose).slice(0, 2000) : null, userId]
      );
      for (const a of allocations) {
        const line = await tx.one(
          'INSERT INTO stock_issue_lines (issue_id, stock_item_id, lot_id, quantity, unit_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [issue.id, a.item.id, a.lotId, a.quantity, a.unitId || null]
        );
        if (a.unitId) {
          await tx.exec(
            `UPDATE stock_units SET status = 'ASSIGNED', holder_id = $2, warehouse_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [a.unitId, recipient.id]
          );
        }
        const movement = await stockModel.addMovement(tx, {
          enterpriseId: warehouse.enterprise_id, stockItemId: a.item.id, warehouseId: warehouse.id, lotId: a.lotId, unitId: a.unitId,
          type: 'ISSUE', quantity: -a.quantity, sourceType: 'ISSUE', sourceId: issue.id, sourceLineId: line.id,
          comment: issue.issue_number, performedBy: userId,
        });
        await tx.exec('UPDATE stock_issue_lines SET stock_movement_id = $1 WHERE id = $2', [movement.id, line.id]);
      }
      return { id: issue.id, issueNumber: issue.issue_number, lines: allocations.length, recipientId: recipient.id };
    });
  }

  async list({ warehouseId, recipientId, status, search, fromDate, toDate, mine, userId, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('si.enterprise_id', params)}`;
    if (mine) { params.push(userId); where += ` AND si.recipient_id = $${params.length}`; }
    if (warehouseId) { params.push(warehouseId); where += ` AND si.warehouse_id = $${params.length}`; }
    if (recipientId) { params.push(recipientId); where += ` AND si.recipient_id = $${params.length}`; }
    if (status) { params.push(status); where += ` AND si.status = $${params.length}`; }
    if (fromDate) { params.push(fromDate); where += ` AND si.issued_at >= $${params.length}::date`; }
    if (toDate) { params.push(toDate); where += ` AND si.issued_at < ($${params.length}::date + 1)`; }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      where += ` AND (si.issue_number ILIKE $${params.length} OR r.first_name ILIKE $${params.length} OR r.last_name ILIKE $${params.length}
                 OR r.email ILIKE $${params.length} OR si.purpose ILIKE $${params.length}
                 OR EXISTS (SELECT 1 FROM stock_issue_lines il JOIN stock_items it ON it.id = il.stock_item_id
                            WHERE il.issue_id = si.id AND (it.code ILIKE $${params.length} OR it.name ILIKE $${params.length})))`;
    }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM stock_issues si JOIN users r ON r.id = si.recipient_id ${where}`, params)).n;
    params.push(Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0);
    const rows = await db.select(
      `SELECT * FROM (${HEADER_SQL} ${where}) x
       ORDER BY x.issued_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    if (rows.length) {
      const summary = await db.select(
        `SELECT il.issue_id, COUNT(*)::int AS line_count,
                STRING_AGG(DISTINCT it.name, ', ') AS items
         FROM stock_issue_lines il JOIN stock_items it ON it.id = il.stock_item_id
         WHERE il.issue_id = ANY($1::uuid[]) GROUP BY il.issue_id`,
        [rows.map(r => r.id)]
      );
      const byId = new Map(summary.map(s => [s.issue_id, s]));
      for (const r of rows) Object.assign(r, { line_count: byId.get(r.id)?.line_count || 0, items: byId.get(r.id)?.items || '' });
    }
    return { rows, total };
  }

  async getById(id) {
    const issue = await db.one(`${HEADER_SQL} WHERE si.id = $1`, [id]);
    if (!issue) return null;
    issue.lines = await db.select(
      `SELECT il.id, il.quantity::float8 AS quantity, il.returned_quantity::float8 AS returned_quantity, il.stock_item_id, il.lot_id, il.unit_id,
              un.serial_number, un.asset_tag, un.status AS unit_status, it.track_serials,
              it.code AS item_code, it.name AS item_name, it.unit,
              lt.lot_number, lt.expiry_date, m.movement_number, rm.movement_number AS reversal_movement_number
       FROM stock_issue_lines il
       JOIN stock_items it ON it.id = il.stock_item_id
       LEFT JOIN stock_lots lt ON lt.id = il.lot_id
       LEFT JOIN stock_movements m ON m.id = il.stock_movement_id
       LEFT JOIN stock_movements rm ON rm.id = il.reversal_movement_id
       LEFT JOIN stock_units un ON un.id = il.unit_id
       WHERE il.issue_id = $1
       ORDER BY it.name, lt.expiry_date NULLS LAST`,
      [id]
    );
    return issue;
  }

  /** Accusé de réception par le bénéficiaire */
  async acknowledge(id, { userId, comment }) {
    return db.withTransaction(async (tx) => {
      const issue = await tx.one('SELECT id, recipient_id, status, acknowledged_at FROM stock_issues WHERE id = $1 FOR UPDATE', [id]);
      if (!issue) throw fail(404, 'NOT_FOUND', 'Bon de sortie introuvable');
      if (String(issue.recipient_id) !== String(userId)) throw fail(403, 'NOT_RECIPIENT', 'Seul le bénéficiaire peut confirmer la réception');
      if (issue.status !== 'ISSUED') throw fail(409, 'CANCELLED', 'Bon de sortie annulé');
      if (issue.acknowledged_at) throw fail(409, 'ALREADY_ACKNOWLEDGED', 'Réception déjà confirmée');
      await tx.exec(
        'UPDATE stock_issues SET acknowledged_at = CURRENT_TIMESTAMP, acknowledgement_comment = $2 WHERE id = $1',
        [id, comment ? String(comment).slice(0, 1000) : null]
      );
      return { id };
    });
  }

  /** Annulation / retour en stock : mouvements inverses (ISSUE_REVERSAL) */
  async cancel(id, { userId, reason }) {
    return db.withTransaction(async (tx) => {
      const issue = await tx.one('SELECT id, issue_number, status, enterprise_id, warehouse_id, recipient_id FROM stock_issues WHERE id = $1 FOR UPDATE', [id]);
      if (!issue) throw fail(404, 'NOT_FOUND', 'Bon de sortie introuvable');
      if (issue.status === 'CANCELLED') throw fail(409, 'ALREADY_CANCELLED', 'Bon de sortie déjà annulé');
      if (!(await warehouseModel.canOperate(userId, issue.warehouse_id))) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès au dépôt de cette sortie');
      const lines = await tx.select(
        `SELECT il.id, il.stock_item_id, il.lot_id, il.quantity, il.unit_id, il.returned_quantity FROM stock_issue_lines il WHERE il.issue_id = $1`,
        [id]
      );
      if (lines.some(l => num(l.returned_quantity) > 0)) {
        throw fail(409, 'HAS_RETURNS', 'Des articles de ce bon ont déjà été rendus : enregistrez un retour pour le reste au lieu d\'annuler');
      }
      for (const line of lines) {
        if (line.unit_id) {
          await tx.exec(
            `UPDATE stock_units SET status = 'IN_STOCK', holder_id = NULL, warehouse_id = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'ASSIGNED'`,
            [line.unit_id, issue.warehouse_id]
          );
        }
        const movement = await stockModel.addMovement(tx, {
          enterpriseId: issue.enterprise_id, stockItemId: line.stock_item_id, warehouseId: issue.warehouse_id, lotId: line.lot_id, unitId: line.unit_id,
          type: 'ISSUE_REVERSAL', quantity: Math.abs(num(line.quantity)), sourceType: 'ISSUE', sourceId: issue.id, sourceLineId: line.id,
          comment: `Annulation ${issue.issue_number}${reason ? ` — ${reason}` : ''}`, performedBy: userId,
        });
        await tx.exec('UPDATE stock_issue_lines SET reversal_movement_id = $1 WHERE id = $2', [movement.id, line.id]);
      }
      await tx.exec(
        `UPDATE stock_issues SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = $3 WHERE id = $1`,
        [id, userId, reason ? String(reason).slice(0, 1000) : null]
      );
      return { id: issue.id, issueNumber: issue.issue_number, recipientId: issue.recipient_id, reversedMovements: lines.length };
    });
  }

  /** Bénéficiaires possibles : utilisateurs actifs de l'entreprise (hors comptes fournisseurs) */
  async recipients(search) {
    const params = [];
    let sql = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.department, u.position
      FROM users u
      WHERE u.is_active${tenant.filter('u.enterprise_id', params)}
        AND NOT EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id IN ('prof_supplier', 'prof_superadmin'))`;
    if (search) {
      params.push(`%${String(search).trim()}%`);
      sql += ` AND (u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length} OR u.email ILIKE $${params.length}
               OR (u.first_name || ' ' || u.last_name) ILIKE $${params.length})`;
    }
    return db.select(`${sql} ORDER BY u.first_name, u.last_name LIMIT 30`, params);
  }
}

module.exports = new StockIssueModel();
