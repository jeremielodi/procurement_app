// backend/src/middleware/tenant.js
// Cloisonnement multi-entreprise (procureApp).
//
// 1. tenantContext : détermine le type de compte et l'entreprise courante
//    - fournisseur  : uniquement portail fournisseur, profil, ses notifications (fournisseurs partagés)
//    - super admin  : uniquement la gestion des entreprises / profils (ne voit aucune donnée d'achat)
//    - utilisateur  : rattaché à une entreprise active → contexte { enterpriseId } pour les modèles
// 2. tenantGuard : tout identifiant cité (URL, query, body) doit appartenir à l'entreprise courante,
//    sinon 404 (on ne révèle pas l'existence de la donnée d'une autre entreprise).
const db = require('../config/database');
const userModel = require('../models/UserModel');
const tenant = require('../utils/tenant');

const SUPPLIER_PATHS = [/^\/auth\/profile$/, /^\/supplier-portal(\/|$)/, /^\/notifications(\/|$)/];
const SUPERADMIN_PATHS = [/^\/auth\/profile$/, /^\/locations(\/|$)/, /^\/market-categories(\/|$)/,/^\/enterprises(\/|$)/, /^\/currencies(\/|$)/, /^\/notifications(\/|$)/, /^\/profiles(\/|$)/];

async function ownsNotification(notificationId, userId) {
  if (!/^\d+$/.test(String(notificationId))) return false;
  return !!(await db.one('SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2', [notificationId, userId]));
}

/** Les routes de notifications ne vérifient pas le propriétaire : on l'impose ici pour tous */
async function checkNotificationAccess(req) {
  const me = String(req.user.id);
  const [, a, b] = req.path.split('/').filter(Boolean);
  if (req.method === 'POST') return !req.isSupplierAccount && !req.isSuperAdmin;
  if (req.method === 'GET') return a === 'detail' ? ownsNotification(b, me) : a === me;
  if (req.method === 'PUT') return b === 'read' ? ownsNotification(a, me) : a === me;
  if (req.method === 'DELETE') return b === 'all' ? a === me : ownsNotification(a, me);
  return false;
}

