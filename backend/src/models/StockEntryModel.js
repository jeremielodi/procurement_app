// backend/src/models/StockEntryModel.js
// Bons d'entrée en stock hors bon de commande (migration 47) — type (entry_type) :
//   DONATION             don / dotation (bailleur, partenaire, siège)
//   OFF_SYSTEM_PURCHASE  achat payé hors procureApp (caisse, petite dépense)
//   RETURN               matériel rendu qui n'était pas sorti par un bon de sortie
//   OTHER                autre entrée, motif obligatoire
// Cycle : PENDING (saisi par le magasinier, aucun mouvement) → VALIDATED par une AUTRE personne (mouvements ENTRY :
// lots, équipements à n° de série, coût facultatif, projet de financement facultatif) ou REJECTED (motif) ;
// l'auteur peut retirer un bon en attente (CANCELLED). Un bon validé s'annule par écritures inverses ENTRY_REVERSAL,
// refusées si le stock entré a déjà été utilisé. Toutes les écritures d'une opération : une transaction (= un groupe).
const db = require('../config/database');
const tenant = require('../utils/tenant');
const stockModel = require('./StockModel');
const warehouseModel = require('./WarehouseModel');
const goodsReceiptModel = require('./GoodsReceiptModel');

const EPS = 1e-9;
const ENTRY_TYPES = ['DONATION', 'OFF_SYSTEM_PURCHASE', 'RETURN', 'OTHER'];
const STATUSES = ['PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED'];
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const clip = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const userName = (alias) => `TRIM(COALESCE(${alias}.first_name, '') || ' ' || COALESCE(${alias}.last_name, ''))`;

const HEADER_SQL = `
  SELECT se.*, w.code AS warehouse_code, w.name AS warehouse_name, l.name AS warehouse_location,
         p.code AS project_code, p.name AS project_name, c.format_key AS currency_code,
         ${userName('cb')} AS created_by_name, cb.position AS created_by_position,
         ${userName('vb')} AS validated_by_name, vb.position AS validated_by_position,
         ${userName('rb')} AS rejected_by_name, ${userName('xb')} AS cancelled_by_name
  FROM stock_entries se
  JOIN warehouses w ON w.id = se.warehouse_id
  JOIN locations l ON l.id = w.location_id
  LEFT JOIN projects p ON p.id = se.project_id
  LEFT JOIN currency c ON c.id = se.currency_id
  LEFT JOIN users cb ON cb.id = se.created_by
  LEFT JOIN users vb ON vb.id = se.validated_by
  LEFT JOIN users rb ON rb.id = se.rejected_by
  LEFT JOIN users xb ON xb.id = se.cancelled_by`;

