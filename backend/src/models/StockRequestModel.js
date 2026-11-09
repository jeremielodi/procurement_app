// backend/src/models/StockRequestModel.js
// Demandes internes au magasin (migration 56) : un utilisateur demande des articles stockables à un dépôt, pour lui-même
// (USER) ou pour un département (DEPARTMENT). Statuts :
//   PENDING_VALIDATION → (validée) TO_SERVE → PARTIALLY_SERVED → SERVED ; ou REJECTED, CANCELLED, CLOSED (reste soldé)
// Validation : option de l'entreprise (enterprise.stock_request_validation) ; validateur = fonction SQL
// user_can_validate_stock_request (chef du projet ou intérimaire, sinon responsable du département, sinon administrateur ;
// jamais le demandeur). Service : bon de sortie classique (StockIssueModel.create avec stockRequestId) — la quantité
// servie est calculée à partir des lignes de bons de sortie non annulés (refreshStatus après chaque sortie / annulation).
const db = require('../config/database');
const tenant = require('../utils/tenant');
const warehouseModel = require('./WarehouseModel');

const EPS = 1e-9;
const OPEN = ['TO_SERVE', 'PARTIALLY_SERVED'];
const STATUSES = ['PENDING_VALIDATION', 'TO_SERVE', 'PARTIALLY_SERVED', 'SERVED', 'REJECTED', 'CANCELLED', 'CLOSED'];
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const text = (v, max = 2000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));

// Quantité servie d'une ligne : lignes des bons de sortie non annulés qui la citent
const SERVED_SQL = (alias) => `COALESCE((SELECT SUM(il.quantity) FROM stock_issue_lines il JOIN stock_issues si ON si.id = il.issue_id
  WHERE il.request_line_id = ${alias}.id AND si.status <> 'CANCELLED'), 0)`;

const HEADER_SQL = `
  SELECT r.*, w.code AS warehouse_code, w.name AS warehouse_name, loc.name AS warehouse_location,
         TRIM(COALESCE(rq.first_name, '') || ' ' || COALESCE(rq.last_name, '')) AS requester_name, rq.email AS requester_email,
         rq.avatar_updated_at AS requester_avatar_version,
         d.code AS department_code, d.name AS department_name, p.code AS project_code, p.name AS project_name,
         TRIM(COALESCE(vb.first_name, '') || ' ' || COALESCE(vb.last_name, '')) AS validated_by_name,
         TRIM(COALESCE(jb.first_name, '') || ' ' || COALESCE(jb.last_name, '')) AS rejected_by_name,
         TRIM(COALESCE(cb.first_name, '') || ' ' || COALESCE(cb.last_name, '')) AS closed_by_name,
         TRIM(COALESCE(xb.first_name, '') || ' ' || COALESCE(xb.last_name, '')) AS cancelled_by_name,
         agg.line_count, agg.requested_total, agg.validated_total, agg.served_total, agg.items
  FROM stock_requests r
  JOIN warehouses w ON w.id = r.warehouse_id
  JOIN locations loc ON loc.id = w.location_id
  JOIN users rq ON rq.id = r.requester_id
  LEFT JOIN departments d ON d.id = r.department_id
  LEFT JOIN projects p ON p.id = r.project_id
  LEFT JOIN users vb ON vb.id = r.validated_by
  LEFT JOIN users jb ON jb.id = r.rejected_by
  LEFT JOIN users cb ON cb.id = r.closed_by
  LEFT JOIN users xb ON xb.id = r.cancelled_by
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::int AS line_count, SUM(l.requested_quantity)::float8 AS requested_total,
           SUM(COALESCE(l.validated_quantity, l.requested_quantity))::float8 AS validated_total,
           SUM(${SERVED_SQL('l')})::float8 AS served_total,
           STRING_AGG(it.name, ', ' ORDER BY it.name) AS items
    FROM stock_request_lines l JOIN stock_items it ON it.id = l.stock_item_id
    WHERE l.request_id = r.id
  ) agg`;

class StockRequestModel {
  /** Validation exigée par l'entreprise */
  async validationRequired(enterpriseId) {
    const row = await db.one('SELECT stock_request_validation FROM enterprise WHERE id = $1', [enterpriseId]);
    return !!row?.stock_request_validation;
  }

