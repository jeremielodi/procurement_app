// backend/src/models/StockCountModel.js
// Inventaire physique d'un dépôt et ajustements ponctuels.
//  - open : photo du stock attendu (soldes article × lot > 0 ; une ligne par équipement en stock) — un seul inventaire
//    ouvert par dépôt ; inventaire partiel possible (une catégorie)
//  - recordCounts / addLine : quantités comptées ; stock trouvé non attendu (articles non suivis par n° de série)
//  - validate : écart = compté − attendu → ADJUSTMENT_IN / ADJUSTMENT_OUT (source COUNT) ; équipement non retrouvé →
//    unité « LOST ». Les mouvements faits pendant l'inventaire restent comptés (l'écart est appliqué au solde courant) ;
//    si le solde ne permet plus la sortie, la validation est refusée (BALANCE_CHANGED)
//  - createAdjustment : ajustement ponctuel motivé (AJU-…)
const db = require('../config/database');
const tenant = require('../utils/tenant');
const stockModel = require('./StockModel');
const warehouseModel = require('./WarehouseModel');

const EPS = 1e-9;
const REASONS = ['DAMAGE', 'LOSS', 'THEFT', 'EXPIRED', 'FOUND', 'CORRECTION', 'OTHER'];
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const name = (first, last) => `TRIM(COALESCE(${first}, '') || ' ' || COALESCE(${last}, ''))`;

async function warehouseFor(userId, warehouseId) {
  const w = (await warehouseModel.accessibleFor(userId)).find(x => String(x.id) === String(warehouseId));
  if (!w) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès à ce dépôt');
  return w;
}

class StockCountModel {
  async open({ warehouseId, categoryId, comment }, { userId }) {
    const warehouse = await warehouseFor(userId, warehouseId);
    try {
      return await db.withTransaction(async (tx) => {
        const count = await tx.one(
          `INSERT INTO stock_counts (enterprise_id, warehouse_id, category_id, comment, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, count_number`,
          [warehouse.enterprise_id, warehouse.id, categoryId || null, comment ? String(comment).slice(0, 2000) : null, userId]
        );
        const cat = categoryId ? ' AND si.category_id = $2' : '';
        const params = categoryId ? [warehouse.id, categoryId] : [warehouse.id];
        // Articles en quantité (lots compris)
        const balances = await tx.select(
          `SELECT b.stock_item_id, b.lot_id, b.quantity FROM stock_balances b JOIN stock_items si ON si.id = b.stock_item_id
           WHERE b.warehouse_id = $1 AND b.quantity > 0 AND NOT si.track_serials${cat}`,
          params
        );
        for (const b of balances) {
          await tx.exec('INSERT INTO stock_count_lines (count_id, stock_item_id, lot_id, expected_quantity) VALUES ($1, $2, $3, $4)',
            [count.id, b.stock_item_id, b.lot_id, b.quantity]);
        }
        // Équipements : une ligne par unité en stock
        const units = await tx.select(
          `SELECT un.id, un.stock_item_id FROM stock_units un JOIN stock_items si ON si.id = un.stock_item_id
           WHERE un.warehouse_id = $1 AND un.status = 'IN_STOCK'${cat}`,
          params
        );
        for (const u of units) {
          await tx.exec('INSERT INTO stock_count_lines (count_id, stock_item_id, unit_id, expected_quantity) VALUES ($1, $2, $3, 1)',
            [count.id, u.stock_item_id, u.id]);
        }
        return { id: count.id, countNumber: count.count_number, lines: balances.length + units.length };
      });
    } catch (error) {
      if (error.code === '23505' && /open_warehouse/.test(error.constraint || error.message)) {
        throw fail(409, 'COUNT_ALREADY_OPEN', 'Un inventaire est déjà en cours dans ce dépôt');
      }
      throw error;
    }
  }

