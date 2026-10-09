// backend/src/models/AuditLogModel.js
// Consultation du journal d'audit (écrit par utils/auditLog.js) : admin d'entreprise = son entreprise ;
// super admin plateforme = tout le journal (événements sans entreprise compris), filtrable par entreprise.
const db = require('../config/database');
const tenant = require('../utils/tenant');
const { AUDIT } = require('../utils/auditLog');

const EXPORT_LIMIT = 20000;

class AuditLogModel {
  /** Clause WHERE commune à la liste et à l'export */
  buildWhere({ action, actions, q, userId, from, to, enterpriseId, failuresOnly } = {}) {
    const params = [];
    let where = 'WHERE 1=1';
    if (tenant.current()?.superAdmin) {
      if (enterpriseId === 'none') where += ' AND a.enterprise_id IS NULL';
      else if (enterpriseId) { params.push(enterpriseId); where += ` AND a.enterprise_id = $${params.length}`; }
    } else {
      where += tenant.filter('a.enterprise_id', params);
    }
    const list = [].concat(actions ? String(actions).split(',') : [], action ? [action] : [])
      .map(s => s.trim()).filter(s => Object.values(AUDIT).includes(s));
    if (list.length) { params.push(list); where += ` AND a.action = ANY($${params.length}::varchar[])`; }
    if (['1', 'true', true].includes(failuresOnly)) {
      where += ` AND a.action IN ('LOGIN_FAILED', 'LOGIN_BLOCKED', 'PASSWORD_CHANGE_FAILED', 'PASSWORD_RESET_INVALID_LINK')`;
    }
    if (userId) { params.push(userId); where += ` AND (a.user_id = $${params.length} OR a.entity_id = $${params.length})`; }
    if (q && String(q).trim()) {
      params.push(`%${String(q).trim().toLowerCase()}%`);
      const n = params.length;
      where += ` AND (LOWER(COALESCE(a.user_email, '')) LIKE $${n} OR LOWER(COALESCE(actor.first_name || ' ' || actor.last_name, '')) LIKE $${n}
                 OR LOWER(COALESCE(target.email, '')) LIKE $${n} OR LOWER(COALESCE(target.first_name || ' ' || target.last_name, '')) LIKE $${n}
                 OR COALESCE(a.ip_address, '') LIKE $${n} OR LOWER(COALESCE(a.new_value->>'email', '')) LIKE $${n})`;
    }
    const isoDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));
    // Période en jours du fuseau de l'application (created_at est écrit dans le fuseau de la session PostgreSQL)
    if (isoDate(from) || isoDate(to)) {
      params.push(process.env.APP_TIMEZONE || 'Africa/Kinshasa');
      const local = `((a.created_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE $${params.length})`;
      if (isoDate(from)) { params.push(from); where += ` AND ${local} >= $${params.length}::text::date`; }
      if (isoDate(to)) { params.push(to); where += ` AND ${local} < ($${params.length}::text::date + 1)`; }
    }
    return { where, params };
  }

  baseFrom() {
    return `FROM audit_logs a
            LEFT JOIN users actor ON actor.id = a.user_id
            LEFT JOIN users target ON target.id = a.entity_id AND a.entity_type = 'user'
            LEFT JOIN enterprise e ON e.id = a.enterprise_id`;
  }

  columns() {
    // created_at : TIMESTAMP sans fuseau écrit dans le fuseau de la session PostgreSQL → converti en instant réel
    return `a.id, (a.created_at AT TIME ZONE current_setting('TimeZone')) AS created_at, a.action, a.user_id, a.user_email,
            NULLIF(TRIM(COALESCE(actor.first_name, '') || ' ' || COALESCE(actor.last_name, '')), '') AS actor_name,
            a.entity_type, a.entity_id, target.email AS target_email,
            NULLIF(TRIM(COALESCE(target.first_name, '') || ' ' || COALESCE(target.last_name, '')), '') AS target_name,
            a.old_value, a.new_value, a.ip_address, a.user_agent, a.enterprise_id, e.name AS enterprise_name`;
  }

  async list(filters = {}, { limit = 50, offset = 0 } = {}) {
    const { where, params } = this.buildWhere(filters);
    const [{ total }] = await db.select(`SELECT COUNT(*)::int AS total ${this.baseFrom()} ${where}`, params);
    const rows = await db.select(
      `SELECT ${this.columns()} ${this.baseFrom()} ${where} ORDER BY a.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    return { rows, total };
  }

  /** Synthèse de la période filtrée : nombre d'événements par action */
  async summary(filters = {}) {
    const { where, params } = this.buildWhere({ ...filters, action: undefined, actions: undefined, failuresOnly: undefined });
    return db.select(`SELECT a.action, COUNT(*)::int AS count ${this.baseFrom()} ${where} GROUP BY a.action ORDER BY count DESC`, params);
  }

  async exportRows(filters = {}) {
    const { where, params } = this.buildWhere(filters);
    return db.select(`SELECT ${this.columns()} ${this.baseFrom()} ${where} ORDER BY a.id DESC LIMIT ${EXPORT_LIMIT}`, params);
  }

  /** Entreprises (filtre du super admin) */
  async enterprises() {
    return db.select('SELECT id, name FROM enterprise ORDER BY name');
  }
}

module.exports = new AuditLogModel();
module.exports.EXPORT_LIMIT = EXPORT_LIMIT;
