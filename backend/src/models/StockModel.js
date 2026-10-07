// backend/src/models/StockModel.js
// Stock : soldes (article × dépôt × lot), journal des mouvements, lots, écritures de réception.
// Les soldes sont tenus par la base (trigger stock_movement_apply, jamais négatifs) ; le journal est
// immuable — une correction se fait par une écriture inverse.
const db = require('../config/database');
const tenant = require('../utils/tenant');
const { localizedSql } = require('../utils/requestLang');

class StockModel {
  /** Soldes, une ligne par article × dépôt × lot (quantité > 0 sauf includeEmpty) */
  async balances({ warehouseId, stockItemId, categoryId, locationId, search, expiringWithinDays, includeEmpty = false } = {}) {
    const params = [];
    let sql = `
      SELECT b.id, b.quantity, b.updated_at,
             si.id AS stock_item_id, si.code AS item_code, si.name AS item_name, si.unit, si.min_quantity,
             si.track_lots, si.track_expiry, ${localizedSql('mc')} AS category_name,
             w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
             l.id AS location_id, l.name AS location_name,
             lt.id AS lot_id, lt.lot_number, lt.expiry_date
      FROM stock_balances b
      JOIN stock_items si ON si.id = b.stock_item_id
      JOIN warehouses w ON w.id = b.warehouse_id
      JOIN locations l ON l.id = w.location_id
      LEFT JOIN stock_lots lt ON lt.id = b.lot_id
      LEFT JOIN market_categories mc ON mc.id = si.category_id
      WHERE 1=1${tenant.filter('b.enterprise_id', params)}`;
    if (!includeEmpty) sql += ' AND b.quantity > 0';
    if (warehouseId) { params.push(warehouseId); sql += ` AND b.warehouse_id = $${params.length}`; }
    if (stockItemId) { params.push(stockItemId); sql += ` AND b.stock_item_id = $${params.length}`; }
    if (categoryId) { params.push(categoryId); sql += ` AND si.category_id = $${params.length}`; }
    if (locationId) { params.push(locationId); sql += ` AND w.location_id = $${params.length}`; }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      sql += ` AND (si.code ILIKE $${params.length} OR si.name ILIKE $${params.length} OR lt.lot_number ILIKE $${params.length})`;
    }
    if (expiringWithinDays !== undefined && expiringWithinDays !== null && expiringWithinDays !== '') {
      params.push(parseInt(expiringWithinDays) || 0);
      sql += ` AND lt.expiry_date IS NOT NULL AND lt.expiry_date <= CURRENT_DATE + $${params.length}::int`;
    }
    return db.select(`${sql} ORDER BY si.name, l.name, w.name, lt.expiry_date NULLS LAST, lt.lot_number`, params);
  }

  /** Journal des mouvements (filtres + pagination) */
  async movements({ warehouseId, stockItemId, lotId, unitId, type, sourceType, sourceId, fromDate, toDate, search, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('m.enterprise_id', params)}`;
    if (warehouseId) { params.push(warehouseId); where += ` AND m.warehouse_id = $${params.length}`; }
    if (stockItemId) { params.push(stockItemId); where += ` AND m.stock_item_id = $${params.length}`; }
    if (lotId) { params.push(lotId); where += ` AND m.lot_id = $${params.length}`; }
    if (unitId) { params.push(unitId); where += ` AND m.unit_id = $${params.length}`; }
    if (type) { params.push(type); where += ` AND m.movement_type = $${params.length}`; }
    if (sourceType) { params.push(sourceType); where += ` AND m.source_type = $${params.length}`; }
    if (sourceId) { params.push(String(sourceId)); where += ` AND m.source_id = $${params.length}`; }
    if (fromDate) { params.push(fromDate); where += ` AND m.performed_at >= $${params.length}::date`; }
    if (toDate) { params.push(toDate); where += ` AND m.performed_at < ($${params.length}::date + 1)`; }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      where += ` AND (si.code ILIKE $${params.length} OR si.name ILIKE $${params.length} OR m.movement_number ILIKE $${params.length}
                 OR lt.lot_number ILIKE $${params.length} OR g.grn_number ILIKE $${params.length} OR sis.issue_number ILIKE $${params.length}
                 OR su.serial_number ILIKE $${params.length} OR su.asset_tag ILIKE $${params.length} OR sr.return_number ILIKE $${params.length})`;
    }
    const from = `
      FROM stock_movements m
      JOIN stock_items si ON si.id = m.stock_item_id
      JOIN warehouses w ON w.id = m.warehouse_id
      LEFT JOIN stock_lots lt ON lt.id = m.lot_id
      LEFT JOIN currency c ON c.id = m.currency_id
      LEFT JOIN users u ON u.id = m.performed_by
      LEFT JOIN goods_receipt_notes g ON m.source_type = 'GRN' AND g.id::text = m.source_id
      LEFT JOIN purchase_orders po ON po.id = g.po_id
      LEFT JOIN stock_issues sis ON m.source_type = 'ISSUE' AND sis.id::text = m.source_id
      LEFT JOIN users ru ON ru.id = sis.recipient_id
      LEFT JOIN departments sd ON sd.id = sis.department_id
      LEFT JOIN warehouses sdw ON sdw.id = sis.destination_warehouse_id
      LEFT JOIN warehouses ssw ON ssw.id = sis.warehouse_id
      LEFT JOIN stock_units su ON su.id = m.unit_id
      LEFT JOIN stock_returns sr ON m.source_type = 'RETURN' AND sr.id::text = m.source_id
      ${where}`;
    const total = (await db.one(`SELECT COUNT(*)::int AS n ${from}`, params)).n;
    params.push(Math.min(parseInt(limit) || 50, 500), parseInt(offset) || 0);
    const rows = await db.select(
      `SELECT m.id, m.movement_number, m.movement_type, m.quantity, m.unit_cost, c.format_key AS currency_code,
              m.source_type, m.source_id, m.comment, m.performed_at,
              si.id AS stock_item_id, si.code AS item_code, si.name AS item_name, si.unit,
              w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
              lt.id AS lot_id, lt.lot_number, lt.expiry_date,
              g.grn_number, po.id AS po_id, po.po_number,
              sis.issue_number, sis.destination_type,
              -- Destination de la sortie ; transfert (et son annulation) : l'autre dépôt du mouvement
              CASE
                WHEN sis.destination_type = 'WAREHOUSE' AND m.warehouse_id = sis.destination_warehouse_id THEN ssw.name
                WHEN sis.destination_type = 'WAREHOUSE' THEN sdw.name
                WHEN sis.destination_type = 'DEPARTMENT' THEN sd.name
                ELSE TRIM(COALESCE(ru.first_name, '') || ' ' || COALESCE(ru.last_name, ''))
              END AS recipient_name,
              su.serial_number, sr.return_number,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS performed_by_name
       ${from}
       ORDER BY m.performed_at DESC, m.movement_number DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { rows, total };
  }

  async lots(stockItemId) {
    return db.select(
      `SELECT lt.*, s.name AS supplier_name,
              COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.lot_id = lt.id), 0) AS quantity
       FROM stock_lots lt LEFT JOIN suppliers s ON s.id = lt.supplier_id
       WHERE lt.stock_item_id = $1
       ORDER BY lt.expiry_date NULLS LAST, lt.created_at`,
      [stockItemId]
    );
  }

  /** Tableau de bord du stock (entreprise courante) */
  async summary() {
    const params = [];
    const scope = tenant.filter('si.enterprise_id', params);
    return db.one(
      `SELECT
         (SELECT COUNT(*) FROM stock_items si WHERE si.is_active AND si.is_stockable${scope})::int AS stockable_items,
         (SELECT COUNT(DISTINCT b.stock_item_id) FROM stock_balances b JOIN stock_items si ON si.id = b.stock_item_id
           WHERE b.quantity > 0${scope})::int AS items_in_stock,
         (SELECT COUNT(*) FROM stock_items si WHERE si.is_active AND si.min_quantity IS NOT NULL${scope}
           AND COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.stock_item_id = si.id), 0) < si.min_quantity)::int AS below_min,
         (SELECT COUNT(*) FROM stock_balances b JOIN stock_items si ON si.id = b.stock_item_id JOIN stock_lots lt ON lt.id = b.lot_id
           WHERE b.quantity > 0 AND lt.expiry_date IS NOT NULL AND lt.expiry_date <= CURRENT_DATE + 90${scope})::int AS lots_expiring_90d,
         (SELECT COUNT(*) FROM stock_balances b JOIN stock_items si ON si.id = b.stock_item_id JOIN stock_lots lt ON lt.id = b.lot_id
           WHERE b.quantity > 0 AND lt.expiry_date IS NOT NULL AND lt.expiry_date < CURRENT_DATE${scope})::int AS lots_expired`,
      params
    );
  }

  // ------------------------------------------------------------------
  // Écritures (dans une transaction db.withTransaction : tx)
  // ------------------------------------------------------------------

  /**
   * Lot d'un article : retrouvé par numéro (insensible à la casse) ou créé.
   * Un lot existant avec une autre date de péremption → erreur (pas de silence sur une incohérence).
   */
  async findOrCreateLot(tx, { enterpriseId, stockItemId, lotNumber, expiryDate, supplierId, createdBy }) {
    const number = String(lotNumber || '').trim();
    const existing = await tx.one(
      'SELECT id, expiry_date FROM stock_lots WHERE stock_item_id = $1 AND UPPER(lot_number) = UPPER($2)',
      [stockItemId, number]
    );
    if (existing) {
      const known = existing.expiry_date ? new Date(existing.expiry_date).toISOString().slice(0, 10) : null;
      if (expiryDate && known && known !== String(expiryDate).slice(0, 10)) {
        const err = new Error(`Le lot ${number} existe déjà avec la date de péremption ${known}`);
        err.status = 400;
        err.code = 'LOT_EXPIRY_MISMATCH';
        throw err;
      }
      return existing.id;
    }
    const row = await tx.one(
      `INSERT INTO stock_lots (enterprise_id, stock_item_id, lot_number, expiry_date, supplier_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [enterpriseId, stockItemId, number, expiryDate || null, supplierId || null, createdBy]
    );
    return row.id;
  }

  /** Écrit un mouvement (le trigger contrôle la cohérence et met à jour le solde) */
  async addMovement(tx, m) {
    return tx.one(
      `INSERT INTO stock_movements
         (enterprise_id, stock_item_id, warehouse_id, lot_id, movement_type, quantity, unit_cost, currency_id,
          source_type, source_id, source_line_id, comment, performed_by, unit_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, movement_number`,
      [m.enterpriseId, m.stockItemId, m.warehouseId, m.lotId || null, m.type, m.quantity, m.unitCost ?? null,
       m.currencyId || null, m.sourceType || null, m.sourceId != null ? String(m.sourceId) : null,
       m.sourceLineId != null ? String(m.sourceLineId) : null, m.comment || null, m.performedBy || null, m.unitId || null]
    );
  }
}

module.exports = new StockModel();
