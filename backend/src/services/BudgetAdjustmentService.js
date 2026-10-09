// backend/src/services/BudgetAdjustmentService.js
// Ajustement budgétaire (étape GoFlow Activity_BudgetAdjustment, après une vérification du budget insuffisante) :
//  - summary : besoin / disponible par ligne budgétaire, articles et leur ligne, tâche GoFlow ouverte
//  - changeBudgetLines : le demandeur affecte d'autres lignes (du projet de la réquisition) à ses articles
//  - decide : RETRY → la vérification du budget est relancée sur la MÊME réquisition (budgetAdjusted = true),
//             refusée tant qu'une ligne reste insuffisante ; ABANDON → réquisition annulée (budgetAdjusted = false)
// Acteurs : le demandeur, un administrateur d'entreprise ou un gestionnaire du budget (MANAGE_BUDGET).
const db = require('../config/database');
const camundaService = require('./CamundaService');
const userModel = require('../models/UserModel');

const TASK_KEY = 'Activity_BudgetAdjustment';
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

async function loadRequisition(id) {
  return db.one(
    `SELECT id, requisition_number, status, requester_id, project_id, enterprise_id, process_instance_id, rejected_reason
     FROM requisitions WHERE id = $1`,
    [id]
  );
}

async function openTask(processInstanceId) {
  if (!processInstanceId) return null;
  const tasks = (await camundaService.getProcessTasks(processInstanceId)) || [];
  return tasks.find(t => t.taskDefinitionKey === TASK_KEY && t.processInstanceId === processInstanceId) || null;
}

class BudgetAdjustmentService {
  async canAct(req, userId) {
    if (String(req.requester_id) === String(userId)) return true;
    if (await userModel.hasPermission(userId, 'MANAGE_BUDGET')) return true;
    const admin = await db.one(`SELECT 1 FROM user_profiles WHERE user_id = $1 AND profile_id = 'prof_admin'`, [userId]);
    return !!admin;
  }

  /** Besoin / disponible par ligne budgétaire (lignes actuelles des articles) */
  async lines(requisitionId) {
    const items = await db.select(
      `SELECT ri.id, ri.item_description, ri.budget_line_id, ba.entity_code AS budget_line_code, ba.description AS budget_line_description,
              COALESCE(ri.total_amount, ri.quantity * COALESCE(ri.frequency, 1) * ri.unit_price)::float8 AS total
       FROM requisition_items ri LEFT JOIN budget_allocations ba ON ba.id = ri.budget_line_id
       WHERE ri.requisition_id = $1 ORDER BY ri.id`,
      [requisitionId]
    );
    const groups = new Map();
    for (const it of items) {
      const key = it.budget_line_id || 'NONE';
      if (!groups.has(key)) {
        groups.set(key, { budgetLineId: it.budget_line_id, code: it.budget_line_code, description: it.budget_line_description, requested: 0 });
      }
      groups.get(key).requested += num(it.total);
    }
    const lines = [];
    for (const g of groups.values()) {
      const line = g.budgetLineId
        ? await db.one('SELECT remaining_amount::float8 AS remaining, is_active FROM budget_allocations WHERE id = $1', [g.budgetLineId])
        : null;
      const available = line && line.is_active ? num(line.remaining) : 0;
      lines.push({ ...g, available, ok: !!g.budgetLineId && !!line?.is_active && available + 1e-9 >= g.requested });
    }
    return { items, lines };
  }

  async summary(requisitionId, userId) {
    const req = await loadRequisition(requisitionId);
    if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
    const { items, lines } = await this.lines(requisitionId);
    let task = null;
    try { task = await openTask(req.process_instance_id); } catch { /* GoFlow injoignable */ }
    return {
      status: req.status, projectId: req.project_id, reason: req.rejected_reason,
      items, lines, allOk: lines.every(l => l.ok),
      taskId: task?.id || null, canAct: await this.canAct(req, userId),
    };
  }

