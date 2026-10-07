// backend/src/models/GoodsReceiptModel.js
// Bons de réception (GRN). La création est ATOMIQUE (db.withTransaction) :
//  - ligne de GRN rattachée à sa ligne de PO (po_item_id ; à défaut, désignation identique sans ambiguïté)
//  - suivi des livraisons : le cumul accepté d'une ligne ne peut pas dépasser la quantité commandée
//  - articles stockables : entrée en stock (mouvement RECEIPT) de la quantité ACCEPTÉE, dans un dépôt
//    auquel l'utilisateur a accès (choix obligatoire s'il en a plusieurs), avec n° de lot / péremption si suivis
const db = require('../config/database');
const tenant = require('../utils/tenant');
const stockModel = require('./StockModel');
const warehouseModel = require('./WarehouseModel');

const EPS = 1e-9;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

class GoodsReceiptModel {

  async generateGRNNumber(tx = db) {
    const year = new Date().getFullYear();
    const result = await tx.one(
      `SELECT COALESCE(MAX(SUBSTRING(grn_number FROM '^GRN-${year}-(\\d+)$')::int), 0) AS last
       FROM goods_receipt_notes WHERE grn_number LIKE $1`,
      [`GRN-${year}-%`]
    );
    return `GRN-${year}-${String(parseInt(result.last) + 1).padStart(4, '0')}`;
  }