  async list({ warehouseId, status, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('c.enterprise_id', params)}`;
    if (warehouseId) { params.push(warehouseId); where += ` AND c.warehouse_id = $${params.length}`; }
    if (status) { params.push(status); where += ` AND c.status = $${params.length}`; }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM stock_counts c ${where}`, params)).n;
    params.push(Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0);
    const rows = await db.select(
      `SELECT c.*, w.name AS warehouse_name, w.code AS warehouse_code, mc.name AS category_name,
              ${name('cu.first_name', 'cu.last_name')} AS created_by_name, ${name('vu.first_name', 'vu.last_name')} AS validated_by_name,
              (SELECT COUNT(*)::int FROM stock_count_lines l WHERE l.count_id = c.id) AS line_count,
              (SELECT COUNT(*)::int FROM stock_count_lines l WHERE l.count_id = c.id AND l.counted_quantity IS NOT NULL) AS counted_count,
              (SELECT COUNT(*)::int FROM stock_count_lines l WHERE l.count_id = c.id AND l.counted_quantity IS NOT NULL
                 AND ABS(l.counted_quantity - l.expected_quantity) > 0.00001) AS difference_count
       FROM stock_counts c JOIN warehouses w ON w.id = c.warehouse_id
       LEFT JOIN market_categories mc ON mc.id = c.category_id
       LEFT JOIN users cu ON cu.id = c.created_by LEFT JOIN users vu ON vu.id = c.validated_by
       ${where} ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { rows, total };
  }

  async get(id) {
    const count = await db.one(
      `SELECT c.*, w.name AS warehouse_name, w.code AS warehouse_code, l.name AS warehouse_location, mc.name AS category_name,
              ${name('cu.first_name', 'cu.last_name')} AS created_by_name, ${name('vu.first_name', 'vu.last_name')} AS validated_by_name,
              ${name('xu.first_name', 'xu.last_name')} AS cancelled_by_name
       FROM stock_counts c JOIN warehouses w ON w.id = c.warehouse_id JOIN locations l ON l.id = w.location_id
       LEFT JOIN market_categories mc ON mc.id = c.category_id
       LEFT JOIN users cu ON cu.id = c.created_by LEFT JOIN users vu ON vu.id = c.validated_by LEFT JOIN users xu ON xu.id = c.cancelled_by
       WHERE c.id = $1`,
      [id]
    );
    if (!count) return null;
    count.lines = await db.select(
      `SELECT cl.id, cl.stock_item_id, cl.lot_id, cl.unit_id, cl.expected_quantity::float8 AS expected_quantity,
              cl.counted_quantity::float8 AS counted_quantity, cl.added_during_count, cl.note, cl.counted_at,
              (cl.counted_quantity - cl.expected_quantity)::float8 AS difference,
              it.code AS item_code, it.name AS item_name, it.unit, it.track_lots, it.track_serials,
              lt.lot_number, lt.expiry_date, un.serial_number, un.asset_tag, m.movement_number,
              ${name('cb.first_name', 'cb.last_name')} AS counted_by_name
       FROM stock_count_lines cl
       JOIN stock_items it ON it.id = cl.stock_item_id
       LEFT JOIN stock_lots lt ON lt.id = cl.lot_id
       LEFT JOIN stock_units un ON un.id = cl.unit_id
       LEFT JOIN stock_movements m ON m.id = cl.adjustment_movement_id
       LEFT JOIN users cb ON cb.id = cl.counted_by
       WHERE cl.count_id = $1
       ORDER BY it.name, lt.expiry_date NULLS LAST, lt.lot_number NULLS FIRST, un.serial_number NULLS FIRST`,
      [id]
    );
    return count;
  }

  async lockOpen(tx, id, userId) {
    const count = await tx.one('SELECT id, count_number, status, warehouse_id, enterprise_id FROM stock_counts WHERE id = $1 FOR UPDATE', [id]);
    if (!count) throw fail(404, 'NOT_FOUND', 'Inventaire introuvable');
    if (count.status !== 'OPEN') throw fail(409, 'COUNT_CLOSED', 'Inventaire déjà validé ou annulé');
    if (!(await warehouseModel.canOperate(userId, count.warehouse_id))) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès à ce dépôt');
    return count;
  }

  /** entries : [{ lineId, countedQuantity (null = effacer), note }] */
  async recordCounts(id, entries, { userId }) {
    if (!Array.isArray(entries) || !entries.length) throw fail(400, 'NO_ENTRIES', 'Aucune quantité saisie');
    return db.withTransaction(async (tx) => {
      await this.lockOpen(tx, id, userId);
      for (const [index, e] of entries.entries()) {
        const line = await tx.one('SELECT id, unit_id FROM stock_count_lines WHERE id::text = $1 AND count_id = $2', [String(e.lineId), id]);
        if (!line) throw fail(400, 'LINE_NOT_FOUND', 'Ligne d\'inventaire introuvable', { line: index });
        const cleared = e.countedQuantity === null || e.countedQuantity === '';
        const qty = cleared ? null : num(e.countedQuantity);
        if (!cleared && (qty < 0 || !Number.isFinite(qty))) throw fail(400, 'INVALID_QUANTITY', 'Quantité invalide', { line: index });
        if (!cleared && line.unit_id && ![0, 1].includes(qty)) throw fail(400, 'INVALID_UNIT_COUNT', 'Équipement : présent (1) ou absent (0)', { line: index });
        await tx.exec(
          `UPDATE stock_count_lines SET counted_quantity = $2, note = $3,
                  counted_by = CASE WHEN $2::numeric IS NULL THEN NULL ELSE $4::uuid END,
                  counted_at = CASE WHEN $2::numeric IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END
           WHERE id = $1`,
          [line.id, qty, e.note !== undefined ? (String(e.note || '').slice(0, 1000) || null) : null, userId]
        );
      }
      return { updated: entries.length };
    });
  }

  /** Stock trouvé non attendu : { stockItemId, lotId | lotNumber + expiryDate, countedQuantity, note } */
  async addLine(id, { stockItemId, lotId, lotNumber, expiryDate, countedQuantity, note }, { userId }) {
    return db.withTransaction(async (tx) => {
      const count = await this.lockOpen(tx, id, userId);
      const item = await tx.one('SELECT id, enterprise_id, name, is_stockable, track_lots, track_expiry, track_serials FROM stock_items WHERE id::text = $1', [String(stockItemId)]);
      if (!item || String(item.enterprise_id) !== String(count.enterprise_id)) throw fail(400, 'ITEM_NOT_FOUND', 'Article introuvable');
      if (!item.is_stockable) throw fail(400, 'ITEM_NOT_STOCKABLE', `${item.name} : article non stocké`);
      if (item.track_serials) throw fail(400, 'SERIAL_ITEM', `${item.name} : enregistrez les équipements trouvés avec leur n° de série (« Enregistrer le parc existant »)`);
      const qty = num(countedQuantity);
      if (!(qty > 0)) throw fail(400, 'INVALID_QUANTITY', 'Quantité invalide');
      let lot = null;
      if (item.track_lots) {
        if (lotId) {
          lot = await tx.one('SELECT id FROM stock_lots WHERE id::text = $1 AND stock_item_id = $2', [String(lotId), item.id]);
        } else if (String(lotNumber || '').trim()) {
          lot = await tx.one('SELECT id, expiry_date FROM stock_lots WHERE stock_item_id = $1 AND UPPER(lot_number) = UPPER($2)', [item.id, String(lotNumber).trim()]);
          if (!lot) {
            if (item.track_expiry && !expiryDate) throw fail(400, 'EXPIRY_REQUIRED', 'Date de péremption obligatoire');
            lot = await tx.one(
              `INSERT INTO stock_lots (enterprise_id, stock_item_id, lot_number, expiry_date, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [item.enterprise_id, item.id, String(lotNumber).trim().slice(0, 100), expiryDate || null, userId]
            );
          }
        }
        if (!lot) throw fail(400, 'LOT_REQUIRED', `${item.name} : n° de lot obligatoire`);
      }
      try {
        const line = await tx.one(
          `INSERT INTO stock_count_lines (count_id, stock_item_id, lot_id, expected_quantity, counted_quantity, added_during_count, note, counted_by, counted_at)
           VALUES ($1, $2, $3, 0, $4, TRUE, $5, $6, CURRENT_TIMESTAMP) RETURNING id`,
          [id, item.id, lot?.id || null, qty, note ? String(note).slice(0, 1000) : null, userId]
        );
        return { lineId: line.id };
      } catch (error) {
        if (error.code === '23505') throw fail(409, 'LINE_EXISTS', 'Cet article (et ce lot) figure déjà dans l\'inventaire : corrigez sa quantité comptée');
        throw error;
      }
    });
  }

  async validate(id, { userId }) {
    return db.withTransaction(async (tx) => {
      const count = await this.lockOpen(tx, id, userId);
      const lines = await tx.select(
        `SELECT cl.*, it.name AS item_name, un.status AS unit_status, un.warehouse_id AS unit_warehouse
         FROM stock_count_lines cl JOIN stock_items it ON it.id = cl.stock_item_id LEFT JOIN stock_units un ON un.id = cl.unit_id
         WHERE cl.count_id = $1 FOR UPDATE OF cl`,
        [id]
      );
      const pending = lines.filter(l => l.counted_quantity === null).length;
      if (pending) throw fail(409, 'NOT_COMPLETE', `${pending} ligne(s) pas encore comptée(s)`, { pending });
      let adjusted = 0;
      for (const l of lines) {
        const delta = num(l.counted_quantity) - num(l.expected_quantity);
        if (Math.abs(delta) <= EPS) continue;
        const base = {
          enterpriseId: count.enterprise_id, stockItemId: l.stock_item_id, warehouseId: count.warehouse_id, lotId: l.lot_id,
          sourceType: 'COUNT', sourceId: count.id, sourceLineId: l.id, performedBy: userId,
          comment: `${count.count_number}${l.note ? ` — ${l.note}` : ''}`,
        };
        if (l.unit_id) {
          // Non retrouvé : seulement s'il est toujours en stock ici (sinon il a été remis / transféré entre-temps)
          if (delta < 0 && l.unit_status === 'IN_STOCK' && String(l.unit_warehouse) === String(count.warehouse_id)) {
            const m = await stockModel.addMovement(tx, { ...base, unitId: l.unit_id, type: 'ADJUSTMENT_OUT', quantity: -1 });
            await tx.exec(`UPDATE stock_units SET status = 'LOST', warehouse_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [l.unit_id]);
            await tx.exec('UPDATE stock_count_lines SET adjustment_movement_id = $1 WHERE id = $2', [m.id, l.id]);
            adjusted++;
          }
          continue;
        }
        let m;
        try {
          m = await stockModel.addMovement(tx, { ...base, type: delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', quantity: delta });
        } catch (error) {
          if (/STOCK_INSUFFICIENT/.test(error.message)) {
            throw fail(409, 'BALANCE_CHANGED', `${l.item_name} : le stock a baissé depuis l'ouverture de l'inventaire, l'écart ne peut plus être appliqué — recomptez cet article`);
          }
          throw error;
        }
        await tx.exec('UPDATE stock_count_lines SET adjustment_movement_id = $1 WHERE id = $2', [m.id, l.id]);
        adjusted++;
      }
      await tx.exec(`UPDATE stock_counts SET status = 'VALIDATED', validated_by = $2, validated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id, userId]);
      return { id, countNumber: count.count_number, adjustedLines: adjusted };
    });
  }

  async cancel(id, { userId, reason }) {
    return db.withTransaction(async (tx) => {
      await this.lockOpen(tx, id, userId);
      await tx.exec(
        `UPDATE stock_counts SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = $3 WHERE id = $1`,
        [id, userId, reason ? String(reason).slice(0, 1000) : null]
      );
      return { id };
    });
  }

  // ------------------------------------------------------------------
  // Ajustements ponctuels
  // ------------------------------------------------------------------
  /** { warehouseId, stockItemId, lotId, unitId, quantity (signée ; équipement : -1), reason, comment } */
  async createAdjustment({ warehouseId, stockItemId, lotId, unitId, quantity, reason, comment }, { userId }) {
    const warehouse = await warehouseFor(userId, warehouseId);
    const r = String(reason || '').toUpperCase();
    if (!REASONS.includes(r)) throw fail(400, 'INVALID_REASON', 'Motif invalide');
    const note = String(comment || '').trim();
    if (!note) throw fail(400, 'COMMENT_REQUIRED', 'Expliquez l\'ajustement');
    return db.withTransaction(async (tx) => {
      const item = await tx.one('SELECT id, enterprise_id, name, is_stockable, track_lots, track_serials FROM stock_items WHERE id::text = $1', [String(stockItemId)]);
      if (!item || String(item.enterprise_id) !== String(warehouse.enterprise_id)) throw fail(400, 'ITEM_NOT_FOUND', 'Article introuvable');
      if (!item.is_stockable) throw fail(400, 'ITEM_NOT_STOCKABLE', `${item.name} : article non stocké`);
      let qty = num(quantity);
      let unit = null;
      if (item.track_serials) {
        if (!unitId) throw fail(400, 'UNIT_REQUIRED', `${item.name} : choisissez l'équipement (n° de série)`);
        unit = await tx.one('SELECT id, serial_number, status, warehouse_id, stock_item_id FROM stock_units WHERE id::text = $1 FOR UPDATE', [String(unitId)]);
        if (!unit || String(unit.stock_item_id) !== String(item.id) || unit.status !== 'IN_STOCK' || String(unit.warehouse_id) !== String(warehouse.id)) {
          throw fail(400, 'UNIT_UNAVAILABLE', 'Équipement introuvable dans ce dépôt');
        }
        qty = -1; // un équipement en plus s'enregistre par « Enregistrer le parc existant »
      }
      if (!qty || !Number.isFinite(qty)) throw fail(400, 'INVALID_QUANTITY', 'Quantité invalide');
      if (item.track_lots && !lotId) throw fail(400, 'LOT_REQUIRED', `${item.name} : choisissez le lot`);
      const lot = lotId ? await tx.one('SELECT id FROM stock_lots WHERE id::text = $1 AND stock_item_id = $2', [String(lotId), item.id]) : null;
      if (lotId && !lot) throw fail(400, 'LOT_NOT_FOUND', 'Lot introuvable');

      const adj = await tx.one(
        `INSERT INTO stock_adjustments (enterprise_id, warehouse_id, stock_item_id, lot_id, unit_id, quantity, reason, comment, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, adjustment_number`,
        [warehouse.enterprise_id, warehouse.id, item.id, lot?.id || null, unit?.id || null, qty, r, note.slice(0, 2000), userId]
      );
      let movement;
      try {
        movement = await stockModel.addMovement(tx, {
          enterpriseId: warehouse.enterprise_id, stockItemId: item.id, warehouseId: warehouse.id, lotId: lot?.id || null, unitId: unit?.id || null,
          type: qty > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', quantity: qty, sourceType: 'ADJUSTMENT', sourceId: adj.id,
          comment: `${adj.adjustment_number} — ${note.slice(0, 500)}`, performedBy: userId,
        });
      } catch (error) {
        if (/STOCK_INSUFFICIENT/.test(error.message)) throw fail(409, 'STOCK_INSUFFICIENT', `${item.name} : stock insuffisant pour cette sortie`);
        throw error;
      }
      if (unit) {
        await tx.exec(`UPDATE stock_units SET status = $2, warehouse_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [unit.id, ['LOSS', 'THEFT'].includes(r) ? 'LOST' : 'RETIRED']);
      }
      await tx.exec('UPDATE stock_adjustments SET stock_movement_id = $1 WHERE id = $2', [movement.id, adj.id]);
      return { id: adj.id, adjustmentNumber: adj.adjustment_number, movementNumber: movement.movement_number };
    });
  }

  async listAdjustments({ warehouseId, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('a.enterprise_id', params)}`;
    if (warehouseId) { params.push(warehouseId); where += ` AND a.warehouse_id = $${params.length}`; }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM stock_adjustments a ${where}`, params)).n;
    params.push(Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0);
    const rows = await db.select(
      `SELECT a.id, a.adjustment_number, a.quantity::float8 AS quantity, a.reason, a.comment, a.created_at,
              w.name AS warehouse_name, it.code AS item_code, it.name AS item_name, it.unit, lt.lot_number, un.serial_number,
              m.movement_number, ${name('u.first_name', 'u.last_name')} AS created_by_name
       FROM stock_adjustments a JOIN warehouses w ON w.id = a.warehouse_id JOIN stock_items it ON it.id = a.stock_item_id
       LEFT JOIN stock_lots lt ON lt.id = a.lot_id LEFT JOIN stock_units un ON un.id = a.unit_id
       LEFT JOIN stock_movements m ON m.id = a.stock_movement_id LEFT JOIN users u ON u.id = a.created_by
       ${where} ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { rows, total };
  }
}

module.exports = new StockCountModel();
module.exports.REASONS = REASONS;
