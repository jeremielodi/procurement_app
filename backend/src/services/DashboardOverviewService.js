// backend/src/services/DashboardOverviewService.js
// Tableau de bord de pilotage, contenu selon le profil (GET /dashboard/overview?period=&projectId=) :
//   - operations : mes tâches GoFlow en attente, en retard (≥ LATE_DAYS jours dans l'étape actuelle) — tout le monde
//   - steering   : cycle P2P, délais par étape, complétion, conversion, livraisons, fournisseurs — STEERING_PROFILES
//   - finance    : budget consommé (= PAYÉ), engagements ouverts, délais de paiement — MANAGE_BUDGET ou AUDIT_ACCESS
//   - control    : rejets / renvois, mise en concurrence, écarts de rapprochement, blocages — AUDIT_ACCESS ou VIEW_AUDIT_LOGS
// Le serveur ne calcule (et ne renvoie) que les volets autorisés. Toutes les requêtes sont cloisonnées par entreprise
// (scopedDb) et limitées aux réquisitions visibles par l'utilisateur (requisitionVisibilitySql, migration 30).
// Montants : uniquement dans la devise de l'entreprise (les budgets n'ont pas de devise) ; les autres devises sont
// comptées à part (otherCurrencyCount) et jamais additionnées.
const db = require('../config/database');
const { scopedDb } = require('../utils/tenantSql');
const tenant = require('../utils/tenant');
const userModel = require('../models/UserModel');
const dashboardModel = require('../models/DashboardModel');
const { loadScope, groupsOnProject, canSeeRequisition, requisitionVisibilitySql } = require('../utils/projectAccess');
const { TASK_CANDIDATE_GROUPS, PERSONAL_TASKS, taskKey, taskLabel, methodLabel } = require('../utils/workflowLabels');
const { getEnterpriseCurrencyCode } = require('../utils/enterpriseCurrency');
const { PROGRESS_STATUS_SQL } = require('../models/RequisitionModel');

const LATE_DAYS = 2;      // tâche en retard : ≥ 2 jours dans l'étape actuelle (choix du client, 2026-10-15)
const BLOCKED_DAYS = 7;   // tâche bloquée
const PERIOD_DAYS = { week: 7, month: 30, quarter: 90, year: 365 }; // périodes glissantes
const STEERING_PROFILES = ['prof_admin', 'prof_dg', 'prof_management', 'prof_auditor'];
// Bons de commande qui n'engagent rien (pas encore approuvés, rejetés, annulés)
const INACTIVE_PO = `('DRAFT', 'PO_PENDING', 'PENDING', 'PO_REJECTED', 'REJECTED', 'CANCELLED')`;
const APPROVAL_TASKS = ['Activity_ValidationN1_Manager', 'Activity_ValidationN2_Finance', 'Activity_ValidationN3_DG', 'Activity_POApproval'];
const COMPETITIVE_METHODS = ['MULTIPLE_QUOTATIONS', 'RFP'];
const CONTROL_AUDIT_ACTIONS = ['SOD_VIOLATION_BLOCKED', 'PAYMENT_BLOCKED', 'INVOICE_DUPLICATE_BLOCKED', 'TASK_COMPLETION_DENIED', 'PROJECT_ACCESS_DENIED'];
// Date de paiement effective d'un paiement PAID
const PAID_AT = 'COALESCE(pay.approved_at, pay.payment_date::timestamp, pay.updated_at)';

const num = (v) => (v === null || v === undefined ? null : Number(v));
const round = (v, d = 1) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);
const rate = (n, total) => (total > 0 ? round((n / total) * 100) : null);
const ageDays = (since, now = Date.now()) => Math.floor((now - new Date(since)) / 86400000);

function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function parseJson(text) {
  if (!text || text[0] !== '{') return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}
const isTrue = (v) => v === true || v === 'true';
const isFalse = (v) => v === false || v === 'false';

