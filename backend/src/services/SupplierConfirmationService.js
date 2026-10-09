// backend/src/services/SupplierConfirmationService.js
// Réponse du fournisseur à un bon de commande (étape GoFlow Activity_SupplierConfirmation) :
//   CONFIRMED → PO_CONFIRMED (date de livraison promise, référence fournisseur) + tâche GoFlow complétée
//   DECLINED  → motif obligatoire ; la tâche reste ouverte, les achats décident (nouvelle négociation, annulation…)
// Source : PORTAL (le fournisseur, depuis son portail) ou PROCUREMENT (confirmation reçue par téléphone / email).
// Un refus peut être suivi d'une confirmation (après négociation) ; une confirmation est définitive.
const db = require('../config/database');
const tenant = require('../utils/tenant');
const camundaService = require('./CamundaService');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const i18n = require('../i18n');

const TASK_KEY = 'Activity_SupplierConfirmation';
const RESPONDABLE = ['PO_APPROVED', 'PO_SENT'];
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
/** Date AAAA-MM-JJ réellement existante (Date.parse accepte « 2026-02-31 » et la décale au 3 mars) */
const isoDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : null;
};

/** Tâche GoFlow « confirmation fournisseur » ouverte pour ce processus (null si GoFlow injoignable ou étape non atteinte) */
async function openTask(processInstanceId) {
  if (!processInstanceId) return null;
  const tasks = (await camundaService.getProcessTasks(processInstanceId)) || [];
  return tasks.find(t => t.taskDefinitionKey === TASK_KEY && t.processInstanceId === processInstanceId) || null;
}

/** Utilisateurs à prévenir : achats actifs de l'entreprise du bon + son créateur (hors auteur de l'action) */
async function buyers(po, exceptUserId) {
  const rows = await db.select(
    `SELECT DISTINCT u.id, u.language FROM users u
     WHERE u.is_active AND (u.id = $2 OR (u.enterprise_id = $1
       AND EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id = 'prof_procurement')))`,
    [po.enterprise_id, po.created_by]
  );
  return rows.filter(r => String(r.id) !== String(exceptUserId));
}

