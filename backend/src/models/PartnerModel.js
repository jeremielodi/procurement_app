// backend/src/models/PartnerModel.js
// Partenaires de l'entreprise (migration 66) : destinataires des transferts de stock « vers un partenaire ».
// Un partenaire appartient à UNE entreprise, est rattaché à une localisation de la plateforme et a un code unique
// dans l'entreprise. Ses comptes (espace partenaire) sont des utilisateurs prof_partner sans entreprise, users.partner_id.
const db = require('../config/database');
const tenant = require('../utils/tenant');

const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$/;
// Types de partenaire (ex. zone de santé) — contact_* = responsable du partenaire
const TYPES = ['HEALTH_ZONE', 'HEALTH_FACILITY', 'NGO', 'GOVERNMENT', 'OTHER'];
const clean = (v, max) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

const SELECT_SQL = `
  SELECT p.*, l.name AS location_name, l.code AS location_code,
         TRIM(COALESCE(cb.first_name, '') || ' ' || COALESCE(cb.last_name, '')) AS created_by_name,
         (SELECT COUNT(*)::int FROM users u WHERE u.partner_id = p.id) AS account_count,
         (SELECT COUNT(*)::int FROM users u WHERE u.partner_id = p.id AND u.is_active) AS active_account_count,
         (SELECT COUNT(*)::int FROM stock_issues si WHERE si.partner_id = p.id AND si.status = 'ISSUED') AS transfer_count,
         (SELECT COUNT(*)::int FROM stock_issues si WHERE si.partner_id = p.id AND si.status = 'ISSUED' AND si.acknowledged_at IS NULL) AS pending_count,
         (SELECT COUNT(*)::int FROM stock_units un WHERE un.partner_id = p.id AND un.status = 'AT_PARTNER') AS unit_count
  FROM partners p
  JOIN locations l ON l.id = p.location_id
  LEFT JOIN users cb ON cb.id = p.created_by`;

class PartnerModel {
  /** Contrôle et normalisation des champs ; partial = modification (champs absents inchangés) */
  async checkFields(data, { enterpriseId, partnerId = null, partial = false }) {
    const out = {};
    const has = (k) => !partial || data[k] !== undefined;
    if (has('code')) {
      const code = String(data.code || '').trim().toUpperCase();
      if (!code) throw fail(400, 'PARTNER_CODE_REQUIRED', 'Code du partenaire obligatoire');
      if (!CODE_RE.test(code)) throw fail(400, 'PARTNER_CODE_INVALID', 'Code invalide (lettres, chiffres, « - », « _ », « . », 30 caractères au plus)');
      const dup = await db.one(
        'SELECT id FROM partners WHERE enterprise_id = $1 AND UPPER(code) = $2 AND ($3::uuid IS NULL OR id <> $3::uuid)',
        [enterpriseId, code, partnerId]
      );
      if (dup) throw fail(409, 'PARTNER_CODE_EXISTS', `Le code ${code} est déjà utilisé par un autre partenaire`);
      out.code = code;
    }
    if (has('name')) {
      const name = clean(data.name, 200);
      if (!name) throw fail(400, 'PARTNER_NAME_REQUIRED', 'Nom du partenaire obligatoire');
      out.name = name;
    }
    if (has('partnerType')) {
      const type = String(data.partnerType || 'OTHER').trim().toUpperCase();
      if (!TYPES.includes(type)) throw fail(400, 'PARTNER_TYPE_INVALID', 'Type de partenaire invalide');
      out.partner_type = type;
    }
    if (has('locationId')) {
      if (!data.locationId) throw fail(400, 'LOCATION_REQUIRED', 'Localisation obligatoire');
      const loc = await db.one('SELECT id, is_active FROM locations WHERE id::text = $1', [String(data.locationId)]);
      if (!loc) throw fail(400, 'LOCATION_INVALID', 'Localisation introuvable');
      // Une localisation désactivée reste acceptée si le partenaire y est déjà rattaché
      if (loc.is_active === false) {
        const current = partnerId ? await db.one('SELECT location_id FROM partners WHERE id = $1', [partnerId]) : null;
        if (String(current?.location_id) !== String(loc.id)) throw fail(400, 'LOCATION_INVALID', 'Localisation inactive');
      }
      out.location_id = loc.id;
    }
    if (has('email')) {
      const email = clean(data.email, 150);
      if (email && !EMAIL_RE.test(email)) throw fail(400, 'EMAIL_INVALID', 'Email invalide');
      out.email = email ? email.toLowerCase() : null;
    }
    for (const [key, col, max] of [['address', 'address', 2000], ['contactName', 'contact_name', 150], ['contactTitle', 'contact_title', 150],
      ['phone', 'phone', 50], ['notes', 'notes', 2000]]) {
      if (has(key)) out[col] = clean(data[key], max);
    }
    if (data.isActive !== undefined) out.is_active = !!data.isActive;
    return out;
  }

