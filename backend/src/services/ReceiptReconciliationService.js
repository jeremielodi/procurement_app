// backend/src/services/ReceiptReconciliationService.js
// Rapprochement « réceptions ↔ stock » pour l'auditeur : une ligne par ligne de bon de réception (GRN), comparée aux
// mouvements de stock qu'elle a produits (source_type 'GRN', source_line_id = ligne du GRN) :
//   attendu en stock = quantité ACCEPTÉE si l'article du catalogue est stockable (sinon rien : prestation, texte libre)
//   entré = somme des mouvements RECEIPT ; repris = somme des RECEIPT_REVERSAL (annulation du GRN)
// Contrôles (code → anomalie si severity 'error') :
//   OK, NOT_STOCKABLE (info), CANCELLED_REVERSED (info : GRN annulé, entrée reprise)
//   MISSING_ENTRY (stockable accepté sans entrée), QTY_MISMATCH (entré ≠ accepté), WAREHOUSE_MISMATCH (autre dépôt que
//   celui du GRN), LOT_MISMATCH (autre lot), COST_MISMATCH (coût ≠ prix du bon de commande), UNEXPECTED_ENTRY (entrée
//   pour un article non stockable / ligne refusée), CANCELLED_NOT_REVERSED (GRN annulé mais stock non repris),
//   SERIAL_MISMATCH (nombre d'unités enregistrées ≠ quantité acceptée pour un équipement suivi par n° de série)
const ExcelJS = require('exceljs');
const db = require('../config/database');
const tenant = require('../utils/tenant');

const EPS = 1e-6;
const COST_TOLERANCE = 0.01;
const ERROR_CODES = ['MISSING_ENTRY', 'QTY_MISMATCH', 'WAREHOUSE_MISMATCH', 'LOT_MISMATCH', 'COST_MISMATCH',
  'UNEXPECTED_ENTRY', 'CANCELLED_NOT_REVERSED', 'SERIAL_MISMATCH'];
const isoDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));
const n = (v) => (v === null || v === undefined ? 0 : Number(v));

