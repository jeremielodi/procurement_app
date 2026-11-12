// backend/src/utils/stockNature.js
// Nature des articles du catalogue (migration 63) : EQUIPMENT (bien durable) / CONSUMABLE — module Stock seulement
// (la réquisition garde tout le catalogue). Deux niveaux de permission par nature :
//   - VIEW_EQUIPMENT / VIEW_CONSUMABLES     : consultation (logistique, finance, auditeur, direction…)
//   - MANAGE_EQUIPMENT / MANAGE_CONSUMABLES : opérations (fiche article, entrées, sorties, retours, inventaires,
//     ajustements, réception en stock) ; « gérer » vaut aussi « voir ».
// Les natures sont calculées une fois par requête HTTP (contexte utils/tenant.js) ; hors requête (workers, scripts) et
// pour l'administrateur : aucune restriction.
// Document mixte (bon de sortie, d'entrée, inventaire…) : visible s'il a au moins une ligne VISIBLE, les autres lignes
// sont masquées (hidden_line_count) ; toute action sur le document exige de GÉRER toutes ses natures.
const db = require('../config/database');
const tenant = require('./tenant');
const stockProject = require('./stockProject');

const NATURES = ['EQUIPMENT', 'CONSUMABLE'];
const PERMISSIONS = {
  view: { EQUIPMENT: 'VIEW_EQUIPMENT', CONSUMABLE: 'VIEW_CONSUMABLES' },
  manage: { EQUIPMENT: 'MANAGE_EQUIPMENT', CONSUMABLE: 'MANAGE_CONSUMABLES' },
};

function normalize(value) {
  const v = String(value || '').trim().toUpperCase();
  return NATURES.includes(v) ? v : null;
}

async function load(userId) {
  const names = [...Object.values(PERMISSIONS.view), ...Object.values(PERMISSIONS.manage)];
  const rows = await db.select(
    `SELECT DISTINCT p.name FROM user_profiles up
     JOIN profile_permissions pp ON pp.profile_id = up.profile_id
     JOIN permissions p ON p.id = pp.permission_id
     WHERE up.user_id = $1 AND p.name = ANY($2::text[])`,
    [userId, names]
  );
  const has = new Set(rows.map(r => r.name));
  const manage = NATURES.filter(n => has.has(PERMISSIONS.manage[n]));
  const view = NATURES.filter(n => has.has(PERMISSIONS.view[n]) || manage.includes(n));
  return { view, manage };
}

/**
 * Natures autorisées à l'utilisateur de la requête. mode : 'view' (consultation, défaut) ou 'manage' (opérations).
 * Toutes hors requête HTTP et pour l'administrateur.
 */
async function allowed(mode = 'view') {
  const store = tenant.current();
  if (!store || !store.userId || store.isAdmin) return NATURES;
  if (!store.stockNatures) store.stockNatures = load(store.userId);
  return (await store.stockNatures)[mode === 'manage' ? 'manage' : 'view'];
}

async function restricted(mode = 'view') {
  return (await allowed(mode)).length < NATURES.length;
}

/** Fragment SQL « AND <colonne> = ANY(natures visibles) » (vide si tout est visible) */
async function filter(column, params, mode = 'view') {
  const natures = await allowed(mode);
  if (natures.length === NATURES.length) return '';
  if (!natures.length) return ' AND FALSE';
  params.push(natures);
  return ` AND ${column} = ANY($${params.length}::text[])`;
}

function forbidden(natures) {
  const err = new Error("Vous n'êtes pas autorisé à gérer les articles de cette nature");
  err.status = 403;
  err.code = 'NATURE_FORBIDDEN';
  err.details = { natures };
  return err;
}

/** Refuse (403 NATURE_FORBIDDEN) si l'utilisateur ne GÈRE pas une des natures */
async function assertAllowed(natures) {
  const ok = await allowed('manage');
  const missing = [...new Set((natures || []).filter(Boolean))].filter(n => !ok.includes(n));
  if (missing.length) throw forbidden(missing);
}

/** Refuse si un des articles (ids) est d'une nature non gérée. conn : db ou transaction */
async function assertItems(itemIds, conn = db) {
  const ids = [...new Set((itemIds || []).filter(Boolean).map(String))];
  if (!ids.length || !(await restricted('manage'))) return;
  const rows = await conn.select('SELECT DISTINCT nature FROM stock_items WHERE id::text = ANY($1::text[])', [ids]);
  await assertAllowed(rows.map(r => r.nature));
}

/** Contrôle d'un document par la requête SQL de ses natures (ex. lignes d'un bon de sortie) : toutes gérées */
async function assertSql(conn, sql, params) {
  if (!(await restricted('manage'))) return;
  const rows = await conn.select(sql, params);
  await assertAllowed(rows.map(r => r.nature));
}

/**
 * Vrai si l'utilisateur gère toutes les natures de ces lignes et que leurs projets lui sont autorisés (drapeaux can_*)
 */
async function managesLines(lines) {
  const ok = await allowed('manage');
  const projects = await stockProject.allowed();
  return (lines || []).every(l => ok.includes(l.item_nature || l.nature) && stockProject.isAllowed(projects, l.project_id));
}

/**
 * Lignes d'un document : garde les lignes VISIBLES — nature (`nature` ou `item_nature`) visible et projet de financement
 * (`project_id`, absent = sans projet) autorisé (migration 65) → { lines, hidden } ; hidden = nombre de lignes masquées
 */
async function splitLines(lines) {
  const ok = await allowed('view');
  const projects = await stockProject.allowed();
  const all = lines || [];
  const kept = all.filter(l => ok.includes(l.item_nature || l.nature) && stockProject.isAllowed(projects, l.project_id));
  return { lines: kept, hidden: all.length - kept.length };
}

/**
 * Condition SQL « le document a au moins une ligne visible » : EXISTS(sous-requête) avec la nature visible et, si
 * projectColumn est donné, le projet de financement autorisé (migration 65)
 */
async function existsLine(subquery, natureColumn, params, projectColumn = null) {
  const f = (await filter(natureColumn, params)) + (projectColumn ? await stockProject.filter(projectColumn, params) : '');
  if (!f) return '';
  return ` AND EXISTS (${subquery}${f})`;
}

module.exports = {
  NATURES, PERMISSIONS, normalize, allowed, restricted, filter, assertAllowed, assertItems, assertSql, managesLines, splitLines, existsLine, forbidden,
};
