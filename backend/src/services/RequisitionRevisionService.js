// backend/src/services/RequisitionRevisionService.js
// Renvoi pour correction, retrait, modification et versions d'une réquisition (migration 25_requisition_revisions.sql).
//  - Renvoi : un approbateur (N1 / N2 / N3) termine son étape avec returnedForCorrection = true (TaskController) ;
//    le retrait par le demandeur termine de la même façon l'étape d'approbation que personne n'a prise en charge
//  - La réquisition passe « À corriger » (RETURNED) ; GoFlow ouvre Activity_ReviseRequisition pour le demandeur
//  - update : seul le demandeur modifie, et seulement dans cet état ; resubmit : nouvelle version (photo complète),
//    étape terminée avec resubmitted = true (nouvelle vérification du budget, circuit d'approbation selon le NOUVEAU
//    montant) ; abandon : resubmitted = false, réquisition annulée
//  - versions : chaque soumission conservée, avec les changements par rapport à la précédente
const db = require('../config/database');
const camundaService = require('./CamundaService');
const notificationService = require('./NotificationService');
const i18n = require('../i18n');

const APPROVAL_TASKS = ['Activity_ValidationN1_Manager', 'Activity_ValidationN2_Finance', 'Activity_ValidationN3_DG'];
const REVISE_TASK = 'Activity_ReviseRequisition';
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

/**
 * Le processus GoFlow connaît-il « Corriger la réquisition » ? Variable revisionSupported posée au démarrage
 * (RequisitionController) : un processus démarré avant la mise à jour du BPMN irait au rejet. GoFlow injoignable : non.
 */
async function supportsRevision(processInstanceId) {
  if (!processInstanceId) return false;
  try {
    const vars = await camundaService.getProcessVariables(processInstanceId);
    return vars?.revisionSupported === true || vars?.revisionSupported === 'true';
  } catch {
    return false;
  }
}
const notSupported = () => fail(409, 'RETURN_NOT_SUPPORTED', "Réquisition démarrée avant la mise à jour du circuit : le renvoi pour correction n'est pas possible (approuvez-la ou rejetez-la)");
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const same = (a, b) => a != null && b != null && String(a) === String(b);
const text = (v, max = 2000) => String(v ?? '').trim().slice(0, max);

async function loadRequisition(id, tx = db) {
  return tx.one(
    `SELECT r.*, u.email AS requester_email, u.language AS requester_language
     FROM requisitions r LEFT JOIN users u ON u.id = r.requester_id WHERE r.id = $1`,
    [id]
  );
}

async function openTasks(processInstanceId) {
  if (!processInstanceId) return [];
  return ((await camundaService.getProcessTasks(processInstanceId)) || [])
    .filter(t => t.processInstanceId === processInstanceId && t.status !== 'completed');
}

/** Notification in-app (+ temps réel si io), dans la langue du destinataire */
async function notify(io, userId, lang, key, params, link) {
  try {
    const T = i18n.translator(lang);
    const title = T(`notification.revision.${key}Title`, params);
    const message = T(`notification.revision.${key}Message`, params);
    const n = await notificationService.sendNotification(userId, title, message, 'INFO', link);
    if (io) io.to(`user-${userId}`).emit('notification', { notification: { id: n?.id, title, message, type: 'INFO', link, created_at: new Date(), read: false } });
  } catch (error) {
    console.error('Notification de correction non envoyée :', error.message);
  }
}

