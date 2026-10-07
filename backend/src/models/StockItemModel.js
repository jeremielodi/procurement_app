// backend/src/models/StockItemModel.js
// Catalogue d'articles d'une entreprise. Une ligne de réquisition / PO / GRN peut citer un article ;
// seuls les articles stockables entrent en stock à la réception.
const db = require('../config/database');
const tenant = require('../utils/tenant');
const { localizedSql } = require('../utils/requestLang');

const SELECT = () => `
  SELECT si.*, ${localizedSql('mc')} AS category_name, mc.code AS category_code,
         COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.stock_item_id = si.id), 0) AS stock_quantity
  FROM stock_items si
  LEFT JOIN market_categories mc ON mc.id = si.category_id`;

const COLUMNS = [
  ['code', 'code'], ['name', 'name'], ['description', 'description'], ['unit', 'unit'], ['categoryId', 'category_id'],
  ['isStockable', 'is_stockable'], ['trackLots', 'track_lots'], ['trackExpiry', 'track_expiry'], ['trackSerials', 'track_serials'],
  ['minQuantity', 'min_quantity'], ['isActive', 'is_active'],
];

class StockItemModel {
  async list({ search, categoryId, stockable, activeOnly = false, belowMin = false, limit = 200, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('si.enterprise_id', params)}`;
    if (activeOnly) where += ' AND si.is_active';
    if (categoryId) { params.push(categoryId); where += ` AND si.category_id = $${params.length}`; }
    if (stockable === true || stockable === 'true') where += ' AND si.is_stockable';
    if (stockable === false || stockable === 'false') where += ' AND NOT si.is_stockable';
    if (search) {
      params.push(`%${String(search).trim()}%`);
      where += ` AND (si.code ILIKE $${params.length} OR si.name ILIKE $${params.length} OR si.description ILIKE $${params.length})`;
    }
    let sql = `SELECT * FROM (${SELECT()} ${where}) x`;
    if (belowMin) sql += ' WHERE x.min_quantity IS NOT NULL AND x.stock_quantity < x.min_quantity';
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM (${sql}) t`, params)).n;
    params.push(Math.min(parseInt(limit) || 200, 1000), parseInt(offset) || 0);
    const rows = await db.select(`${sql} ORDER BY x.name LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows, total };
  }

  /** Autocomplétion (réquisition, GRN) : articles actifs, code ou désignation */
  async search(term, limit = 15) {
    const params = [];
    let where = `WHERE si.is_active${tenant.filter('si.enterprise_id', params)}`;
    let order = 'si.name';
    if (term) {
      params.push(`%${String(term).trim()}%`);
      where += ` AND (si.code ILIKE $${params.length} OR si.name ILIKE $${params.length})`;
      // Code exact ou commençant par le terme en premier
      params.push(`${String(term).trim()}%`);
      order = `(si.code ILIKE $${params.length}) DESC, si.name`;
    }
    params.push(Math.min(parseInt(limit) || 15, 50));
    return db.select(`${SELECT()} ${where} ORDER BY ${order} LIMIT $${params.length}`, params);
  }

  async getById(id) {
    return db.one(`${SELECT()} WHERE si.id = $1`, [id]);
  }

  /** Articles de l'entreprise courante par code (import Excel de réquisition) */
  async findByCodes(codes) {
    const list = [...new Set((codes || []).map(c => String(c).trim().toUpperCase()).filter(Boolean))];
    if (!list.length) return [];
    const params = [list];
    return db.select(
      `SELECT id, code, name, unit, is_stockable, is_active FROM stock_items si
       WHERE UPPER(si.code) = ANY($1::text[])${tenant.filter('si.enterprise_id', params)}`,
      params
    );
  }

  async findByCode(enterpriseId, code, exceptId = null) {
    return db.one(
      `SELECT id FROM stock_items WHERE enterprise_id = $1 AND UPPER(code) = UPPER($2) AND ($3::uuid IS NULL OR id <> $3)`,
      [enterpriseId, code, exceptId]
    );
  }

  pick(data) {
    const out = {};
    for (const [key, col] of COLUMNS) if (data[key] !== undefined) out[col] = data[key];
    return out;
  }

  async create(data, { enterpriseId, createdBy }) {
    const fields = { ...this.pick(data), enterprise_id: enterpriseId, created_by: createdBy };
    const cols = Object.keys(fields);
    return db.one(
      `INSERT INTO stock_items (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      cols.map(c => fields[c])
    );
  }

  async update(id, data) {
    const fields = this.pick(data);
    if (!Object.keys(fields).length) return;
    await db.update('stock_items', { ...fields, updated_at: new Date() }, 'id', id);
  }

  /** Vrai si l'article a déjà du stock ou des mouvements (certaines propriétés deviennent figées) */
  async hasMovements(id) {
    return !!(await db.one('SELECT 1 AS ok FROM stock_movements WHERE stock_item_id = $1 LIMIT 1', [id]));
  }
}

module.exports = new StockItemModel();