class StockEntryModel {
  /**
   * Saisie d'un bon d'entrée (statut PENDING, aucun mouvement de stock).
   * @param {object} data { entryType, warehouseId, origin, deliveredBy, reference, reason, projectId, currencyId,
   *                        lines: [{ stockItemId, quantity, unitCost?, lotNumber?, expiryDate?, serials? }] }
   * @param {object} context { userId } — doit avoir accès au dépôt
   */
  async create({ entryType, warehouseId, origin, deliveredBy, reference, reason, projectId, currencyId, lines = [] }, { userId }) {
    const type = String(entryType || '').toUpperCase();
    if (!ENTRY_TYPES.includes(type)) throw fail(400, 'INVALID_ENTRY_TYPE', 'Type d\'entrée invalide');
    if (type === 'OTHER' && !clip(reason, 2000)) throw fail(400, 'REASON_REQUIRED', 'Motif obligatoire pour une autre entrée');
    if (!Array.isArray(lines) || !lines.length) throw fail(400, 'NO_LINES', 'Ajoutez au moins un article');
    if (!warehouseId) throw fail(400, 'WAREHOUSE_REQUIRED', 'Dépôt requis');
    const warehouse = (await warehouseModel.accessibleFor(userId)).find(w => String(w.id) === String(warehouseId));
    if (!warehouse) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès à ce dépôt');

    return db.withTransaction(async (tx) => {
      const enterpriseId = warehouse.enterprise_id;
      const fundingProjectId = await stockModel.fundingProject(tx, projectId, enterpriseId);
      const checked = await this.checkLines(tx, lines, enterpriseId);

      // Devise : celle choisie, sinon celle de l'entreprise (utile seulement si un coût est saisi)
      let currency = null;
      if (currencyId) {
        currency = await tx.one('SELECT id FROM currency WHERE id::text = $1', [String(currencyId)]);
        if (!currency) throw fail(400, 'CURRENCY_INVALID', 'Devise inconnue');
      } else if (checked.some(l => l.unitCost !== null)) {
        currency = await tx.one('SELECT currency_id AS id FROM enterprise WHERE id = $1 AND currency_id IS NOT NULL', [enterpriseId]);
      }

      const entry = await tx.one(
        `INSERT INTO stock_entries (enterprise_id, warehouse_id, entry_type, origin, delivered_by, reference, reason, project_id, currency_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, entry_number`,
        [enterpriseId, warehouse.id, type, clip(origin, 255), clip(deliveredBy, 255), clip(reference, 100), clip(reason, 2000),
         fundingProjectId, currency?.id || null, userId]
      );
      for (const l of checked) {
        await tx.exec(
          `INSERT INTO stock_entry_lines (entry_id, stock_item_id, quantity, unit_cost, lot_number, expiry_date, serials)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [entry.id, l.item.id, l.quantity, l.unitCost, l.lotNumber, l.expiryDate, JSON.stringify(l.serials.map(s => s.serialNumber))]
        );
      }
      return { id: entry.id, entryNumber: entry.entry_number, lines: checked.length, enterpriseId };
    });
  }

  /**
   * Contrôles des lignes (saisie et validation) : article stockable de l'entreprise, quantité > 0, coût ≥ 0,
   * lot / péremption / n° de série selon l'article (mêmes règles qu'à la réception) ; n° de série uniques dans le bon.
   */
  async checkLines(tx, lines, enterpriseId) {
    const checked = [];
    const serialsByItem = new Map();
    for (const [index, raw] of lines.entries()) {
      const item = await tx.one(
        'SELECT id, enterprise_id, code, name, unit, is_stockable, is_active, track_lots, track_expiry, track_serials FROM stock_items WHERE id::text = $1',
        [String(raw.stockItemId || raw.stock_item_id || '')]
      );
      if (!item || String(item.enterprise_id) !== String(enterpriseId)) throw fail(400, 'ITEM_NOT_FOUND', 'Article introuvable', { line: index });
      if (!item.is_stockable) throw fail(400, 'ITEM_NOT_STOCKABLE', `${item.name} : article non stocké`, { line: index });
      const quantity = num(raw.quantity);
      if (!(quantity > EPS)) throw fail(400, 'INVALID_QUANTITY', `${item.name} : quantité invalide`, { line: index });
      const rawCost = raw.unitCost ?? raw.unit_cost;
      const unitCost = rawCost === undefined || rawCost === null || String(rawCost).trim() === '' ? null : num(rawCost);
      if (unitCost !== null && !(unitCost >= 0)) throw fail(400, 'INVALID_COST', `${item.name} : coût unitaire invalide`, { line: index });
      const lotNumber = item.track_lots ? clip(raw.lotNumber ?? raw.lot_number, 100) : null;
      const expiryRaw = raw.expiryDate ?? raw.expiry_date;
      const expiryDate = item.track_expiry || item.track_lots ? clip(expiryRaw ? String(expiryRaw).slice(0, 10) : null, 10) : null;
      if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) throw fail(400, 'EXPIRY_INVALID', `${item.name} : date de péremption invalide`, { line: index });
      const serials = await goodsReceiptModel.stockLineChecks(tx, {
        stockItem: item, accepted: quantity, lotNumber, expiryDate, serials: raw.serials, enterpriseId, index,
      });
      const seen = serialsByItem.get(item.id) || new Set();
      for (const s of serials) {
        const key = s.serialNumber.toUpperCase();
        if (seen.has(key)) throw fail(400, 'SERIAL_DUPLICATE', `${item.name} : n° de série ${s.serialNumber} en double`, { line: index });
        seen.add(key);
      }
      serialsByItem.set(item.id, seen);
      checked.push({ item, quantity, unitCost, lotNumber, expiryDate, serials });
    }
    return checked;
  }

  /**
   * Validation par une autre personne que l'auteur (contrôlé aussi par le contrôleur, avec trace d'audit) :
   * mouvements ENTRY, lots créés / retrouvés, une unité par n° de série. Lignes recontrôlées (lot périmé depuis la
   * saisie, n° de série enregistré entre-temps…).
   */
  async validate(id, { userId, comment }) {
    return db.withTransaction(async (tx) => {
      const entry = await tx.one('SELECT * FROM stock_entries WHERE id = $1 FOR UPDATE', [id]);
      if (!entry) throw fail(404, 'NOT_FOUND', 'Bon d\'entrée introuvable');
      if (entry.status !== 'PENDING') throw fail(409, 'NOT_PENDING', 'Ce bon d\'entrée n\'est plus en attente de validation');
      if (String(entry.created_by) === String(userId)) throw fail(403, 'SELF_VALIDATION', 'Le bon doit être validé par une autre personne que celle qui l\'a saisi');
      if (!(await warehouseModel.canOperate(userId, entry.warehouse_id))) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès au dépôt de ce bon');

      const rows = await tx.select('SELECT * FROM stock_entry_lines WHERE entry_id = $1 ORDER BY id', [id]);
      const checked = await this.checkLines(tx, rows.map(r => ({
        stockItemId: r.stock_item_id, quantity: r.quantity, unitCost: r.unit_cost, lotNumber: r.lot_number,
        expiryDate: r.expiry_date, serials: r.serials || [],
      })), entry.enterprise_id);

      let movements = 0;
      for (const [index, l] of checked.entries()) {
        const row = rows[index];
        const lotId = l.item.track_lots
          ? await stockModel.findOrCreateLot(tx, { enterpriseId: entry.enterprise_id, stockItemId: l.item.id, lotNumber: l.lotNumber, expiryDate: l.expiryDate, createdBy: userId })
          : null;
        const base = {
          enterpriseId: entry.enterprise_id, stockItemId: l.item.id, warehouseId: entry.warehouse_id, type: 'ENTRY',
          unitCost: l.unitCost, currencyId: l.unitCost !== null ? entry.currency_id : null, projectId: entry.project_id,
          sourceType: 'ENTRY', sourceId: entry.id, sourceLineId: row.id, comment: entry.entry_number, performedBy: userId,
        };
        let first = null;
        if (l.item.track_serials) {
          for (const s of l.serials) {
            const unit = await tx.one(
              `INSERT INTO stock_units (enterprise_id, stock_item_id, serial_number, asset_tag, status, warehouse_id, created_by, project_id)
               VALUES ($1, $2, $3, NULL, 'IN_STOCK', $4, $5, $6) RETURNING id`,
              [entry.enterprise_id, l.item.id, s.serialNumber, entry.warehouse_id, userId, entry.project_id]
            );
            const m = await stockModel.addMovement(tx, { ...base, unitId: unit.id, quantity: 1 });
            first = first || m;
            movements++;
          }
        } else {
          first = await stockModel.addMovement(tx, { ...base, lotId, quantity: l.quantity });
          movements++;
        }
        await tx.exec('UPDATE stock_entry_lines SET lot_id = $1, stock_movement_id = $2 WHERE id = $3', [lotId, first.id, row.id]);
      }
      await tx.exec(
        `UPDATE stock_entries SET status = 'VALIDATED', validated_by = $2, validated_at = CURRENT_TIMESTAMP, validation_comment = $3 WHERE id = $1`,
        [id, userId, clip(comment, 1000)]
      );
      return { id, entryNumber: entry.entry_number, movements, createdBy: entry.created_by };
    });
  }

  /** Refus d'un bon en attente (motif obligatoire) : aucun mouvement */
  async reject(id, { userId, reason }) {
    if (!clip(reason, 1000)) throw fail(400, 'REASON_REQUIRED', 'Motif obligatoire');
    return db.withTransaction(async (tx) => {
      const entry = await tx.one('SELECT id, entry_number, status, created_by, warehouse_id FROM stock_entries WHERE id = $1 FOR UPDATE', [id]);
      if (!entry) throw fail(404, 'NOT_FOUND', 'Bon d\'entrée introuvable');
      if (entry.status !== 'PENDING') throw fail(409, 'NOT_PENDING', 'Ce bon d\'entrée n\'est plus en attente de validation');
      if (String(entry.created_by) === String(userId)) throw fail(403, 'SELF_VALIDATION', 'Retirez votre propre bon au lieu de le refuser');
      if (!(await warehouseModel.canOperate(userId, entry.warehouse_id))) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès au dépôt de ce bon');
      await tx.exec(
        `UPDATE stock_entries SET status = 'REJECTED', rejected_by = $2, rejected_at = CURRENT_TIMESTAMP, reject_reason = $3 WHERE id = $1`,
        [id, userId, clip(reason, 1000)]
      );
      return { id, entryNumber: entry.entry_number, createdBy: entry.created_by };
    });
  }

  /**
   * Annulation (motif obligatoire). En attente : retrait par son auteur, aucun mouvement. Validé (canValidate requis,
   * vérifié par le contrôleur) : ENTRY_REVERSAL de chaque mouvement d'entrée, au même coût ; équipements → VOID.
   * Refusée (409 ENTRY_USED) si un équipement n'est plus en stock dans le dépôt ou si le stock entré a été sorti.
   */
  async cancel(id, { userId, reason, canValidate = false }) {
    if (!clip(reason, 1000)) throw fail(400, 'REASON_REQUIRED', 'Motif obligatoire');
    return db.withTransaction(async (tx) => {
      const entry = await tx.one(
        `SELECT se.*, w.name AS warehouse_name FROM stock_entries se JOIN warehouses w ON w.id = se.warehouse_id WHERE se.id = $1 FOR UPDATE OF se`,
        [id]
      );
      if (!entry) throw fail(404, 'NOT_FOUND', 'Bon d\'entrée introuvable');
      if (!['PENDING', 'VALIDATED'].includes(entry.status)) throw fail(409, 'NOT_CANCELLABLE', 'Ce bon d\'entrée est déjà refusé ou annulé');
      if (!(await warehouseModel.canOperate(userId, entry.warehouse_id))) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès au dépôt de ce bon');
      const wasValidated = entry.status === 'VALIDATED';
      if (!wasValidated && String(entry.created_by) !== String(userId)) {
        throw fail(403, 'NOT_AUTHOR', 'Seul l\'auteur peut retirer un bon en attente (les autres le refusent)');
      }
      if (wasValidated && !canValidate) throw fail(403, 'FORBIDDEN', 'Annulation d\'un bon validé réservée aux valideurs');

      let reversed = 0;
      if (wasValidated) {
        const note = `Annulation ${entry.entry_number} — ${clip(reason, 500)}`;
        const moves = await tx.select(
          `SELECT id, stock_item_id, warehouse_id, lot_id, unit_id, project_id, quantity::float8 AS quantity, unit_cost, currency_id, source_line_id
           FROM stock_movements WHERE source_type = 'ENTRY' AND source_id = $1 AND movement_type = 'ENTRY' ORDER BY movement_number`,
          [String(entry.id)]
        );
        for (const m of moves) {
          if (m.unit_id) {
            const unit = await tx.one('SELECT serial_number, status, warehouse_id FROM stock_units WHERE id = $1 FOR UPDATE', [m.unit_id]);
            if (unit.status !== 'IN_STOCK' || String(unit.warehouse_id) !== String(entry.warehouse_id)) {
              throw fail(409, 'ENTRY_USED', `Annulation impossible : l'équipement ${unit.serial_number} n'est plus en stock au dépôt ${entry.warehouse_name}`);
            }
          }
          try {
            await stockModel.addMovement(tx, {
              enterpriseId: entry.enterprise_id, stockItemId: m.stock_item_id, warehouseId: m.warehouse_id, lotId: m.lot_id, unitId: m.unit_id,
              projectId: m.project_id, type: 'ENTRY_REVERSAL', quantity: -m.quantity, unitCost: m.unit_cost, currencyId: m.currency_id,
              sourceType: 'ENTRY', sourceId: entry.id, sourceLineId: m.source_line_id, comment: note, performedBy: userId,
            });
          } catch (error) {
            if (/STOCK_INSUFFICIENT|négatif|negative/i.test(error.message)) {
              throw fail(409, 'ENTRY_USED', `Annulation impossible : une partie du stock entré a déjà été utilisée au dépôt ${entry.warehouse_name}`);
            }
            throw error;
          }
          if (m.unit_id) await tx.exec(`UPDATE stock_units SET status = 'VOID', warehouse_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [m.unit_id]);
          reversed++;
        }
      }
      await tx.exec(
        `UPDATE stock_entries SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = $3 WHERE id = $1`,
        [id, userId, clip(reason, 1000)]
      );
      return { id, entryNumber: entry.entry_number, wasValidated, reversedMovements: reversed, createdBy: entry.created_by };
    });
  }

  async list({ warehouseId, entryType, status, search, fromDate, toDate, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('se.enterprise_id', params)}`;
    if (warehouseId) { params.push(warehouseId); where += ` AND se.warehouse_id = $${params.length}`; }
    if (entryType && ENTRY_TYPES.includes(String(entryType).toUpperCase())) { params.push(String(entryType).toUpperCase()); where += ` AND se.entry_type = $${params.length}`; }
    if (status && STATUSES.includes(String(status).toUpperCase())) { params.push(String(status).toUpperCase()); where += ` AND se.status = $${params.length}`; }
    if (fromDate) { params.push(fromDate); where += ` AND se.created_at >= $${params.length}::date`; }
    if (toDate) { params.push(toDate); where += ` AND se.created_at < ($${params.length}::date + 1)`; }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      const p = `$${params.length}`;
      where += ` AND (se.entry_number ILIKE ${p} OR se.origin ILIKE ${p} OR se.reference ILIKE ${p} OR se.reason ILIKE ${p} OR se.delivered_by ILIKE ${p}
                 OR EXISTS (SELECT 1 FROM stock_entry_lines el JOIN stock_items it ON it.id = el.stock_item_id
                            WHERE el.entry_id = se.id AND (it.code ILIKE ${p} OR it.name ILIKE ${p} OR el.lot_number ILIKE ${p} OR el.serials::text ILIKE ${p})))`;
    }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM stock_entries se ${where}`, params)).n;
    params.push(Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0);
    const rows = await db.select(
      `SELECT x.*, s.line_count, s.items, s.total_value FROM (${HEADER_SQL} ${where}) x
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS line_count, STRING_AGG(DISTINCT it.name, ', ') AS items,
                CASE WHEN BOOL_AND(el.unit_cost IS NOT NULL) THEN SUM(el.quantity * el.unit_cost)::float8 END AS total_value
         FROM stock_entry_lines el JOIN stock_items it ON it.id = el.stock_item_id WHERE el.entry_id = x.id
       ) s ON true
       ORDER BY x.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { rows, total };
  }

  async getById(id) {
    const entry = await db.one(`${HEADER_SQL} WHERE se.id = $1`, [id]);
    if (!entry) return null;
    entry.lines = await db.select(
      `SELECT el.id, el.stock_item_id, el.quantity::float8 AS quantity, el.unit_cost::float8 AS unit_cost, el.lot_number, el.expiry_date, el.serials,
              el.lot_id, it.code AS item_code, it.name AS item_name, it.unit, it.track_lots, it.track_expiry, it.track_serials,
              m.movement_number,
              (SELECT JSON_AGG(JSON_BUILD_OBJECT('id', u.id, 'serial_number', u.serial_number, 'asset_tag', u.asset_tag, 'status', u.status) ORDER BY u.serial_number)
               FROM stock_movements um JOIN stock_units u ON u.id = um.unit_id
               WHERE um.source_type = 'ENTRY' AND um.source_line_id = el.id::text AND um.movement_type = 'ENTRY') AS units,
              (SELECT STRING_AGG(rm.movement_number, ', ' ORDER BY rm.movement_number) FROM stock_movements rm
               WHERE rm.source_type = 'ENTRY' AND rm.source_line_id = el.id::text AND rm.movement_type = 'ENTRY_REVERSAL') AS reversal_movement_numbers
       FROM stock_entry_lines el
       JOIN stock_items it ON it.id = el.stock_item_id
       LEFT JOIN stock_movements m ON m.id = el.stock_movement_id
       WHERE el.entry_id = $1
       ORDER BY it.name, el.lot_number NULLS FIRST`,
      [id]
    );
    const costed = entry.lines.filter(l => l.unit_cost !== null);
    entry.total_value = costed.length === entry.lines.length && entry.lines.length
      ? costed.reduce((s, l) => s + l.quantity * l.unit_cost, 0) : null;
    return entry;
  }

  /**
   * Personnes à prévenir d'un bon à valider : utilisateurs actifs de l'entreprise avec VALIDATE_STOCK_ENTRIES (ou admin)
   * ayant accès au dépôt (admin : tous), sauf l'auteur
   */
  async validators(entry) {
    const rows = await db.select(
      `SELECT DISTINCT u.id FROM users u
       WHERE u.is_active AND u.enterprise_id = $1 AND u.id IS DISTINCT FROM $3::uuid
         AND (EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id = 'prof_admin')
              OR (EXISTS (SELECT 1 FROM user_profiles up JOIN profile_permissions pp ON pp.profile_id = up.profile_id
                          JOIN permissions p ON p.id = pp.permission_id
                          WHERE up.user_id = u.id AND p.name = 'VALIDATE_STOCK_ENTRIES')
                  AND EXISTS (SELECT 1 FROM warehouse_users wu WHERE wu.warehouse_id = $2 AND wu.user_id = u.id)))`,
      [entry.enterprise_id, entry.warehouse_id, entry.created_by]
    );
    return rows.map(r => r.id);
  }
}

module.exports = new StockEntryModel();
module.exports.ENTRY_TYPES = ENTRY_TYPES;