async function history(tx, { requisition, action, comments, userId, taskName = 'Correction réquisition' }) {
  await tx.exec(
    `INSERT INTO workflow_history (entity_type, entity_id, process_instance_id, task_name, action, comments, performed_by, performed_at)
     VALUES ('requisition', $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
    [requisition.id, requisition.process_instance_id, taskName, action, comments, userId]
  );
}

// ---------------- Photo et comparaison ----------------

/** Photo complète d'une réquisition (champs, montant, articles) : ce que l'approbateur a sous les yeux */
async function snapshot(requisitionId, tx = db) {
  const r = await tx.one(
    `SELECT r.title, r.description, r.justification, r.priority, r.estimated_amount::float8 AS amount,
            r.department_id, d.code AS department_code, d.name AS department_name,
            r.project_id, p.code AS project_code, p.name AS project_name, c.format_key AS currency
     FROM requisitions r
     LEFT JOIN departments d ON d.id = r.department_id
     LEFT JOIN projects p ON p.id = r.project_id
     LEFT JOIN currency c ON c.id = r.currency_id
     WHERE r.id = $1`,
    [requisitionId]
  );
  const items = await tx.select(
    `SELECT ri.id, ri.item_description AS description, ri.quantity::float8 AS quantity, COALESCE(ri.frequency, 1)::float8 AS frequency,
            ri.unit_price::float8 AS "unitPrice", COALESCE(ri.total_amount, ri.quantity * COALESCE(ri.frequency, 1) * ri.unit_price)::float8 AS total,
            ri.budget_line_id AS "budgetLineId", COALESCE(ba.entity_code, ri.budget_line_code) AS "budgetLineCode", ri.specifications
     FROM requisition_items ri LEFT JOIN budget_allocations ba ON ba.id = ri.budget_line_id
     WHERE ri.requisition_id = $1 ORDER BY ri.id`,
    [requisitionId]
  );
  return {
    title: r.title, description: r.description || '', justification: r.justification || '', priority: r.priority,
    amount: num(r.amount), currency: r.currency || null,
    department: r.department_id ? { id: r.department_id, label: `${r.department_code} - ${r.department_name}` } : null,
    project: r.project_id ? { id: r.project_id, label: `${r.project_code} - ${r.project_name}` } : null,
    items,
  };
}

const FIELDS = ['title', 'description', 'justification', 'priority'];
const ITEM_FIELDS = ['description', 'quantity', 'frequency', 'unitPrice', 'total', 'budgetLineCode', 'specifications'];

/**
 * Changements entre deux photos → { fields: [{ field, before, after }], items: { added, removed, changed: [{ id, description, changes }] } }
 * Articles rapprochés par id (conservé à la modification), sinon par désignation
 */
function diff(before, after) {
  if (!before || !after) return null;
  const fields = [];
  for (const f of FIELDS) {
    if (text(before[f]) !== text(after[f])) fields.push({ field: f, before: before[f] ?? '', after: after[f] ?? '' });
  }
  if (Math.abs(num(before.amount) - num(after.amount)) > 0.0001) fields.push({ field: 'amount', before: num(before.amount), after: num(after.amount) });
  for (const f of ['department', 'project']) {
    if (!same(before[f]?.id, after[f]?.id) && (before[f]?.id || after[f]?.id)) fields.push({ field: f, before: before[f]?.label || '', after: after[f]?.label || '' });
  }
  const key = (i) => text(i.description).toLowerCase();
  const remaining = [...(before.items || [])];
  const added = [];
  const changed = [];
  for (const item of after.items || []) {
    let index = remaining.findIndex(o => same(o.id, item.id));
    if (index < 0) index = remaining.findIndex(o => key(o) === key(item));
    if (index < 0) { added.push(item); continue; }
    const old = remaining.splice(index, 1)[0];
    const changes = ITEM_FIELDS
      .filter(f => (['quantity', 'frequency', 'unitPrice', 'total'].includes(f) ? Math.abs(num(old[f]) - num(item[f])) > 0.0001 : text(old[f]) !== text(item[f])))
      .map(f => ({ field: f, before: old[f] ?? '', after: item[f] ?? '' }));
    if (changes.length) changed.push({ id: item.id, description: item.description, changes });
  }
  return { fields, items: { added, removed: remaining, changed } };
}

const hasChanges = (d) => !!d && (d.fields.length + d.items.added.length + d.items.removed.length + d.items.changed.length) > 0;

/** Version courante enregistrée (créée à partir de l'état actuel si absente : réquisitions antérieures à la migration) */
async function ensureCurrentVersion(tx, requisition) {
  const existing = await tx.one('SELECT * FROM requisition_versions WHERE requisition_id = $1 AND version = $2', [requisition.id, requisition.version || 1]);
  if (existing) return existing;
  return tx.one(
    `INSERT INTO requisition_versions (requisition_id, version, snapshot, submitted_by, submitted_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_TIMESTAMP)) RETURNING *`,
    [requisition.id, requisition.version || 1, JSON.stringify(await snapshot(requisition.id, tx)), requisition.requester_id, requisition.created_at]
  );
}

class RequisitionRevisionService {
  constructor() {
    this.snapshot = snapshot;
    this.diff = diff;
  }

  /** Première version, à la création (n'interrompt jamais la création) */
  async recordInitialVersion(requisitionId) {
    try {
      const requisition = await loadRequisition(requisitionId);
      if (requisition) await ensureCurrentVersion(db, requisition);
    } catch (error) {
      console.error('Version initiale de la réquisition non enregistrée :', error.message);
    }
  }

  /**
   * Après le renvoi par un approbateur (étape déjà terminée dans GoFlow par TaskController) ou le retrait :
   * version courante close avec le motif, réquisition « À corriger », demandeur notifié
   */
  async markReturned(requisitionId, { kind = 'RETURNED', reason, userId, taskKey = null, io = null }) {
    const requisition = await db.withTransaction(async (tx) => {
      const req = await loadRequisition(requisitionId, tx);
      if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
      await ensureCurrentVersion(tx, req);
      await tx.exec(
        `UPDATE requisition_versions SET return_kind = $3, return_reason = $4, returned_by = $5, returned_at = CURRENT_TIMESTAMP, returned_task = $6
         WHERE requisition_id = $1 AND version = $2`,
        [req.id, req.version || 1, kind, text(reason) || null, userId, taskKey]
      );
      await tx.exec(`UPDATE requisitions SET status = 'RETURNED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [req.id]);
      await history(tx, {
        requisition: req, userId, taskName: taskKey || 'Correction réquisition',
        action: kind === 'WITHDRAWN' ? 'WITHDRAWN' : 'RETURNED_FOR_CORRECTION',
        comments: JSON.stringify({ reason: text(reason) || null, version: req.version || 1 }),
      });
      return req;
    });
    if (kind === 'RETURNED' && !same(requisition.requester_id, userId)) {
      await notify(io, requisition.requester_id, requisition.requester_language, 'returned',
        { number: requisition.requisition_number, reason: text(reason, 300) }, `/requisitions/${requisition.id}`);
    }
    return requisition;
  }

  /**
   * Retrait par le demandeur : l'étape d'approbation en cours (que personne n'a prise en charge) est terminée avec
   * returnedForCorrection = true → GoFlow ouvre « Corriger la réquisition »
   */
  async withdraw(requisitionId, { reason } = {}, userId, io = null) {
    const req = await loadRequisition(requisitionId);
    if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
    if (!same(req.requester_id, userId)) throw fail(403, 'NOT_REQUESTER', 'Seul le demandeur peut retirer sa réquisition');
    const task = (await openTasks(req.process_instance_id)).find(t => APPROVAL_TASKS.includes(t.taskDefinitionKey));
    if (!task) throw fail(409, 'NOT_WITHDRAWABLE', 'La réquisition n\'est pas en attente d\'approbation');
    if (!(await supportsRevision(req.process_instance_id))) throw notSupported();
    if (task.assignee) throw fail(409, 'APPROVAL_IN_PROGRESS', `Approbation déjà prise en charge par ${task.assignee} : demandez-lui de la renvoyer pour correction`, { assignee: task.assignee });
    const result = await camundaService.completeTask(task.id, {
      approved: false, returnedForCorrection: true, withdrawnByRequester: true, comment: text(reason, 1000),
    });
    if (!result.success) throw fail(502, 'GOFLOW_ERROR', result.error || 'GoFlow n\'a pas accepté le retrait');
    await this.markReturned(req.id, { kind: 'WITHDRAWN', reason, userId, taskKey: task.taskDefinitionKey, io });
    return { status: 'RETURNED' };
  }

  /** Droits et état, pour l'écran : { canWithdraw, canEdit, approvalClaimedBy, version, lastReturn } */
  async state(requisitionId, userId) {
    const req = await loadRequisition(requisitionId);
    if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
    const isRequester = same(req.requester_id, userId);
    let approval = null;
    if (isRequester && ['IN_PROGRESS', 'PENDING'].includes(req.status)) {
      try { approval = (await openTasks(req.process_instance_id)).find(t => APPROVAL_TASKS.includes(t.taskDefinitionKey)) || null; } catch { /* GoFlow injoignable */ }
    }
    const lastReturn = await db.one(
      `SELECT v.version, v.return_kind AS kind, v.return_reason AS reason, v.returned_at AS at, v.returned_task AS task,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS by_name, u.email AS by_email
       FROM requisition_versions v LEFT JOIN users u ON u.id = v.returned_by
       WHERE v.requisition_id = $1 AND v.return_kind IS NOT NULL ORDER BY v.version DESC LIMIT 1`,
      [req.id]
    );
    return {
      status: req.status,
      version: req.version || 1,
      isRequester,
      canEdit: isRequester && req.status === 'RETURNED',
      canWithdraw: !!approval && !approval.assignee && await supportsRevision(req.process_instance_id),
      approvalClaimedBy: approval?.assignee || null,
      lastReturn: req.status === 'RETURNED' ? lastReturn : null,
    };
  }

  /**
   * Modification par le demandeur pendant la correction : champs + articles (id conservé = article modifié, sans id =
   * ajouté, absent = supprimé). Montant recalculé.
   */
  async update(requisitionId, data, userId) {
    const items = Array.isArray(data.items) ? data.items : null;
    if (!text(data.title)) throw fail(400, 'TITLE_REQUIRED', 'Le titre est obligatoire');
    if (!items || !items.length) throw fail(400, 'ITEMS_REQUIRED', 'Au moins un article est requis');
    items.forEach((it, line) => {
      if (!text(it.description)) throw fail(400, 'ITEM_INVALID', 'Désignation obligatoire', { line });
      if (!(num(it.quantity) > 0) || !(num(it.frequency || 1) > 0) || num(it.unitPrice) < 0) throw fail(400, 'ITEM_INVALID', 'Quantité, fréquence ou prix invalide', { line });
    });

    return db.withTransaction(async (tx) => {
      const req = await tx.one('SELECT * FROM requisitions WHERE id = $1 FOR UPDATE', [requisitionId]);
      if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
      if (!same(req.requester_id, userId)) throw fail(403, 'NOT_REQUESTER', 'Seul le demandeur peut modifier sa réquisition');
      if (req.status !== 'RETURNED') throw fail(409, 'NOT_EDITABLE', 'La réquisition ne peut être modifiée que lorsqu\'elle est « À corriger »');

      const projectId = data.projectId || null;
      for (const [line, it] of items.entries()) {
        if (!it.budgetLineId) throw fail(400, 'BUDGET_LINE_REQUIRED', 'Ligne budgétaire obligatoire', { line });
        const budget = await tx.one(
          `SELECT id FROM budget_allocations WHERE id = $1 AND is_active AND enterprise_id = $2 AND ($3::uuid IS NULL OR project_id = $3)`,
          [it.budgetLineId, req.enterprise_id, projectId]
        );
        if (!budget) throw fail(400, 'BUDGET_LINE_INVALID', 'Ligne budgétaire introuvable, inactive ou d\'un autre projet', { line });
      }

      const existing = (await tx.select('SELECT id FROM requisition_items WHERE requisition_id = $1', [req.id])).map(r => String(r.id));
      const kept = items.filter(it => it.id && existing.includes(String(it.id))).map(it => String(it.id));
      await tx.exec('DELETE FROM requisition_items WHERE requisition_id = $1 AND NOT (id::text = ANY($2))', [req.id, kept]);
      let total = 0;
      for (const it of items) {
        const quantity = num(it.quantity);
        const frequency = num(it.frequency || 1);
        const unitPrice = num(it.unitPrice);
        const lineTotal = quantity * frequency * unitPrice;
        total += lineTotal;
        const code = (await tx.one('SELECT entity_code FROM budget_allocations WHERE id = $1', [it.budgetLineId]))?.entity_code || null;
        const values = [text(it.description), quantity, frequency, unitPrice, lineTotal, text(it.specifications) || null, it.budgetLineId, code, it.stockItemId || null];
        if (it.id && kept.includes(String(it.id))) {
          await tx.exec(
            `UPDATE requisition_items SET item_description = $1, quantity = $2, frequency = $3, unit_price = $4, total_amount = $5,
                    specifications = $6, budget_line_id = $7, budget_line_code = $8, stock_item_id = $9 WHERE id = $10`,
            [...values, it.id]
          );
        } else {
          await tx.exec(
            `INSERT INTO requisition_items (item_description, quantity, frequency, unit_price, total_amount, specifications, budget_line_id, budget_line_code, stock_item_id, requisition_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [...values, req.id]
          );
        }
      }
      await tx.exec(
        `UPDATE requisitions SET title = $2, description = $3, justification = $4, priority = $5, department_id = $6, project_id = $7,
                estimated_amount = $8, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.id, text(data.title, 255), text(data.description, 5000) || null, text(data.justification, 5000) || null,
         data.priority || req.priority, data.departmentId || null, projectId, total]
      );
      return { id: req.id, estimatedAmount: total };
    });
  }

  /**
   * Nouvelle soumission : nouvelle version (photo), « Corriger la réquisition » terminée avec resubmitted = true et les
   * valeurs à jour (montant → niveau d'approbation, articles). GoFlow relance la vérification du budget.
   */
  async resubmit(requisitionId, { comment } = {}, userId, io = null) {
    const req = await loadRequisition(requisitionId);
    if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
    if (!same(req.requester_id, userId)) throw fail(403, 'NOT_REQUESTER', 'Seul le demandeur peut soumettre à nouveau sa réquisition');
    if (req.status !== 'RETURNED') throw fail(409, 'NOT_EDITABLE', 'La réquisition n\'est pas « À corriger »');
    const task = (await openTasks(req.process_instance_id)).find(t => t.taskDefinitionKey === REVISE_TASK);
    if (!task) throw fail(409, 'TASK_NOT_FOUND', 'Étape « Corriger la réquisition » introuvable dans GoFlow (moteur injoignable ou processus terminé)');

    const photo = await snapshot(req.id);
    const previous = await db.one('SELECT snapshot FROM requisition_versions WHERE requisition_id = $1 AND version = $2', [req.id, req.version || 1]);
    const changes = diff(previous?.snapshot, photo);
    const version = (req.version || 1) + 1;

    await db.withTransaction(async (tx) => {
      await tx.exec(
        `INSERT INTO requisition_versions (requisition_id, version, snapshot, submitted_by, submit_comment) VALUES ($1, $2, $3, $4, $5)`,
        [req.id, version, JSON.stringify(photo), userId, text(comment, 2000) || null]
      );
      await tx.exec(`UPDATE requisitions SET version = $2, status = 'IN_PROGRESS', rejected_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [req.id, version]);
      await history(tx, {
        requisition: req, userId, taskName: REVISE_TASK, action: 'RESUBMITTED',
        comments: JSON.stringify({ version, comment: text(comment, 1000) || null, changed: hasChanges(changes) }),
      });
      // GoFlow en dernier : en cas de refus, la transaction est annulée (la réquisition reste « À corriger »)
      const result = await camundaService.completeTask(task.id, {
        resubmitted: true,
        estimatedAmount: photo.amount,
        title: photo.title,
        description: photo.description,
        justification: photo.justification,
        priority: photo.priority,
        departmentId: photo.department?.id || '',
        projectId: photo.project?.id || '',
        projectCode: photo.project?.label?.split(' - ')[0] || '',
        projectName: photo.project?.label?.split(' - ').slice(1).join(' - ') || '',
        items: JSON.stringify(photo.items.map(i => ({
          description: i.description, quantity: i.quantity, frequency: i.frequency, unitPrice: i.unitPrice, total: i.total,
          budgetLineId: i.budgetLineId, budgetLineCode: i.budgetLineCode,
        }))),
        totalItems: photo.items.length,
        requisitionVersion: version,
        resubmitComment: text(comment, 1000),
      });
      if (!result.success) throw fail(502, 'GOFLOW_ERROR', result.error || 'GoFlow n\'a pas accepté la nouvelle soumission');
    });
    return { version, status: 'IN_PROGRESS', changes };
  }

  /** Abandon pendant la correction : étape terminée avec resubmitted = false, réquisition annulée */
  async abandon(requisitionId, { reason } = {}, userId) {
    const req = await loadRequisition(requisitionId);
    if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
    if (!same(req.requester_id, userId)) throw fail(403, 'NOT_REQUESTER', 'Seul le demandeur peut abandonner sa réquisition');
    if (req.status !== 'RETURNED') throw fail(409, 'NOT_EDITABLE', 'La réquisition n\'est pas « À corriger »');
    if (!text(reason)) throw fail(400, 'REASON_REQUIRED', 'Motif obligatoire');
    let task = null;
    try { task = (await openTasks(req.process_instance_id)).find(t => t.taskDefinitionKey === REVISE_TASK); } catch { /* GoFlow injoignable */ }
    if (task) {
      const result = await camundaService.completeTask(task.id, { resubmitted: false, comment: text(reason, 1000) });
      if (!result.success) throw fail(502, 'GOFLOW_ERROR', result.error || 'GoFlow n\'a pas accepté l\'abandon');
    }
    await db.withTransaction(async (tx) => {
      await tx.exec(
        `UPDATE requisitions SET status = 'CANCELLED', rejected_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.id, `Abandonnée pendant la correction — ${text(reason, 500)}`]
      );
      await history(tx, { requisition: req, userId, taskName: REVISE_TASK, action: 'REVISION_ABANDONED', comments: JSON.stringify({ reason: text(reason, 1000) }) });
    });
    return { status: 'CANCELLED' };
  }

  /**
   * Versions soumises (la plus récente d'abord) avec les changements par rapport à la précédente ; pendant la
   * correction, pendingChanges = modifications pas encore soumises (état actuel vs dernière version)
   */
  async versions(requisitionId) {
    const req = await loadRequisition(requisitionId);
    if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
    const rows = await db.select(
      `SELECT v.*, TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS submitted_by_name,
              TRIM(COALESCE(r.first_name, '') || ' ' || COALESCE(r.last_name, '')) AS returned_by_name
       FROM requisition_versions v
       LEFT JOIN users s ON s.id = v.submitted_by
       LEFT JOIN users r ON r.id = v.returned_by
       WHERE v.requisition_id = $1 ORDER BY v.version`,
      [req.id]
    );
    const list = rows.map((v, i) => ({
      version: v.version,
      submittedAt: v.submitted_at,
      submittedBy: v.submitted_by_name || null,
      comment: v.submit_comment,
      amount: num(v.snapshot?.amount),
      currency: v.snapshot?.currency || null,
      returnKind: v.return_kind,
      returnReason: v.return_reason,
      returnedAt: v.returned_at,
      returnedBy: v.returned_by_name || null,
      returnedTask: v.returned_task,
      changes: i > 0 ? diff(rows[i - 1].snapshot, v.snapshot) : null,
    })).reverse();
    let pendingChanges = null;
    if (req.status === 'RETURNED' && rows.length) {
      const d = diff(rows[rows.length - 1].snapshot, await snapshot(req.id));
      pendingChanges = hasChanges(d) ? d : null;
    }
    return { version: req.version || 1, status: req.status, versions: list, pendingChanges };
  }
}

module.exports = new RequisitionRevisionService();
module.exports.supportsRevision = supportsRevision;
module.exports.notSupported = notSupported;
module.exports.APPROVAL_TASKS = APPROVAL_TASKS;
module.exports.REVISE_TASK = REVISE_TASK;
