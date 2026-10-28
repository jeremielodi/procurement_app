// src/services/SupplierAllocationService.js
// Réquisition répartie entre plusieurs fournisseurs (migration 38_supplier_split.sql). À l'étape
// Activity_AllocateSuppliers, les achats attribuent chaque article à un fournisseur : une part par fournisseur,
// chaque article dans une seule part, tous les articles répartis. L'étape se termine avec supplierLots = [id des
// parts] : le sous-processus SubProcess_SupplierOrder du BPMN est alors répété une fois par part (bon de commande,
// approbation, envoi, confirmation, SAN / GRN, facture, paiement). La méthode d'achat et le niveau d'approbation
// restent ceux du montant TOTAL (pas de fractionnement) : la répartition ne les change pas.
const db = require('../config/database');
const camundaService = require('./CamundaService');

const TASK_KEY = 'Activity_AllocateSuppliers';
const ATTACHMENT_MIME = /^(application\/pdf|image\/(jpeg|png))$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });
const text = (v, max = 2000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));

class SupplierAllocationService {
  get TASK_KEY() { return TASK_KEY; }

  /** Méthode d'achat choisie (variable BpmnGo, sinon statut CLASSIFIED_*) */
  async methodOf(requisition) {
    try {
      const vars = await camundaService.getProcessVariables(requisition.process_instance_id);
      const method = vars?.procurementMethod?.value ?? vars?.procurementMethod;
      if (method) return method;
    } catch { /* BpmnGo injoignable : statut */ }
    return String(requisition.status || '').startsWith('CLASSIFIED_') ? requisition.status.slice('CLASSIFIED_'.length) : null;
  }

