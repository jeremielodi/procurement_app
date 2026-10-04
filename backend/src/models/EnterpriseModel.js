// backend/src/models/EnterpriseModel.js
// Entreprises clientes de procureApp (multi-entreprise)
const db = require('../config/database');

const SELECT = `
  SELECT
    e.id, e.name, e.code, e.currency_id,
    c.name AS currency_name, c.symbol AS currency_symbol, c.format_key AS currency_code, c.intel_number_format,
    e.logo_path, e.address, e.phone, e.email, e.website, e.tax_id, e.registration_number,
    e.is_active, e.created_at, e.last_update,
    (SELECT COUNT(*) FROM users u WHERE u.enterprise_id = e.id)::int AS user_count,
    (SELECT COUNT(*) FROM requisitions r WHERE r.enterprise_id = e.id)::int AS requisition_count
  FROM enterprise e
  LEFT JOIN currency c ON e.currency_id = c.id`;

// Champs modifiables : clé API → colonne
const FIELDS = {
  name: 'name', code: 'code', currencyId: 'currency_id', address: 'address', phone: 'phone',
  email: 'email', website: 'website', taxId: 'tax_id', registrationNumber: 'registration_number',
};

class EnterpriseModel {
  async findAll(filters = {}) {
    const params = [];
    let sql = `${SELECT} WHERE 1=1`;
    if (filters.search) {
      params.push(`%${filters.search}%`);
      sql += ` AND (e.name ILIKE $${params.length} OR e.code ILIKE $${params.length})`;
    }
    sql += ' ORDER BY e.name ASC';
    return db.select(sql, params);
  }

  async count(filters = {}) {
    const params = [];
    let sql = 'SELECT COUNT(*)::int AS count FROM enterprise e WHERE 1=1';
    if (filters.search) {
      params.push(`%${filters.search}%`);
      sql += ` AND (e.name ILIKE $${params.length} OR e.code ILIKE $${params.length})`;
    }
    return (await db.one(sql, params)).count;
  }

  async findById(id) {
    return db.one(`${SELECT} WHERE e.id = $1`, [id]);
  }

  async findByCode(code) {
    return db.one(`${SELECT} WHERE LOWER(e.code) = LOWER($1)`, [code]);
  }

  async findByName(name) {
    return db.one(`${SELECT} WHERE LOWER(e.name) = LOWER($1)`, [name]);
  }

  async create(data) {
    const row = await db.one(
      `INSERT INTO enterprise (name, code, currency_id, address, phone, email, website, tax_id, registration_number, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE) RETURNING id`,
      [data.name.trim(), data.code.trim().toUpperCase(), data.currencyId, data.address || null, data.phone || null,
       data.email || null, data.website || null, data.taxId || null, data.registrationNumber || null]
    );
    return this.findById(row.id);
  }

  async update(id, data) {
    const fields = {};
    for (const [key, col] of Object.entries(FIELDS)) {
      if (data[key] === undefined) continue;
      let v = data[key] === '' ? null : data[key];
      if (key === 'code' && v) v = String(v).trim().toUpperCase();
      if (key === 'name' && v) v = String(v).trim();
      fields[col] = v;
    }
    if (Object.keys(fields).length === 0) return this.findById(id);
    fields.last_update = new Date();
    await db.update('enterprise', fields, 'id', id);
    return this.findById(id);
  }

  async setLogo(id, logoPath) {
    await db.update('enterprise', { logo_path: logoPath, last_update: new Date() }, 'id', id);
  }

  async setActive(id, isActive) {
    await db.update('enterprise', { is_active: !!isActive, last_update: new Date() }, 'id', id);
    return this.findById(id);
  }

  /** Suppression uniquement d'une entreprise vide (aucun utilisateur ni réquisition) */
  async delete(id) {
    const e = await this.findById(id);
    if (!e) return { deleted: false, reason: 'NOT_FOUND' };
    if (e.user_count > 0 || e.requisition_count > 0) return { deleted: false, reason: 'NOT_EMPTY' };
    await db.delete('enterprise', 'id', id);
    return { deleted: true };
  }

  /** Administrateurs (profil prof_admin) d'une entreprise */
  async getAdmins(id) {
    return db.select(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.last_login
       FROM users u JOIN user_profiles up ON up.user_id = u.id AND up.profile_id = 'prof_admin'
       WHERE u.enterprise_id = $1 ORDER BY u.created_at`,
      [id]
    );
  }
}

module.exports = new EnterpriseModel();