  async setValidationRequired(enterpriseId, required) {
    await db.exec('UPDATE enterprise SET stock_request_validation = $2, last_update = CURRENT_TIMESTAMP WHERE id = $1', [enterpriseId, !!required]);
  }

  /** Choix du formulaire : dépôts actifs, départements actifs, projets actifs de l'entreprise */
  async options() {
    const wp = [], dp = [], pp = [];
    const [warehouses, departments, projects] = await Promise.all([
      db.select(`SELECT w.id, w.code, w.name, l.name AS location_name FROM warehouses w JOIN locations l ON l.id = w.location_id
                 WHERE w.is_active${tenant.filter('w.enterprise_id', wp)} ORDER BY l.name, w.name`, wp),
      db.select(`SELECT d.id, d.code, d.name FROM departments d WHERE COALESCE(d.is_active, true)${tenant.filter('d.enterprise_id', dp)} ORDER BY d.name`, dp),
      db.select(`SELECT p.id, p.code, p.name FROM projects p WHERE COALESCE(p.is_active, true)${tenant.filter('p.enterprise_id', pp)} ORDER BY p.code`, pp),
    ]);
    return { warehouses, departments, projects };
  }

  /** Articles stockables actifs (recherche) avec la quantité disponible dans le dépôt (lots non périmés) */
  async items({ warehouseId, q, ids } = {}) {
    const params = [warehouseId || null];
    let where = `WHERE si.is_active AND si.is_stockable${tenant.filter('si.enterprise_id', params)}`;
    if (ids?.length) { params.push(ids.map(String)); where += ` AND si.id::text = ANY($${params.length}::text[])`; }
    if (q) {
      params.push(`%${String(q).trim()}%`);
      where += ` AND (si.code ILIKE $${params.length} OR si.name ILIKE $${params.length})`;
    }
    return db.select(
      `SELECT si.id, si.code, si.name, si.unit, si.track_serials,
              COALESCE((SELECT SUM(b.quantity) FROM stock_balances b LEFT JOIN stock_lots lt ON lt.id = b.lot_id
                        WHERE b.stock_item_id = si.id AND b.warehouse_id = $1::uuid
                          AND (lt.expiry_date IS NULL OR lt.expiry_date >= CURRENT_DATE)), 0)::float8 AS available
       FROM stock_items si ${where}
       ORDER BY (si.code ILIKE ${q ? `$${params.length}` : "''"}) DESC, si.name LIMIT 30`,
      params
    );
  }

