// backend/src/services/GlobalSearchService.js
// Recherche globale de l'en-tête : réquisitions, bons de commande, réceptions, factures, fournisseurs, appels d'offres,
// articles du stock — par numéro, titre, nom ou code. Chaque groupe n'est interrogé que si l'utilisateur a la
// permission de la liste correspondante ; résultats cloisonnés par entreprise (sauf fournisseurs, communs).
const db = require('../config/database');
const tenant = require('../utils/tenant');
const userModel = require('../models/UserModel');

const PER_GROUP = 5;
const escapeLike = (s) => s.replace(/[\\%_]/g, c => '\\' + c);

// [groupe, permission, requête(paramètres) → lignes { id, label, sublabel }, lien]
const GROUPS = [
  ['requisitions', 'VIEW_REQUISITIONS', (p) => `
    SELECT r.id, r.requisition_number AS label, r.title AS sublabel, r.status
    FROM requisitions r
    WHERE (r.requisition_number ILIKE $1 OR r.title ILIKE $1)${tenant.filter('r.enterprise_id', p)}
    ORDER BY r.created_at DESC LIMIT ${PER_GROUP}`, (r) => `/requisitions/${r.id}`],
  ['purchaseOrders', 'VIEW_PURCHASE_ORDERS', (p) => `
    SELECT po.id, po.po_number AS label, s.name AS sublabel, po.status
    FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE (po.po_number ILIKE $1 OR s.name ILIKE $1)${tenant.filter('po.enterprise_id', p)}
    ORDER BY po.created_at DESC LIMIT ${PER_GROUP}`, (r) => `/purchase-orders/${r.id}`],
  ['goodsReceipts', 'VIEW_PURCHASE_ORDERS', (p) => `
    SELECT g.id, g.grn_number AS label, po.po_number AS sublabel, g.status
    FROM goods_receipt_notes g LEFT JOIN purchase_orders po ON po.id = g.po_id
    WHERE (g.grn_number ILIKE $1 OR po.po_number ILIKE $1)${tenant.filter('g.enterprise_id', p)}
    ORDER BY g.created_at DESC LIMIT ${PER_GROUP}`, (r) => `/goods-receipts/${r.id}`],
  ['invoices', 'VIEW_PURCHASE_ORDERS', (p) => `
    SELECT i.id, i.invoice_number AS label, po.po_number AS sublabel, i.status
    FROM invoices i LEFT JOIN purchase_orders po ON po.id = i.po_id
    WHERE (i.invoice_number ILIKE $1 OR po.po_number ILIKE $1)${tenant.filter('i.enterprise_id', p)}
    ORDER BY i.created_at DESC LIMIT ${PER_GROUP}`, (r) => `/invoices/${r.id}`],
  ['suppliers', 'VIEW_SUPPLIERS', () => `
    SELECT s.id, s.name AS label, COALESCE(s.supplier_code, s.email) AS sublabel, NULL AS status
    FROM suppliers s
    WHERE s.name ILIKE $1 OR s.supplier_code ILIKE $1 OR s.email ILIKE $1
    ORDER BY s.name LIMIT ${PER_GROUP}`, (r) => `/suppliers/${r.id}`],
  ['tenders', 'MANAGE_TENDERS', (p) => `
    SELECT t.id, t.tender_number AS label, t.title AS sublabel, t.status
    FROM tenders t
    WHERE (t.tender_number ILIKE $1 OR t.title ILIKE $1)${tenant.filter('t.enterprise_id', p)}
    ORDER BY t.created_at DESC LIMIT ${PER_GROUP}`, (r) => `/tenders/${r.id}`],
  ['stockItems', 'VIEW_STOCK', (p) => `
    SELECT si.id, si.code AS label, si.name AS sublabel, NULL AS status
    FROM stock_items si
    WHERE (si.code ILIKE $1 OR si.name ILIKE $1)${tenant.filter('si.enterprise_id', p)}
    ORDER BY si.name LIMIT ${PER_GROUP}`, (r) => `/stock/items/${r.id}`],
];

class GlobalSearchService {
  /** @returns {Array<{ group, items: [{ id, label, sublabel, status, link }] }>} groupes non vides */
  async search(query, userId) {
    const q = String(query || '').trim().slice(0, 100);
    if (q.length < 2) return [];
    const permissions = new Set(await userModel.getUserPermissions(userId));
    const results = await Promise.all(GROUPS
      .filter(([, permission]) => permissions.has(permission))
      .map(async ([group, , sql, link]) => {
        const params = [`%${escapeLike(q)}%`];
        try {
          const rows = await db.select(sql(params), params);
          return { group, items: rows.map(r => ({ id: r.id, label: r.label, sublabel: r.sublabel, status: r.status, link: link(r) })) };
        } catch (error) {
          console.error(`Recherche globale (${group}) :`, error.message);
          return { group, items: [] };
        }
      }));
    return results.filter(r => r.items.length);
  }
}

module.exports = new GlobalSearchService();
