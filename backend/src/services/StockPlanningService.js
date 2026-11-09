// backend/src/services/StockPlanningService.js
// Prévision du réapprovisionnement (migration 55) : par article × dépôt, ou total de l'entreprise par article.
// Règles de calcul : utils/stockPlanning.js. Données lues à la demande (aucune table de cumul) :
//  - stock = soldes actuels (stock_balances, tous lots et projets) ; consommation et jours de rupture = journal des mouvements
//  - en commande = reste à livrer des bons de commande actifs (hors rejetés / annulés, reliquat non soldé) ; le dépôt est celui
//    de la ligne de réquisition (destination_warehouse_id), sinon la commande ne compte que dans le total de l'entreprise
//  - demandé = lignes des réquisitions en cours (ni brouillon, ni rejetée, ni annulée, ni terminée) pas encore commandées
// Cloisonné par entreprise (tenant.filter) ; hors requête HTTP, paramètres par défaut.
const ExcelJS = require('exceljs');
const db = require('../config/database');
const tenant = require('../utils/tenant');
const { localizedSql } = require('../utils/requestLang');
const rules = require('../utils/stockPlanning');

const DEFAULTS = { amcMonths: 6, safetyMonths: 2, orderIntervalMonths: 1, leadTimeDays: 30 };
const INACTIVE_PO = ['PO_REJECTED', 'PO_CANCELLED', 'CANCELLED', 'REJECTED'];
const CLOSED_REQUISITION = ['DRAFT', 'CANCELLED', 'REJECTED', 'COMPLETED'];
const CONSUMPTION_TYPES = ['ISSUE', 'ISSUE_REVERSAL', 'RETURN'];
const key = (itemId, warehouseId) => `${itemId}|${warehouseId || ''}`;
// Dépôt de la sortie d'origine d'un retour (le mouvement RETURN porte la ligne du bon de sortie dans source_line_id)
const ORIGIN_WAREHOUSE_SQL = `CASE WHEN m.movement_type = 'RETURN' THEN (
  SELECT s.warehouse_id FROM stock_issue_lines il JOIN stock_issues s ON s.id = il.issue_id WHERE il.id::text = m.source_line_id) END`;

function fail(status, code, message, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details) err.details = details;
  return err;
}

class StockPlanningService {
  /** Paramètres de l'entreprise courante (ou valeurs par défaut) */
  async settings(enterpriseId = tenant.enterpriseId()) {
    if (!enterpriseId) return { ...DEFAULTS };
    const row = await db.one(
      `SELECT stock_amc_months, stock_safety_months::float8 AS safety, stock_order_interval_months::float8 AS interval,
              stock_lead_time_days FROM enterprise WHERE id = $1`,
      [enterpriseId]
    );
    if (!row) return { ...DEFAULTS };
    return { amcMonths: row.stock_amc_months, safetyMonths: row.safety, orderIntervalMonths: row.interval, leadTimeDays: row.stock_lead_time_days };
  }

  async saveSettings(enterpriseId, body) {
    const s = rules.parseSettings(body);
    await db.exec(
      `UPDATE enterprise SET stock_amc_months = $2, stock_safety_months = $3, stock_order_interval_months = $4, stock_lead_time_days = $5,
              last_update = CURRENT_TIMESTAMP WHERE id = $1`,
      [enterpriseId, s.amcMonths, s.safetyMonths, s.orderIntervalMonths, s.leadTimeDays]
    );
    return this.settings(enterpriseId);
  }

  /**
   * Dépôts de destination des lignes d'une réquisition : article du catalogue obligatoire, dépôt actif de l'entreprise.
   * 400 DESTINATION_NEEDS_ITEM / DESTINATION_WAREHOUSE_INVALID (+ details.line)
   */
  async checkDestinations(items, enterpriseId) {
    for (const [line, it] of (items || []).entries()) {
      if (!it?.destinationWarehouseId) continue;
      if (!it.stockItemId) throw fail(400, 'DESTINATION_NEEDS_ITEM', 'Un dépôt de destination demande un article du catalogue', { line });
      const wh = await db.one('SELECT id FROM warehouses WHERE id::text = $1 AND enterprise_id = $2 AND is_active', [String(it.destinationWarehouseId), enterpriseId]);
      if (!wh) throw fail(400, 'DESTINATION_WAREHOUSE_INVALID', 'Dépôt de destination introuvable ou inactif', { line });
    }
  }

