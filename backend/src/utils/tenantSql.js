// backend/src/utils/tenantSql.js
// Cloisonnement « mécanique » d'une requête SQL d'agrégation (tableau de bord) :
// chaque FROM/JOIN sur une table métier devient une sous-requête restreinte à l'entreprise courante,
// avec le même alias, sans réécrire la requête.
//   FROM requisitions r   →  FROM (SELECT * FROM requisitions WHERE enterprise_id = '<uuid>') r
//   FROM purchase_orders  →  FROM (SELECT * FROM purchase_orders WHERE enterprise_id = '<uuid>') purchase_orders
// Les fournisseurs (partagés) ne sont pas filtrés : leurs chiffres viennent des commandes/évaluations filtrées.
const db = require('../config/database');
const tenant = require('./tenant');

const SCOPED = {
  requisitions:             (e) => `enterprise_id = '${e}'`,
  purchase_orders:          (e) => `enterprise_id = '${e}'`,
  goods_receipt_notes:      (e) => `enterprise_id = '${e}'`,
  service_acceptance_notes: (e) => `enterprise_id = '${e}'`,
  invoices:                 (e) => `enterprise_id = '${e}'`,
  payments:                 (e) => `enterprise_id = '${e}'`,
  budget_allocations:       (e) => `enterprise_id = '${e}'`,
  departments:              (e) => `enterprise_id = '${e}'`,
  projects:                 (e) => `enterprise_id = '${e}'`,
  tenders:                  (e) => `enterprise_id = '${e}'`,
  supplier_evaluations:     (e) => `enterprise_id = '${e}'`,
  users:                    (e) => `enterprise_id = '${e}'`,
  requisition_items:        (e) => `requisition_id IN (SELECT id FROM requisitions WHERE enterprise_id = '${e}')`,
  sole_source_justifications: (e) => `requisition_id IN (SELECT id FROM requisitions WHERE enterprise_id = '${e}')`,
  workflow_history:         (e) => `entity_id IN (SELECT id FROM requisitions WHERE enterprise_id = '${e}')`,
};

const KEYWORDS = new Set(['where', 'group', 'order', 'left', 'right', 'inner', 'outer', 'full', 'join', 'on',
  'limit', 'offset', 'union', 'having', 'cross', 'natural', 'using', 'window', 'fetch', 'for', 'returning']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONE = '00000000-0000-0000-0000-000000000000';

function scopeSql(sql) {
  const store = tenant.current();
  if (!store) return sql; // hors requête HTTP (workers) : inchangé
  const e = store.enterpriseId && UUID_RE.test(store.enterpriseId) ? store.enterpriseId : NONE;
  const names = Object.keys(SCOPED).join('|');
  const re = new RegExp(`\\b(FROM|JOIN)(\\s+)(${names})\\b(?!\\s*\\()(\\s+(?:AS\\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?`, 'gi');
  return sql.replace(re, (m, kw, sp, table, aliasPart, alias) => {
    const t = table.toLowerCase();
    const sub = `(SELECT * FROM ${t} WHERE ${SCOPED[t](e)})`;
    if (alias && !KEYWORDS.has(alias.toLowerCase())) return `${kw}${sp}${sub} ${alias}`;
    return `${kw}${sp}${sub} ${t}${aliasPart || ''}`;
  });
}

// Même API que db.one / db.select, avec cloisonnement
const scopedDb = {
  one: (sql, params) => db.one(scopeSql(sql), params),
  select: (sql, params) => db.select(scopeSql(sql), params),
};

module.exports = { scopeSql, scopedDb };
