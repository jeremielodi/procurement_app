// backend/src/utils/projectAccess.js
// Profils BPMN liés au projet (migration 24_project_profiles.sql).
// Un profil « de workflow » (profiles.project_scoped : manager, finance, dg, management, procurement, logistic,
// requester) ne s'exerce que sur les projets où il est attribué au membre (project_member_profiles), ou partout si
// user_profiles.all_projects. Les autres profils (admin, magasinier, auditeur…) restent globaux. Réquisition sans
// projet : profils globaux. Les règles sont dans les fonctions SQL user_project_profiles / user_has_project_*.
const db = require('../config/database');
const { audit, AUDIT } = require('./auditLog');

const groupOf = (profileId) => String(profileId).replace(/^prof_/, '');

/**
 * Profils de l'utilisateur, en une lecture : sert à calculer ses groupes GoFlow sur n'importe quel projet
 * (listes de tâches). → { isAdmin, global: Set(groupes globaux), scoped: Set(groupes soumis au projet),
 *   everywhere: Set(groupes « tous les projets »), byProject: Map(projectId → Set(groupes)) }
 */
async function loadScope(userId) {
  const [profiles, assignments] = await Promise.all([
    db.select(
      `SELECT up.profile_id, up.all_projects, pr.project_scoped
       FROM user_profiles up JOIN profiles pr ON pr.id = up.profile_id WHERE up.user_id = $1`,
      [userId]
    ),
    db.select(
      `SELECT pmp.project_id, pmp.profile_id FROM project_member_profiles pmp
       JOIN user_profiles up ON up.user_id = pmp.user_id AND up.profile_id = pmp.profile_id
       WHERE pmp.user_id = $1`,
      [userId]
    ),
  ]);
  const scope = { isAdmin: false, global: new Set(), scoped: new Set(), everywhere: new Set(), byProject: new Map() };
  for (const p of profiles) {
    const group = groupOf(p.profile_id);
    if (p.profile_id === 'prof_admin') scope.isAdmin = true;
    if (!p.project_scoped) scope.global.add(group);
    else {
      scope.scoped.add(group);
      if (p.all_projects) scope.everywhere.add(group);
    }
  }
  for (const a of assignments) {
    const key = String(a.project_id);
    if (!scope.byProject.has(key)) scope.byProject.set(key, new Set());
    scope.byProject.get(key).add(groupOf(a.profile_id));
  }
  return scope;
}

/** Groupes GoFlow de l'utilisateur sur un projet (projet inconnu : tous ses groupes) */
function groupsOnProject(scope, projectId) {
  if (!projectId) return new Set([...scope.global, ...scope.scoped]);
  return new Set([...scope.global, ...scope.everywhere, ...(scope.byProject.get(String(projectId)) || [])]);
}

/** A le profil du groupe partout, mais pas sur ce projet → raison « NOT_ON_PROJECT » à afficher */
function hasGroupElsewhere(scope, group) {
  return scope.scoped.has(group);
}

/** Permission accordée par un des profils de l'utilisateur sur ce projet (admin : oui) */
async function hasProjectPermission(userId, projectId, permission) {
  if (!projectId) return true; // pas de projet : la permission globale (vérifiée par la route) suffit
  const row = await db.one('SELECT user_has_project_permission($1, $2, $3) AS ok', [userId, projectId, permission]);
  return !!row?.ok;
}

// Projet d'un document (via la réquisition d'origine)
const PROJECT_OF = {
  requisition: 'SELECT project_id FROM requisitions WHERE id = $1',
  purchaseOrder: `SELECT r.project_id FROM purchase_orders po JOIN requisitions r ON r.id = po.requisition_id WHERE po.id = $1`,
  goodsReceipt: `SELECT r.project_id FROM goods_receipt_notes g JOIN purchase_orders po ON po.id = g.po_id
                 JOIN requisitions r ON r.id = po.requisition_id WHERE g.id = $1`,
  invoice: `SELECT r.project_id FROM invoices i JOIN purchase_orders po ON po.id = i.po_id
            JOIN requisitions r ON r.id = po.requisition_id WHERE i.id = $1`,
  payment: `SELECT r.project_id FROM payments pa
            LEFT JOIN invoices i ON i.id = pa.invoice_id
            JOIN purchase_orders po ON po.id = COALESCE(pa.po_id, i.po_id)
            JOIN requisitions r ON r.id = po.requisition_id WHERE pa.id = $1`,
  tender: 'SELECT r.project_id FROM tenders t JOIN requisitions r ON r.id = t.requisition_id WHERE t.id = $1',
  project: 'SELECT id AS project_id FROM projects WHERE id = $1',
};

async function projectOf(kind, id) {
  if (id == null || id === '') return null;
  try {
    return (await db.one(PROJECT_OF[kind], [id]))?.project_id || null;
  } catch (_) {
    return null; // identifiant mal formé : le contrôleur répondra lui-même (400 / 404)
  }
}

/** Erreur 403 NOT_ON_PROJECT (même forme que les autres erreurs métier) + trace dans le journal d'audit */
async function deny(req, { projectId, permission, kind, id, taskId, candidateGroup }) {
  const project = projectId ? await db.one('SELECT code, name FROM projects WHERE id = $1', [projectId]) : null;
  await audit(req, AUDIT.PROJECT_ACCESS_DENIED, {
    entity: { type: 'project', id: projectId, label: project ? `${project.code} — ${project.name}` : null },
    details: { permission: permission || null, candidateGroup: candidateGroup || null, document: kind || null, documentId: id || null, taskId: taskId || null },
  });
  return Object.assign(
    new Error(`Vous n'avez pas le profil requis sur le projet${project ? ` ${project.code}` : ''} : demandez à l'administrateur de vous l'attribuer`),
    { status: 403, code: 'NOT_ON_PROJECT', details: { project: project?.code || null } }
  );
}

/**
 * Middleware de route : la permission doit être accordée par un profil de l'utilisateur SUR LE PROJET du document.
 * @param {string} permission ex. 'RECORD_GOODS_RECEIPT'
 * @param {string} kind       clé de PROJECT_OF (requisition, purchaseOrder, invoice…)
 * @param {(req) => any} pick lit l'identifiant du document dans la requête
 * Identifiant absent ou document introuvable : laisse passer (le contrôleur répond 400 / 404).
 */
function requireProjectPermission(permission, kind, pick) {
  return async (req, res, next) => {
    try {
      const id = pick(req);
      const projectId = await projectOf(kind, id);
      if (!projectId || await hasProjectPermission(req.user.id, projectId, permission)) return next();
      const error = await deny(req, { projectId, permission, kind, id });
      return res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  };
}

const from = {
  body: (key) => (req) => req.body?.[key],
  param: (key) => (req) => req.params?.[key],
};

module.exports = { loadScope, groupsOnProject, hasGroupElsewhere, hasProjectPermission, projectOf, deny, requireProjectPermission, from, groupOf };
