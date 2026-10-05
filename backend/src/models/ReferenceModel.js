// backend/src/models/ReferenceModel.js
// Référentiels de la PLATEFORME (gérés par le super admin, partagés par toutes les entreprises) :
// localisations (bureaux / zones de livraison) et catégories de marché.
const db = require('../config/database');

// table → colonnes modifiables et table de liaison fournisseur (pour le contrôle avant suppression)
const TABLES = {
  locations: { columns: ['name', 'province'], link: 'supplier_locations', linkColumn: 'location_id', tenderColumn: 'location_id' },
  market_categories: { columns: ['name', 'description'], link: 'supplier_categories', linkColumn: 'category_id', tenderColumn: 'category_id' },
};

class ReferenceModel {
  async list(table, { activeOnly = false } = {}) {
    const { link, linkColumn } = TABLES[table];
    return db.select(
      `SELECT r.*, (SELECT COUNT(*) FROM ${link} l WHERE l.${linkColumn} = r.id)::int AS supplier_count
       FROM ${table} r ${activeOnly ? 'WHERE r.is_active' : ''} ORDER BY r.name`,
      []
    );
  }

  async getById(table, id) {
    return db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  }

  async findByName(table, name, exceptId = null) {
    return db.one(
      `SELECT id FROM ${table} WHERE LOWER(name) = LOWER($1) AND ($2::int IS NULL OR id <> $2)`,
      [name, exceptId]
    );
  }

  async create(table, data) {
    const fields = this.pick(table, data);
    const cols = Object.keys(fields);
    return db.one(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      cols.map(c => fields[c])
    );
  }

  async update(table, id, data) {
    const fields = this.pick(table, data);
    if (data.isActive !== undefined) fields.is_active = data.isActive === true || data.isActive === 'true';
    await db.update(table, { ...fields, updated_at: new Date() }, 'id', id);
    return this.getById(table, id);
  }

  /** Supprime si jamais utilisé ; sinon { deleted: false } (désactiver à la place) */
  async delete(table, id) {
    const { link, linkColumn, tenderColumn } = TABLES[table];
    const used = await db.one(
      `SELECT EXISTS (SELECT 1 FROM ${link} WHERE ${linkColumn} = $1)
           OR EXISTS (SELECT 1 FROM tenders WHERE ${tenderColumn} = $1)
           ${table === 'market_categories' ? 'OR EXISTS (SELECT 1 FROM supplier_prequalifications WHERE category_id = $1)' : ''}
           AS used`,
      [id]
    );
    if (used.used) return { deleted: false };
    await db.delete(table, 'id', id);
    return { deleted: true };
  }

  /** Ids existants et actifs parmi ceux fournis (sélection d'un fournisseur) */
  async validActiveIds(table, ids) {
    const list = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
    if (!list.length) return [];
    const rows = await db.select(`SELECT id FROM ${table} WHERE is_active AND id = ANY($1::int[])`, [list]);
    return rows.map(r => r.id);
  }

  pick(table, data) {
    const out = {};
    for (const col of TABLES[table].columns) {
      if (data[col] !== undefined) out[col] = typeof data[col] === 'string' ? (data[col].trim() || null) : data[col];
    }
    return out;
  }
}

module.exports = new ReferenceModel();
module.exports.TABLES = TABLES;