  async list({ search, locationId, partnerType, status, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('p.enterprise_id', params)}`;
    if (partnerType && TYPES.includes(String(partnerType).toUpperCase())) { params.push(String(partnerType).toUpperCase()); where += ` AND p.partner_type = $${params.length}`; }
    if (status === 'active') where += ' AND p.is_active';
    else if (status === 'inactive') where += ' AND NOT p.is_active';
    if (locationId) { params.push(String(locationId)); where += ` AND p.location_id::text = $${params.length}`; }
    if (search) {
      params.push(`%${String(search).trim()}%`);
      const n = params.length;
      where += ` AND (p.code ILIKE $${n} OR p.name ILIKE $${n} OR p.contact_name ILIKE $${n} OR p.email ILIKE $${n} OR l.name ILIKE $${n})`;
    }
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM partners p JOIN locations l ON l.id = p.location_id ${where}`, params)).n;
    params.push(Math.min(parseInt(limit) || 50, 500), parseInt(offset) || 0);
    const rows = await db.select(`${SELECT_SQL} ${where} ORDER BY p.is_active DESC, p.name LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows, total };
  }

  /** Partenaires actifs (choix de la destination d'un bon de sortie) */
  async options() {
    const params = [];
    return db.select(
      `SELECT p.id, p.code, p.name, p.partner_type, l.name AS location_name,
              EXISTS (SELECT 1 FROM users u WHERE u.partner_id = p.id AND u.is_active) AS has_account
       FROM partners p JOIN locations l ON l.id = p.location_id
       WHERE p.is_active${tenant.filter('p.enterprise_id', params)} ORDER BY p.name`,
      params
    );
  }

  async getById(id) {
    if (!/^[0-9a-fA-F-]{36}$/.test(String(id))) return null;
    const partner = await db.one(`${SELECT_SQL} WHERE p.id = $1`, [id]);
    if (!partner) return null;
    partner.accounts = await this.accounts(id);
    return partner;
  }

  /** Comptes de l'espace partenaire */
  async accounts(partnerId) {
    return db.select(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.position, u.language, u.is_active, u.last_login, u.created_at
       FROM users u WHERE u.partner_id = $1 ORDER BY u.is_active DESC, u.first_name, u.last_name`,
      [partnerId]
    );
  }

  async create(data, { userId, enterpriseId }) {
    const f = await this.checkFields(data, { enterpriseId });
    return db.one(
      `INSERT INTO partners (enterprise_id, location_id, code, name, partner_type, address, contact_name, contact_title, phone, email, notes, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, true), $13) RETURNING id, code, name`,
      [enterpriseId, f.location_id, f.code, f.name, f.partner_type || 'OTHER', f.address, f.contact_name, f.contact_title, f.phone, f.email, f.notes,
        f.is_active === undefined ? null : f.is_active, userId]
    );
  }

  /** Modification : renvoie { before, after } (audit) */
  async update(id, data, { enterpriseId }) {
    const before = await db.one('SELECT * FROM partners WHERE id = $1', [id]);
    if (!before) throw fail(404, 'NOT_FOUND', 'Partenaire introuvable');
    const f = await this.checkFields(data, { enterpriseId, partnerId: id, partial: true });
    const cols = Object.keys(f);
    if (cols.length) {
      await db.exec(
        `UPDATE partners SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id, ...cols.map(c => f[c])]
      );
    }
    const after = await db.one('SELECT * FROM partners WHERE id = $1', [id]);
    return { before, after };
  }

  /** Compte d'un partenaire (contrôle d'appartenance) */
  async account(partnerId, userId) {
    return db.one('SELECT id, email, first_name, last_name, is_active, language FROM users WHERE id::text = $1 AND partner_id = $2', [String(userId), partnerId]);
  }

  async setAccountActive(partnerId, userId, active) {
    const acc = await this.account(partnerId, userId);
    if (!acc) throw fail(404, 'ACCOUNT_NOT_FOUND', 'Compte introuvable');
    await db.exec('UPDATE users SET is_active = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [acc.id, !!active]);
    return { ...acc, is_active: !!active };
  }

  /** Utilisateurs actifs de l'espace d'un partenaire (notifications) */
  async activeAccounts(partnerId) {
    return db.select('SELECT id, email, first_name, last_name, language FROM users WHERE partner_id = $1 AND is_active', [partnerId]);
  }
}

module.exports = new PartnerModel();
module.exports.fail = fail;
module.exports.TYPES = TYPES;
