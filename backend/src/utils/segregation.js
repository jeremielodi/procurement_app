// backend/src/utils/segregation.js
// Séparation des tâches (contrôle interne) : une même personne ne peut pas
//  - approuver une réquisition dont elle est le demandeur (N1 / N2 / N3) ;
//  - approuver un bon de commande qu'elle a créé, ou qui découle de sa propre réquisition ;
//  - valider une facture qu'elle a saisie ;
//  - approuver (ou passer « payé ») un paiement qu'elle a saisi.
// Aucune exception, y compris pour un administrateur : c'est le principe du contrôle. Toute tentative refusée est
// tracée dans le journal d'audit (SOD_VIOLATION_BLOCKED).
const db = require('../config/database');
const { audit, AUDIT } = require('./auditLog');

const REQUISITION_APPROVAL_TASKS = ['Activity_ValidationN1_Manager', 'Activity_ValidationN2_Finance', 'Activity_ValidationN3_DG'];
const PO_APPROVAL_TASK = 'Activity_POApproval';

const same = (a, b) => a != null && b != null && String(a) === String(b);

/** Erreur métier { status 403, code } (même forme que les autres erreurs des contrôleurs) */
function sodError(code, message) {
  return Object.assign(new Error(message), { status: 403, code });
}

/**
 * Conflits des tâches GoFlow pour un utilisateur, en lot (liste « Mes tâches », prise en charge, complétion).
 * @param {Array<{ processInstanceId, taskDefinitionKey }>} tasks
 * @returns {Map<processInstanceId|taskDefinitionKey, code>} clé `${processInstanceId}|${taskDefinitionKey}` → code
 */
async function taskConflicts(tasks, userId) {
  const conflicts = new Map();
  const relevant = (tasks || []).filter(t => t.processInstanceId
    && (REQUISITION_APPROVAL_TASKS.includes(t.taskDefinitionKey) || t.taskDefinitionKey === PO_APPROVAL_TASK));
  if (!relevant.length || !userId) return conflicts;
  const processIds = [...new Set(relevant.map(t => t.processInstanceId))];
  const reqs = await db.select(
    `SELECT r.id, r.process_instance_id, r.requester_id,
            (SELECT array_agg(po.created_by::text) FROM purchase_orders po
              WHERE po.requisition_id = r.id AND po.status IN ('PO_PENDING', 'DRAFT')) AS pending_po_creators
     FROM requisitions r WHERE r.process_instance_id = ANY($1)`,
    [processIds]
  );
  const byProcess = new Map(reqs.map(r => [r.process_instance_id, r]));
  for (const t of relevant) {
    const r = byProcess.get(t.processInstanceId);
    if (!r) continue;
    const key = `${t.processInstanceId}|${t.taskDefinitionKey}`;
    if (REQUISITION_APPROVAL_TASKS.includes(t.taskDefinitionKey) && same(r.requester_id, userId)) {
      conflicts.set(key, 'SELF_APPROVAL');
    } else if (t.taskDefinitionKey === PO_APPROVAL_TASK
      && (same(r.requester_id, userId) || (r.pending_po_creators || []).some(c => same(c, userId)))) {
      conflicts.set(key, 'SELF_APPROVAL');
    }
  }
  return conflicts;
}

/** Conflit d'une tâche (null si aucun) */
async function taskConflict(task, userId) {
  return (await taskConflicts([task], userId)).get(`${task.processInstanceId}|${task.taskDefinitionKey}`) || null;
}

/**
 * Refuse et trace une action contraire à la séparation des tâches.
 * @param {object} req
 * @param {object} p { code, message, entity: { type, id, label }, details }
 */
async function block(req, { code = 'SELF_APPROVAL', message, entity, details }) {
  await audit(req, AUDIT.SOD_VIOLATION_BLOCKED, { entity, details: { rule: code, ...(details || {}) } });
  return sodError(code, message || 'Séparation des tâches : vous ne pouvez pas approuver votre propre demande');
}

/** Demandeur de la réquisition d'origine d'un bon de commande */
async function poRequester(po) {
  return po.requisition_id
    ? (await db.one('SELECT requester_id FROM requisitions WHERE id = $1', [po.requisition_id]))?.requester_id
    : null;
}

/** L'utilisateur ne peut pas approuver ce bon (créateur, ou demandeur de la réquisition) — affichage des fiches */
async function isPurchaseOrderSelfApproval(po, userId) {
  return same(po.created_by, userId) || same(await poRequester(po), userId);
}

/** Bon de commande : ni son créateur, ni le demandeur de la réquisition d'origine */
async function assertCanApprovePurchaseOrder(req, po) {
  const userId = req.user?.id;
  const requester = await poRequester(po);
  if (same(po.created_by, userId) || same(requester, userId)) {
    throw await block(req, {
      message: same(po.created_by, userId)
        ? 'Séparation des tâches : vous ne pouvez pas approuver un bon de commande que vous avez créé'
        : 'Séparation des tâches : vous ne pouvez pas approuver le bon de commande de votre propre réquisition',
      entity: { type: 'purchase_order', id: po.id, label: po.po_number },
      details: { document: 'purchase_order' },
    });
  }
}

/** Facture : pas celui qui l'a saisie */
async function assertCanApproveInvoice(req, invoice) {
  if (same(invoice.created_by, req.user?.id)) {
    throw await block(req, {
      message: 'Séparation des tâches : la facture doit être validée par une autre personne que celle qui l\'a saisie',
      entity: { type: 'invoice', id: invoice.id, label: invoice.invoice_number },
      details: { document: 'invoice' },
    });
  }
}

/** Paiement : pas celui qui l'a saisi */
async function assertCanApprovePayment(req, payment) {
  if (same(payment.created_by, req.user?.id)) {
    throw await block(req, {
      message: 'Séparation des tâches : le paiement doit être approuvé par une autre personne que celle qui l\'a saisi',
      entity: { type: 'payment', id: payment.id, label: payment.payment_number },
      details: { document: 'payment' },
    });
  }
}

module.exports = {
  REQUISITION_APPROVAL_TASKS, PO_APPROVAL_TASK, same, isPurchaseOrderSelfApproval,
  taskConflicts, taskConflict, block, sodError,
  assertCanApprovePurchaseOrder, assertCanApproveInvoice, assertCanApprovePayment,
};
