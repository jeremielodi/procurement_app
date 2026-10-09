// backend/src/services/StockValuationService.js
// Valorisation du stock au coût moyen unitaire pondéré (CMUP), par article et pour toute l'entreprise (tous dépôts),
// recalculée à partir du journal des mouvements (immuable) dans l'ordre chronologique :
//  - entrée avec coût (réception au prix du PO, OPENING / RETURN… s'ils portent un coût) :
//      CMUP = (quantité × CMUP + quantité entrée × coût) / (quantité + quantité entrée)
//  - annulation de réception (RECEIPT_REVERSAL, au coût de la réception) : retire sa valeur
//  - transferts entre dépôts : sans effet sur la quantité totale ni sur le coût (le stock en transit reste compté dans le
//    total de l'entreprise, pas dans celui d'un dépôt) ; la perte en transit (expédié − reçu) sort au CMUP à la réception
//  - autres sorties (ISSUE, ADJUSTMENT_OUT…) : au CMUP courant ; autres entrées sans coût (retour, ajustement) : au CMUP courant
// Devise : celle des réceptions. Un article reçu dans plusieurs devises n'est pas valorisé (pas de taux de change) ;
// un article sans aucun coût connu (stock initial, ajustements) non plus.
const db = require('../config/database');
const tenant = require('../utils/tenant');

const EPS = 1e-9;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

class StockValuationService {
  /**
   * @param {object} opts { asOf (date ISO, inclus), categoryId, warehouseId (répartition : valeur = quantité du dépôt × CMUP) }
   * @returns {{ items: Array, totals: Array<{ currency, value }>, notValued: number, mixedCurrency: number, asOf }}
   */
  async valuation({ asOf, categoryId, warehouseId } = {}) {
    const params = [];
    let where = `WHERE si.is_stockable${tenant.filter('si.enterprise_id', params)}`;
    if (categoryId) { params.push(categoryId); where += ` AND si.category_id = $${params.length}`; }
    const items = await db.select(
      `SELECT si.id, si.code, si.name, si.unit, si.category_id FROM stock_items si ${where} ORDER BY si.name`,
      params
    );
    if (!items.length) return { items: [], totals: [], notValued: 0, mixedCurrency: 0, asOf: asOf || null };

    const mParams = [items.map(i => i.id)];
    let mWhere = 'WHERE m.stock_item_id = ANY($1::uuid[])';
    let lWhere = "WHERE il.stock_item_id = ANY($1::uuid[]) AND s.destination_type = 'WAREHOUSE' AND s.acknowledged_at IS NOT NULL AND il.received_quantity < il.quantity";
    if (asOf) {
      mParams.push(asOf);
      mWhere += ` AND m.performed_at < ($${mParams.length}::date + 1)`;
      lWhere += ` AND s.acknowledged_at < ($${mParams.length}::date + 1)`;
    }
    const movements = await db.select(
      `SELECT * FROM (
         SELECT m.stock_item_id, m.warehouse_id, m.movement_type, m.quantity::float8 AS quantity,
                m.unit_cost::float8 AS unit_cost, c.format_key AS currency, m.performed_at AS at, m.movement_number AS seq
         FROM stock_movements m LEFT JOIN currency c ON c.id = m.currency_id
         ${mWhere}
         UNION ALL
         SELECT il.stock_item_id, NULL, 'TRANSIT_LOSS', -(il.quantity - il.received_quantity)::float8, NULL, NULL, s.acknowledged_at, s.issue_number
         FROM stock_issue_lines il JOIN stock_issues s ON s.id = il.issue_id
         ${lWhere}
       ) x ORDER BY at, seq`,
      mParams
    );

    const state = new Map(items.map(i => [i.id, { qty: 0, avg: 0, currency: null, currencies: new Set(), costed: false, byWarehouse: new Map() }]));
    for (const m of movements) {
      const s = state.get(m.stock_item_id);
      const q = num(m.quantity);
      if (m.warehouse_id) s.byWarehouse.set(m.warehouse_id, (s.byWarehouse.get(m.warehouse_id) || 0) + q);
      if (m.movement_type === 'TRANSFER_IN' || m.movement_type === 'TRANSFER_OUT') continue; // déplacement interne
      const hasCost = m.unit_cost !== null && m.unit_cost !== undefined;
      if (hasCost && m.currency) { s.currencies.add(m.currency); s.currency = s.currency || m.currency; }
      if (q > 0) {
        if (hasCost) {
          const total = s.qty + q;
          s.avg = total > EPS ? (Math.max(s.qty, 0) * s.avg + q * num(m.unit_cost)) / total : num(m.unit_cost);
          s.costed = true;
        }
        s.qty += q;
      } else {
        // Annulation de réception : retire la valeur à son propre coût ; les autres sorties au CMUP
        if (m.movement_type === 'RECEIPT_REVERSAL' && hasCost && s.qty + q > EPS) {
          s.avg = (s.qty * s.avg + q * num(m.unit_cost)) / (s.qty + q);
        }
        s.qty += q;
        if (s.qty <= EPS) { s.qty = 0; }
      }
    }

    const rows = [];
    const totals = new Map();
    let notValued = 0, mixedCurrency = 0;
    for (const it of items) {
      const s = state.get(it.id);
      const qty = warehouseId ? Math.max(s.byWarehouse.get(warehouseId) || 0, 0) : Math.max(s.qty, 0);
      if (qty <= EPS) continue;
      const mixed = s.currencies.size > 1;
      const valued = s.costed && !mixed;
      const value = valued ? round(qty * s.avg, 2) : null;
      if (mixed) mixedCurrency++; else if (!valued) notValued++;
      if (valued) totals.set(s.currency, (totals.get(s.currency) || 0) + value);
      rows.push({
        stock_item_id: it.id, code: it.code, name: it.name, unit: it.unit,
        quantity: round(qty), average_cost: valued ? round(s.avg) : null, value, currency: valued ? s.currency : null,
        status: mixed ? 'MIXED_CURRENCY' : valued ? 'VALUED' : 'NO_COST',
        currencies: [...s.currencies],
      });
    }
    rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.name.localeCompare(b.name));
    return {
      items: rows,
      totals: [...totals.entries()].map(([currency, value]) => ({ currency, value: round(value, 2) })),
      notValued, mixedCurrency, asOf: asOf || null,
    };
  }
}

module.exports = new StockValuationService();