  /**
   * Contrôle de la répartition (avant toute écriture) → parts normalisées.
   * variables.lots : [{ supplierId, itemIds: [id de ligne de réquisition], attachmentId?, amount?, justification? }]
   */
  async validate(requisitionId, variables = {}) {
    const requisition = requisitionId
      ? await db.one('SELECT id, status, process_instance_id FROM requisitions WHERE id = $1', [requisitionId])
      : null;
    if (!requisition) throw fail(400, 'REQUISITION_REQUIRED', 'Réquisition introuvable pour cette étape');
    let lots = variables.lots;
    if (typeof lots === 'string') { try { lots = JSON.parse(lots); } catch { lots = null; } }
    if (!Array.isArray(lots) || !lots.length) throw fail(400, 'ALLOCATION_REQUIRED', 'Répartissez les articles entre les fournisseurs');

    const method = await this.methodOf(requisition);
    const items = await db.select(
      'SELECT id, item_description, total_amount::float8 AS total_amount FROM requisition_items WHERE requisition_id = $1 ORDER BY id',
      [requisitionId]
    );
    const itemIds = new Set(items.map(i => String(i.id)));
    const seen = new Map();
    const suppliers = new Set();
    // 1. Structure : fournisseurs et articles (une seule part par article, tous répartis, au moins deux fournisseurs)
    const parts = [];
    for (const [index, lot] of lots.entries()) {
      const supplierId = parseInt(lot?.supplierId, 10);
      if (!supplierId) throw fail(400, 'SUPPLIER_REQUIRED', `Part ${index + 1} : choisissez le fournisseur`, { lot: index + 1 });
      if (suppliers.has(supplierId)) throw fail(400, 'SUPPLIER_TWICE', 'Un fournisseur ne peut avoir qu\'une part', { lot: index + 1 });
      suppliers.add(supplierId);
      const supplier = await db.one('SELECT id, name, status FROM suppliers WHERE id = $1', [supplierId]);
      if (!supplier) throw fail(400, 'SUPPLIER_NOT_FOUND', 'Fournisseur introuvable', { lot: index + 1 });
      if (supplier.status !== 'ACTIVE') throw fail(400, 'SUPPLIER_INACTIVE', `${supplier.name} n'est pas actif`, { lot: index + 1 });

      const lotItems = [...new Set((Array.isArray(lot.itemIds) ? lot.itemIds : []).map(String))];
      if (!lotItems.length) throw fail(400, 'LOT_EMPTY', `${supplier.name} : aucun article`, { lot: index + 1 });
      for (const itemId of lotItems) {
        if (!itemIds.has(itemId)) throw fail(400, 'ITEM_NOT_FOUND', 'Article absent de la réquisition', { lot: index + 1, itemId });
        if (seen.has(itemId)) throw fail(400, 'ITEM_ALLOCATED_TWICE', 'Un article ne peut être attribué qu\'à un seul fournisseur', { itemId });
        seen.set(itemId, index);
      }
      parts.push({ lot, supplier, lotItems });
    }
    if (parts.length < 2) throw fail(400, 'SPLIT_MIN_SUPPLIERS', 'Une répartition compte au moins deux fournisseurs');
    const missing = items.filter(i => !seen.has(String(i.id)));
    if (missing.length) {
      throw fail(400, 'ITEM_NOT_ALLOCATED', 'Chaque article doit être attribué à un fournisseur', { itemIds: missing.map(i => i.id) });
    }

    // 2. Pièces et justification de chaque part
    const normalized = [];
    for (const [index, { lot, supplier, lotItems }] of parts.entries()) {
      let attachment = null;
      const attachmentId = text(lot.attachmentId, 36);
      if (attachmentId) {
        attachment = UUID_RE.test(attachmentId)
          ? await db.one(
            `SELECT id, file_name, mime_type FROM attachments WHERE id = $1 AND entity_type = 'requisition' AND entity_id = $2`,
            [attachmentId, requisitionId]
          )
          : null;
        if (!attachment) throw fail(400, 'PROFORMA_NOT_FOUND', 'Pro-forma introuvable (le fichier doit être joint à cette réquisition)', { lot: index + 1 });
        if (!ATTACHMENT_MIME.test(attachment.mime_type || '')) throw fail(400, 'PROFORMA_TYPE', 'La pro-forma doit être un PDF, un JPG ou un PNG', { lot: index + 1 });
      } else if (method === 'DIRECT_PURCHASE') {
        throw fail(400, 'PROFORMA_REQUIRED', `${supplier.name} : joignez la facture pro-forma`, { lot: index + 1 });
      }

      let amount = null;
      if (lot.amount !== undefined && lot.amount !== null && lot.amount !== '') {
        amount = Number(lot.amount);
        if (!Number.isFinite(amount) || amount < 0) throw fail(400, 'PROFORMA_AMOUNT_INVALID', 'Montant invalide', { lot: index + 1 });
      }
      const justification = text(lot.justification) || null;
      if (method === 'SOLE_SOURCE' && !justification) {
        throw fail(400, 'JUSTIFICATION_REQUIRED', `${supplier.name} : justifiez le choix de ce fournisseur`, { lot: index + 1 });
      }
      normalized.push({ supplier, itemIds: lotItems.map(Number), attachment, amount, justification });
    }
    return { method, lots: normalized };
  }

  /**
   * Enregistre les parts puis termine l'étape BpmnGo (complete(lotIds)) dans la même transaction : refus de BpmnGo =
   * rien d'écrit. Une répartition précédente sans bon de commande (étape reprise) est remplacée.
   */
  async recordAndComplete({ requisitionId, allocation, userId, taskId }, complete) {
    return db.withTransaction(async (tx) => {
      const ordered = await tx.one(
        'SELECT COUNT(*)::int AS n FROM requisition_supplier_lots WHERE requisition_id = $1 AND po_id IS NOT NULL',
        [requisitionId]
      );
      if (ordered?.n) throw fail(409, 'ALLOCATION_LOCKED', 'Des bons de commande existent déjà pour cette répartition');
      const lotIds = await this.insertLots(tx, requisitionId, allocation.lots.map(l => ({
        supplierId: l.supplier.id, itemIds: l.itemIds, attachmentId: l.attachment?.id, amount: l.amount, justification: l.justification,
      })), { userId, taskId });
      // BpmnGo en dernier : en cas de refus, la répartition est annulée avec la transaction
      const result = await complete(lotIds);
      if (!result?.success) throw fail(502, 'BPMNGO_ERROR', result?.error || 'BpmnGo n\'a pas accepté la fin de l\'étape');
      return { ...result, lotIds };
    });
  }