class DashboardOverviewService {
  /** Volets autorisés pour l'utilisateur */
  async access(userId) {
    const rows = await db.select('SELECT profile_id FROM user_profiles WHERE user_id = $1', [userId]);
    const profiles = new Set(rows.map(r => r.profile_id));
    const can = (perm) => userModel.hasPermission(userId, perm);
    const [budget, audit, logs] = await Promise.all([can('MANAGE_BUDGET'), can('AUDIT_ACCESS'), can('VIEW_AUDIT_LOGS')]);
    return {
      operations: true,
      steering: STEERING_PROFILES.some(p => profiles.has(p)),
      finance: budget || audit,
      control: audit || logs,
    };
  }

  /**
   * @param {string} userId
   * @param {{ period?: string, projectId?: string, lang?: string }} options
   */
  async build(userId, { period = 'month', projectId, lang } = {}) {
    const days = PERIOD_DAYS[period] || PERIOD_DAYS.month;
    const access = await this.access(userId);
    const ctx = { userId, projectId: projectId || null, days, lang };
    const [tasks, currency] = await Promise.all([this.visibleTasks(userId, ctx), getEnterpriseCurrencyCode()]);
    ctx.currency = currency;

    const [operations, steering, finance, control] = await Promise.all([
      this.operations(tasks, ctx),
      access.steering ? this.steering(tasks, ctx) : null,
      access.finance ? this.finance(ctx) : null,
      access.control ? this.control(ctx) : null,
    ]);
    return {
      period: PERIOD_DAYS[period] ? period : 'month',
      periodDays: days,
      projectId: ctx.projectId,
      currency,
      thresholds: { lateDays: LATE_DAYS, blockedDays: BLOCKED_DAYS },
      access,
      operations, steering, finance, control,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Filtre commun : projet choisi + réquisitions visibles par l'utilisateur (alias de la réquisition) */
  scope(alias, ctx, params) {
    let sql = '';
    if (ctx.projectId) { params.push(ctx.projectId); sql += ` AND ${alias}.project_id = $${params.length}`; }
    return sql + requisitionVisibilitySql(alias, ctx.userId, params);
  }

  /** Paramètre « début de période » (colonnes TIMESTAMP sans fuseau, écrites dans le fuseau de la session) */
  since(ctx, params) {
    params.push(ctx.days);
    return `(LOCALTIMESTAMP - make_interval(days => $${params.length}))`;
  }

  // ───────────────────────────── Tâches ─────────────────────────────

  /** Tâches en attente des réquisitions visibles, avec ancienneté dans l'étape actuelle et responsable */
  async visibleTasks(userId, ctx) {
    const [rows, names, scope] = await Promise.all([
      dashboardModel.getPendingTaskRows(ctx.projectId),
      dashboardModel.userNames(),
      loadScope(userId),
    ]);
    const now = Date.now();
    return {
      scope,
      list: rows
        .filter(r => canSeeRequisition(scope, r))
        .map(r => {
          const key = taskKey(r);
          const age = ageDays(r.created_at, now);
          return {
            taskId: r.task_id,
            key,
            group: TASK_CANDIDATE_GROUPS[key] || null,
            label: taskLabel(key || r.task_name, ctx.lang),
            requisitionId: r.requisition_id,
            requisitionNumber: r.requisition_number,
            requisitionTitle: r.requisition_title,
            requesterId: r.requester_id,
            projectId: r.project_id,
            projectName: r.project_name,
            since: r.created_at,
            ageDays: age,
            lateDays: Math.max(0, age - LATE_DAYS),
            assignee: dashboardModel.taskAssignee(r, names),
            claimedByMe: !!r.claim && String(r.claimed_by) === String(userId),
          };
        }),
    };
  }

  /** La tâche peut être traitée par l'utilisateur (même règle que les listes de tâches : profil sur le projet) */
  isMine(task, scope) {
    if (PERSONAL_TASKS.includes(task.key)) return String(task.requesterId) === scope.userId;
    if (task.group === 'requester' && String(task.requesterId) !== scope.userId) return false;
    if (scope.isAdmin) return true;
    return !!task.group && groupsOnProject(scope, task.projectId).has(task.group);
  }

  summarizeTasks(list) {
    return {
      total: list.length,
      late: list.filter(t => t.ageDays >= LATE_DAYS).length,
      blocked: list.filter(t => t.ageDays >= BLOCKED_DAYS).length,
      unclaimed: list.filter(t => !t.assignee).length,
      oldestAgeDays: list.reduce((m, t) => Math.max(m, t.ageDays), 0),
    };
  }

  // ───────────────────────────── Opérations ─────────────────────────────

  async operations(tasks, ctx) {
    const mine = tasks.list.filter(t => this.isMine(t, tasks.scope)).sort((a, b) => b.ageDays - a.ageDays);
    return {
      ...this.summarizeTasks(mine),
      claimedByMe: mine.filter(t => t.claimedByMe).length,
      tasks: mine.slice(0, 10),
    };
  }

  // ───────────────────────────── Pilotage (direction) ─────────────────────────────

  async steering(tasks, ctx) {
    const [cycle, stepDurations, completion, conversion, deliveries, urgent, suppliers] = await Promise.all([
      this.p2pCycle(ctx), this.stepDurations(ctx), this.completion(ctx), this.conversion(ctx),
      this.deliveries(ctx), this.urgent(ctx), this.supplierConcentration(ctx),
    ]);
    const lateTasks = tasks.list.filter(t => t.ageDays >= LATE_DAYS).sort((a, b) => b.ageDays - a.ageDays);
    return {
      tasks: { ...this.summarizeTasks(tasks.list), lateList: lateTasks.slice(0, 10) },
      cycle, stepDurations, completion, conversion, deliveries, urgent, suppliers,
    };
  }

  /**
   * Cycle P2P : création de la réquisition → dernier paiement PAID. Réquisitions dont tous les bons de commande
   * actifs sont payés (au moins un paiement PAID, aucun paiement en cours), dernier paiement dans la période.
   */
  async p2pCycle(ctx) {
    const params = [];
    const since = this.since(ctx, params);
    const rows = await scopedDb.select(`
      WITH pp AS (
        SELECT COALESCE(pay.po_id, i.po_id) AS po_id, pay.status, ${PAID_AT} AS paid_at
        FROM payments pay LEFT JOIN invoices i ON i.id = pay.invoice_id
      ),
      po_state AS (
        SELECT po.requisition_id,
               BOOL_AND(EXISTS (SELECT 1 FROM pp WHERE pp.po_id = po.id AND pp.status = 'PAID')
                        AND NOT EXISTS (SELECT 1 FROM pp WHERE pp.po_id = po.id AND pp.status NOT IN ('PAID', 'CANCELLED', 'REJECTED'))) AS all_paid,
               MAX((SELECT MAX(pp.paid_at) FROM pp WHERE pp.po_id = po.id AND pp.status = 'PAID')) AS paid_at
        FROM purchase_orders po
        WHERE po.status NOT IN ${INACTIVE_PO}
        GROUP BY po.requisition_id
      )
      SELECT EXTRACT(EPOCH FROM (ps.paid_at - r.created_at)) / 86400 AS days
      FROM po_state ps JOIN requisitions r ON r.id = ps.requisition_id
      WHERE ps.all_paid AND ps.paid_at >= ${since} ${this.scope('r', ctx, params)}
    `, params);
    const values = rows.map(r => Math.max(0, Number(r.days)));
    return { count: values.length, medianDays: round(median(values)), meanDays: round(mean(values)) };
  }

  /** Délai par étape : de l'entrée dans l'étape (TASK_CREATED) à sa fin (TASK_COMPLETED), étapes terminées dans la période */
  async stepDurations(ctx) {
    const params = [];
    const since = this.since(ctx, params);
    const rows = await scopedDb.select(`
      WITH created AS (
        SELECT DISTINCT ON (task_id) task_id, task_definition_id, task_name, entity_id, performed_at
        FROM workflow_history WHERE action = 'TASK_CREATED' AND task_id IS NOT NULL
        ORDER BY task_id, performed_at
      ),
      completed AS (
        SELECT DISTINCT ON (task_id) task_id, performed_at
        FROM workflow_history WHERE action = 'TASK_COMPLETED' AND task_id IS NOT NULL
        ORDER BY task_id, performed_at
      )
      SELECT c.task_definition_id, c.task_name,
             EXTRACT(EPOCH FROM (d.performed_at - c.performed_at)) / 86400 AS days
      FROM created c
      JOIN completed d ON d.task_id = c.task_id
      JOIN requisitions r ON r.id = c.entity_id
      WHERE d.performed_at >= ${since} ${this.scope('r', ctx, params)}
    `, params);
    const byKey = new Map();
    for (const row of rows) {
      const key = taskKey(row);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(Math.max(0, Number(row.days)));
    }
    return [...byKey.entries()]
      .map(([key, values]) => ({
        key, label: taskLabel(key, ctx.lang), count: values.length,
        medianDays: round(median(values)), meanDays: round(mean(values)),
        lateCount: values.filter(v => v >= LATE_DAYS).length,
      }))
      .sort((a, b) => (b.medianDays ?? 0) - (a.medianDays ?? 0));
  }

  /**
   * Complétion : réquisitions soumises (hors brouillon) créées dans la période — terminées / clôturées
   * (terminées + rejetées + annulées) ; les dossiers en cours sont comptés à part, jamais comme des échecs.
   */
  async completion(ctx) {
    const params = [];
    const since = this.since(ctx, params);
    const rows = await scopedDb.select(`
      SELECT progress, COUNT(*)::int AS n FROM (
        SELECT ${PROGRESS_STATUS_SQL} AS progress
        FROM requisitions r
        WHERE r.status <> 'DRAFT' AND r.created_at >= ${since} ${this.scope('r', ctx, params)}
      ) x GROUP BY progress
    `, params);
    const n = Object.fromEntries(rows.map(r => [r.progress, r.n]));
    const completed = n.COMPLETED || 0;
    const rejected = n.REJECTED || 0;
    const cancelled = n.CANCELLED || 0;
    const inProgress = (n.IN_PROGRESS || 0) + (n.DRAFT || 0);
    const closed = completed + rejected + cancelled;
    return { submitted: closed + inProgress, completed, rejected, cancelled, inProgress, closed, rate: rate(completed, closed) };
  }

  /** Conversion : réquisitions approuvées dans la période ayant au moins un bon de commande actif */
  async conversion(ctx) {
    const params = [];
    const since = this.since(ctx, params);
    const row = await scopedDb.one(`
      SELECT COUNT(*)::int AS approved,
             COUNT(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM purchase_orders po WHERE po.requisition_id = r.id AND po.status NOT IN ('PO_REJECTED', 'REJECTED', 'CANCELLED')
             ))::int AS converted
      FROM requisitions r
      WHERE r.approved_at >= ${since} ${this.scope('r', ctx, params)}
    `, params);
    return { approved: row.approved, converted: row.converted, rate: rate(row.converted, row.approved) };
  }

  /**
   * Livraisons complètes : bons de commande créés dans la période dont la livraison est terminée —
   * livrés en totalité / (livrés en totalité + reliquat soldé). En cours de livraison : à part.
   */
  async deliveries(ctx) {
    const params = [];
    const since = this.since(ctx, params);
    const rows = await scopedDb.select(`
      SELECT status, COUNT(*)::int AS n FROM (
        SELECT (SELECT CASE
                  WHEN COUNT(*) = 0 THEN 'NOT_DELIVERED'
                  WHEN BOOL_AND(d.quantity_remaining <= 0) THEN 'DELIVERED'
                  WHEN po.delivery_closed_at IS NOT NULL THEN 'CLOSED_SHORT'
                  WHEN BOOL_OR(d.quantity_accepted > 0) THEN 'PARTIALLY_DELIVERED'
                  ELSE 'NOT_DELIVERED' END
                FROM v_po_item_delivery d WHERE d.purchase_order_id = po.id) AS status
        FROM purchase_orders po
        JOIN requisitions r ON r.id = po.requisition_id
        WHERE po.status NOT IN ${INACTIVE_PO} AND po.created_at >= ${since} ${this.scope('r', ctx, params)}
      ) x GROUP BY status
    `, params);
    const n = Object.fromEntries(rows.map(r => [r.status, r.n]));
    const delivered = n.DELIVERED || 0;
    const closedShort = n.CLOSED_SHORT || 0;
    return {
      delivered, closedShort,
      inProgress: (n.PARTIALLY_DELIVERED || 0) + (n.NOT_DELIVERED || 0),
      rate: rate(delivered, delivered + closedShort),
    };
  }

  /** Commandes urgentes : réquisitions soumises dans la période avec la priorité URGENT ou HIGH */
  async urgent(ctx) {
    const params = [];
    const since = this.since(ctx, params);
    const row = await scopedDb.one(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE UPPER(COALESCE(r.priority, '')) IN ('URGENT', 'HIGH'))::int AS urgent
      FROM requisitions r
      WHERE r.status <> 'DRAFT' AND r.created_at >= ${since} ${this.scope('r', ctx, params)}
    `, params);
    return { total: row.total, urgent: row.urgent, rate: rate(row.urgent, row.total) };
  }

  /** Concentration : part des 5 premiers fournisseurs dans le montant des commandes actives créées dans la période */
  async supplierConcentration(ctx) {
    const params = [ctx.currency];
    const since = this.since(ctx, params);
    const rows = await scopedDb.select(`
      SELECT s.id, s.name, SUM(po.total_amount)::float8 AS amount, COUNT(*)::int AS orders
      FROM purchase_orders po
      JOIN requisitions r ON r.id = po.requisition_id
      JOIN currency c ON c.id = po.currency_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.status NOT IN ${INACTIVE_PO} AND c.format_key = $1 AND po.created_at >= ${since} ${this.scope('r', ctx, params)}
      GROUP BY s.id, s.name
      ORDER BY amount DESC NULLS LAST
    `, params);
    const total = rows.reduce((sum, r) => sum + (r.amount || 0), 0);
    const top = rows.slice(0, 5).map(r => ({
      supplierId: r.id, name: r.name, amount: round(r.amount, 2), orders: r.orders, share: rate(r.amount || 0, total),
    }));
    return {
      suppliers: rows.length,
      totalAmount: round(total, 2),
      top5Share: rate(top.reduce((sum, r) => sum + (r.amount || 0), 0), total),
      top,
    };
  }

  // ───────────────────────────── Finance ─────────────────────────────

  async finance(ctx) {
    const [budget, commitments, paymentDelay, invoices, byProject] = await Promise.all([
      this.budgetConsumed(ctx), this.openCommitments(ctx), this.paymentDelay(ctx), this.invoicesToPay(ctx), this.budgetByProject(ctx),
    ]);
    return { budget, commitments, paymentDelay, invoices, byProject };
  }

  /** Paiements PAID rattachés à une réquisition (via le bon de commande), devise de l'entreprise */
  paidSql(ctx, params, { since = null } = {}) {
    params.push(ctx.currency);
    const cur = `$${params.length}`;
    return `
      FROM payments pay
      LEFT JOIN invoices i ON i.id = pay.invoice_id
      JOIN purchase_orders po ON po.id = COALESCE(pay.po_id, i.po_id)
      JOIN requisitions r ON r.id = po.requisition_id
      WHERE pay.status = 'PAID' ${since ? `AND ${PAID_AT} >= ${since}` : ''} ${this.scope('r', ctx, params)}
      AND COALESCE(pay.currency, ${cur}) = ${cur}`;
  }

  /** Budget consommé = montant PAYÉ (cumul) / budget alloué (lignes actives) — choix du client, 2026-10-15 */
  async budgetConsumed(ctx) {
    const allocParams = [];
    let allocWhere = '';
    if (ctx.projectId) { allocParams.push(ctx.projectId); allocWhere = ` AND ba.project_id = $1`; }
    const paidParams = [];
    const otherParams = [ctx.currency];
    const [alloc, paid, other] = await Promise.all([
      scopedDb.one(`SELECT COALESCE(SUM(ba.allocated_amount), 0)::float8 AS allocated FROM budget_allocations ba WHERE ba.is_active = true${allocWhere}`, allocParams),
      scopedDb.one(`SELECT COALESCE(SUM(pay.amount), 0)::float8 AS paid ${this.paidSql(ctx, paidParams)}`, paidParams),
      scopedDb.one(`
        SELECT COUNT(*)::int AS n
        FROM payments pay
        LEFT JOIN invoices i ON i.id = pay.invoice_id
        JOIN purchase_orders po ON po.id = COALESCE(pay.po_id, i.po_id)
        JOIN requisitions r ON r.id = po.requisition_id
        WHERE pay.status = 'PAID' AND pay.currency IS NOT NULL AND pay.currency <> $1 ${this.scope('r', ctx, otherParams)}
      `, otherParams),
    ]);
    return {
      allocated: round(alloc.allocated, 2),
      paid: round(paid.paid, 2),
      remaining: round(alloc.allocated - paid.paid, 2),
      rate: rate(paid.paid, alloc.allocated),
      otherCurrencyCount: other.n,
    };
  }

  /** Budget alloué / payé par projet (10 premiers projets par budget alloué) */
  async budgetByProject(ctx) {
    const params = [];
    const paid = this.paidSql(ctx, params);
    const projectFilter = ctx.projectId ? (params.push(ctx.projectId), ` AND p.id = $${params.length}`) : '';
    const rows = await scopedDb.select(`
      WITH paid AS (SELECT r.project_id, SUM(pay.amount)::float8 AS paid ${paid} GROUP BY r.project_id),
      alloc AS (SELECT ba.project_id, SUM(ba.allocated_amount)::float8 AS allocated FROM budget_allocations ba WHERE ba.is_active = true GROUP BY ba.project_id)
      SELECT p.id, p.code, p.name, COALESCE(a.allocated, 0) AS allocated, COALESCE(pd.paid, 0) AS paid
      FROM projects p
      LEFT JOIN alloc a ON a.project_id = p.id
      LEFT JOIN paid pd ON pd.project_id = p.id
      WHERE (a.allocated > 0 OR pd.paid > 0)${projectFilter}
      ORDER BY COALESCE(a.allocated, 0) DESC
      LIMIT 10
    `, params);
    return rows.map(r => ({
      projectId: r.id, code: r.code, name: r.name,
      allocated: round(r.allocated, 2), paid: round(r.paid, 2), rate: rate(r.paid, r.allocated),
    }));
  }

  /** Engagements ouverts : bons de commande actifs (devise de l'entreprise) — montant restant à payer */
  async openCommitments(ctx) {
    const params = [ctx.currency];
    const row = await scopedDb.one(`
      WITH paid AS (
        SELECT COALESCE(pay.po_id, i.po_id) AS po_id, SUM(pay.amount) AS paid
        FROM payments pay LEFT JOIN invoices i ON i.id = pay.invoice_id
        WHERE pay.status = 'PAID' GROUP BY COALESCE(pay.po_id, i.po_id)
      )
      SELECT COUNT(*)::int AS orders, COALESCE(SUM(po.total_amount - COALESCE(pd.paid, 0)), 0)::float8 AS amount
      FROM purchase_orders po
      JOIN requisitions r ON r.id = po.requisition_id
      JOIN currency c ON c.id = po.currency_id
      LEFT JOIN paid pd ON pd.po_id = po.id
      WHERE po.status NOT IN ${INACTIVE_PO} AND c.format_key = $1
        AND po.total_amount - COALESCE(pd.paid, 0) > 0.009 ${this.scope('r', ctx, params)}
    `, params);
    return { orders: row.orders, amount: round(row.amount, 2) };
  }

  /** Délai de paiement : date de facture → paiement, paiements effectués dans la période */
  async paymentDelay(ctx) {
    const params = [];
    const since = this.since(ctx, params);
    const rows = await scopedDb.select(`
      SELECT EXTRACT(EPOCH FROM (${PAID_AT} - i.invoice_date::timestamp)) / 86400 AS days
      FROM payments pay
      JOIN invoices i ON i.id = pay.invoice_id
      JOIN purchase_orders po ON po.id = i.po_id
      JOIN requisitions r ON r.id = po.requisition_id
      WHERE pay.status = 'PAID' AND i.invoice_date IS NOT NULL AND ${PAID_AT} >= ${since} ${this.scope('r', ctx, params)}
    `, params);
    const values = rows.map(r => Math.max(0, Number(r.days)));
    return { count: values.length, medianDays: round(median(values)), meanDays: round(mean(values)) };
  }

  /** Factures à payer (ni payées, ni rejetées / annulées), dont échues */
  async invoicesToPay(ctx) {
    const params = [ctx.currency];
    const row = await scopedDb.one(`
      SELECT COUNT(*)::int AS count,
             COUNT(*) FILTER (WHERE i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE)::int AS overdue,
             COALESCE(SUM(i.total_amount) FILTER (WHERE COALESCE(i.currency, $1) = $1), 0)::float8 AS amount
      FROM invoices i
      JOIN purchase_orders po ON po.id = i.po_id
      JOIN requisitions r ON r.id = po.requisition_id
      WHERE i.status NOT IN ('PAID', 'REJECTED', 'CANCELLED') ${this.scope('r', ctx, params)}
    `, params);
    return { count: row.count, overdue: row.overdue, amount: round(row.amount, 2) };
  }

  // ───────────────────────────── Contrôle ─────────────────────────────

  async control(ctx) {
    const [decisions, methods, discrepancies, blocked] = await Promise.all([
      this.decisions(ctx), this.methods(ctx), this.discrepancies(ctx), this.blockedActions(ctx),
    ]);
    return { decisions, methods, discrepancies, blocked };
  }

  /** Étapes terminées dans la période (TASK_COMPLETED) avec leurs variables GoFlow (user_vars) */
  async completedTasks(ctx, keys) {
    const params = [];
    const since = this.since(ctx, params);
    // La clé de l'étape peut être dans task_definition_id ou task_name (nom anglais) : filtrée par taskKey ci-dessous
    const rows = await scopedDb.select(`
      SELECT wh.task_definition_id, wh.task_name, wh.comments, wh.entity_id
      FROM workflow_history wh
      JOIN requisitions r ON r.id = wh.entity_id
      WHERE wh.action = 'TASK_COMPLETED' AND wh.performed_at >= ${since} ${this.scope('r', ctx, params)}
    `, params);
    return rows
      .map(r => ({ key: taskKey(r), requisitionId: r.entity_id, vars: parseJson(r.comments)?.user_vars || {} }))
      .filter(r => keys.includes(r.key));
  }

  /**
   * Rejets et renvois par étape d'approbation : chaque décision compte (un dossier renvoyé deux fois = deux renvois) ;
   * le retrait par le demandeur n'est pas une décision. Taux = (rejets + renvois) / décisions.
   */
  async decisions(ctx) {
    const rows = await this.completedTasks(ctx, APPROVAL_TASKS);
    const steps = new Map();
    const returnsByRequisition = new Map();
    for (const r of rows) {
      const v = r.vars;
      if (isTrue(v.withdrawnByRequester)) continue;
      const approved = v.approved ?? v.poApproved;
      let decision = null;
      if (isTrue(v.returnedForCorrection)) decision = 'returned';
      else if (isTrue(approved)) decision = 'approved';
      else if (isFalse(approved)) decision = 'rejected';
      if (!decision) continue;
      if (!steps.has(r.key)) steps.set(r.key, { key: r.key, label: taskLabel(r.key, ctx.lang), decisions: 0, approved: 0, rejected: 0, returned: 0 });
      const s = steps.get(r.key);
      s.decisions++;
      s[decision]++;
      if (decision === 'returned') returnsByRequisition.set(r.requisitionId, (returnsByRequisition.get(r.requisitionId) || 0) + 1);
    }
    const list = APPROVAL_TASKS.filter(k => steps.has(k)).map(k => {
      const s = steps.get(k);
      return { ...s, rate: rate(s.rejected + s.returned, s.decisions) };
    });
    const total = list.reduce((a, s) => ({
      decisions: a.decisions + s.decisions, rejected: a.rejected + s.rejected, returned: a.returned + s.returned,
    }), { decisions: 0, rejected: 0, returned: 0 });
    return {
      steps: list,
      ...total,
      rate: rate(total.rejected + total.returned, total.decisions),
      returnedSeveralTimes: [...returnsByRequisition.values()].filter(n => n >= 2).length,
    };
  }

  /** Méthodes d'achat choisies dans la période (Activity_DetermineType) et taux de mise en concurrence */
  async methods(ctx) {
    const rows = await this.completedTasks(ctx, ['Activity_DetermineType']);
    const counts = {};
    for (const r of rows) {
      const m = r.vars.procurementMethod;
      if (m) counts[m] = (counts[m] || 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const competitive = COMPETITIVE_METHODS.reduce((a, m) => a + (counts[m] || 0), 0);
    return {
      total,
      competitive,
      competitiveRate: rate(competitive, total),
      soleSource: counts.SOLE_SOURCE || 0,
      byMethod: Object.entries(counts)
        .map(([method, count]) => ({ method, label: methodLabel(method, ctx.lang), count, share: rate(count, total) }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /** Écarts du rapprochement à 3 voies (factures ni rejetées ni annulées, statut de rapprochement ≠ conforme / en attente) */
  async discrepancies(ctx) {
    const params = [];
    const rows = await scopedDb.select(`
      SELECT i.id, i.invoice_number, i.supplier_invoice_number, i.match_status, i.status, i.total_amount::float8 AS amount,
             i.currency, i.invoice_date, po.id AS po_id, po.po_number, s.name AS supplier_name
      FROM invoices i
      JOIN purchase_orders po ON po.id = i.po_id
      JOIN requisitions r ON r.id = po.requisition_id
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE COALESCE(i.match_status, 'PENDING') NOT IN ('MATCHED', 'PENDING')
        AND i.status NOT IN ('REJECTED', 'CANCELLED') ${this.scope('r', ctx, params)}
      ORDER BY i.created_at DESC
    `, params);
    return {
      count: rows.length,
      unpaid: rows.filter(r => r.status !== 'PAID').length,
      list: rows.slice(0, 10).map(r => ({
        invoiceId: r.id, invoiceNumber: r.invoice_number, supplierInvoiceNumber: r.supplier_invoice_number,
        matchStatus: r.match_status, status: r.status, amount: round(r.amount, 2), currency: r.currency,
        invoiceDate: r.invoice_date, poId: r.po_id, poNumber: r.po_number, supplierName: r.supplier_name,
      })),
    };
  }

  /** Tentatives bloquées par le contrôle interne (journal d'audit, entreprise entière : pas de filtre projet) */
  async blockedActions(ctx) {
    const params = [CONTROL_AUDIT_ACTIONS, ctx.days];
    const rows = await db.select(`
      SELECT a.action, COUNT(*)::int AS n
      FROM audit_logs a
      WHERE a.action = ANY($1::varchar[])
        AND a.created_at >= LOCALTIMESTAMP - make_interval(days => $2)${tenant.filter('a.enterprise_id', params)}
      GROUP BY a.action
    `, params);
    const n = Object.fromEntries(rows.map(r => [r.action, r.n]));
    return {
      total: rows.reduce((a, r) => a + r.n, 0),
      byAction: CONTROL_AUDIT_ACTIONS.map(action => ({ action, count: n[action] || 0 })),
    };
  }
}

module.exports = new DashboardOverviewService();
module.exports.LATE_DAYS = LATE_DAYS;
module.exports.BLOCKED_DAYS = BLOCKED_DAYS;
module.exports.STEERING_PROFILES = STEERING_PROFILES;
