// backend/src/utils/projectAccess.js
// Profils BPMN liés au projet (migration 24_project_profiles.sql).
// Un profil « de workflow » (profiles.project_scoped : manager, finance, dg, management, procurement, logistic,
// requester) ne s'exerce que sur les projets où il est attribué au membre (project_member_profiles), ou partout si
// user_profiles.all_projects. Les autres profils (admin, magasinier, auditeur…) restent globaux. Réquisition sans
// projet : profils globaux. Les règles sont dans les fonctions SQL user_project_profiles / user_has_project_*.
const db = require('../config/database');
const { audit, AUDIT } = require('./auditLog');

const groupOf = (profileId) => String(profileId).replace(/^prof_/, '');

// Visibilité des réquisitions (migration 30_requisition_visibility.sql) : ces profils ne donnent accès qu'à ses
// propres réquisitions ; tout autre profil sur le projet (managers, finance, achats, logistique, auditeur, admin…)
// donne accès à toutes les réquisitions du projet. Même liste que requisition_own_only_profiles() en SQL.
const OWN_ONLY_GROUPS = new Set(['requester', 'user', 'supplier', 'superadmin']);

/**
 * Profils de l'utilisateur, en une lecture : sert à calculer ses groupes BpmnGo sur n'importe quel projet
 * (listes de tâches). → { isAdmin, global: Set(groupes globaux), scoped: Set(groupes soumis au projet),
 *   everywhere: Set(groupes « tous les projets »), byProject: Map(projectId → Set(groupes)) }
 */
async function loadScope(userId) {
  const [profiles, assignments, managed] = await Promise.all([
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
    db.select('SELECT id FROM projects WHERE project_manager_id = $1', [userId]),
  ]);
  const scope = {
    userId: String(userId), isAdmin: false, global: new Set(), scoped: new Set(), everywhere: new Set(), byProject: new Map(),
    managedProjects: new Set(managed.map(p => String(p.id))), // chef de projet
  };
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

/** Groupes BpmnGo de l'utilisateur sur un projet (projet inconnu : tous ses groupes) */
function groupsOnProject(scope, projectId) {
  if (!projectId) return new Set([...scope.global, ...scope.scoped]);
  return new Set([...scope.global, ...scope.everywhere, ...(scope.byProject.get(String(projectId)) || [])]);
}

/** Voit toutes les réquisitions du projet (sinon seulement les siennes) — cf. user_sees_project_requisitions */
function seesProjectRequisitions(scope, projectId) {
  if (scope.isAdmin || (projectId && scope.managedProjects.has(String(projectId)))) return true;
  return [...groupsOnProject(scope, projectId)].some(g => !OWN_ONLY_GROUPS.has(g));
}

/** Peut consulter la réquisition { requester_id, project_id } (la sienne ou celles de son projet) */
function canSeeRequisition(scope, requisition) {
  return !!requisition && (String(requisition.requester_id) === scope.userId || seesProjectRequisitions(scope, requisition.project_id));
}

/** Clause SQL de liste : réquisitions (alias) visibles par l'utilisateur ; ajoute le paramètre à params */
function requisitionVisibilitySql(alias, userId, params) {
  params.push(userId);
  const p = `$${params.length}`;
  return ` AND (${alias}.requester_id = ${p} OR user_sees_project_requisitions(${p}, ${alias}.project_id))`;
}

/**
 * Middleware : /requisitions/:id… → 404 si la réquisition n'est pas visible par l'utilisateur (même réponse qu'une
 * réquisition d'une autre entreprise). Identifiant non UUID (export, import-items…) : laisse passer.
 */
async function requisitionVisible(req, res, next) {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return next();
  try {
    const row = await db.one(
      'SELECT EXISTS (SELECT 1 FROM requisitions WHERE id = $1) AS exists, user_can_view_requisition($2, $1) AS ok',
      [id, req.user.id]
    );
    if (!row.exists || row.ok) return next(); // introuvable : le contrôleur répond 404
    return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Réquisition introuvable' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
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

module.exports = {
  loadScope, groupsOnProject, hasGroupElsewhere, hasProjectPermission, projectOf, deny, requireProjectPermission, from, groupOf,
  OWN_ONLY_GROUPS, seesProjectRequisitions, canSeeRequisition, requisitionVisibilitySql, requisitionVisible,
};