  /** changes : [{ itemId, budgetLineId }] — lignes actives du projet de la réquisition, statut BUDGET_INSUFFICIENT */
  async changeBudgetLines(requisitionId, changes, userId) {
    if (!Array.isArray(changes) || !changes.length) throw fail(400, 'NO_CHANGES', 'Aucune modification');
    return db.withTransaction(async (tx) => {
      const req = await tx.one('SELECT id, status, requester_id, project_id, enterprise_id FROM requisitions WHERE id = $1 FOR UPDATE', [requisitionId]);
      if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
      if (!(await this.canAct(req, userId))) throw fail(403, 'FORBIDDEN', 'Seul le demandeur (ou la finance / un administrateur) peut ajuster le budget');
      if (req.status !== 'BUDGET_INSUFFICIENT') throw fail(409, 'NOT_BUDGET_INSUFFICIENT', 'La réquisition n\'est pas en attente d\'ajustement budgétaire');
      for (const [index, c] of changes.entries()) {
        const item = await tx.one('SELECT id FROM requisition_items WHERE id = $1 AND requisition_id = $2', [c.itemId, requisitionId]);
        if (!item) throw fail(400, 'ITEM_NOT_FOUND', 'Article introuvable', { line: index });
        const line = await tx.one(
          `SELECT id, entity_code FROM budget_allocations
           WHERE id = $1 AND is_active AND enterprise_id = $2 AND ($3::uuid IS NULL OR project_id = $3)`,
          [c.budgetLineId, req.enterprise_id, req.project_id]
        );
        if (!line) throw fail(400, 'BUDGET_LINE_INVALID', 'Ligne budgétaire introuvable, inactive ou d\'un autre projet', { line: index });
        await tx.exec('UPDATE requisition_items SET budget_line_id = $1, budget_line_code = $2 WHERE id = $3', [line.id, line.entity_code, item.id]);
      }
      return { updated: changes.length };
    });
  }

  /** decision : RETRY | ABANDON */
  async decide(requisitionId, { decision, comment }, userId) {
    const d = String(decision || '').toUpperCase();
    if (!['RETRY', 'ABANDON'].includes(d)) throw fail(400, 'INVALID_DECISION', 'Décision invalide');
    const req = await loadRequisition(requisitionId);
    if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
    if (!(await this.canAct(req, userId))) throw fail(403, 'FORBIDDEN', 'Seul le demandeur (ou la finance / un administrateur) peut ajuster le budget');
    if (req.status !== 'BUDGET_INSUFFICIENT') throw fail(409, 'NOT_BUDGET_INSUFFICIENT', 'La réquisition n\'est pas en attente d\'ajustement budgétaire');

    if (d === 'RETRY') {
      const { lines } = await this.lines(requisitionId);
      const short = lines.filter(l => !l.ok);
      if (short.length) throw fail(409, 'STILL_INSUFFICIENT', 'Le budget est encore insuffisant sur au moins une ligne', { lines: short });
    }

    let task = null;
    try { task = await openTask(req.process_instance_id); } catch { /* GoFlow injoignable */ }
    if (!task && d === 'RETRY') throw fail(409, 'TASK_NOT_FOUND', 'Étape « Ajustement budgétaire » introuvable dans GoFlow (moteur injoignable ou processus terminé)');
    if (task) {
      const result = await camundaService.completeTask(task.id, { budgetAdjusted: d === 'RETRY', comment: String(comment || '').slice(0, 1000) });
      if (!result.success) throw fail(502, 'GOFLOW_ERROR', result.error || 'GoFlow n\'a pas accepté la décision');
    }

    if (d === 'ABANDON') {
      await db.exec(
        `UPDATE requisitions SET status = 'CANCELLED', rejected_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [requisitionId, comment ? `Abandonnée après budget insuffisant — ${String(comment).slice(0, 500)}` : 'Abandonnée après budget insuffisant']
      );
    }
    await db.exec(
      `INSERT INTO workflow_history (entity_type, entity_id, process_instance_id, task_id, task_name, action, comments, performed_by, performed_at)
       VALUES ('requisition', $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
      [requisitionId, req.process_instance_id, task?.id || null, TASK_KEY,
       d === 'RETRY' ? 'BUDGET_RECHECK_REQUESTED' : 'BUDGET_ADJUSTMENT_ABANDONED', comment ? String(comment).slice(0, 1000) : null, userId]
    );
    return { decision: d, taskCompleted: !!task };
  }
}

module.exports = new BudgetAdjustmentService();
module.exports.TASK_KEY = TASK_KEY;