  /**
   * Prévision. level 'enterprise' = une ligne par article ; sinon une ligne par article × dépôt (warehouseId : un seul dépôt).
   * Filtres : categoryId, search, stockItemId, status (après calcul ; counts = avant ce filtre)
   * → { level, settings, periodStart, rows, counts }
   */
  async plan({ level, warehouseId, categoryId, search, stockItemId, status, now = new Date() } = {}) {
    const enterprise = level === 'enterprise';
    const settings = await this.settings();
    const periodStart = new Date(now);
    periodStart.setMonth(periodStart.getMonth() - settings.amcMonths);

    const iParams = [];
    let iWhere = `WHERE si.is_active AND si.is_stockable${tenant.filter('si.enterprise_id', iParams)}`;
    if (categoryId) { iParams.push(categoryId); iWhere += ` AND si.category_id = $${iParams.length}`; }
    if (stockItemId) { iParams.push(String(stockItemId)); iWhere += ` AND si.id::text = $${iParams.length}`; }
    if (search) {
      iParams.push(`%${String(search).trim()}%`);
      iWhere += ` AND (si.code ILIKE $${iParams.length} OR si.name ILIKE $${iParams.length})`;
    }
    const items = await db.select(
      `SELECT si.id, si.code, si.name, si.unit, si.unit_id, si.track_lots, si.track_serials, si.is_stockable,
              si.min_quantity::float8 AS min_quantity, si.reorder_quantity::float8 AS reorder_quantity, si.lead_time_days,
              ${localizedSql('mc')} AS category_name
       FROM stock_items si LEFT JOIN market_categories mc ON mc.id = si.category_id
       ${iWhere} ORDER BY si.name`,
      iParams
    );
    const wParams = [];
    let wWhere = `WHERE w.is_active${tenant.filter('w.enterprise_id', wParams)}`;
    if (warehouseId && !enterprise) { wParams.push(String(warehouseId)); wWhere += ` AND w.id::text = $${wParams.length}`; }
    const warehouses = await db.select(
      `SELECT w.id, w.code, w.name, w.safety_stock_months::float8 AS safety_stock_months FROM warehouses w ${wWhere} ORDER BY w.name`,
      wParams
    );
    const empty = { level: enterprise ? 'enterprise' : 'warehouse', settings, periodStart, rows: [], counts: this.countBy([]) };
    if (!items.length || !warehouses.length) return empty;

    const itemIds = items.map(i => i.id);
    const whIds = warehouses.map(w => w.id);
    const [balances, opening, movements, onOrder, requested] = await Promise.all([
      db.select(
        `SELECT stock_item_id, warehouse_id, SUM(quantity)::float8 AS qty FROM stock_balances
         WHERE stock_item_id = ANY($1::uuid[]) AND warehouse_id = ANY($2::uuid[]) GROUP BY stock_item_id, warehouse_id`,
        [itemIds, whIds]),
      db.select(
        `SELECT stock_item_id, warehouse_id, SUM(quantity)::float8 AS qty FROM stock_movements
         WHERE stock_item_id = ANY($1::uuid[]) AND warehouse_id = ANY($2::uuid[]) AND performed_at < $3
         GROUP BY stock_item_id, warehouse_id`,
        [itemIds, whIds, periodStart]),
      // Retours : aussi ceux rendus dans un dépôt hors filtre (ils réduisent la consommation du dépôt de la sortie)
      db.select(
        `SELECT m.stock_item_id, m.warehouse_id, m.movement_type AS type, m.quantity::float8 AS quantity, m.performed_at AS at,
                ${ORIGIN_WAREHOUSE_SQL} AS origin_warehouse_id
         FROM stock_movements m
         WHERE m.stock_item_id = ANY($1::uuid[]) AND (m.warehouse_id = ANY($2::uuid[]) OR m.movement_type = 'RETURN')
           AND m.performed_at >= $3
         ORDER BY m.performed_at, m.movement_number`,
        [itemIds, whIds, periodStart]),
      this.onOrder(itemIds),
      this.requested(itemIds),
    ]);

    const whSet = new Set(whIds);
    const byPair = new Map();
    const pair = (itemId, whId) => {
      const k = key(itemId, whId);
      if (!byPair.has(k)) byPair.set(k, { stock: 0, opening: 0, hasHistoryBefore: false, movements: [], onOrder: 0, requested: 0 });
      return byPair.get(k);
    };
    for (const b of balances) pair(b.stock_item_id, b.warehouse_id).stock = b.qty;
    for (const o of opening) Object.assign(pair(o.stock_item_id, o.warehouse_id), { opening: o.qty, hasHistoryBefore: true });
    for (const m of movements) {
      // Retour rendu ailleurs que dans le dépôt de la sortie : le stock revient dans ce dépôt-ci, la consommation
      // diminue dans le dépôt d'où l'article était sorti
      const elsewhere = m.type === 'RETURN' && m.origin_warehouse_id && m.origin_warehouse_id !== m.warehouse_id;
      if (whSet.has(m.warehouse_id)) pair(m.stock_item_id, m.warehouse_id).movements.push(elsewhere ? { ...m, consumed: 0 } : m);
      if (elsewhere && whSet.has(m.origin_warehouse_id)) {
        pair(m.stock_item_id, m.origin_warehouse_id).movements.push({ at: m.at, type: m.type, quantity: 0, consumed: -m.quantity });
      }
    }
    // Totaux de l'entreprise : aussi les commandes / demandes sans dépôt de destination (ou vers un dépôt hors filtre)
    const itemOnOrder = new Map(), itemRequested = new Map();
    for (const o of onOrder) {
      itemOnOrder.set(o.stock_item_id, (itemOnOrder.get(o.stock_item_id) || 0) + o.qty);
      if (o.warehouse_id && whSet.has(o.warehouse_id)) pair(o.stock_item_id, o.warehouse_id).onOrder += o.qty;
    }
    for (const r of requested) {
      itemRequested.set(r.stock_item_id, (itemRequested.get(r.stock_item_id) || 0) + r.qty);
      if (r.warehouse_id && whSet.has(r.warehouse_id)) pair(r.stock_item_id, r.warehouse_id).requested += r.qty;
    }

    const base = (it) => ({
      stockItemId: it.id, code: it.code, name: it.name, unit: it.unit, unitId: it.unit_id, categoryName: it.category_name,
      trackLots: it.track_lots, trackSerials: it.track_serials, minQuantity: it.min_quantity, reorderQuantity: it.reorder_quantity,
    });
    const pairRows = [];
    for (const it of items) {
      const leadTimeDays = it.lead_time_days ?? settings.leadTimeDays;
      for (const w of warehouses) {
        const p = byPair.get(key(it.id, w.id));
        if (!p) continue;
        const stats = rules.consumptionStats({ openingBalance: p.opening, hasHistoryBefore: p.hasHistoryBefore, movements: p.movements, periodStart, now });
        const safetyMonths = w.safety_stock_months ?? settings.safetyMonths;
        const plan = rules.planRow({ amc: stats.amc, stock: p.stock, onOrder: p.onOrder, requested: p.requested, safetyMonths, leadTimeDays, intervalMonths: settings.orderIntervalMonths });
        pairRows.push({
          ...base(it), warehouseId: w.id, warehouseCode: w.code, warehouseName: w.name,
          stock: rules.round(p.stock, 4), onOrder: rules.round(p.onOrder, 4), requested: rules.round(p.requested, 4),
          consumption: stats.consumption, amc: stats.amc, observedDays: stats.observedDays, stockoutDays: stats.stockoutDays,
          safetyMonths, leadTimeDays, intervalMonths: settings.orderIntervalMonths, basis: stats.amc > 0 ? 'AMC' : null, ...plan,
        });
      }
    }

    let rows;
    if (enterprise) {
      rows = [];
      for (const it of items) {
        const own = pairRows.filter(r => r.stockItemId === it.id);
        const stock = own.reduce((s, r) => s + r.stock, 0);
        const ordered = itemOnOrder.get(it.id) || 0;
        const asked = itemRequested.get(it.id) || 0;
        const amcRows = own.filter(r => r.amc > 0);
        let plan = amcRows.length ? { ...rules.aggregateRow(amcRows, { stock, onOrder: ordered, requested: asked }), basis: 'AMC' } : null;
        if (!plan) {
          const fb = rules.fallbackRow({ stock, onOrder: ordered, requested: asked, minQuantity: it.min_quantity, reorderQuantity: it.reorder_quantity });
          if (fb) plan = { ...fb, amc: 0, basis: 'MIN_QUANTITY' };
        }
        if (!plan) {
          if (!own.length && !ordered && !asked) continue; // jamais mouvementé, aucun seuil : rien à prévoir
          plan = { ...rules.planRow({ amc: 0, stock, onOrder: ordered, requested: asked }), amc: 0, basis: null };
        }
        rows.push({
          ...base(it), warehouseId: null, warehouseCode: null, warehouseName: null, warehouseCount: own.length,
          stock: rules.round(stock, 4), onOrder: rules.round(ordered, 4), requested: rules.round(asked, 4),
          consumption: rules.round(own.reduce((s, r) => s + r.consumption, 0), 4),
          stockoutDays: null, observedDays: null, safetyMonths: settings.safetyMonths, leadTimeDays: it.lead_time_days ?? settings.leadTimeDays,
          intervalMonths: settings.orderIntervalMonths, ...plan,
        });
      }
    } else {
      rows = pairRows;
    }

    const order = (s) => rules.STATUSES.indexOf(s);
    rows.sort((a, b) => order(a.status) - order(b.status) || a.name.localeCompare(b.name) || String(a.warehouseName || '').localeCompare(String(b.warehouseName || '')));
    const counts = this.countBy(rows);
    const statuses = status ? String(status).split(',').filter(s => rules.STATUSES.includes(s)) : [];
    if (statuses.length) rows = rows.filter(r => statuses.includes(r.status));
    return { level: enterprise ? 'enterprise' : 'warehouse', settings, periodStart, rows, counts };
  }