  /**
   * Création d'un GRN (et des entrées en stock).
   * @param {object} data      { poId, receivedBy, grnItems, observations, warehouseId }
   *   grnItems[] : { poItemId, item_description, quantity_received, quantity_accepted, quantity_rejected,
   *                  rejection_reason, stockItemId (rattacher une ligne en texte libre), lotNumber, expiryDate }
   * @param {object} context   { userId } — utilisateur qui réceptionne (contrôle d'accès aux dépôts) ;
   *                           sans userId (worker) : dépôt obligatoire et non contrôlé
   */
  async create({ poId, receivedBy, grnItems = [], observations, warehouseId }, { userId } = {}) {
    return db.withTransaction(async (tx) => {
      // Verrou du PO : deux réceptions simultanées du même PO sont sérialisées (cumuls exacts)
      const po = await tx.one(
        'SELECT id, enterprise_id, currency_id, supplier_id FROM purchase_orders WHERE id = $1 FOR UPDATE',
        [poId]
      );
      if (!po) throw fail(404, 'PO_NOT_FOUND', 'Commande introuvable');

      const poItems = await tx.select(
        `SELECT pi.id, pi.item_description, pi.quantity, pi.unit_price, pi.stock_item_id,
                d.quantity_accepted AS already_accepted
         FROM purchase_order_items pi
         JOIN v_po_item_delivery d ON d.po_item_id = pi.id
         WHERE pi.purchase_order_id = $1`,
        [poId]
      );
      const byId = new Map(poItems.map(p => [String(p.id), p]));
      const byDescription = (desc) => {
        const key = String(desc || '').trim().toLowerCase();
        const matches = poItems.filter(p => String(p.item_description || '').trim().toLowerCase() === key);
        return matches.length === 1 ? matches[0] : null;
      };

      // ---- 1. Lignes : quantités, ligne de PO, article
      const acceptedInThisGrn = new Map();
      const lines = [];
      for (const [index, raw] of grnItems.entries()) {
        const received = num(raw.quantity_received);
        const rejected = num(raw.quantity_rejected);
        const accepted = raw.quantity_accepted === undefined || raw.quantity_accepted === null || raw.quantity_accepted === ''
          ? received - rejected
          : num(raw.quantity_accepted);
        const label = raw.item_description || raw.description || `#${index + 1}`;
        if (received < 0 || rejected < 0 || accepted < 0) {
          throw fail(400, 'INVALID_QUANTITY', `Quantités négatives interdites (${label})`, { line: index });
        }
        if (Math.abs(accepted + rejected - received) > 1e-6) {
          throw fail(400, 'INVALID_QUANTITY', `Quantité reçue ≠ acceptée + rejetée (${label})`, { line: index });
        }

        let poItem = null;
        const poItemId = raw.poItemId ?? raw.po_item_id;
        if (poItemId !== undefined && poItemId !== null && poItemId !== '') {
          poItem = byId.get(String(poItemId));
          if (!poItem) throw fail(400, 'PO_ITEM_MISMATCH', `La ligne ${label} n'appartient pas à cette commande`, { line: index });
        } else {
          poItem = byDescription(label);
        }

        if (poItem) {
          const cumulated = num(poItem.already_accepted) + (acceptedInThisGrn.get(poItem.id) || 0) + accepted;
          if (cumulated - num(poItem.quantity) > EPS) {
            const remaining = Math.max(num(poItem.quantity) - num(poItem.already_accepted) - (acceptedInThisGrn.get(poItem.id) || 0), 0);
            throw fail(400, 'OVER_DELIVERY',
              `${poItem.item_description} : ${accepted} accepté(s) pour un reste à livrer de ${remaining}`,
              { line: index, poItemId: poItem.id, remaining });
          }
          acceptedInThisGrn.set(poItem.id, (acceptedInThisGrn.get(poItem.id) || 0) + accepted);
        }

        // Article : celui de la ligne de PO, ou rattachement d'une ligne en texte libre par la logistique
        const requestedItemId = raw.stockItemId ?? raw.stock_item_id ?? null;
        if (poItem?.stock_item_id && requestedItemId && String(requestedItemId) !== String(poItem.stock_item_id)) {
          throw fail(400, 'ITEM_MISMATCH', `${label} : la ligne de commande est déjà liée à un autre article`, { line: index });
        }
        const stockItemId = poItem?.stock_item_id || requestedItemId || null;
        let stockItem = null;
        if (stockItemId) {
          stockItem = await tx.one(
            'SELECT id, enterprise_id, code, name, is_stockable, track_lots, track_expiry, track_serials, is_active FROM stock_items WHERE id = $1',
            [stockItemId]
          );
          if (!stockItem || String(stockItem.enterprise_id) !== String(po.enterprise_id)) {
            throw fail(400, 'ITEM_NOT_FOUND', `${label} : article introuvable`, { line: index });
          }
        }

        const lotNumber = String(raw.lotNumber ?? raw.lot_number ?? '').trim();
        const expiryDate = raw.expiryDate ?? raw.expiry_date ?? null;
        const toStock = !!(stockItem?.is_stockable && accepted > EPS);
        if (toStock && stockItem.track_lots && !lotNumber) {
          throw fail(400, 'LOT_REQUIRED', `${stockItem.name} : n° de lot obligatoire`, { line: index });
        }
        if (toStock && stockItem.track_expiry && !expiryDate) {
          throw fail(400, 'EXPIRY_REQUIRED', `${stockItem.name} : date de péremption obligatoire`, { line: index });
        }
        if (toStock && expiryDate && String(expiryDate).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
          throw fail(400, 'LOT_EXPIRED', `${stockItem.name} : lot ${lotNumber} déjà périmé — à rejeter`, { line: index });
        }

        // Équipements suivis par n° de série : un n° (et éventuellement un n° d'inventaire) par unité acceptée
        let serials = [];
        if (toStock && stockItem.track_serials) {
          if (!Number.isInteger(accepted)) throw fail(400, 'SERIAL_INTEGER', `${stockItem.name} : quantité entière obligatoire`, { line: index });
          serials = (raw.serials || raw.serialNumbers || []).map(s => (typeof s === 'string' ? { serialNumber: s } : s))
            .map(s => ({ serialNumber: String(s.serialNumber || s.serial_number || '').trim(), assetTag: String(s.assetTag || s.asset_tag || '').trim() || null }))
            .filter(s => s.serialNumber);
          if (serials.length !== accepted) {
            throw fail(400, 'SERIALS_REQUIRED', `${stockItem.name} : ${accepted} n° de série attendu(s), ${serials.length} saisi(s)`, { line: index });
          }
          const seen = new Set();
          for (const s of serials) {
            const key = s.serialNumber.toUpperCase();
            if (seen.has(key)) throw fail(400, 'SERIAL_DUPLICATE', `${stockItem.name} : n° de série ${s.serialNumber} en double`, { line: index });
            seen.add(key);
          }
          const known = await tx.select(
            `SELECT serial_number FROM stock_units WHERE stock_item_id = $1 AND status <> 'VOID' AND UPPER(serial_number) = ANY($2::text[])`,
            [stockItem.id, [...seen]]
          );
          if (known.length) throw fail(400, 'SERIAL_EXISTS', `${stockItem.name} : n° de série déjà enregistré (${known.map(k => k.serial_number).join(', ')})`, { line: index });
          await require('./StockEquipmentModel').checkAssetTags(tx, po.enterprise_id, serials);
        }

        lines.push({ raw, label, received, accepted, rejected, poItem, stockItem, requestedItemId, lotNumber, expiryDate, toStock, serials });
      }

      // ---- 2. Dépôt (si au moins une ligne entre en stock)
      let warehouse = null;
      if (lines.some(l => l.toStock)) {
        if (userId) {
          const accessible = (await warehouseModel.accessibleFor(userId))
            .filter(w => String(w.enterprise_id) === String(po.enterprise_id));
          if (!accessible.length) {
            throw fail(403, 'NO_WAREHOUSE_ACCESS', 'Vous n\'avez accès à aucun dépôt : demandez un accès à votre administrateur');
          }
          if (warehouseId) {
            warehouse = accessible.find(w => String(w.id) === String(warehouseId));
            if (!warehouse) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès à ce dépôt');
          } else if (accessible.length === 1) {
            warehouse = accessible[0];
          } else {
            throw fail(400, 'WAREHOUSE_REQUIRED', 'Choisissez le dépôt où placer les articles reçus');
          }
        } else {
          if (!warehouseId) throw fail(400, 'WAREHOUSE_REQUIRED', 'Dépôt obligatoire pour les articles stockables');
          warehouse = await tx.one('SELECT id, enterprise_id, is_active FROM warehouses WHERE id = $1', [warehouseId]);
          if (!warehouse || !warehouse.is_active || String(warehouse.enterprise_id) !== String(po.enterprise_id)) {
            throw fail(400, 'WAREHOUSE_FORBIDDEN', 'Dépôt introuvable ou inactif');
          }
        }
      }

      // ---- 3. GRN
      const totalReceived = lines.reduce((s, l) => s + l.received, 0);
      const totalRejected = lines.reduce((s, l) => s + l.rejected, 0);
      const status = totalRejected > EPS ? 'PARTIAL' : (totalReceived > EPS ? 'COMPLETE' : 'PENDING');
      const grnCompliant = totalReceived > EPS && totalRejected <= EPS;
      const grnNumber = await this.generateGRNNumber(tx);

      const grn = await tx.one(
        `INSERT INTO goods_receipt_notes (grn_number, po_id, receipt_date, received_by, status, observations, warehouse_id, enterprise_id)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7)
         RETURNING id, grn_number, status`,
        [grnNumber, poId, receivedBy || null, status, observations || null, warehouse?.id || null, po.enterprise_id]
      );

      // ---- 4. Lignes, lots, mouvements
      let movementCount = 0;
      for (const l of lines) {
        let lotId = null;
        if (l.toStock && l.stockItem.track_lots) {
          lotId = await stockModel.findOrCreateLot(tx, {
            enterpriseId: po.enterprise_id, stockItemId: l.stockItem.id, lotNumber: l.lotNumber,
            expiryDate: l.expiryDate, supplierId: po.supplier_id, createdBy: userId || receivedBy || null,
          });
        }
        const item = await tx.one(
          `INSERT INTO goods_receipt_items
             (grn_id, item_description, quantity_received, quantity_accepted, quantity_rejected, rejection_reason,
              po_item_id, stock_item_id, lot_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [grn.id, l.poItem?.item_description || l.label, l.received, l.accepted, l.rejected, l.raw.rejection_reason || null,
           l.poItem?.id || null, l.stockItem?.id || null, lotId]
        );
        // Ligne de PO en texte libre rattachée à un article à la réception : le lien est conservé
        if (l.poItem && !l.poItem.stock_item_id && l.stockItem) {
          await tx.exec('UPDATE purchase_order_items SET stock_item_id = $1 WHERE id = $2 AND stock_item_id IS NULL', [l.stockItem.id, l.poItem.id]);
        }
        if (l.toStock && l.stockItem.track_serials) {
          let first = null;
          for (const s of l.serials) {
            const unit = await tx.one(
              `INSERT INTO stock_units (enterprise_id, stock_item_id, serial_number, asset_tag, status, warehouse_id, grn_item_id, created_by)
               VALUES ($1, $2, $3, $4, 'IN_STOCK', $5, $6, $7) RETURNING id`,
              [po.enterprise_id, l.stockItem.id, s.serialNumber, s.assetTag, warehouse.id, item.id, userId || receivedBy || null]
            );
            const movement = await stockModel.addMovement(tx, {
              enterpriseId: po.enterprise_id, stockItemId: l.stockItem.id, warehouseId: warehouse.id, unitId: unit.id,
              type: 'RECEIPT', quantity: 1, unitCost: l.poItem?.unit_price ?? null, currencyId: po.currency_id,
              sourceType: 'GRN', sourceId: grn.id, sourceLineId: item.id,
              comment: grnNumber, performedBy: userId || receivedBy || null,
            });
            first = first || movement;
            movementCount++;
          }
          await tx.exec('UPDATE goods_receipt_items SET stock_movement_id = $1 WHERE id = $2', [first.id, item.id]);
        } else if (l.toStock) {
          const movement = await stockModel.addMovement(tx, {
            enterpriseId: po.enterprise_id, stockItemId: l.stockItem.id, warehouseId: warehouse.id, lotId,
            type: 'RECEIPT', quantity: l.accepted, unitCost: l.poItem?.unit_price ?? null, currencyId: po.currency_id,
            sourceType: 'GRN', sourceId: grn.id, sourceLineId: item.id,
            comment: grnNumber, performedBy: userId || receivedBy || null,
          });
          await tx.exec('UPDATE goods_receipt_items SET stock_movement_id = $1 WHERE id = $2', [movement.id, item.id]);
          movementCount++;
        }
      }

      const delivery = await tx.one(
        `SELECT COUNT(*)::int AS lines, COUNT(*) FILTER (WHERE quantity_remaining > 0)::int AS open_lines
         FROM v_po_item_delivery WHERE purchase_order_id = $1`,
        [poId]
      );

      return {
        id: grn.id, grnNumber: grn.grn_number, status: grn.status, grnCompliant,
        warehouseId: warehouse?.id || null, stockMovements: movementCount,
        poFullyDelivered: delivery.lines > 0 && delivery.open_lines === 0,
      };
    });
  }

  async findById(id) {
    const grn = await db.one(
      `SELECT grn.*,
              po.po_number, po.total_amount AS po_amount, po.requisition_id,
              s.name AS supplier_name,
              u.first_name || ' ' || u.last_name AS received_by_name,
              w.code AS warehouse_code, w.name AS warehouse_name, l.name AS warehouse_location
       FROM goods_receipt_notes grn
       LEFT JOIN purchase_orders po ON grn.po_id = po.id
       LEFT JOIN suppliers       s  ON po.supplier_id = s.id
       LEFT JOIN users           u  ON grn.received_by = u.id
       LEFT JOIN warehouses      w  ON w.id = grn.warehouse_id
       LEFT JOIN locations       l  ON l.id = w.location_id
       WHERE grn.id = $1`,
      [id]
    );
    if (!grn) return null;

    const items = await db.select(
      `SELECT gi.id, gi.grn_id, gi.item_description, gi.rejection_reason, gi.created_at, gi.po_item_id,
              gi.stock_item_id, gi.lot_id, gi.stock_movement_id,
              gi.quantity_received::float8 AS quantity_received, gi.quantity_accepted::float8 AS quantity_accepted,
              gi.quantity_rejected::float8 AS quantity_rejected, pi.quantity::float8 AS quantity_ordered,
              si.code AS item_code, si.name AS item_name, si.unit, si.is_stockable,
              lt.lot_number, lt.expiry_date, m.movement_number,
              ARRAY(SELECT un.serial_number FROM stock_units un WHERE un.grn_item_id = gi.id AND un.status <> 'VOID' ORDER BY un.serial_number) AS serials
       FROM goods_receipt_items gi
       LEFT JOIN purchase_order_items pi ON pi.id = gi.po_item_id
       LEFT JOIN stock_items si ON si.id = gi.stock_item_id
       LEFT JOIN stock_lots lt ON lt.id = gi.lot_id
       LEFT JOIN stock_movements m ON m.id = gi.stock_movement_id
       WHERE gi.grn_id = $1 ORDER BY gi.id`,
      [id]
    );

    return { ...grn, items };
  }

  async findAll({ poId, status, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    let i = 1;
    // Multi-entreprise : uniquement les données de l'entreprise courante
    where += tenant.filter('grn.enterprise_id', params);
    i = params.length + 1;

    if (poId)   { where += ` AND grn.po_id = $${i++}`;    params.push(poId); }
    if (status) { where += ` AND grn.status = $${i++}`;   params.push(status); }

    params.push(limit, offset);

    return db.select(
      `SELECT grn.id, grn.grn_number, grn.status, grn.receipt_date, grn.observations,
              grn.created_at, grn.po_id,
              po.po_number, po.total_amount AS po_amount,
              s.name AS supplier_name,
              u.first_name || ' ' || u.last_name AS received_by_name,
              w.name AS warehouse_name
       FROM goods_receipt_notes grn
       LEFT JOIN purchase_orders po ON grn.po_id = po.id
       LEFT JOIN suppliers       s  ON po.supplier_id = s.id
       LEFT JOIN users           u  ON grn.received_by = u.id
       LEFT JOIN warehouses      w  ON w.id = grn.warehouse_id
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
    // Multi-entreprise : uniquement les données de l'entreprise courante
    where += tenant.filter('enterprise_id', params);
    i = params.length + 1;
    if (poId)   { where += ` AND po_id = $${i++}`;  params.push(poId); }
    if (status) { where += ` AND status = $${i++}`; params.push(status); }
    const result = await db.one(
      `SELECT COUNT(*) AS count FROM goods_receipt_notes ${where}`, params
    );
    return parseInt(result.count);
  }

  async findByPOId(poId) {
    return db.select(
      `SELECT grn.*, u.first_name || ' ' || u.last_name AS received_by_name, w.name AS warehouse_name
       FROM goods_receipt_notes grn
       LEFT JOIN users u ON grn.received_by = u.id
       LEFT JOIN warehouses w ON w.id = grn.warehouse_id
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

  /**
   * Annulation d'un GRN : écritures inverses (RECEIPT_REVERSAL) des entrées en stock, puis statut CANCELLED.
   * Refusée si le stock correspondant a déjà été consommé (solde insuffisant) — rien n'est modifié.
   * Le GRN annulé ne compte plus dans le suivi des livraisons (v_po_item_delivery).
   */
  async cancel(id, { userId, reason } = {}) {
    return db.withTransaction(async (tx) => {
      const grn = await tx.one('SELECT id, grn_number, status, enterprise_id FROM goods_receipt_notes WHERE id = $1 FOR UPDATE', [id]);
      if (!grn) throw fail(404, 'GRN_NOT_FOUND', 'GRN introuvable');
      if (grn.status === 'CANCELLED') throw fail(409, 'ALREADY_CANCELLED', 'GRN déjà annulé');

      const entries = await tx.select(
        `SELECT m.id, m.stock_item_id, m.warehouse_id, m.lot_id, m.unit_id, m.quantity, m.unit_cost, m.currency_id, m.source_line_id AS line_id
         FROM stock_movements m
         WHERE m.source_type = 'GRN' AND m.source_id = $1 AND m.movement_type = 'RECEIPT'`,
        [String(id)]
      );
      // Équipements : chaque unité reçue doit être encore en stock dans son dépôt (ni affectée, ni sortie)
      for (const e of entries.filter(x => x.unit_id)) {
        const unit = await tx.one('SELECT serial_number, status, warehouse_id FROM stock_units WHERE id = $1 FOR UPDATE', [e.unit_id]);
        if (unit.status !== 'IN_STOCK' || String(unit.warehouse_id) !== String(e.warehouse_id)) {
          throw fail(409, 'STOCK_INSUFFICIENT', `Annulation impossible : l'équipement ${unit.serial_number} n'est plus en stock dans ce dépôt`);
        }
      }
      if (entries.length && userId && !(await warehouseModel.isEnterpriseAdmin(userId))) {
        for (const e of entries) {
          if (!(await warehouseModel.canOperate(userId, e.warehouse_id))) {
            throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès au dépôt de cette réception');
          }
        }
      }
      for (const e of entries) {
        try {
          await stockModel.addMovement(tx, {
            enterpriseId: grn.enterprise_id, stockItemId: e.stock_item_id, warehouseId: e.warehouse_id, lotId: e.lot_id, unitId: e.unit_id,
            type: 'RECEIPT_REVERSAL', quantity: -Math.abs(parseFloat(e.quantity)), unitCost: e.unit_cost, currencyId: e.currency_id,
            sourceType: 'GRN', sourceId: grn.id, sourceLineId: e.line_id,
            comment: `Annulation ${grn.grn_number}${reason ? ` — ${reason}` : ''}`, performedBy: userId || null,
          });
        } catch (error) {
          if (/STOCK_INSUFFICIENT/.test(error.message)) {
            throw fail(409, 'STOCK_INSUFFICIENT', 'Annulation impossible : une partie du stock reçu a déjà été sortie');
          }
          throw error;
        }
      }
      // Unités reçues par ce GRN : annulées (n° de série libéré pour une nouvelle saisie)
      await tx.exec(
        `UPDATE stock_units SET status = 'VOID', warehouse_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE grn_item_id IN (SELECT id FROM goods_receipt_items WHERE grn_id = $1)`,
        [id]
      );
      await tx.exec(
        `UPDATE goods_receipt_notes SET status = 'CANCELLED',
           observations = CONCAT_WS(E'\\n', NULLIF(observations, ''), $2::text) WHERE id = $1`,
        [id, reason ? `Annulé : ${reason}` : null]
      );
      return { id: grn.id, grnNumber: grn.grn_number, reversedMovements: entries.length };
    });
  }
}

module.exports = new GoodsReceiptModel();