class ReceiptReconciliationService {
  /** Lignes de réception de l'entreprise courante avec leurs mouvements de stock agrégés */
  async rows({ fromDate, toDate, warehouseId, search } = {}) {
    const params = [];
    let where = `WHERE 1=1${tenant.filter('g.enterprise_id', params)}`;
    if (isoDate(fromDate)) { params.push(fromDate); where += ` AND g.receipt_date >= $${params.length}::date`; }
    if (isoDate(toDate)) { params.push(toDate); where += ` AND g.receipt_date <= $${params.length}::date`; }
    if (warehouseId) { params.push(warehouseId); where += ` AND g.warehouse_id = $${params.length}`; }
    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const p = `$${params.length}`;
      where += ` AND (g.grn_number ILIKE ${p} OR po.po_number ILIKE ${p} OR si.code ILIKE ${p} OR si.name ILIKE ${p} OR gi.item_description ILIKE ${p} OR s.name ILIKE ${p})`;
    }
    return db.select(
      `WITH mv AS (
         SELECT m.source_line_id,
                SUM(m.quantity) FILTER (WHERE m.movement_type = 'RECEIPT')::float8 AS entered,
                ABS(COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type = 'RECEIPT_REVERSAL'), 0))::float8 AS reversed,
                COUNT(*) FILTER (WHERE m.movement_type = 'RECEIPT')::int AS receipt_movements,
                COUNT(DISTINCT m.warehouse_id) FILTER (WHERE m.movement_type = 'RECEIPT')::int AS warehouses,
                (ARRAY_AGG(m.warehouse_id::text) FILTER (WHERE m.movement_type = 'RECEIPT'))[1] AS mv_warehouse_id,
                BOOL_OR(m.movement_type = 'RECEIPT' AND m.lot_id IS DISTINCT FROM gi2.lot_id) AS lot_differs,
                MIN(m.unit_cost) FILTER (WHERE m.movement_type = 'RECEIPT')::float8 AS min_cost,
                MAX(m.unit_cost) FILTER (WHERE m.movement_type = 'RECEIPT')::float8 AS max_cost,
                STRING_AGG(DISTINCT m.movement_number, ', ') FILTER (WHERE m.movement_type = 'RECEIPT') AS movement_numbers,
                STRING_AGG(DISTINCT m.movement_number, ', ') FILTER (WHERE m.movement_type = 'RECEIPT_REVERSAL') AS reversal_numbers
         FROM stock_movements m
         JOIN goods_receipt_items gi2 ON gi2.id::text = m.source_line_id
         WHERE m.source_type = 'GRN'
         GROUP BY m.source_line_id
       ),
       units AS (
         SELECT su.grn_item_id, COUNT(*)::int AS unit_count FROM stock_units su WHERE su.grn_item_id IS NOT NULL GROUP BY su.grn_item_id
       )
       SELECT gi.id AS line_id, g.id AS grn_id, g.grn_number, g.receipt_date, g.status AS grn_status,
              po.id AS po_id, po.po_number, s.name AS supplier_name, cur.format_key AS currency,
              w.code AS warehouse_code, w.name AS warehouse_name, g.warehouse_id,
              mw.code AS mv_warehouse_code,
              gi.item_description, si.code AS item_code, si.name AS item_name, si.unit, si.is_stockable, si.track_serials,
              lt.lot_number,
              gi.quantity_received::float8 AS received, gi.quantity_accepted::float8 AS accepted, gi.quantity_rejected::float8 AS rejected,
              poi.unit_price::float8 AS po_price,
              COALESCE(mv.entered, 0) AS entered, COALESCE(mv.reversed, 0) AS reversed,
              COALESCE(mv.receipt_movements, 0) AS receipt_movements, mv.warehouses, mv.mv_warehouse_id, mv.lot_differs,
              mv.min_cost, mv.max_cost, mv.movement_numbers, mv.reversal_numbers,
              un.unit_count
       FROM goods_receipt_items gi
       JOIN goods_receipt_notes g ON g.id = gi.grn_id
       LEFT JOIN purchase_orders po ON po.id = g.po_id
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN currency cur ON cur.id = po.currency_id
       LEFT JOIN purchase_order_items poi ON poi.id = gi.po_item_id
       LEFT JOIN stock_items si ON si.id = gi.stock_item_id
       LEFT JOIN stock_lots lt ON lt.id = gi.lot_id
       LEFT JOIN warehouses w ON w.id = g.warehouse_id
       LEFT JOIN mv ON mv.source_line_id = gi.id::text
       LEFT JOIN warehouses mw ON mw.id::text = mv.mv_warehouse_id
       LEFT JOIN units un ON un.grn_item_id = gi.id
       ${where}
       ORDER BY g.receipt_date DESC, g.grn_number DESC, gi.id`,
      params
    );
  }

  /** Contrôles d'une ligne → { expected, net, checks: [codes], status: code principal, severity } */
  classify(r) {
    const stockable = !!(r.item_code && r.is_stockable);
    const cancelled = r.grn_status === 'CANCELLED';
    // Réception annulée : plus rien ne doit rester en stock (tout repris par écriture inverse)
    const expected = stockable && !cancelled ? n(r.accepted) : 0;
    const entered = n(r.entered);
    const reversed = n(r.reversed);
    const net = entered - reversed;
    const checks = [];

    if (cancelled) {
      if (net > EPS) checks.push('CANCELLED_NOT_REVERSED');
    } else if (!stockable) {
      if (entered > EPS) checks.push('UNEXPECTED_ENTRY');
    } else {
      if (expected > EPS && entered <= EPS) checks.push('MISSING_ENTRY');
      else if (Math.abs(entered - expected) > EPS) checks.push(expected <= EPS ? 'UNEXPECTED_ENTRY' : 'QTY_MISMATCH');
      if (reversed > EPS) checks.push('QTY_MISMATCH'); // écriture inverse sur un GRN non annulé
    }
    if (entered > EPS) {
      if (r.warehouse_id && (n(r.warehouses) > 1 || (r.mv_warehouse_id && r.mv_warehouse_id !== r.warehouse_id))) checks.push('WAREHOUSE_MISMATCH');
      if (r.lot_differs && !r.track_serials) checks.push('LOT_MISMATCH');
      if (r.po_price !== null && r.po_price !== undefined
        && (Math.abs(n(r.min_cost) - n(r.po_price)) > COST_TOLERANCE || Math.abs(n(r.max_cost) - n(r.po_price)) > COST_TOLERANCE)) {
        checks.push('COST_MISMATCH');
      }
      if (r.track_serials && !cancelled && Math.abs(n(r.unit_count) - expected) > EPS) checks.push('SERIAL_MISMATCH');
    }
    const errors = [...new Set(checks)];
    const status = errors[0] || (cancelled ? 'CANCELLED_REVERSED' : !stockable ? 'NOT_STOCKABLE' : 'OK');
    return { expected, net, checks: errors, status, severity: errors.length ? 'error' : status === 'OK' ? 'ok' : 'info' };
  }

  /** Rapport : lignes contrôlées + synthèse */
  async report({ fromDate, toDate, warehouseId, search, onlyIssues } = {}) {
    const rows = (await this.rows({ fromDate, toDate, warehouseId, search })).map(r => ({ ...r, ...this.classify(r) }));
    const summary = { lines: rows.length, grns: new Set(rows.map(r => r.grn_id)).size, ok: 0, info: 0, errors: 0, byCode: {} };
    for (const r of rows) {
      summary[r.severity === 'error' ? 'errors' : r.severity]++;
      for (const code of (r.checks.length ? r.checks : [r.status])) summary.byCode[code] = (summary.byCode[code] || 0) + 1;
    }
    const filtered = ['1', 'true', true].includes(onlyIssues) ? rows.filter(r => r.severity === 'error') : rows;
    return { summary, rows: filtered };
  }

  /** Classeur Excel : synthèse + détail (une ligne par ligne de réception) */
  async workbook(filters, T) {
    const { summary, rows } = await this.report(filters);
    const label = (prefix, code) => { const k = `${prefix}.${code}`; const v = T(k); return v === k ? code : v; };
    const wb = new ExcelJS.Workbook();
    wb.creator = 'procureApp';
    wb.created = new Date();

    const s = wb.addWorksheet(T('receiptRecon.sheetSummary'));
    s.columns = [{ width: 48 }, { width: 14 }];
    s.addRow([T('receiptRecon.title')]).font = { bold: true, size: 14 };
    s.addRow([T('receiptRecon.period', { from: filters.fromDate || '—', to: filters.toDate || '—' })]);
    s.addRow([]);
    for (const [k, v] of [['lines', summary.lines], ['grns', summary.grns], ['ok', summary.ok], ['info', summary.info], ['errors', summary.errors]]) {
      s.addRow([T(`receiptRecon.summary.${k}`), v]);
    }
    s.addRow([]);
    s.addRow([T('receiptRecon.summary.byCode')]).font = { bold: true };
    for (const [code, count] of Object.entries(summary.byCode).sort((a, b) => b[1] - a[1])) {
      const row = s.addRow([label('receiptRecon.code', code), count]);
      if (ERROR_CODES.includes(code)) row.font = { color: { argb: 'FFB91C1C' } };
    }

    const d = wb.addWorksheet(T('receiptRecon.sheetDetail'), { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = [
      ['status', 26], ['checks', 40], ['grn', 16], ['date', 12], ['po', 16], ['supplier', 24], ['warehouse', 18], ['item', 30],
      ['lot', 14], ['unit', 8], ['received', 11], ['accepted', 11], ['rejected', 11], ['expected', 12], ['entered', 11],
      ['reversed', 11], ['net', 11], ['poPrice', 12], ['stockCost', 12], ['currency', 9], ['movements', 30], ['reversals', 24],
    ];
    d.columns = cols.map(([key, width]) => ({ header: T(`receiptRecon.col.${key}`), key, width }));
    d.getRow(1).font = { bold: true };
    d.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    for (const r of rows) {
      const row = d.addRow({
        status: label('receiptRecon.code', r.status),
        checks: r.checks.map(c => label('receiptRecon.code', c)).join(' · '),
        grn: r.grn_number, date: r.receipt_date ? new Date(`${r.receipt_date}T12:00:00`) : null, po: r.po_number, supplier: r.supplier_name,
        warehouse: r.warehouse_code || '', item: [r.item_code, r.item_name || r.item_description].filter(Boolean).join(' — '),
        lot: r.lot_number || '', unit: r.unit || '', received: n(r.received), accepted: n(r.accepted), rejected: n(r.rejected),
        expected: r.expected, entered: n(r.entered), reversed: n(r.reversed), net: r.net,
        poPrice: r.po_price ?? null, stockCost: r.min_cost ?? null, currency: r.currency || '',
        movements: r.movement_numbers || '', reversals: r.reversal_numbers || '',
      });
      row.getCell('date').numFmt = 'dd/mm/yyyy';
      if (r.severity === 'error') row.getCell('status').font = { bold: true, color: { argb: 'FFB91C1C' } };
    }
    d.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    return wb;
  }
}

module.exports = new ReceiptReconciliationService();
module.exports.ERROR_CODES = ERROR_CODES;