  countBy(rows) {
    const counts = Object.fromEntries(rules.STATUSES.map(s => [s, 0]));
    for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
    counts.total = rows.length;
    return counts;
  }

  /** Reste à livrer des bons de commande actifs, par article et dépôt de destination (null = sans dépôt) */
  async onOrder(itemIds) {
    const params = [itemIds, INACTIVE_PO];
    return db.select(
      `SELECT COALESCE(pi.stock_item_id, ri.stock_item_id) AS stock_item_id, ri.destination_warehouse_id AS warehouse_id,
              SUM(d.quantity_remaining)::float8 AS qty
       FROM purchase_order_items pi
       JOIN purchase_orders po ON po.id = pi.purchase_order_id
       JOIN v_po_item_delivery d ON d.po_item_id = pi.id
       LEFT JOIN requisition_items ri ON ri.id = pi.requisition_item_id
       WHERE COALESCE(pi.stock_item_id, ri.stock_item_id) = ANY($1::uuid[]) AND NOT (po.status = ANY($2::text[]))
         AND po.delivery_closed_at IS NULL AND d.quantity_remaining > 0${tenant.filter('po.enterprise_id', params)}
       GROUP BY 1, 2`,
      params
    );
  }

  /** Lignes de réquisitions en cours pas encore commandées (quantité × fréquence − commandé), par article et dépôt */
  async requested(itemIds) {
    const params = [itemIds, CLOSED_REQUISITION, INACTIVE_PO];
    return db.select(
      `SELECT ri.stock_item_id, ri.destination_warehouse_id AS warehouse_id,
              SUM(GREATEST(ri.quantity * COALESCE(ri.frequency, 1) - COALESCE(o.ordered, 0), 0))::float8 AS qty
       FROM requisition_items ri
       JOIN requisitions r ON r.id = ri.requisition_id
       LEFT JOIN LATERAL (
         SELECT SUM(pi.quantity) AS ordered FROM purchase_order_items pi JOIN purchase_orders po ON po.id = pi.purchase_order_id
         WHERE pi.requisition_item_id = ri.id AND NOT (po.status = ANY($3::text[]))
       ) o ON TRUE
       WHERE ri.stock_item_id = ANY($1::uuid[]) AND NOT (r.status = ANY($2::text[]))${tenant.filter('r.enterprise_id', params)}
       GROUP BY 1, 2
       HAVING SUM(GREATEST(ri.quantity * COALESCE(ri.frequency, 1) - COALESCE(o.ordered, 0), 0)) > 0`,
      params
    );
  }

