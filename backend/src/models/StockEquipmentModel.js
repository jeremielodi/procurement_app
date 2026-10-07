// backend/src/models/StockEquipmentModel.js
// Équipements (unités suivies par n° de série) et retours en stock.
// - holdings(userId) : ce qu'un utilisateur détient encore (lignes de sortie non entièrement rendues)
// - createReturn : bon de retour (RET-…) — bon état / endommagé → mouvement RETURN dans le dépôt choisi ;
//   perdu → aucun mouvement, unité « LOST » ; quantité rendue reportée sur la ligne de sortie
// - units / unitHistory / registerUnits (parc existant : mouvement OPENING) / updateUnit (état, réforme)
const db = require('../config/database');
const tenant = require('../utils/tenant');
const stockModel = require('./StockModel');
const warehouseModel = require('./WarehouseModel');

const EPS = 1e-9;
const CONDITIONS = ['GOOD', 'DAMAGED', 'LOST'];
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** N° d'inventaire uniques par entreprise : contrôle avant insertion (message clair plutôt qu'une erreur SQL) */
async function checkAssetTags(tx, enterpriseId, units) {
  const tags = units.map(u => u.assetTag).filter(Boolean).map(t => t.toUpperCase());
  if (new Set(tags).size !== tags.length) throw fail(400, 'ASSET_TAG_DUPLICATE', 'N° d\'inventaire en double dans la saisie');
  if (!tags.length) return;
  const known = await tx.select(
    `SELECT asset_tag FROM stock_units WHERE enterprise_id = $1 AND status <> 'VOID' AND UPPER(asset_tag) = ANY($2::text[])`,
    [enterpriseId, tags]
  );
  if (known.length) throw fail(400, 'ASSET_TAG_EXISTS', `N° d'inventaire déjà attribué : ${known.map(k => k.asset_tag).join(', ')}`);
}

class StockEquipmentModel {
  /** Articles encore détenus par un utilisateur (bons de sortie non annulés, reste > 0) */
  async holdings(userId) {
    const params = [userId];
    return db.select(
      `SELECT il.id AS issue_line_id, il.quantity::float8 AS quantity, il.returned_quantity::float8 AS returned_quantity,
              (il.quantity - il.returned_quantity)::float8 AS remaining,
              si.id AS issue_id, si.issue_number, si.issued_at, si.warehouse_id, w.name AS warehouse_name,
              it.id AS stock_item_id, it.code AS item_code, it.name AS item_name, it.unit, it.track_serials,
              lt.lot_number, un.id AS unit_id, un.serial_number, un.asset_tag, un.condition
       FROM stock_issue_lines il
       JOIN stock_issues si ON si.id = il.issue_id
       JOIN stock_items it ON it.id = il.stock_item_id
       JOIN warehouses w ON w.id = si.warehouse_id
       LEFT JOIN stock_lots lt ON lt.id = il.lot_id
       LEFT JOIN stock_units un ON un.id = il.unit_id
       WHERE si.recipient_id = $1 AND si.status = 'ISSUED' AND il.quantity - il.returned_quantity > 0${tenant.filter('si.enterprise_id', params)}
       ORDER BY it.track_serials DESC, si.issued_at, it.name, un.serial_number NULLS LAST, il.id`,
      params
    );
  }

  /** Nombre d'équipements (unités) détenus — contrôle avant désactivation d'un compte */
  async heldUnits(userId) {
    return db.select(
      `SELECT un.id, un.serial_number, un.asset_tag, it.code AS item_code, it.name AS item_name
       FROM stock_units un JOIN stock_items it ON it.id = un.stock_item_id
       WHERE un.holder_id = $1 AND un.status = 'ASSIGNED' ORDER BY it.name, un.serial_number`,
      [userId]
    );
  }