  /**
   * Création. data : { warehouseId, destinationType (USER | DEPARTMENT), departmentId, projectId, purpose, neededBy,
   *                    lines: [{ stockItemId, quantity, comment }] }
   */
  async create(data, { userId, enterpriseId }) {
    const type = String(data.destinationType || 'USER').toUpperCase();
    if (!['USER', 'DEPARTMENT'].includes(type)) throw fail(400, 'INVALID_DESTINATION', 'Destination invalide');
    const purpose = text(data.purpose);
    if (!purpose) throw fail(400, 'PURPOSE_REQUIRED', 'Motif de la demande obligatoire');
    if (!data.warehouseId) throw fail(400, 'WAREHOUSE_REQUIRED', 'Dépôt requis');
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if (!lines.length) throw fail(400, 'NO_LINES', 'Ajoutez au moins un article');
    if (data.neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.neededBy))) throw fail(400, 'NEEDED_BY_INVALID', 'Date souhaitée invalide');
    const validation = await this.validationRequired(enterpriseId);

    return db.withTransaction(async (tx) => {
      const warehouse = await tx.one('SELECT id, is_active FROM warehouses WHERE id::text = $1 AND enterprise_id = $2', [String(data.warehouseId), enterpriseId]);
      if (!warehouse?.is_active) throw fail(400, 'WAREHOUSE_INVALID', 'Dépôt introuvable ou inactif');
      let departmentId = null;
      if (type === 'DEPARTMENT') {
        if (!data.departmentId) throw fail(400, 'DEPARTMENT_REQUIRED', 'Département requis');
        const d = await tx.one('SELECT id FROM departments WHERE id::text = $1 AND enterprise_id = $2 AND COALESCE(is_active, true)', [String(data.departmentId), enterpriseId]);
        if (!d) throw fail(400, 'DEPARTMENT_INVALID', 'Département introuvable ou inactif');
        departmentId = d.id;
      }
      let projectId = null;
      if (data.projectId) {
        const p = await tx.one('SELECT id FROM projects WHERE id::text = $1 AND enterprise_id = $2', [String(data.projectId), enterpriseId]);
        if (!p) throw fail(400, 'PROJECT_INVALID', 'Projet introuvable');
        projectId = p.id;
      }
      const seen = new Set();
      const checked = [];
      for (const [line, raw] of lines.entries()) {
        const quantity = num(raw.quantity);
        if (!(quantity > EPS)) throw fail(400, 'INVALID_QUANTITY', 'Quantité invalide', { line });
        const item = await tx.one('SELECT id, name, is_active, is_stockable, track_serials FROM stock_items WHERE id::text = $1 AND enterprise_id = $2', [String(raw.stockItemId || ''), enterpriseId]);
        if (!item || !item.is_active) throw fail(400, 'ITEM_NOT_FOUND', 'Article introuvable', { line });
        if (!item.is_stockable) throw fail(400, 'ITEM_NOT_STOCKABLE', `${item.name} : article non stocké`, { line });
        if (item.track_serials && !Number.isInteger(quantity)) throw fail(400, 'INVALID_QUANTITY', `${item.name} : nombre entier d'équipements`, { line });
        if (seen.has(item.id)) throw fail(400, 'ITEM_TWICE', `${item.name} : article demandé deux fois`, { line });
        seen.add(item.id);
        checked.push({ itemId: item.id, quantity, comment: text(raw.comment, 500) || null });
      }
      const request = await tx.one(
        `INSERT INTO stock_requests (enterprise_id, warehouse_id, requester_id, destination_type, department_id, project_id, purpose, needed_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, request_number, status`,
        [enterpriseId, warehouse.id, userId, type, departmentId, projectId, purpose, data.neededBy || null, validation ? 'PENDING_VALIDATION' : 'TO_SERVE']
      );
      for (const l of checked) {
        await tx.exec(
          'INSERT INTO stock_request_lines (request_id, stock_item_id, requested_quantity, validated_quantity, comment) VALUES ($1, $2, $3, $4, $5)',
          [request.id, l.itemId, l.quantity, validation ? null : l.quantity, l.comment]
        );
      }
      return { id: request.id, requestNumber: request.request_number, status: request.status };
    });
  }

  /**
   * Liste. scope : 'mine' (mes demandes), 'toValidate' (celles que je peux valider), 'toServe' (à servir dans mes dépôts),
   * 'all' (toutes — l'appelant vérifie VIEW_STOCK). Filtres : status, warehouseId, search
   */
  async list({ scope = 'mine', userId, status, warehouseId, search, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('r.enterprise_id', params)}`;
    if (scope === 'mine') { params.push(userId); where += ` AND r.requester_id = $${params.length}`; }
    if (scope === 'toValidate') {
      params.push(userId);
      where += ` AND r.status = 'PENDING_VALIDATION' AND user_can_validate_stock_request($${params.length}, r.id)`;
    }
    if (scope === 'toServe') {
      const mine = (await warehouseModel.accessibleFor(userId)).map(w => w.id);
      params.push(mine);
      where += ` AND r.status IN ('TO_SERVE', 'PARTIALLY_SERVED') AND r.warehouse_id = ANY($${params.length}::uuid[])`;
    }
    const statuses = status ? String(status).split(',').filter(s => STATUSES.includes(s)) : [];
    if (statuses.length) { params.push(statuses); where += ` AND r.status = ANY($${params.length}::text[])`; }
    if (warehouseId) { params.push(String(warehouseId)); where += ` AND r.warehouse_id::text = $${params.length}`; }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      const p = `$${params.length}`;
      where += ` AND (r.request_number ILIKE ${p} OR r.purpose ILIKE ${p} OR rq.first_name ILIKE ${p} OR rq.last_name ILIKE ${p}
                 OR EXISTS (SELECT 1 FROM stock_request_lines l JOIN stock_items it ON it.id = l.stock_item_id
                            WHERE l.request_id = r.id AND (it.code ILIKE ${p} OR it.name ILIKE ${p})))`;
    }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM stock_requests r JOIN users rq ON rq.id = r.requester_id ${where}`, params)).n;
    params.push(Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0);
    const rows = await db.select(`${HEADER_SQL} ${where} ORDER BY r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows, total };
  }

  /** Nombre de demandes à valider / à servir pour l'utilisateur (bandeaux) */
  async counts(userId, { canServe }) {
    const toValidate = (await this.list({ scope: 'toValidate', userId, limit: 1 })).total;
    const toServe = canServe ? (await this.list({ scope: 'toServe', userId, limit: 1 })).total : 0;
    return { toValidate, toServe };
  }

  async getById(id) {
    const request = await db.one(`${HEADER_SQL} WHERE r.id::text = $1`, [String(id)]);
    if (!request) return null;
    request.lines = await db.select(
      `SELECT l.id, l.stock_item_id, l.requested_quantity::float8 AS requested_quantity, l.validated_quantity::float8 AS validated_quantity,
              ${SERVED_SQL('l')}::float8 AS served_quantity, l.comment,
              it.code AS item_code, it.name AS item_name, it.unit, it.track_serials, it.track_lots,
              COALESCE((SELECT SUM(b.quantity) FROM stock_balances b LEFT JOIN stock_lots lt ON lt.id = b.lot_id
                        WHERE b.stock_item_id = l.stock_item_id AND b.warehouse_id = $2
                          AND (lt.expiry_date IS NULL OR lt.expiry_date >= CURRENT_DATE)), 0)::float8 AS available
       FROM stock_request_lines l JOIN stock_items it ON it.id = l.stock_item_id
       WHERE l.request_id = $1 ORDER BY it.name`,
      [request.id, request.warehouse_id]
    );
    for (const l of request.lines) {
      const target = l.validated_quantity ?? l.requested_quantity;
      l.remaining_quantity = Math.max(Math.round((target - l.served_quantity) * 1e4) / 1e4, 0);
    }
    request.issues = await db.select(
      `SELECT si.id, si.issue_number, si.status, si.issued_at, si.acknowledged_at,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS issued_by_name,
              (SELECT SUM(il.quantity) FROM stock_issue_lines il WHERE il.issue_id = si.id)::float8 AS quantity
       FROM stock_issues si LEFT JOIN users u ON u.id = si.issued_by
       WHERE si.request_id = $1 ORDER BY si.issued_at`,
      [request.id]
    );
    return request;
  }

  async canValidate(id, userId) {
    return !!(await db.one('SELECT user_can_validate_stock_request($1, $2) AS ok', [userId, id]))?.ok;
  }

  /** Validateurs actuels d'une demande (notifications) : utilisateurs actifs de l'entreprise qui peuvent la valider */
  async validators(id) {
    return (await db.select(
      `SELECT u.id FROM users u JOIN stock_requests r ON r.id = $1
       WHERE u.is_active AND u.enterprise_id = r.enterprise_id AND user_can_validate_stock_request(u.id, r.id)`,
      [id]
    )).map(r => r.id);
  }

  /** Magasiniers à prévenir : utilisateurs actifs ayant accès au dépôt (ISSUE_STOCK vérifié par l'appelant) */
  async warehouseUsers(warehouseId) {
    return (await db.select(
      `SELECT u.id FROM users u JOIN warehouse_users wu ON wu.user_id = u.id AND wu.warehouse_id = $1 WHERE u.is_active`,
      [warehouseId]
    )).map(r => r.id);
  }

  /**
   * Validation : lines [{ lineId, validatedQuantity }] (absente = quantité demandée), au moins une quantité > 0.
   * 403 NOT_VALIDATOR / SELF_APPROVAL ; 409 NOT_PENDING
   */
  async validate(id, { userId, lines = [], comment }) {
    return db.withTransaction(async (tx) => {
      const r = await tx.one('SELECT id, status, requester_id FROM stock_requests WHERE id::text = $1 FOR UPDATE', [String(id)]);
      if (!r) throw fail(404, 'NOT_FOUND', 'Demande introuvable');
      if (r.status !== 'PENDING_VALIDATION') throw fail(409, 'NOT_PENDING', 'La demande n\'attend pas de validation');
      if (String(r.requester_id) === String(userId)) throw fail(403, 'SELF_APPROVAL', 'Vous ne pouvez pas valider votre propre demande');
      if (!(await tx.one('SELECT user_can_validate_stock_request($1, $2) AS ok', [userId, r.id]))?.ok) {
        throw fail(403, 'NOT_VALIDATOR', 'Vous ne pouvez pas valider cette demande');
      }
      const given = new Map((Array.isArray(lines) ? lines : []).map(l => [String(l.lineId), l.validatedQuantity]));
      const current = await tx.select('SELECT l.id, l.requested_quantity::float8 AS requested, it.track_serials FROM stock_request_lines l JOIN stock_items it ON it.id = l.stock_item_id WHERE l.request_id = $1', [r.id]);
      let any = false;
      for (const [line, l] of current.entries()) {
        const q = given.has(String(l.id)) ? num(given.get(String(l.id))) : l.requested;
        if (q < 0 || q - l.requested > EPS || (l.track_serials && !Number.isInteger(q))) throw fail(400, 'INVALID_QUANTITY', 'Quantité validée invalide (0 à la quantité demandée)', { line });
        if (q > EPS) any = true;
        await tx.exec('UPDATE stock_request_lines SET validated_quantity = $2 WHERE id = $1', [l.id, q]);
      }
      if (!any) throw fail(400, 'NOTHING_VALIDATED', 'Validez au moins un article, ou rejetez la demande');
      await tx.exec(
        `UPDATE stock_requests SET status = 'TO_SERVE', validated_by = $2, validated_at = CURRENT_TIMESTAMP, validation_comment = $3,
                updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [r.id, userId, text(comment, 1000) || null]
      );
      return { id: r.id };
    });
  }

  /** Rejet (motif obligatoire) — mêmes droits que la validation */
  async reject(id, { userId, reason }) {
    if (!text(reason)) throw fail(400, 'REASON_REQUIRED', 'Motif obligatoire');
    return db.withTransaction(async (tx) => {
      const r = await tx.one('SELECT id, status, requester_id FROM stock_requests WHERE id::text = $1 FOR UPDATE', [String(id)]);
      if (!r) throw fail(404, 'NOT_FOUND', 'Demande introuvable');
      if (r.status !== 'PENDING_VALIDATION') throw fail(409, 'NOT_PENDING', 'La demande n\'attend pas de validation');
      if (String(r.requester_id) === String(userId)) throw fail(403, 'SELF_APPROVAL', 'Vous ne pouvez pas rejeter votre propre demande');
      if (!(await tx.one('SELECT user_can_validate_stock_request($1, $2) AS ok', [userId, r.id]))?.ok) {
        throw fail(403, 'NOT_VALIDATOR', 'Vous ne pouvez pas rejeter cette demande');
      }
      await tx.exec(
        `UPDATE stock_requests SET status = 'REJECTED', rejected_by = $2, rejected_at = CURRENT_TIMESTAMP, reject_reason = $3,
                updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [r.id, userId, text(reason, 1000)]
      );
      return { id: r.id };
    });
  }

  /** Retrait par le demandeur, tant que rien n'a été servi (en attente de validation ou à servir) */
  async cancel(id, { userId, reason }) {
    return db.withTransaction(async (tx) => {
      const r = await tx.one('SELECT id, status, requester_id FROM stock_requests WHERE id::text = $1 FOR UPDATE', [String(id)]);
      if (!r) throw fail(404, 'NOT_FOUND', 'Demande introuvable');
      if (String(r.requester_id) !== String(userId)) throw fail(403, 'NOT_REQUESTER', 'Seul le demandeur peut retirer sa demande');
      if (!['PENDING_VALIDATION', 'TO_SERVE'].includes(r.status)) throw fail(409, 'NOT_CANCELLABLE', 'La demande a déjà été servie (en partie) ou est terminée');
      if (await tx.one(`SELECT 1 AS x FROM stock_issues WHERE request_id = $1 AND status <> 'CANCELLED' LIMIT 1`, [r.id])) {
        throw fail(409, 'NOT_CANCELLABLE', 'La demande a déjà été servie (en partie)');
      }
      await tx.exec(
        `UPDATE stock_requests SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = $3,
                updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [r.id, userId, text(reason, 1000) || null]
      );
      return { id: r.id };
    });
  }

  /** Solde du reste (motif obligatoire) par un magasinier du dépôt : rien ne sera plus servi (refus si rien n'a été servi) */
  async close(id, { userId, reason }) {
    if (!text(reason)) throw fail(400, 'REASON_REQUIRED', 'Motif obligatoire');
    return db.withTransaction(async (tx) => {
      const r = await tx.one('SELECT id, status, warehouse_id FROM stock_requests WHERE id::text = $1 FOR UPDATE', [String(id)]);
      if (!r) throw fail(404, 'NOT_FOUND', 'Demande introuvable');
      if (!OPEN.includes(r.status)) throw fail(409, 'NOT_OPEN', 'La demande n\'est pas à servir');
      if (!(await warehouseModel.canOperate(userId, r.warehouse_id))) throw fail(403, 'WAREHOUSE_FORBIDDEN', 'Vous n\'avez pas accès à ce dépôt');
      await tx.exec(
        `UPDATE stock_requests SET status = 'CLOSED', closed_by = $2, closed_at = CURRENT_TIMESTAMP, close_reason = $3,
                updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [r.id, userId, text(reason, 1000)]
      );
      return { id: r.id, previousStatus: r.status };
    });
  }

  // ------------------------------------------------------------------
  // Service par un bon de sortie (appelés par StockIssueModel dans SA transaction)
  // ------------------------------------------------------------------

  /**
   * Demande verrouillée pour être servie par le bon : à servir, même dépôt, même destination (USER : le demandeur ;
   * DEPARTMENT : le même département). → { request, lines: Map(lineId → { stockItemId, remaining }) }
   */
  async lockForServe(tx, requestId, { warehouseId, destinationType, recipientId, departmentId }) {
    const r = await tx.one('SELECT * FROM stock_requests WHERE id::text = $1 FOR UPDATE', [String(requestId)]);
    if (!r) throw fail(400, 'REQUEST_NOT_FOUND', 'Demande au magasin introuvable');
    if (!OPEN.includes(r.status)) throw fail(409, 'REQUEST_NOT_OPEN', `Demande ${r.request_number} : rien à servir (statut ${r.status})`);
    if (String(r.warehouse_id) !== String(warehouseId)) throw fail(400, 'REQUEST_WAREHOUSE_MISMATCH', `La demande ${r.request_number} est adressée à un autre dépôt`);
    const type = String(destinationType || 'USER').toUpperCase();
    const sameDestination = r.destination_type === 'USER'
      ? type === 'USER' && String(recipientId) === String(r.requester_id)
      : type === 'DEPARTMENT' && String(departmentId) === String(r.department_id);
    if (!sameDestination) throw fail(400, 'REQUEST_DESTINATION_MISMATCH', `Le bon doit aller à la destination de la demande ${r.request_number}`);
    const rows = await tx.select(
      `SELECT l.id, l.stock_item_id, COALESCE(l.validated_quantity, l.requested_quantity)::float8 AS target, ${SERVED_SQL('l')}::float8 AS served
       FROM stock_request_lines l WHERE l.request_id = $1`,
      [r.id]
    );
    return { request: r, lines: new Map(rows.map(l => [String(l.id), { stockItemId: l.stock_item_id, remaining: l.target - l.served }])) };
  }

  /** Statut recalculé à partir des quantités servies (après une sortie ou l'annulation d'une sortie) */
  async refreshStatus(tx, requestId) {
    const r = await tx.one('SELECT id, status FROM stock_requests WHERE id = $1 FOR UPDATE', [requestId]);
    if (!r || !['TO_SERVE', 'PARTIALLY_SERVED', 'SERVED'].includes(r.status)) return r?.status || null;
    const lines = await tx.select(
      `SELECT COALESCE(l.validated_quantity, l.requested_quantity)::float8 AS target, ${SERVED_SQL('l')}::float8 AS served
       FROM stock_request_lines l WHERE l.request_id = $1`,
      [requestId]
    );
    const status = lines.every(l => l.served >= l.target - EPS) ? 'SERVED'
      : lines.some(l => l.served > EPS) ? 'PARTIALLY_SERVED' : 'TO_SERVE';
    if (status !== r.status) await tx.exec('UPDATE stock_requests SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [requestId, status]);
    return status;
  }
}

module.exports = new StockRequestModel();
module.exports.STATUSES = STATUSES;
