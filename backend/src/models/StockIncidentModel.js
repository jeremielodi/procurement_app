// backend/src/models/StockIncidentModel.js
// Rapports d'incident sur les articles détenus par un employé (migration 68) : perte (LOST), vol (STOLEN), dommage
// (DAMAGED, équipements à n° de série). Déclaré par le détenteur, ou par le magasin pour son compte ; validé par le chef
// du projet du stock (ou son intérimaire), à défaut l'administrateur — fonction SQL user_can_validate_stock_incident
// (jamais le détenteur ni le déclarant). Le validateur se prononce sur la responsabilité de l'employé.
// Effets de la validation (une transaction) :
//  - perte / vol : la quantité sort des détentions (stock_issue_lines.returned_quantity, comme un retour « perdu ») ;
//    équipement → LOST ; aucun mouvement de stock (l'article était déjà sorti) ;
//  - dommage : l'équipement reste détenu, état DAMAGED (il sera rendu par un bon de retour).
const db = require('../config/database');
const tenant = require('../utils/tenant');
const stockNature = require('../utils/stockNature');
const stockProject = require('../utils/stockProject');

const EPS = 1e-9;
const TYPES = ['LOST', 'STOLEN', 'DAMAGED'];
const STATUSES = ['PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED'];
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const text = (v, max = 4000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const name = (alias) => `NULLIF(TRIM(COALESCE(${alias}.first_name, '') || ' ' || COALESCE(${alias}.last_name, '')), '')`;

// Quantité déjà déclarée perdue / volée et en attente de validation sur une ligne de sortie
const PENDING_SQL = (lineExpr) => `COALESCE((SELECT SUM(xl.quantity) FROM stock_incident_lines xl JOIN stock_incidents xi ON xi.id = xl.incident_id
  WHERE xl.issue_line_id = ${lineExpr} AND xi.status = 'PENDING' AND xi.incident_type IN ('LOST', 'STOLEN')), 0)`;

const HEADER_SQL = `
  SELECT i.*, ${name('h')} AS holder_name, h.email AS holder_email, h.avatar_updated_at AS holder_avatar_version,
         ${name('rb')} AS reported_by_name, ${name('vb')} AS validated_by_name, ${name('ob')} AS on_behalf_of_name,
         ${name('jb')} AS rejected_by_name, ${name('xb')} AS cancelled_by_name,
         p.code AS project_code, p.name AS project_name, ${name('pm')} AS project_manager_name,
         agg.line_count, agg.items
  FROM stock_incidents i
  JOIN users h ON h.id = i.holder_id
  JOIN users rb ON rb.id = i.reported_by
  LEFT JOIN users vb ON vb.id = i.validated_by
  LEFT JOIN users ob ON ob.id = i.on_behalf_of
  LEFT JOIN users jb ON jb.id = i.rejected_by
  LEFT JOIN users xb ON xb.id = i.cancelled_by
  LEFT JOIN projects p ON p.id = i.project_id
  LEFT JOIN users pm ON pm.id = p.project_manager_id
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::int AS line_count, STRING_AGG(it.name, ', ' ORDER BY it.name) AS items
    FROM stock_incident_lines l JOIN stock_items it ON it.id = l.stock_item_id WHERE l.incident_id = i.id
  ) agg`;

class StockIncidentModel {
  /**
   * Déclaration. data : { incidentType, incidentDate (AAAA-MM-JJ), incidentPlace, circumstances, policeReference,
   *                       lines: [{ issueLineId, quantity }] }
   * ctx : { userId (déclarant), holderId (détenteur), enterpriseId, onBehalf (magasin : natures / projets contrôlés) }
   */
  async create(data, { userId, holderId, enterpriseId, onBehalf = false }) {
    const type = String(data.incidentType || '').toUpperCase();
    if (!TYPES.includes(type)) throw fail(400, 'INCIDENT_TYPE_INVALID', 'Type d\'incident invalide (perte, vol ou dommage)');
    const date = String(data.incidentDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw fail(400, 'INCIDENT_DATE_INVALID', 'Date de l\'incident invalide');
    const circumstances = text(data.circumstances);
    if (circumstances.length < 10) throw fail(400, 'CIRCUMSTANCES_REQUIRED', 'Décrivez les circonstances de l\'incident (10 caractères au moins)');
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if (!lines.length) throw fail(400, 'NO_LINES', 'Sélectionnez au moins un article');

    return db.withTransaction(async (tx) => {
      if ((await tx.one('SELECT ($1::date > CURRENT_DATE) AS future', [date]))?.future) {
        throw fail(400, 'INCIDENT_DATE_FUTURE', 'La date de l\'incident ne peut pas être dans le futur');
      }
      const holder = await tx.one('SELECT id, is_active, enterprise_id FROM users WHERE id::text = $1', [String(holderId)]);
      if (!holder || String(holder.enterprise_id) !== String(enterpriseId)) throw fail(400, 'HOLDER_INVALID', 'Employé introuvable');

      const prepared = [];
      const seen = new Set();
      for (const [index, raw] of lines.entries()) {
        const key = String(raw.issueLineId || '');
        if (seen.has(key)) throw fail(400, 'DUPLICATE_LINE', 'Article en double', { line: index });
        seen.add(key);
        const line = await tx.one(
          `SELECT il.id, il.stock_item_id, il.unit_id, il.project_id, il.quantity::float8 AS quantity, il.returned_quantity::float8 AS returned_quantity,
                  si.status, si.destination_type, si.recipient_id, si.enterprise_id, it.name AS item_name, it.nature,
                  un.status AS unit_status, un.holder_id AS unit_holder, un.condition AS unit_condition
           FROM stock_issue_lines il JOIN stock_issues si ON si.id = il.issue_id JOIN stock_items it ON it.id = il.stock_item_id
           LEFT JOIN stock_units un ON un.id = il.unit_id
           WHERE il.id::text = $1 FOR UPDATE OF il`,
          [key]
        );
        if (!line || String(line.enterprise_id) !== String(enterpriseId)) throw fail(400, 'LINE_NOT_FOUND', 'Article détenu introuvable', { line: index });
        if (line.destination_type !== 'USER' || String(line.recipient_id) !== String(holder.id)) {
          throw fail(400, 'NOT_HOLDER', `${line.item_name} : article remis à une autre personne`, { line: index });
        }
        if (line.status !== 'ISSUED') throw fail(409, 'ISSUE_CANCELLED', `${line.item_name} : bon de sortie annulé`, { line: index });
        if (onBehalf) {
          try { await stockNature.assertAllowed([line.nature]); await stockProject.assertAllowed([line.project_id]); } catch (e) { e.line = index; throw e; }
        }
        const remaining = line.quantity - line.returned_quantity;
        if (!(remaining > EPS)) throw fail(409, 'NOT_HELD', `${line.item_name} : plus détenu (déjà rendu)`, { line: index });
        if (line.unit_id && (line.unit_status !== 'ASSIGNED' || String(line.unit_holder) !== String(holder.id))) {
          throw fail(409, 'NOT_HELD', `${line.item_name} : équipement plus détenu`, { line: index });
        }
        // Un équipement : un seul rapport en attente à la fois (quel que soit le type)
        const pendingOnLine = await tx.one(
          `SELECT COUNT(*)::int AS n, ${PENDING_SQL('$1')}::float8 AS lost
           FROM stock_incident_lines xl JOIN stock_incidents xi ON xi.id = xl.incident_id
           WHERE xl.issue_line_id = $1 AND xi.status = 'PENDING'`,
          [line.id]
        );
        if (type === 'DAMAGED') {
          if (!line.unit_id) throw fail(400, 'DAMAGE_EQUIPMENT_ONLY', `${line.item_name} : le dommage se déclare pour un équipement à n° de série`, { line: index });
          if (pendingOnLine.n > 0) throw fail(409, 'INCIDENT_PENDING', `${line.item_name} : un rapport d'incident est déjà en attente`, { line: index });
          if (line.unit_condition === 'DAMAGED') throw fail(409, 'ALREADY_DAMAGED', `${line.item_name} : équipement déjà signalé endommagé`, { line: index });
          prepared.push({ line, quantity: 1 });
          continue;
        }
        if (line.unit_id && pendingOnLine.n > 0) throw fail(409, 'INCIDENT_PENDING', `${line.item_name} : un rapport d'incident est déjà en attente`, { line: index });
        const quantity = line.unit_id ? 1 : num(raw.quantity);
        if (!(quantity > EPS)) throw fail(400, 'INVALID_QUANTITY', 'Quantité invalide', { line: index });
        const available = Math.round((remaining - pendingOnLine.lost) * 1e4) / 1e4;
        if (quantity - available > EPS) {
          throw fail(400, 'OVER_HELD', `${line.item_name} : ${quantity} déclaré(s) pour ${available} détenu(s)`, { line: index, available });
        }
        prepared.push({ line, quantity });
      }

      // Un rapport = un projet (son chef le valide)
      const projects = [...new Set(prepared.map(p => (p.line.project_id ? String(p.line.project_id) : '')))];
      if (projects.length > 1) throw fail(400, 'MIXED_PROJECTS', 'Ces articles relèvent de projets différents : faites un rapport par projet');

      const incident = await tx.one(
        `INSERT INTO stock_incidents (enterprise_id, holder_id, project_id, incident_type, incident_date, incident_place, circumstances,
                                      police_reference, reported_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, incident_number`,
        [enterpriseId, holder.id, projects[0] || null, type, date, text(data.incidentPlace, 500) || null, circumstances,
          type === 'STOLEN' ? text(data.policeReference, 200) || null : null, userId]
      );
      for (const p of prepared) {
        await tx.exec(
          'INSERT INTO stock_incident_lines (incident_id, issue_line_id, stock_item_id, unit_id, quantity) VALUES ($1, $2, $3, $4, $5)',
          [incident.id, p.line.id, p.line.stock_item_id, p.line.unit_id, p.quantity]
        );
      }
      return { id: incident.id, incidentNumber: incident.incident_number, projectId: projects[0] || null };
    });
  }

  /** scope : mine (détenteur ou déclarant) | toValidate | all (VIEW_STOCK, contrôlé par l'appelant) */
  async list({ scope = 'mine', userId, status, type, search, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('i.enterprise_id', params)}`;
    if (scope === 'mine') { params.push(userId); where += ` AND (i.holder_id = $${params.length} OR i.reported_by = $${params.length})`; }
    if (scope === 'toValidate') { params.push(userId); where += ` AND i.status = 'PENDING' AND user_can_validate_stock_incident($${params.length}, i.id)`; }
    if (scope === 'all') {
      where += await stockNature.existsLine('SELECT 1 FROM stock_incident_lines nl JOIN stock_items ni ON ni.id = nl.stock_item_id WHERE nl.incident_id = i.id', 'ni.nature', params);
      where += await stockProject.filter('i.project_id', params);
    }
    const statuses = status ? String(status).split(',').filter(s => STATUSES.includes(s)) : [];
    if (statuses.length) { params.push(statuses); where += ` AND i.status = ANY($${params.length}::text[])`; }
    if (type && TYPES.includes(String(type))) { params.push(String(type)); where += ` AND i.incident_type = $${params.length}`; }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      const p = `$${params.length}`;
      where += ` AND (i.incident_number ILIKE ${p} OR h.first_name ILIKE ${p} OR h.last_name ILIKE ${p} OR h.email ILIKE ${p}
                 OR EXISTS (SELECT 1 FROM stock_incident_lines l JOIN stock_items it ON it.id = l.stock_item_id LEFT JOIN stock_units un ON un.id = l.unit_id
                            WHERE l.incident_id = i.id AND (it.code ILIKE ${p} OR it.name ILIKE ${p} OR un.serial_number ILIKE ${p} OR un.asset_tag ILIKE ${p})))`;
    }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM stock_incidents i JOIN users h ON h.id = i.holder_id ${where}`, params)).n;
    params.push(Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0);
    const rows = await db.select(`${HEADER_SQL} ${where} ORDER BY i.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows, total };
  }

  async countToValidate(userId) {
    return (await this.list({ scope: 'toValidate', userId, limit: 1 })).total;
  }

  async getById(id) {
    const incident = await db.one(`${HEADER_SQL} WHERE i.id::text = $1`, [String(id)]);
    if (!incident) return null;
    incident.lines = await db.select(
      `SELECT l.id, l.issue_line_id, l.stock_item_id, l.unit_id, l.quantity::float8 AS quantity,
              it.code AS item_code, it.name AS item_name, it.unit, it.nature AS item_nature, il.project_id,
              si.id AS issue_id, si.issue_number, si.issued_at, w.name AS warehouse_name, si.warehouse_id,
              lt.lot_number, un.serial_number, un.asset_tag, un.status AS unit_status, un.condition AS unit_condition
       FROM stock_incident_lines l
       JOIN stock_items it ON it.id = l.stock_item_id
       JOIN stock_issue_lines il ON il.id = l.issue_line_id
       JOIN stock_issues si ON si.id = il.issue_id
       JOIN warehouses w ON w.id = si.warehouse_id
       LEFT JOIN stock_lots lt ON lt.id = il.lot_id
       LEFT JOIN stock_units un ON un.id = l.unit_id
       WHERE l.incident_id = $1 ORDER BY it.name, un.serial_number NULLS LAST`,
      [incident.id]
    );
    return incident;
  }

  async canValidate(id, userId) {
    return !!(await db.one('SELECT user_can_validate_stock_incident($1, $2) AS ok', [userId, id]))?.ok;
  }

  /** Validateurs actuels (notifications, « en attente de ») : utilisateurs actifs de l'entreprise */
  async validators(id) {
    return db.select(
      `SELECT u.id, ${name('u')} AS name FROM users u JOIN stock_incidents i ON i.id = $1
       WHERE u.is_active AND u.enterprise_id = i.enterprise_id AND user_can_validate_stock_incident(u.id, i.id) ORDER BY 2`,
      [id]
    );
  }

  /** Verrouille un rapport en attente et contrôle les droits du validateur */
  async lockPending(tx, id, userId) {
    const i = await tx.one('SELECT * FROM stock_incidents WHERE id::text = $1 FOR UPDATE', [String(id)]);
    if (!i) throw fail(404, 'NOT_FOUND', 'Rapport d\'incident introuvable');
    if (i.status !== 'PENDING') throw fail(409, 'NOT_PENDING', 'Le rapport n\'attend pas de validation');
    if ([i.holder_id, i.reported_by].map(String).includes(String(userId))) throw fail(403, 'SELF_APPROVAL', 'Le rapport doit être validé par une autre personne');
    if (!(await tx.one('SELECT user_can_validate_stock_incident($1, $2) AS ok', [userId, i.id]))?.ok) {
      throw fail(403, 'NOT_VALIDATOR', 'Seul le chef du projet (ou l\'administrateur) valide ce rapport');
    }
    return i;
  }

  /**
   * Validation : { employeeLiable (true / false, obligatoire), comment } — applique l'incident aux détentions.
   * 409 HOLDING_CHANGED si l'article a été rendu / le bon annulé entre-temps (rejeter alors le rapport).
   */
  async validate(id, { userId, employeeLiable, comment }) {
    if (typeof employeeLiable !== 'boolean') throw fail(400, 'LIABILITY_REQUIRED', 'Indiquez si la responsabilité de l\'employé est engagée');
    return db.withTransaction(async (tx) => {
      const i = await this.lockPending(tx, id, userId);
      // Intérim : le chef de projet remplacé
      const pm = i.project_id ? await tx.one(
        `SELECT u.id FROM projects p JOIN users u ON u.id = p.project_manager_id AND u.is_active WHERE p.id = $1`, [i.project_id]
      ) : null;
      const onBehalfOf = pm && String(pm.id) !== String(userId) && ![i.holder_id, i.reported_by].map(String).includes(String(pm.id))
        && (await tx.one('SELECT user_manages_project($1, $2) AS ok', [userId, i.project_id]))?.ok ? pm.id : null;

      const lines = await tx.select('SELECT * FROM stock_incident_lines WHERE incident_id = $1', [i.id]);
      const note = `${i.incident_number} — ${{ LOST: 'perte', STOLEN: 'vol', DAMAGED: 'dommage' }[i.incident_type]} (${String(i.incident_date)})`;
      for (const l of lines) {
        const il = await tx.one(
          `SELECT il.id, il.quantity::float8 AS quantity, il.returned_quantity::float8 AS returned_quantity, si.status, si.recipient_id, it.name AS item_name
           FROM stock_issue_lines il JOIN stock_issues si ON si.id = il.issue_id JOIN stock_items it ON it.id = il.stock_item_id
           WHERE il.id = $1 FOR UPDATE OF il`,
          [l.issue_line_id]
        );
        const changed = () => fail(409, 'HOLDING_CHANGED', `${il?.item_name || ''} : l'article n'est plus détenu par l'employé (rendu ou bon annulé) — rejetez le rapport`);
        if (!il || il.status !== 'ISSUED' || String(il.recipient_id) !== String(i.holder_id)) throw changed();
        if (l.unit_id) {
          const unit = await tx.one('SELECT status, holder_id FROM stock_units WHERE id = $1 FOR UPDATE', [l.unit_id]);
          if (!unit || unit.status !== 'ASSIGNED' || String(unit.holder_id) !== String(i.holder_id)) throw changed();
        }
        if (i.incident_type === 'DAMAGED') {
          await tx.exec(
            `UPDATE stock_units SET condition = 'DAMAGED', notes = CONCAT_WS(E'\\n', NULLIF(notes, ''), $2::text), updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [l.unit_id, note]
          );
          continue;
        }
        if (num(l.quantity) - (il.quantity - il.returned_quantity) > EPS) throw changed();
        await tx.exec('UPDATE stock_issue_lines SET returned_quantity = returned_quantity + $2 WHERE id = $1', [il.id, l.quantity]);
        if (l.unit_id) {
          await tx.exec(
            `UPDATE stock_units SET status = 'LOST', holder_id = NULL, department_id = NULL, partner_id = NULL, warehouse_id = NULL,
                    notes = CONCAT_WS(E'\\n', NULLIF(notes, ''), $2::text), updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [l.unit_id, note]
          );
        }
      }
      await tx.exec(
        `UPDATE stock_incidents SET status = 'VALIDATED', validated_by = $2, validated_at = CURRENT_TIMESTAMP, on_behalf_of = $3,
                employee_liable = $4, decision_comment = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [i.id, userId, onBehalfOf, employeeLiable, text(comment, 2000) || null]
      );
      return { id: i.id, onBehalfOf };
    });
  }

  /** Rejet (motif obligatoire) — mêmes droits que la validation ; les articles restent détenus */
  async reject(id, { userId, reason }) {
    if (!text(reason)) throw fail(400, 'REASON_REQUIRED', 'Motif obligatoire');
    return db.withTransaction(async (tx) => {
      const i = await this.lockPending(tx, id, userId);
      await tx.exec(
        `UPDATE stock_incidents SET status = 'REJECTED', rejected_by = $2, rejected_at = CURRENT_TIMESTAMP, reject_reason = $3,
                updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [i.id, userId, text(reason, 2000)]
      );
      return { id: i.id };
    });
  }

  /** Retrait par le détenteur ou le déclarant, tant que le rapport attend sa validation */
  async cancel(id, { userId, reason }) {
    return db.withTransaction(async (tx) => {
      const i = await tx.one('SELECT id, status, holder_id, reported_by FROM stock_incidents WHERE id::text = $1 FOR UPDATE', [String(id)]);
      if (!i) throw fail(404, 'NOT_FOUND', 'Rapport d\'incident introuvable');
      if (![i.holder_id, i.reported_by].map(String).includes(String(userId))) throw fail(403, 'NOT_ALLOWED', 'Seul le détenteur ou le déclarant peut retirer le rapport');
      if (i.status !== 'PENDING') throw fail(409, 'NOT_CANCELLABLE', 'Le rapport a déjà été traité');
      await tx.exec(
        `UPDATE stock_incidents SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = $3,
                updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [i.id, userId, text(reason, 2000) || null]
      );
      return { id: i.id };
    });
  }
}

module.exports = new StockIncidentModel();
module.exports.PENDING_SQL = PENDING_SQL;
module.exports.TYPES = TYPES;
