// backend/src/models/StockItemModel.js
// Catalogue d'articles d'une entreprise. Une ligne de réquisition / PO / GRN peut citer un article ;
// seuls les articles stockables entrent en stock à la réception.
const db = require('../config/database');
const tenant = require('../utils/tenant');
const { localizedSql } = require('../utils/requestLang');
const stockNature = require('../utils/stockNature');
const stockProject = require('../utils/stockProject');

// projectSql : soldes limités aux projets autorisés (stockProject.inlineFilter — migration 65)
const SELECT = (projectSql = '') => `
  SELECT si.*, ${localizedSql('mc')} AS category_name, mc.code AS category_code,
         ${localizedSql('un')} AS unit_name, -- unité du référentiel (si.unit = son abréviation, tenue par trigger)
         COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.stock_item_id = si.id${projectSql}), 0) AS stock_quantity
  FROM stock_items si
  LEFT JOIN market_categories mc ON mc.id = si.category_id
  LEFT JOIN units un ON un.id = si.unit_id`;

const COLUMNS = [
  ['code', 'code'], ['name', 'name'], ['description', 'description'], ['unitId', 'unit_id'], ['categoryId', 'category_id'],
  ['isStockable', 'is_stockable'], ['trackLots', 'track_lots'], ['trackExpiry', 'track_expiry'], ['trackSerials', 'track_serials'],
  ['minQuantity', 'min_quantity'], ['reorderQuantity', 'reorder_quantity'], ['leadTimeDays', 'lead_time_days'], ['assetCategory', 'asset_category'], ['isActive', 'is_active'],
  ['nature', 'nature'],
];

class StockItemModel {
  /** warehouseId : articles ayant du stock dans ce dépôt, quantité = celle du dépôt */
  async list({ search, categoryId, stockable, nature, warehouseId, activeOnly = false, belowMin = false, limit = 200, offset = 0 } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('si.enterprise_id', params)}`;
    let warehouseSql = '';
    if (warehouseId) {
      params.push(String(warehouseId));
      warehouseSql = ` AND b.warehouse_id::text = $${params.length}`;
      where += ` AND EXISTS (SELECT 1 FROM stock_balances wb WHERE wb.stock_item_id = si.id AND wb.warehouse_id::text = $${params.length} AND wb.quantity > 0)`;
    }
    if (activeOnly) where += ' AND si.is_active';
    if (categoryId) { params.push(categoryId); where += ` AND si.category_id = $${params.length}`; }
    if (stockable === true || stockable === 'true') where += ' AND si.is_stockable';
    if (stockable === false || stockable === 'false') where += ' AND NOT si.is_stockable';
    // Nature (migration 63) : filtre demandé, puis natures autorisées à l'utilisateur
    const wanted = stockNature.normalize(nature);
    if (wanted) { params.push(wanted); where += ` AND si.nature = $${params.length}`; }
    where += await stockNature.filter('si.nature', params);
    if (search) {
      params.push(`%${String(search).trim()}%`);
      where += ` AND (si.code ILIKE $${params.length} OR si.name ILIKE $${params.length} OR si.description ILIKE $${params.length})`;
    }
    let sql = `SELECT * FROM (${SELECT((await stockProject.inlineFilter('b.project_id')) + warehouseSql)} ${where}) x`;
    if (belowMin) sql += ' WHERE x.min_quantity IS NOT NULL AND x.stock_quantity < x.min_quantity';
    const total = (await db.one(`SELECT COUNT(*)::int AS n FROM (${sql}) t`, params)).n;
    params.push(Math.min(parseInt(limit) || 200, 1000), parseInt(offset) || 0);
    const rows = await db.select(`${sql} ORDER BY x.name LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows, total };
  }

  /** Autocomplétion (réquisition, GRN) : articles actifs, code ou désignation */
  async search(term, limit = 15, { restrictNature = false } = {}) {
    const params = [];
    let where = `WHERE si.is_active${tenant.filter('si.enterprise_id', params)}`;
    // Écrans du stock : natures autorisées seulement (réquisition, bon de commande : tout le catalogue)
    if (restrictNature) where += await stockNature.filter('si.nature', params);
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
    return db.one(`${SELECT(await stockProject.inlineFilter('b.project_id'))} WHERE si.id = $1`, [id]);
  }

  /** Articles de l'entreprise courante par code (import Excel de réquisition) */
  async findByCodes(codes) {
    const list = [...new Set((codes || []).map(c => String(c).trim().toUpperCase()).filter(Boolean))];
    if (!list.length) return [];
    const params = [list];
    return db.select(
      `SELECT id, code, name, unit, unit_id, is_stockable, is_active FROM stock_items si
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