async function tenantContext(req, res, next) {
  try {
    if (!req.user?.id) return next(); // routes publiques (login…)
    const [profiles, user] = await Promise.all([
      userModel.getUserProfiles(req.user.id),
      db.one(
        `SELECT u.enterprise_id, u.is_active, e.is_active AS enterprise_active, e.name AS enterprise_name
         FROM users u LEFT JOIN enterprise e ON e.id = u.enterprise_id WHERE u.id = $1`,
        [req.user.id]
      ),
    ]);
    if (!user || !user.is_active) return res.status(401).json({ success: false, message: 'Compte inactif' });
    const ids = profiles.map(p => p.id);
    req.isSupplierAccount = ids.length > 0 && ids.every(p => p === 'prof_supplier');
    req.isSuperAdmin = ids.includes('prof_superadmin');

    if (req.path.startsWith('/notifications') && !(await checkNotificationAccess(req))) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    if (req.isSupplierAccount) {
      if (!SUPPLIER_PATHS.some(re => re.test(req.path))) {
        return res.status(403).json({ success: false, message: 'Accès réservé au portail fournisseur' });
      }
      return tenant.run({ enterpriseId: null, supplier: true }, next);
    }
    if (req.isSuperAdmin) {
      if (!SUPERADMIN_PATHS.some(re => re.test(req.path))) {
        return res.status(403).json({ success: false, message: 'Le super administrateur gère les entreprises, pas leurs achats' });
      }
      return tenant.run({ enterpriseId: null, superAdmin: true }, next);
    }
    if (!user.enterprise_id) {
      return res.status(403).json({ success: false, message: 'Compte non rattaché à une entreprise' });
    }
    if (user.enterprise_active === false) {
      return res.status(403).json({ success: false, message: `L'entreprise ${user.enterprise_name} est suspendue` });
    }
    req.enterpriseId = user.enterprise_id;
    return tenant.run({ enterpriseId: user.enterprise_id }, next);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

// ---------------- Garde sur les identifiants ----------------

const UUID = '[0-9a-fA-F-]{36}';
// Ressource dans l'URL → table (les mots-clés comme /stats, /search ne correspondent pas aux motifs)
const PATH_RESOURCES = [
  { re: new RegExp(`^/requisitions/(${UUID})(/|$)`), table: 'requisitions' },
  { re: new RegExp(`^/tenders/by-requisition/(${UUID})$`), table: 'requisitions' },
  { re: /^\/purchase-orders\/(\d+)(\/|$)/, table: 'purchase_orders' },
  { re: /^\/goods-receipts\/(\d+)(\/|$)/, table: 'goods_receipt_notes' },
  { re: /^\/service-acceptance-notes\/(\d+)(\/|$)/, table: 'service_acceptance_notes' },
  { re: /^\/invoices\/(\d+)(\/|$)/, table: 'invoices' },
  { re: /^\/payments\/(\d+)(\/|$)/, table: 'payments' },
  { re: /^\/tenders\/(\d+)(\/|$)/, table: 'tenders' },
  { re: new RegExp(`^/budget/(${UUID})(/|$)`), table: 'budget_allocations' },
  { re: new RegExp(`^/budget/by-project/(${UUID})$`), table: 'projects' },
  { re: new RegExp(`^/departments/(${UUID})(/|$)`), table: 'departments' },
  { re: new RegExp(`^/projects/(${UUID})(/|$)`), table: 'projects' },
  { re: new RegExp(`^/projects/members/(${UUID})/(${UUID})$`), table: 'projects', second: 'users' },
  { re: new RegExp(`^/users/(${UUID})(/|$)`), table: 'users' },
  { re: /^\/workflow\/process\/([^/]+)/, table: 'requisitions', column: 'process_instance_id' },
  { re: /^\/tasks\/process\/([^/]+)/, table: 'requisitions', column: 'process_instance_id' },
];

// Clés de query / body → table
const KEY_TABLES = {
  projectId: 'projects', project_id: 'projects',
  departmentId: 'departments', department_id: 'departments',
  requisitionId: 'requisitions', requisition_id: 'requisitions',
  poId: 'purchase_orders', po_id: 'purchase_orders', purchaseOrderId: 'purchase_orders',
  invoiceId: 'invoices', invoice_id: 'invoices',
  grnId: 'goods_receipt_notes', grn_id: 'goods_receipt_notes',
  budgetLineId: 'budget_allocations', budget_line_id: 'budget_allocations', budgetId: 'budget_allocations',
  managerId: 'users', manager_id: 'users', projectManagerId: 'users', project_manager_id: 'users',
  userId: 'users', user_id: 'users', requesterId: 'users',
};

// Pièces jointes : type d'entité → table
const ATTACHMENT_TABLES = {
  requisition: 'requisitions', purchase_order: 'purchase_orders', grn: 'goods_receipt_notes',
  invoice: 'invoices', payment: 'payments', san: 'service_acceptance_notes',
};

async function belongs(table, value, enterpriseId, column = 'id') {
  if (value === undefined || value === null || value === '') return true;
  const row = await db.one(`SELECT enterprise_id FROM ${table} WHERE ${column}::text = $1 LIMIT 1`, [String(value)]);
  if (!row) return true; // inexistant : la route renverra elle-même 404 / 400
  return String(row.enterprise_id) === String(enterpriseId);
}

function collectKeys(obj, out, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 2) return;
  for (const [k, v] of Object.entries(obj)) {
    if (KEY_TABLES[k] && (typeof v === 'string' || typeof v === 'number')) out.push([KEY_TABLES[k], v]);
    else if (Array.isArray(v)) v.forEach(item => collectKeys(item, out, depth + 1));
    else if (v && typeof v === 'object') collectKeys(v, out, depth + 1);
  }
}

async function tenantGuard(req, res, next) {
  const enterpriseId = req.enterpriseId;
  if (!enterpriseId) return next(); // fournisseur / super admin : déjà restreints par tenantContext
  try {
    const notFound = () => res.status(404).json({ success: false, message: 'Ressource introuvable' });

    for (const r of PATH_RESOURCES) {
      const m = r.re.exec(req.path);
      if (!m) continue;
      if (!(await belongs(r.table, m[1], enterpriseId, r.column))) return notFound();
      if (r.second && !(await belongs(r.second, m[2], enterpriseId))) return notFound();
    }

    // Pièces jointes
    let m = /^\/upload\/([a-z_]+)\/([^/]+)$/.exec(req.path);
    if (m && req.method === 'GET' && ATTACHMENT_TABLES[m[1]] && !(await belongs(ATTACHMENT_TABLES[m[1]], m[2], enterpriseId))) return notFound();
    m = /^\/upload\/(?:download\/file\/)?(\d+|[0-9a-fA-F-]{36})$/.exec(req.path);
    if (m && ['GET', 'DELETE'].includes(req.method)) {
      const att = await db.one('SELECT entity_type, entity_id FROM attachments WHERE id::text = $1', [m[1]]);
      if (att && ATTACHMENT_TABLES[att.entity_type] && !(await belongs(ATTACHMENT_TABLES[att.entity_type], att.entity_id, enterpriseId))) return notFound();
    }
    if (req.path.startsWith('/upload') && req.method === 'POST' && ATTACHMENT_TABLES[req.body?.entity_type]
        && !(await belongs(ATTACHMENT_TABLES[req.body.entity_type], req.body.entity_id, enterpriseId))) return notFound();

    // Identifiants cités dans la query ou le body (création, filtres…)
    const refs = [];
    collectKeys(req.query, refs);
    collectKeys(req.body, refs);
    for (const [table, value] of refs) {
      if (!(await belongs(table, value, enterpriseId))) return notFound();
    }
    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

/** Pièce jointe multipart : l'entité cible doit appartenir à l'entreprise (body lu après multer) */
async function attachmentEntityAllowed(req, entityType, entityId) {
  if (!req.enterpriseId) return false;
  const table = ATTACHMENT_TABLES[entityType];
  if (!table) return true; // type non rattaché à une table métier
  return belongs(table, entityId, req.enterpriseId);
}

module.exports = { tenantContext, tenantGuard, attachmentEntityAllowed };