  /**
   * Écrit les parts d'une réquisition (dans la transaction tx), en remplaçant une répartition précédente sans bon de
   * commande. lots : [{ supplierId, itemIds, attachmentId?, amount?, justification? }] → id des parts, dans l'ordre.
   * Utilisé par la répartition (Activity_AllocateSuppliers) et par l'attribution par article d'un appel d'offres.
   */
  async insertLots(tx, requisitionId, lots, { userId = null, taskId = null, tenderId = null } = {}) {
    await tx.exec('DELETE FROM requisition_supplier_lots WHERE requisition_id = $1 AND po_id IS NULL', [requisitionId]);
    const lotIds = [];
    for (const [index, lot] of lots.entries()) {
      const row = await tx.one(
        `INSERT INTO requisition_supplier_lots
           (requisition_id, lot_number, supplier_id, attachment_id, amount, justification, task_id, created_by, tender_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [requisitionId, index + 1, lot.supplierId, lot.attachmentId || null, lot.amount ?? null, lot.justification || null,
          taskId, userId, tenderId]
      );
      for (const itemId of lot.itemIds) {
        await tx.exec('INSERT INTO requisition_supplier_lot_items (lot_id, requisition_item_id) VALUES ($1, $2)', [row.id, itemId]);
      }
      lotIds.push(row.id);
    }
    return lotIds;
  }

  /** Parts de la réquisition (fournisseur, articles, pro-forma, bon de commande et son avancement), [] sans répartition */
  async list(requisitionId) {
    const lots = await db.select(
      `SELECT l.id, l.lot_number, l.supplier_id, s.name AS supplier_name, l.attachment_id, a.file_name AS attachment_name,
              l.amount::float8 AS amount, l.justification, l.po_id, po.po_number, po.status AS po_status,
              po.total_amount::float8 AS po_amount,
              EXISTS (SELECT 1 FROM invoices i WHERE i.po_id = po.id AND i.status = 'PAID') AS paid,
              l.tender_id, l.created_by, u.first_name || ' ' || u.last_name AS created_by_name, l.created_at
       FROM requisition_supplier_lots l
       JOIN suppliers s ON s.id = l.supplier_id
       LEFT JOIN attachments a ON a.id = l.attachment_id
       LEFT JOIN purchase_orders po ON po.id = l.po_id
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.requisition_id = $1
       ORDER BY l.lot_number`,
      [requisitionId]
    );
    if (!lots.length) return [];
    const items = await db.select(
      `SELECT li.lot_id, ri.id, ri.item_description, ri.quantity::float8 AS quantity, ri.unit_price::float8 AS unit_price,
              ri.total_amount::float8 AS total_amount, ta.unit_price::float8 AS awarded_unit_price, ta.total_price::float8 AS awarded_total
       FROM requisition_supplier_lot_items li
       JOIN requisition_supplier_lots l ON l.id = li.lot_id
       JOIN requisition_items ri ON ri.id = li.requisition_item_id
       -- Part issue d'un appel d'offres attribué par article : prix de l'offre retenue
       LEFT JOIN tender_awards ta ON ta.tender_id = l.tender_id AND ta.requisition_item_id = ri.id
       WHERE li.lot_id = ANY($1)
       ORDER BY ri.id`,
      [lots.map(l => l.id)]
    );
    return lots.map(l => {
      const own = items.filter(i => String(i.lot_id) === String(l.id)).map(({ lot_id: _, ...i }) => i);
      return { ...l, items: own, estimated_amount: own.reduce((sum, i) => sum + (i.awarded_total ?? i.total_amount ?? 0), 0) };
    });
  }

  /** Une part (avec ses articles) ou null */
  async get(lotId) {
    const lot = await db.one('SELECT requisition_id FROM requisition_supplier_lots WHERE id = $1', [lotId]);
    return lot ? (await this.list(lot.requisition_id)).find(l => String(l.id) === String(lotId)) || null : null;
  }
}

module.exports = new SupplierAllocationService();