async function notify(io, recipients, key, vars, link) {
  for (const r of recipients) {
    try {
      const T = i18n.translator(r.language);
      const title = T(`notification.supplierConfirmation.${key}Title`, vars);
      const message = T(`notification.supplierConfirmation.${key}Message`, vars);
      await notificationModel.create({ userId: r.id, title, message, type: key === 'declined' ? 'WARNING' : 'SUCCESS', link });
      io?.to(`user-${r.id}`).emit('notification', { title, message, type: key === 'declined' ? 'WARNING' : 'SUCCESS', link, timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Notification confirmation fournisseur :', error.message);
    }
  }
}

class SupplierConfirmationService {
  /**
   * @param {number} poId
   * @param {object} data { response: 'CONFIRMED' | 'DECLINED', deliveryDate, reference, comment }
   * @param {object} ctx  { userId, source: 'PORTAL' | 'PROCUREMENT', supplierId (PORTAL : contrôle d'appartenance), io, taskId,
   *                        skipTask (tâche GoFlow déjà complétée par « Mes tâches ») }
   * @returns {{ poId, poNumber, response, taskCompleted }}
   */
  async respond(poId, { response, deliveryDate, reference, comment }, { userId, source, supplierId, io, taskId, skipTask } = {}) {
    const resp = String(response || '').toUpperCase();
    if (!['CONFIRMED', 'DECLINED'].includes(resp)) throw fail(400, 'INVALID_RESPONSE', 'Réponse invalide');
    const note = String(comment || '').trim().slice(0, 2000);
    if (resp === 'DECLINED' && !note) throw fail(400, 'REASON_REQUIRED', 'Indiquez le motif du refus');
    const date = deliveryDate ? isoDate(deliveryDate) : null;
    if (deliveryDate && !date) throw fail(400, 'INVALID_DATE', 'Date de livraison invalide');
    const ref = String(reference || '').trim().slice(0, 100) || null;

    const po = await db.withTransaction(async (tx) => {
      const row = await tx.one(
        `SELECT po.id, po.po_number, po.status, po.supplier_id, po.supplier_response, po.enterprise_id, po.created_by, po.requisition_id,
                po.process_instance_id AS po_process, r.process_instance_id AS req_process, s.name AS supplier_name
         FROM purchase_orders po
         LEFT JOIN requisitions r ON r.id = po.requisition_id
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.id = $1 FOR UPDATE OF po`,
        [poId]
      );
      if (!row || (source === 'PORTAL' && String(row.supplier_id) !== String(supplierId))) throw fail(404, 'NOT_FOUND', 'Bon de commande introuvable');
      if (row.supplier_response === 'CONFIRMED' || row.status === 'PO_CONFIRMED') throw fail(409, 'ALREADY_CONFIRMED', 'Commande déjà confirmée');
      if (!RESPONDABLE.includes(row.status)) throw fail(409, 'NOT_RESPONDABLE', 'Cette commande n\'attend pas de confirmation (non approuvée, annulée ou terminée)');
      if (date && date < new Date().toISOString().slice(0, 10)) throw fail(400, 'DATE_IN_PAST', 'La date de livraison promise est déjà passée');

      await tx.exec(
        `UPDATE purchase_orders
            SET supplier_response = $2::varchar, supplier_responded_at = CURRENT_TIMESTAMP, supplier_responded_by = $3,
                supplier_response_source = $4, confirmed_delivery_date = $5, supplier_reference = $6, supplier_comment = $7,
                status = CASE WHEN $2::varchar = 'CONFIRMED' THEN 'PO_CONFIRMED' ELSE status END, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [row.id, resp, userId || null, source, resp === 'CONFIRMED' ? date : null, ref, note || null]
      );
      // Historique (suivi du workflow de la réquisition) : entity_id est un UUID → rattaché à la réquisition
      if (row.requisition_id) {
        await tx.exec(
          `INSERT INTO workflow_history (entity_type, entity_id, process_instance_id, task_name, action, comments, performed_by, performed_at)
           VALUES ('requisition', $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
          [row.requisition_id, row.req_process || row.po_process || null, TASK_KEY, resp === 'CONFIRMED' ? 'SUPPLIER_CONFIRMED' : 'SUPPLIER_DECLINED',
           JSON.stringify({ source, deliveryDate: date, reference: ref, comment: note || null, poNumber: row.po_number, poId: row.id }), userId || null]
        );
      }
      return row;
    });

    // Confirmation : l'étape GoFlow est terminée (contexte de l'entreprise du bon : un compte fournisseur n'en a pas)
    let taskCompleted = !!skipTask;
    if (resp === 'CONFIRMED' && !skipTask) {
      try {
        const task = taskId ? { id: taskId } : await openTask(po.req_process || po.po_process);
        if (task) {
          const result = await tenant.run({ enterpriseId: po.enterprise_id }, () =>
            camundaService.completeTask(task.id, { supplierConfirmed: true, confirmedDeliveryDate: date || '', supplierReference: ref || '' }));
          taskCompleted = !!result.success;
          if (!result.success) console.warn(`[SupplierConfirmation] ${po.po_number} : tâche GoFlow non complétée — ${result.error}`);
        }
      } catch (error) {
        console.warn(`[SupplierConfirmation] ${po.po_number} : GoFlow injoignable — ${error.message}`);
      }
    }

    const vars = { number: po.po_number, supplier: po.supplier_name || '—', date: date || '—', reason: note || '—' };
    await notify(io, await buyers(po, userId), resp === 'CONFIRMED' ? 'confirmed' : 'declined', vars, `/purchase-orders/${po.id}`);
    return { poId: po.id, poNumber: po.po_number, response: resp, taskCompleted };
  }

  /** Bons de commande d'un fournisseur (portail) : à confirmer d'abord, puis les plus récents */
  async listForSupplier(supplierId, { status } = {}) {
    const params = [supplierId];
    let where = `po.supplier_id = $1 AND po.status NOT IN ('DRAFT', 'PO_PENDING', 'PO_REJECTED', 'CANCELLED')`;
    if (status === 'TO_CONFIRM') where += ` AND po.status IN ('PO_APPROVED', 'PO_SENT') AND COALESCE(po.supplier_response, '') <> 'CONFIRMED'`;
    return db.select(
      `SELECT po.id, po.po_number, po.status, po.order_date, po.delivery_date, po.total_amount::float8 AS total_amount,
              c.format_key AS currency, po.supplier_response, po.supplier_responded_at, po.confirmed_delivery_date,
              e.name AS buyer_name,
              (po.status IN ('PO_APPROVED', 'PO_SENT') AND COALESCE(po.supplier_response, '') <> 'CONFIRMED') AS awaiting_response
       FROM purchase_orders po
       LEFT JOIN currency c ON c.id = po.currency_id
       LEFT JOIN enterprise e ON e.id = po.enterprise_id
       WHERE ${where}
       ORDER BY awaiting_response DESC, po.created_at DESC`,
      params
    );
  }

  /** Détail d'un bon pour son fournisseur (lignes, acheteur, adresse de livraison) — null si ce n'est pas le sien */
  async getForSupplier(poId, supplierId) {
    const po = await db.one(
      `SELECT po.id, po.po_number, po.status, po.order_date, po.delivery_date, po.shipping_address,
              po.total_amount::float8 AS total_amount, c.format_key AS currency,
              po.supplier_response, po.supplier_responded_at, po.supplier_response_source, po.confirmed_delivery_date,
              po.supplier_reference, po.supplier_comment, e.name AS buyer_name, e.address AS buyer_address,
              e.phone AS buyer_phone, e.email AS buyer_email,
              (po.status IN ('PO_APPROVED', 'PO_SENT') AND COALESCE(po.supplier_response, '') <> 'CONFIRMED') AS awaiting_response
       FROM purchase_orders po
       LEFT JOIN currency c ON c.id = po.currency_id
       LEFT JOIN enterprise e ON e.id = po.enterprise_id
       WHERE po.id = $1 AND po.supplier_id = $2
         AND po.status NOT IN ('DRAFT', 'PO_PENDING', 'PO_REJECTED', 'CANCELLED')`,
      [poId, supplierId]
    );
    if (!po) return null;
    po.items = await db.select(
      `SELECT id, item_description, quantity::float8 AS quantity, unit_price::float8 AS unit_price,
              (quantity * unit_price)::float8 AS total
       FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id`,
      [poId]
    );
    return po;
  }
}

module.exports = new SupplierConfirmationService();
module.exports.TASK_KEY = TASK_KEY;
