// backend/src/models/ReferenceModel.js
// Référentiels de la PLATEFORME (gérés par le super admin, partagés par toutes les entreprises) :
// localisations (bureaux / zones de livraison) et catégories de marché.
const db = require('../config/database');
const i18n = require('../i18n');
const { localizedSql } = require('../utils/requestLang');

// table → colonnes modifiables et table de liaison fournisseur (pour le contrôle avant suppression)
const TABLES = {
  locations: { columns: ['code', 'name', 'province'], link: 'supplier_locations', linkColumn: 'location_id', tenderColumn: 'location_id' },
  market_categories: { columns: ['code', 'name', 'description', 'is_stockable'], translatable: ['name', 'description'], link: 'supplier_categories', linkColumn: 'category_id', tenderColumn: 'category_id' },
};

const MAX_TRANSLATION = { name: 150, description: 1000 };

class ReferenceModel {
  /**
   * activeOnly (listes de sélection) : champs traduits dans la langue de la requête (name, description) ;
   * sinon (écran d'administration) : valeurs françaises brutes + `translations` à éditer.
   */
  async list(table, { activeOnly = false } = {}) {
    const { link, linkColumn, translatable = [] } = TABLES[table];
    const localized = activeOnly ? translatable.map(f => `, ${localizedSql('r', f)} AS ${f}`).join('') : '';
    return db.select(
      `SELECT r.*${localized}, (SELECT COUNT(*) FROM ${link} l WHERE l.${linkColumn} = r.id)::int AS supplier_count
       FROM ${table} r ${activeOnly ? 'WHERE r.is_active' : ''} ORDER BY ${activeOnly && translatable.includes('name') ? localizedSql('r') : 'r.name'}`,
      []
    );
  }

  async getById(table, id) {
    return db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  }

  /**
   * Code stable (identique dans toutes les bases) : saisi, ou dérivé du nom — majuscules sans accents,
   * ex. « Matériel de bureau » → MATERIEL_DE_BUREAU ; suffixe _2, _3… si déjà pris
   */
  async uniqueCode(table, source, exceptId = null) {
    const base = String(source || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 45) || 'REF';
    for (let i = 1; ; i++) {
      const code = i === 1 ? base : `${base}_${i}`;
      if (!(await this.findByCode(table, code, exceptId))) return code;
    }
  }

  async findByCode(table, code, exceptId = null) {
    return db.one(
      `SELECT id FROM ${table} WHERE UPPER(code) = UPPER($1) AND ($2::int IS NULL OR id <> $2)`,
      [code, exceptId]
    );
  }

  async findByName(table, name, exceptId = null) {
    return db.one(
      `SELECT id FROM ${table} WHERE LOWER(name) = LOWER($1) AND ($2::int IS NULL OR id <> $2)`,
      [name, exceptId]
    );
  }

  async create(table, data) {
    const fields = this.pick(table, data);
    fields.code = await this.uniqueCode(table, fields.code || fields.name);
    const translations = this.cleanTranslations(table, data.translations);
    if (translations) fields.translations = JSON.stringify(translations);
    const cols = Object.keys(fields);
    return db.one(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      cols.map(c => fields[c])
    );
  }

  async update(table, id, data) {
    const fields = this.pick(table, data);
    const translations = this.cleanTranslations(table, data.translations);
    if (translations) {
      // Fusion par langue : une langue absente de la requête garde sa traduction
      const current = (await this.getById(table, id))?.translations || {};
      const merged = { ...current };
      for (const [lang, values] of Object.entries(translations)) merged[lang] = { ...(current[lang] || {}), ...values };
      fields.translations = JSON.stringify(merged);
    }
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

  /**
   * { en: { name, description } } → langues connues (hors français, langue des colonnes) et champs traduisibles ;
   * valeur vide = traduction supprimée (repli sur le français). null si rien d'exploitable.
   */
  cleanTranslations(table, input) {
    const fields = TABLES[table].translatable;
    if (!fields || !input || typeof input !== 'object') return null;
    const out = {};
    for (const [lang, values] of Object.entries(input)) {
      if (!i18n.LANGS.includes(lang) || lang === i18n.DEFAULT_LANG || !values || typeof values !== 'object') continue;
      for (const f of fields) {
        if (values[f] === undefined) continue;
        const v = String(values[f] ?? '').trim().slice(0, MAX_TRANSLATION[f]);
        (out[lang] = out[lang] || {})[f] = v;
      }
    }
    return Object.keys(out).length ? out : null;
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