  /**
   * Bon de retour : { warehouseId (dépôt de destination), returnedBy (détenteur), lines: [{ issueLineId, quantity, condition }], comment }
   * context.userId : magasinier qui réceptionne (doit avoir accès au dépôt)
   */
  async createReturn({ warehouseId, returnedBy, lines = [], comment }, { userId }) {
    if (!Array.isArray(lines) || !lines.length) throw fail(400, 'NO_LINES', 'Sélectionnez au moins un article à rendre');
    const warehouse = (await warehouseModel.accessibleFor(userId)).find(w => String(w.id) === String(warehouseId));
    if (!warehouse) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès à ce dépôt');

    return db.withTransaction(async (tx) => {
      const prepared = [];
      const seen = new Set();
      for (const [index, raw] of lines.entries()) {
        const condition = String(raw.condition || 'GOOD').toUpperCase();
        if (!CONDITIONS.includes(condition)) throw fail(400, 'INVALID_CONDITION', 'État invalide', { line: index });
        if (seen.has(String(raw.issueLineId))) throw fail(400, 'DUPLICATE_LINE', 'Ligne en double', { line: index });
        seen.add(String(raw.issueLineId));
        const line = await tx.one(
          `SELECT il.id, il.stock_item_id, il.lot_id, il.unit_id, il.quantity, il.returned_quantity,
                  si.id AS issue_id, si.status, si.recipient_id, si.enterprise_id, it.name AS item_name
           FROM stock_issue_lines il
           JOIN stock_issues si ON si.id = il.issue_id
           JOIN stock_items it ON it.id = il.stock_item_id
           WHERE il.id::text = $1 FOR UPDATE OF il`,
          [String(raw.issueLineId)]
        );
        if (!line || String(line.enterprise_id) !== String(warehouse.enterprise_id)) throw fail(400, 'LINE_NOT_FOUND', 'Ligne de sortie introuvable', { line: index });
        if (line.status !== 'ISSUED') throw fail(409, 'ISSUE_CANCELLED', `${line.item_name} : bon de sortie annulé`, { line: index });
        if (String(line.recipient_id) !== String(returnedBy)) throw fail(400, 'NOT_HOLDER', `${line.item_name} : article remis à un autre utilisateur`, { line: index });
        const remaining = num(line.quantity) - num(line.returned_quantity);
        const quantity = line.unit_id ? 1 : num(raw.quantity);
        if (!(quantity > EPS)) throw fail(400, 'INVALID_QUANTITY', 'Quantité invalide', { line: index });
        if (quantity - remaining > EPS) throw fail(400, 'OVER_RETURN', `${line.item_name} : ${quantity} rendu(s) pour ${remaining} détenu(s)`, { line: index, remaining });
        prepared.push({ line, quantity, condition });
      }

      const ret = await tx.one(
        `INSERT INTO stock_returns (enterprise_id, warehouse_id, returned_by, received_by, comment)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, return_number`,
        [warehouse.enterprise_id, warehouse.id, returnedBy, userId, comment ? String(comment).slice(0, 2000) : null]
      );
      for (const p of prepared) {
        let movementId = null;
        if (p.condition !== 'LOST') {
          const movement = await stockModel.addMovement(tx, {
            enterpriseId: warehouse.enterprise_id, stockItemId: p.line.stock_item_id, warehouseId: warehouse.id,
            lotId: p.line.lot_id, unitId: p.line.unit_id, type: 'RETURN', quantity: p.quantity,
            sourceType: 'RETURN', sourceId: ret.id, sourceLineId: p.line.id,
            comment: `${ret.return_number}${p.condition === 'DAMAGED' ? ' — endommagé' : ''}`, performedBy: userId,
          });
          movementId = movement.id;
        }
        if (p.line.unit_id) {
          await tx.exec(
            p.condition === 'LOST'
              ? `UPDATE stock_units SET status = 'LOST', holder_id = NULL, warehouse_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`
              : `UPDATE stock_units SET status = 'IN_STOCK', holder_id = NULL, warehouse_id = $2, condition = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            p.condition === 'LOST' ? [p.line.unit_id] : [p.line.unit_id, warehouse.id, p.condition]
          );
        }
        await tx.exec(
          'INSERT INTO stock_return_lines (return_id, issue_line_id, quantity, condition, stock_movement_id) VALUES ($1, $2, $3, $4, $5)',
          [ret.id, p.line.id, p.quantity, p.condition, movementId]
        );
        await tx.exec('UPDATE stock_issue_lines SET returned_quantity = returned_quantity + $2 WHERE id = $1', [p.line.id, p.quantity]);
      }
      return { id: ret.id, returnNumber: ret.return_number, lines: prepared.length };
    });
  }

  async listReturns({ userId: holderId, warehouseId, search, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('r.enterprise_id', params)}`;
    if (holderId) { params.push(holderId); where += ` AND r.returned_by = $${params.length}`; }
    if (warehouseId) { params.push(warehouseId); where += ` AND r.warehouse_id = $${params.length}`; }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      where += ` AND (r.return_number ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }
    const from = `FROM stock_returns r JOIN users u ON u.id = r.returned_by JOIN warehouses w ON w.id = r.warehouse_id LEFT JOIN users rb ON rb.id = r.received_by ${where}`;
    const total = (await db.one(`SELECT COUNT(*)::int AS n ${from}`, params)).n;
    params.push(Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0);
    const rows = await db.select(
      `SELECT r.*, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS returned_by_name,
              TRIM(COALESCE(rb.first_name, '') || ' ' || COALESCE(rb.last_name, '')) AS received_by_name, w.name AS warehouse_name,
              (SELECT COUNT(*)::int FROM stock_return_lines rl WHERE rl.return_id = r.id) AS line_count,
              (SELECT COUNT(*)::int FROM stock_return_lines rl WHERE rl.return_id = r.id AND rl.condition = 'LOST') AS lost_count
       ${from} ORDER BY r.received_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { rows, total };
  }

  async getReturn(id) {
    const ret = await db.one(
      `SELECT r.*, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS returned_by_name, u.email AS returned_by_email,
              TRIM(COALESCE(rb.first_name, '') || ' ' || COALESCE(rb.last_name, '')) AS received_by_name,
              w.name AS warehouse_name, w.code AS warehouse_code
       FROM stock_returns r JOIN users u ON u.id = r.returned_by JOIN warehouses w ON w.id = r.warehouse_id
       LEFT JOIN users rb ON rb.id = r.received_by WHERE r.id = $1`,
      [id]
    );
    if (!ret) return null;
    ret.lines = await db.select(
      `SELECT rl.id, rl.quantity::float8 AS quantity, rl.condition, m.movement_number,
              si.id AS issue_id, si.issue_number, it.code AS item_code, it.name AS item_name, it.unit,
              lt.lot_number, un.serial_number, un.asset_tag
       FROM stock_return_lines rl
       JOIN stock_issue_lines il ON il.id = rl.issue_line_id
       JOIN stock_issues si ON si.id = il.issue_id
       JOIN stock_items it ON it.id = il.stock_item_id
       LEFT JOIN stock_lots lt ON lt.id = il.lot_id
       LEFT JOIN stock_units un ON un.id = il.unit_id
       LEFT JOIN stock_movements m ON m.id = rl.stock_movement_id
       WHERE rl.return_id = $1 ORDER BY it.name`,
      [id]
    );
    return ret;
  }

  // ------------------------------------------------------------------
  // Unités (équipements)
  // ------------------------------------------------------------------
  async units({ status, stockItemId, warehouseId, holderId, search, limit = 100, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE un.status <> 'VOID'${tenant.filter('un.enterprise_id', params)}`;
    if (status) { params.push(status); where += ` AND un.status = $${params.length}`; }
    if (stockItemId) { params.push(stockItemId); where += ` AND un.stock_item_id = $${params.length}`; }
    if (warehouseId) { params.push(warehouseId); where += ` AND un.warehouse_id = $${params.length}`; }
    if (holderId) { params.push(holderId); where += ` AND un.holder_id = $${params.length}`; }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      where += ` AND (un.serial_number ILIKE $${params.length} OR un.asset_tag ILIKE $${params.length} OR it.name ILIKE $${params.length}
                 OR it.code ILIKE $${params.length} OR h.first_name ILIKE $${params.length} OR h.last_name ILIKE $${params.length})`;
    }
    const from = `
      FROM stock_units un
      JOIN stock_items it ON it.id = un.stock_item_id
      LEFT JOIN warehouses w ON w.id = un.warehouse_id
      LEFT JOIN users h ON h.id = un.holder_id
      ${where}`;
    const total = (await db.one(`SELECT COUNT(*)::int AS n ${from}`, params)).n;
    params.push(Math.min(parseInt(limit) || 100, 500), parseInt(offset) || 0);
    const rows = await db.select(
      `SELECT un.id, un.serial_number, un.asset_tag, un.status, un.condition, un.notes, un.updated_at,
              it.id AS stock_item_id, it.code AS item_code, it.name AS item_name,
              w.id AS warehouse_id, w.name AS warehouse_name,
              h.id AS holder_id, TRIM(COALESCE(h.first_name, '') || ' ' || COALESCE(h.last_name, '')) AS holder_name, h.email AS holder_email,
              h.is_active AS holder_active,
              (SELECT si.issued_at FROM stock_issue_lines il JOIN stock_issues si ON si.id = il.issue_id
                WHERE il.unit_id = un.id AND si.status = 'ISSUED' AND il.returned_quantity < il.quantity ORDER BY si.issued_at DESC LIMIT 1) AS assigned_at
       ${from}
       ORDER BY it.name, un.serial_number LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { rows, total };
  }

  async getUnit(id) {
    return db.one(
      `SELECT un.*, it.code AS item_code, it.name AS item_name, w.name AS warehouse_name,
              TRIM(COALESCE(h.first_name, '') || ' ' || COALESCE(h.last_name, '')) AS holder_name, h.email AS holder_email
       FROM stock_units un JOIN stock_items it ON it.id = un.stock_item_id
       LEFT JOIN warehouses w ON w.id = un.warehouse_id LEFT JOIN users h ON h.id = un.holder_id
       WHERE un.id = $1`,
      [id]
    );
  }

  /** Parc existant (déjà acheté) : enregistre des unités en stock dans un dépôt (mouvement OPENING) */
  async registerUnits({ stockItemId, warehouseId, units = [] }, { userId }) {
    const warehouse = (await warehouseModel.accessibleFor(userId)).find(w => String(w.id) === String(warehouseId));
    if (!warehouse) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès à ce dépôt');
    const list = units.map(u => (typeof u === 'string' ? { serialNumber: u } : u))
      .map(u => ({ serialNumber: String(u.serialNumber || '').trim(), assetTag: String(u.assetTag || '').trim() || null }))
      .filter(u => u.serialNumber);
    if (!list.length) throw fail(400, 'SERIALS_REQUIRED', 'Saisissez au moins un n° de série');
    return db.withTransaction(async (tx) => {
      const item = await tx.one('SELECT id, enterprise_id, name, track_serials FROM stock_items WHERE id = $1', [stockItemId]);
      if (!item || String(item.enterprise_id) !== String(warehouse.enterprise_id)) throw fail(400, 'ITEM_NOT_FOUND', 'Article introuvable');
      if (!item.track_serials) throw fail(400, 'NOT_SERIAL_ITEM', `${item.name} n'est pas suivi par n° de série`);
      const keys = list.map(u => u.serialNumber.toUpperCase());
      if (new Set(keys).size !== keys.length) throw fail(400, 'SERIAL_DUPLICATE', 'N° de série en double dans la saisie');
      const known = await tx.select(
        `SELECT serial_number FROM stock_units WHERE stock_item_id = $1 AND status <> 'VOID' AND UPPER(serial_number) = ANY($2::text[])`,
        [item.id, keys]
      );
      if (known.length) throw fail(400, 'SERIAL_EXISTS', `N° de série déjà enregistré : ${known.map(k => k.serial_number).join(', ')}`);
      await checkAssetTags(tx, item.enterprise_id, list);
      const created = [];
      for (const u of list) {
        const unit = await tx.one(
          `INSERT INTO stock_units (enterprise_id, stock_item_id, serial_number, asset_tag, status, warehouse_id, created_by)
           VALUES ($1, $2, $3, $4, 'IN_STOCK', $5, $6) RETURNING id`,
          [item.enterprise_id, item.id, u.serialNumber, u.assetTag, warehouse.id, userId]
        );
        await stockModel.addMovement(tx, {
          enterpriseId: item.enterprise_id, stockItemId: item.id, warehouseId: warehouse.id, unitId: unit.id,
          type: 'OPENING', quantity: 1, sourceType: 'OPENING', comment: 'Parc existant', performedBy: userId,
        });
        created.push(unit.id);
      }
      return { created: created.length, ids: created };
    });
  }

  /**
   * Mise à jour d'une unité : n° d'inventaire, notes, état (GOOD / DAMAGED, en stock uniquement)
   * ou réforme (RETIRED, en stock uniquement → mouvement ADJUSTMENT_OUT)
   */
  async updateUnit(id, { assetTag, notes, condition, retire, reason }, { userId }) {
    return db.withTransaction(async (tx) => {
      const unit = await tx.one('SELECT * FROM stock_units WHERE id = $1 FOR UPDATE', [id]);
      if (!unit || unit.status === 'VOID') throw fail(404, 'NOT_FOUND', 'Équipement introuvable');
      if ((condition !== undefined || retire) && unit.status !== 'IN_STOCK') {
        throw fail(409, 'NOT_IN_STOCK', 'Équipement hors stock : faites d\'abord le retour');
      }
      if ((condition !== undefined || retire) && !(await warehouseModel.canOperate(userId, unit.warehouse_id))) {
        throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès au dépôt de cet équipement');
      }
      const fields = [];
      const params = [id];
      const set = (col, value) => { params.push(value); fields.push(`${col} = $${params.length}`); };
      if (assetTag !== undefined) set('asset_tag', String(assetTag || '').trim() || null);
      if (notes !== undefined) set('notes', String(notes || '').slice(0, 2000) || null);
      if (condition !== undefined) {
        if (!['GOOD', 'DAMAGED'].includes(condition)) throw fail(400, 'INVALID_CONDITION', 'État invalide');
        set('condition', condition);
      }
      if (retire) {
        await stockModel.addMovement(tx, {
          enterpriseId: unit.enterprise_id, stockItemId: unit.stock_item_id, warehouseId: unit.warehouse_id, unitId: unit.id,
          type: 'ADJUSTMENT_OUT', quantity: -1, sourceType: 'RETIRE', sourceId: unit.id,
          comment: `Réforme${reason ? ` — ${reason}` : ''}`, performedBy: userId,
        });
        set('status', 'RETIRED');
        set('warehouse_id', null);
      }
      if (fields.length) await tx.exec(`UPDATE stock_units SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, params);
      return { id };
    });
  }
}

module.exports = new StockEquipmentModel();
module.exports.checkAssetTags = checkAssetTags;
