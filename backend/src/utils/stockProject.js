// backend/src/utils/stockProject.js
// Stock cloisonné par projet (migration 65) : les profils de stock liés au projet (gestionnaire des équipements /
// des consommables, magasinier, logistique…) ne s'exercent que sur les projets où ils sont attribués au membre
// (project_member_profiles) ou partout avec « Tous les projets ». Le projet d'une ligne de stock = projet qui l'a financée
// (stock_balances / stock_movements / stock_units / lignes de bons .project_id) ; le stock SANS projet reste visible de tous.
// allowed() : null = aucune restriction (administrateur, profil de stock global, « Tous les projets », hors requête HTTP),
// sinon la liste des projets autorisés (éventuellement vide : seul le stock sans projet).
const db = require('../config/database');
const tenant = require('./tenant');

// Permissions qui font d'un profil un « profil de stock »
const STOCK_PERMISSIONS = [
  'VIEW_STOCK', 'MANAGE_STOCK_ITEMS', 'ISSUE_STOCK', 'COUNT_STOCK', 'ADJUST_STOCK', 'RECORD_STOCK_ENTRIES', 'VALIDATE_STOCK_ENTRIES',
  'VIEW_EQUIPMENT', 'VIEW_CONSUMABLES', 'MANAGE_EQUIPMENT', 'MANAGE_CONSUMABLES',
];

async function load(userId) {
  const profiles = await db.select(
    `SELECT DISTINCT up.profile_id, COALESCE(pr.project_scoped, false) AS project_scoped, COALESCE(up.all_projects, false) AS all_projects
     FROM user_profiles up JOIN profiles pr ON pr.id = up.profile_id
     WHERE up.user_id = $1 AND (up.profile_id = 'prof_admin' OR EXISTS (
       SELECT 1 FROM profile_permissions pp JOIN permissions p ON p.id = pp.permission_id
       WHERE pp.profile_id = up.profile_id AND p.name = ANY($2::text[])))`,
    [userId, STOCK_PERMISSIONS]
  );
  if (profiles.some(p => p.profile_id === 'prof_admin' || !p.project_scoped || p.all_projects)) return null;
  if (!profiles.length) return [];
  const rows = await db.select(
    'SELECT DISTINCT project_id FROM project_member_profiles WHERE user_id = $1 AND profile_id = ANY($2::text[])',
    [userId, profiles.map(p => p.profile_id)]
  );
  return rows.map(r => String(r.project_id));
}

/** Projets autorisés (null = tous) pour l'utilisateur de la requête */
async function allowed() {
  const store = tenant.current();
  if (!store || !store.userId || store.isAdmin) return null;
  if (!store.stockProjects) store.stockProjects = load(store.userId);
  return store.stockProjects;
}

const ok = (projects, projectId) => projects === null || projectId === null || projectId === undefined || projectId === ''
  || projects.includes(String(projectId));

/** Fragment SQL « AND (<colonne> IS NULL OR <colonne> = ANY(projets)) » (vide sans restriction) */
async function filter(column, params) {
  const projects = await allowed();
  if (projects === null) return '';
  params.push(projects);
  return ` AND (${column} IS NULL OR ${column}::text = ANY($${params.length}::text[]))`;
}

/** Condition SQL « le document a au moins une ligne d'un projet autorisé (ou sans projet) » */
async function existsLine(subquery, projectColumn, params) {
  const f = await filter(projectColumn, params);
  if (!f) return '';
  return ` AND EXISTS (${subquery}${f})`;
}

function forbidden(projectIds) {
  const err = new Error("Ce stock appartient à un projet sur lequel vous n'avez pas de profil de stock");
  err.status = 403;
  err.code = 'PROJECT_FORBIDDEN';
  err.details = { projects: projectIds };
  return err;
}

/** Refuse (403 PROJECT_FORBIDDEN) si un des projets n'est pas autorisé (vide / null = stock sans projet : autorisé) */
async function assertAllowed(projectIds) {
  const projects = await allowed();
  const missing = [...new Set((projectIds || []).filter(p => !ok(projects, p)).map(String))];
  if (missing.length) throw forbidden(missing);
}

/** Contrôle d'un document par la requête SQL de ses projets (colonne project_id) */
async function assertSql(conn, sql, params) {
  if ((await allowed()) === null) return;
  const rows = await conn.select(sql, params);
  await assertAllowed(rows.map(r => r.project_id));
}

/**
 * Même filtre que filter(), avec la liste écrite dans le SQL (identifiants validés) : pour une sous-requête partagée
 * entre plusieurs requêtes (ex. quantité en stock du catalogue)
 */
async function inlineFilter(column) {
  const projects = await allowed();
  if (projects === null) return '';
  const ids = projects.filter(p => /^[0-9a-f-]{36}$/i.test(p)).map(p => `'${p}'`);
  return ` AND (${column} IS NULL OR ${column}::text = ANY(ARRAY[${ids.join(', ')}]::text[]))`;
}

/** Vrai si la ligne (project_id) est visible */
async function lineAllowed(line) {
  return ok(await allowed(), line.project_id);
}

module.exports = { STOCK_PERMISSIONS, allowed, filter, inlineFilter, existsLine, assertAllowed, assertSql, lineAllowed, forbidden, isAllowed: ok };