  /**
   * Détail d'un article : prévision par dépôt + total, et consommation des 12 derniers mois (dépôt choisi ou tous)
   * → { item, warehouses, total, months: [{ month: 'AAAA-MM', consumption }] , settings }
   */
  async itemDetail(stockItemId, { warehouseId } = {}) {
    const [byWarehouse, total] = await Promise.all([
      this.plan({ stockItemId }),
      this.plan({ stockItemId, level: 'enterprise' }),
    ]);
    const params = [String(stockItemId), CONSUMPTION_TYPES];
    let where = `WHERE m.stock_item_id::text = $1 AND m.movement_type = ANY($2::text[])
                 AND m.performed_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'${tenant.filter('m.enterprise_id', params)}`;
    // Dépôt de la consommation : celui de la sortie (un retour compte pour le dépôt d'où l'article était sorti)
    if (warehouseId) { params.push(String(warehouseId)); where += ` AND COALESCE(${ORIGIN_WAREHOUSE_SQL}, m.warehouse_id)::text = $${params.length}`; }
    const rows = await db.select(
      `SELECT to_char(date_trunc('month', m.performed_at), 'YYYY-MM') AS month, SUM(-m.quantity)::float8 AS consumption
       FROM stock_movements m ${where} GROUP BY 1`,
      params
    );
    const found = new Map(rows.map(r => [r.month, r.consumption]));
    const months = [];
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 11);
    for (let i = 0; i < 12; i++) {
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ month, consumption: rules.round(Math.max(found.get(month) || 0, 0), 4) });
      d.setMonth(d.getMonth() + 1);
    }
    return { warehouses: byWarehouse.rows, total: total.rows[0] || null, months, settings: byWarehouse.settings, periodStart: byWarehouse.periodStart };
  }

  /** Excel de la prévision (mêmes filtres que plan) */
  async workbook(query, T) {
    const data = await this.plan(query);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'procureApp';
    const ws = wb.addWorksheet(T('stockPlanning.sheet'));
    const columns = [
      ['code', T('stockExport.code'), 16], ['name', T('stockExport.item'), 36], ['category', T('stockExport.category'), 24],
      ...(data.level === 'enterprise' ? [] : [['warehouse', T('stockExport.warehouse'), 24]]),
      ['status', T('stockPlanning.status'), 20], ['stock', T('stockPlanning.stock'), 12], ['amc', T('stockPlanning.amc'), 12],
      ['months', T('stockPlanning.monthsOfStock'), 12], ['safety', T('stockPlanning.safetyStock'), 12], ['min', T('stockPlanning.minStock'), 12],
      ['max', T('stockPlanning.maxStock'), 12], ['onOrder', T('stockPlanning.onOrder'), 12], ['requested', T('stockPlanning.requested'), 12],
      ['toOrder', T('stockPlanning.toOrder'), 14], ['unit', T('stockExport.unit'), 8], ['stockout', T('stockPlanning.stockoutDays'), 12],
      ['lead', T('stockPlanning.leadTimeDays'), 12],
    ];
    ws.columns = columns.map(([k, header, width]) => ({ key: k, header, width }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of data.rows) {
      const row = ws.addRow({
        code: r.code, name: r.name, category: r.categoryName || '', warehouse: r.warehouseName || '',
        status: T(`stockPlanning.statuses.${r.status}`), stock: r.stock, amc: r.amc, months: r.monthsOfStock, safety: r.safetyStock,
        min: r.minStock, max: r.maxStock, onOrder: r.onOrder, requested: r.requested, toOrder: r.toOrder, unit: r.unit,
        stockout: r.stockoutDays, lead: r.leadTimeDays,
      });
      if (['STOCKOUT', 'BELOW_SAFETY'].includes(r.status)) row.getCell('status').font = { color: { argb: 'FFDC2626' }, bold: true };
      if (r.toOrder > 0) row.getCell('toOrder').font = { bold: true };
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return wb;
  }
}

module.exports = new StockPlanningService();
module.exports.DEFAULTS = DEFAULTS;
