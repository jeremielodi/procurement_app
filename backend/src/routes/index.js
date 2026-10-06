// backend/src/routes/index.js
const express = require('express');
const router = express.Router();
const requisitionController = require('../controllers/RequisitionController');
const contactController = require('../controllers/ContactController');
const supplierController = require('../controllers/SupplierController');
const notificationController = require('../controllers/NotificationController');
const dashboardController = require('../controllers/DashboardController');
const purchaseOrderModel = require('../models/PurchaseOrderModel');
const taskController = require('../controllers/TaskController');
const workflowController = require('../controllers/WorkflowController');
const authController = require('../controllers/AuthController');
const userController = require('../controllers/UserController');
const purchaseOrderController = require('../controllers/PurchaseOrderController');
const departmentController = require('../controllers/DepartmentController');
const projectController = require('../controllers/ProjectController');
const profileController = require('../controllers/ProfileController');
const budgetController = require('../controllers/BudgetController');
const userModelForBudget = require('../models/UserModel');

// Liste complète des lignes budgétaires = Finance ; les autres profils (VIEW_BUDGET) seulement par projet
async function budgetListAccess(req, res, next) {
  if (req.query.projectId) return next();
  if (await userModelForBudget.hasPermission(req.user.id, 'MANAGE_BUDGET')) return next();
  return res.status(403).json({ success: false, message: 'Permission MANAGE_BUDGET requise' });
}
const enterpriseController = require('../controllers/EnterpriseController');
const currencyController = require('../controllers/CurrencyController');
const grnController = require('../controllers/GoodsReceiptController');
const sanController = require('../controllers/ServiceAcceptanceController');
const invoiceController = require('../controllers/InvoiceController');
const paymentController = require('../controllers/PaymentController');
const supplierPortalController = require('../controllers/SupplierPortalController');
const tenderController = require('../controllers/TenderController');
const requisitionImport = require('../controllers/requisition/importItems');
const referenceController = require('../controllers/ReferenceController');
const { singleDocumentMiddleware } = require('../utils/supplierDocuments');
const requisitionTimeline = require('../services/RequisitionTimelineService');
const i18n = require('../i18n');
const { authenticate, hasPermission, hasAnyPermission } = require('../middleware/auth');
const { tenantContext, tenantGuard } = require('../middleware/tenant');
const { logoMiddleware } = require('../utils/logoUpload');

// Réservé au super administrateur de la plateforme
const requireSuperAdmin = (req, res, next) => req.isSuperAdmin
  ? next()
  : res.status(403).json({ success: false, message: 'Réservé au super administrateur procureApp' });
// Consultation des profils : super admin ou administrateur d'entreprise
const superAdminOr = (permission) => (req, res, next) => (req.isSuperAdmin ? next() : hasPermission(permission)(req, res, next));

const uploadRoutes = require('./upload');

// ============================================
// ROUTES D'AUTHENTIFICATION (publiques)
// ============================================
router.post('/auth/login', authController.login);
router.get('/auth/profile', authenticate, authController.getProfile);
router.post('/auth/forgot-password', authController.forgotPassword);
router.post('/auth/reset-password/confirm', authController.confirmPasswordReset);
// Avant tenantContext : accessible à tous les types de compte (fournisseur, super admin)
router.post('/auth/change-password', authenticate, authController.changePassword);
router.post('/auth/logout', authenticate, authController.logout);
router.put('/auth/language', authenticate, authController.setLanguage.bind(authController));

// Inscription fournisseur + logo (publics)
router.post('/auth/register-supplier',
  supplierPortalController.handleLogoUpload,
  supplierPortalController.register.bind(supplierPortalController)
);
router.get('/public/suppliers/:id/logo', supplierPortalController.getLogo.bind(supplierPortalController));
router.get('/public/enterprises/:id/logo', enterpriseController.getLogo.bind(enterpriseController));
// Localisations et catégories de marché actives (formulaire d'inscription fournisseur)
router.get('/public/locations', referenceController.locations.list);
router.get('/public/market-categories', referenceController.categories.list);
// Formulaire de contact du site vitrine (email à CONTACT_EMAIL)
router.post('/public/contact', contactController.send.bind(contactController));

router.use(authenticate);
// Multi-entreprise : type de compte + entreprise courante, puis contrôle des identifiants cités
router.use(tenantContext);
router.use(tenantGuard);

// Routes publiques (lecture)
// ============================================
// ENTREPRISES (multi-entreprise procureApp)
// ============================================
const e = enterpriseController;
// Entreprise de l'utilisateur connecté (nom, logo, devise)
router.get('/enterprises/current', e.getCurrent.bind(e));
router.get('/enterprises/default', e.getCurrent.bind(e)); // ancien nom, conservé
router.put('/enterprises/current', hasPermission('MANAGE_USERS'), logoMiddleware, e.update.bind(e));
// Liste : super admin = toutes ; utilisateur = la sienne
router.get('/enterprises', e.list.bind(e));
router.get('/enterprises/:id', e.getOne.bind(e));
// Gestion de la plateforme : super admin uniquement
router.post('/enterprises', requireSuperAdmin, logoMiddleware, e.create.bind(e));
router.put('/enterprises/:id', requireSuperAdmin, logoMiddleware, e.update.bind(e));
router.patch('/enterprises/:id/active', requireSuperAdmin, e.setActive.bind(e));
router.delete('/enterprises/:id', requireSuperAdmin, e.delete.bind(e));
router.post('/enterprises/:id/admins', requireSuperAdmin, e.addAdmin.bind(e));

// Référentiels de la plateforme : localisations (bureaux) et catégories de marché — écriture super admin
const loc = referenceController.locations;
const cat = referenceController.categories;
router.get('/locations', loc.list);
router.post('/locations', requireSuperAdmin, loc.create);
router.put('/locations/:id', requireSuperAdmin, loc.update);
router.delete('/locations/:id', requireSuperAdmin, loc.delete);
router.get('/market-categories', cat.list);
router.post('/market-categories', requireSuperAdmin, cat.create);
router.put('/market-categories/:id', requireSuperAdmin, cat.update);
router.delete('/market-categories/:id', requireSuperAdmin, cat.delete);


router.get('/currencies', authenticate, currencyController.list);
router.get('/currencies/active', authenticate, currencyController.getActive);
router.get('/currencies/default', authenticate, currencyController.getDefault);
router.get('/currencies/:id', authenticate, currencyController.getOne);

// Routes protégées (écriture)
router.post('/currencies/', authenticate, hasPermission('MANAGE_CURRENCIES'), currencyController.create);
router.put('/currencies/:id', authenticate, hasPermission('MANAGE_CURRENCIES'), currencyController.update);
router.delete('/currencies/:id', authenticate, hasPermission('MANAGE_CURRENCIES'), currencyController.delete);

// ============================================
// ROUTES DES RÉQUISITIONS (protégées)
// ============================================
router.post('/requisitions',
  authenticate,
  hasPermission('CREATE_REQUISITIONS'),
  (req, res) => requisitionController.create(req, res)
);

// Import d'articles Excel/CSV (avant /requisitions/:id)
router.post('/requisitions/import-items',
  hasPermission('CREATE_REQUISITIONS'),
  requisitionImport.handleUpload,
  requisitionImport.importItems
);

// Suivi lisible du workflow (étapes + historique dans la langue de la requête : Accept-Language / ?lang=)
router.get('/requisitions/:id/timeline',
  hasPermission('VIEW_REQUISITIONS'),
  async (req, res) => {
    try {
      const data = await requisitionTimeline.build(req.params.id, i18n.fromRequest(req));
      if (!data) return res.status(404).json({ success: false, message: 'Réquisition introuvable' });
      res.json({ success: true, data });
    } catch (error) {
      console.error('Timeline error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.get('/requisitions/:id',
  authenticate,
  hasPermission('VIEW_REQUISITIONS'),
  (req, res) => requisitionController.getOne(req, res)
);

router.get('/requisitions',
  authenticate,
  hasPermission('VIEW_REQUISITIONS'),
  (req, res) => requisitionController.list(req, res)
);

router.post('/requisitions/history',
  authenticate,
  hasPermission('VIEW_REQUISITIONS'),
  (req, res) => requisitionController.addWorkflowHistory(req, res)
);

router.delete('/requisitions/:id',
  authenticate,
  hasPermission('DELETE_REQUISITIONS'),
  (req, res) => requisitionController.delete(req, res)
);


// Exports
router.get('/requisitions/export/pdf', hasPermission('VIEW_REQUISITIONS'), requisitionController.exportPDF);
router.get('/requisitions/export/excel', hasPermission('VIEW_REQUISITIONS'), requisitionController.exportExcel);
router.get('/requisitions/:id/export/pdf', hasPermission('VIEW_REQUISITIONS'), requisitionController.exportRequisitionPDF);

// ============================================
// ROUTES DES TÂCHES (protégées)
// ============================================
router.get('/tasks/user',
  authenticate,
  hasAnyPermission('VIEW_REQUISITIONS', 'APPROVE_REQUISITIONS', 'VIEW_PURCHASE_ORDERS'),
  taskController.getUserTasks
);

router.get('/tasks/group',
  authenticate,
  hasAnyPermission('VIEW_REQUISITIONS', 'APPROVE_REQUISITIONS'),
  taskController.getGroupTasks
);

router.get('/tasks/:taskId/form',
  authenticate,
  taskController.getTaskForm
);

router.post('/tasks/:taskId/claim',
  authenticate,
  taskController.claimTask
);

router.post('/tasks/:taskId/unclaim',
  authenticate,
  taskController.unclaimTask
);

router.post('/tasks/:taskId/complete',
  authenticate,
  taskController.completeTask
);

router.get('/tasks/process/:processInstanceId',
  authenticate,
  hasPermission('VIEW_REQUISITIONS'),
  taskController.getTasksByProcess
);

// ============================================
// ROUTES DES FOURNISSEURS (protégées)
// ============================================
const sup = supplierController;
router.get('/suppliers', authenticate, hasPermission('VIEW_SUPPLIERS'), sup.list.bind(sup));
// Liste des préqualifiés de l'entreprise (avant /suppliers/:id)
router.get('/suppliers/prequalified', authenticate, hasPermission('VIEW_SUPPLIERS'), sup.listPrequalified.bind(sup));
router.get('/suppliers/prequalified/export', authenticate, hasPermission('VIEW_SUPPLIERS'), sup.exportPrequalified.bind(sup));
router.get('/suppliers/:id', authenticate, hasPermission('VIEW_SUPPLIERS'), sup.getOne.bind(sup));
router.get('/suppliers/:id/evaluations', authenticate, hasPermission('VIEW_SUPPLIERS'), sup.getEvaluations.bind(sup));
router.post('/suppliers', authenticate, hasPermission('MANAGE_SUPPLIERS'), sup.create.bind(sup));
router.put('/suppliers/:id', authenticate, hasPermission('MANAGE_SUPPLIERS'), sup.update.bind(sup));
router.delete('/suppliers/:id', authenticate, hasPermission('MANAGE_SUPPLIERS'), sup.delete.bind(sup));
router.post('/suppliers/:id/prequalify', authenticate, hasPermission('MANAGE_SUPPLIERS'), sup.prequalify.bind(sup));
router.post('/suppliers/:id/evaluations', authenticate, hasPermission('MANAGE_SUPPLIERS'), sup.addEvaluation.bind(sup));
router.get('/suppliers/:id/documents/:documentId/file', authenticate, hasPermission('VIEW_SUPPLIERS'), sup.getDocument.bind(sup));
router.put('/suppliers/:id/documents/:type', authenticate, hasPermission('MANAGE_SUPPLIERS'), singleDocumentMiddleware, sup.uploadDocument.bind(sup));
router.get('/suppliers/:id/prequalification', authenticate, hasPermission('VIEW_SUPPLIERS'), sup.getPrequalification.bind(sup));
// Vérification des documents et décision de préqualification : administrateur d'entreprise (PREQUALIFY_SUPPLIERS)
router.put('/suppliers/:id/documents/:documentId/review', authenticate, hasPermission('PREQUALIFY_SUPPLIERS'), sup.reviewDocument.bind(sup));
router.put('/suppliers/:id/prequalification', authenticate, hasPermission('PREQUALIFY_SUPPLIERS'), sup.setPrequalification.bind(sup));

// ============================================
// ROUTES DES COMMANDES D'ACHAT (protégées)
// ============================================
router.get('/purchase-orders',
  authenticate,
  hasPermission('VIEW_PURCHASE_ORDERS'),
  purchaseOrderController.getAll
);

router.get('/purchase-orders/stats',
  authenticate,
  hasPermission('VIEW_DASHBOARD'),
  purchaseOrderController.getStats
);

router.get('/purchase-orders/:id',
  authenticate,
  hasPermission('VIEW_PURCHASE_ORDERS'),
  purchaseOrderController.getById
);

router.get('/purchase-orders/:id/pdf',
  authenticate,
  hasPermission('VIEW_PURCHASE_ORDERS'),
  purchaseOrderController.generatePDF
);

router.post('/purchase-orders',
  authenticate,
  hasPermission('CREATE_PURCHASE_ORDERS'),
  purchaseOrderController.create
);

router.put('/purchase-orders/:id',
  authenticate,
  hasPermission('EDIT_PURCHASE_ORDERS'),
  purchaseOrderController.update
);

router.post('/purchase-orders/:id/approve',
  authenticate,
  hasPermission('APPROVE_PURCHASE_ORDERS'),
  purchaseOrderController.approve
);

router.post('/purchase-orders/:id/reject',
  authenticate,
  hasPermission('APPROVE_PURCHASE_ORDERS'),
  purchaseOrderController.reject
);

router.post('/purchase-orders/:id/send',
  authenticate,
  hasPermission('CREATE_PURCHASE_ORDERS'),
  purchaseOrderController.send
);

router.delete('/purchase-orders/:id',
  authenticate,
  hasPermission('DELETE_PURCHASE_ORDERS'),
  purchaseOrderController.delete
);

// ============================================
// ROUTES DES NOTIFICATIONS (protégées)
// ============================================
router.get('/notifications/:userId',
  authenticate,
  notificationController.getUserNotifications
);

router.get('/notifications/:userId/unread-count',
  authenticate,
  notificationController.getUnreadCount
);

router.get('/notifications/detail/:id',
  authenticate,
  notificationController.getNotificationById
);

router.post('/notifications',
  authenticate,
  notificationController.createNotification
);

router.put('/notifications/:id/read',
  authenticate,
  notificationController.markAsRead
);

router.put('/notifications/:userId/read-all',
  authenticate,
  notificationController.markAllAsRead
);

router.delete('/notifications/:id',
  authenticate,
  notificationController.deleteNotification
);

router.delete('/notifications/:userId/all',
  authenticate,
  notificationController.deleteAllNotifications
);

// ============================================
// ROUTES DU DASHBOARD (protégées)
// ============================================

// Toutes les routes du dashboard nécessitent une authentification

// Dashboard principal
router.get('/dashboard', dashboardController.getDashboardData);

// Statistiques
router.get('/dashboard/stats', dashboardController.getStats);

// Graphiques
router.get('/dashboard/charts', dashboardController.getChartData);

// Réquisitions récentes
router.get('/dashboard/recent-requisitions', dashboardController.getRecentRequisitions);

// Activités récentes
router.get('/dashboard/recent-activities', dashboardController.getRecentActivities);

// Résumé par département
router.get('/dashboard/department-summary', dashboardController.getDepartmentSummary);

// Résumé par fournisseur
router.get('/dashboard/supplier-summary', dashboardController.getSupplierSummary);

// KPI
router.get('/dashboard/kpis', dashboardController.getKPIs);

// Tâches GoFlow en cours par profil (goulots d'étranglement)
router.get('/dashboard/pending-tasks', hasPermission('VIEW_DASHBOARD'), dashboardController.getPendingTasksByProfile.bind(dashboardController));

// Alertes
router.get('/dashboard/alerts', dashboardController.getAlerts);

// Statistiques par projet
router.get('/dashboard/project-stats', dashboardController.getProjectStats);

// Export
router.get('/dashboard/export', dashboardController.exportDashboardData);

// ============================================
// ROUTES DU WORKFLOW (protégées)
// ============================================
router.get('/workflow/process/:processInstanceId/history',
  hasPermission('VIEW_REQUISITIONS'),
  workflowController.getProcessHistory
);

router.get('/workflow/process/:processInstanceId/status',
  hasPermission('VIEW_REQUISITIONS'),
  workflowController.getProcessStatus
);

router.get('/workflow/process/:processInstanceId/tasks',
  hasPermission('VIEW_REQUISITIONS'),
  workflowController.getProcessTasks
);

router.get('/workflow/process/:processInstanceId/variables',
  hasPermission('VIEW_REQUISITIONS'),
  workflowController.getProcessVariables
);

router.post('/workflow/process/:processInstanceId/suspend',
  hasPermission('MANAGE_WORKFLOW'),
  workflowController.suspendProcess
);

router.post('/workflow/process/:processInstanceId/resume',
  authenticate,
  hasPermission('MANAGE_WORKFLOW'),
  workflowController.resumeProcess
);

router.post('/workflow/process/:processInstanceId/variables',
  authenticate,
  hasPermission('MANAGE_WORKFLOW'),
  workflowController.setProcessVariables
);

router.delete('/workflow/process/:processInstanceId',
  authenticate,
  hasPermission('MANAGE_WORKFLOW'),
  workflowController.deleteProcess
 );


router.get('/users', authenticate,hasPermission('MANAGE_USERS'), userController.list);
router.get('/users/profiles', authenticate, hasPermission('MANAGE_USERS'), userController.getProfiles);
router.get('/users/:id',authenticate,hasPermission('MANAGE_USERS'), userController.getOne);
router.post('/users',authenticate, hasPermission('MANAGE_USERS'),  userController.create);
router.put('/users/:id',authenticate, hasPermission('MANAGE_USERS'),  userController.update);
router.patch('/users/:id/toggle-active',authenticate, hasPermission('MANAGE_USERS'), userController.toggleActive);
router.post('/users/:id/reset-password',authenticate, hasPermission('MANAGE_USERS'),  userController.resetPassword);
router.delete('/users/:id',authenticate, hasPermission('MANAGE_USERS'), userController.delete);


// Profils (rôles) partagés par toutes les entreprises : lecture admin, modification super admin
router.get('/profiles', superAdminOr('MANAGE_USERS'), profileController.list);
router.get('/profiles/permissions', superAdminOr('MANAGE_USERS'), profileController.getPermissions);
router.get('/profiles/:id', superAdminOr('MANAGE_USERS'), profileController.getOne);
router.get('/profiles/:profileId/permissions', superAdminOr('MANAGE_USERS'), profileController.getProfilePermissions);
router.post('/profiles/', requireSuperAdmin, profileController.create);
router.put('/profiles/:id', requireSuperAdmin, profileController.update);
router.delete('/profiles/:id', requireSuperAdmin, profileController.delete);
router.post('/profiles/:profileId/permissions/:permissionId', requireSuperAdmin, profileController.assignPermission);
router.delete('/profiles/:profileId/permissions/:permissionId', requireSuperAdmin, profileController.removePermission);



router.get('/departments', hasPermission('VIEW_DEPARTMENTS'), departmentController.list);
router.get('/departments/users', hasPermission('VIEW_DEPARTMENTS'), departmentController.getUsers);
router.get('/departments/:id', hasPermission('VIEW_DEPARTMENTS'), departmentController.getOne);
router.post('/departments', hasPermission('MANAGE_DEPARTMENTS'), departmentController.create);
router.put('/departments/:id', hasPermission('MANAGE_DEPARTMENTS'), departmentController.update);
router.delete('/departments/:id', hasPermission('MANAGE_DEPARTMENTS'), departmentController.delete);

router.get('/projects', hasPermission('VIEW_PROJECTS'), projectController.list);
router.get('/projects/users', hasPermission('VIEW_PROJECTS'), projectController.getAvailableUsers);
router.get('/projects/:id', hasPermission('VIEW_PROJECTS'), projectController.getOne);
router.get('/projects/:projectId/members', hasPermission('VIEW_PROJECTS'), projectController.getMembers);
router.post('/projects/', hasPermission('MANAGE_PROJECTS'), projectController.create);
router.put('/projects/:id', hasPermission('MANAGE_PROJECTS'), projectController.update);
router.delete('/projects/:id', hasPermission('MANAGE_PROJECTS'), projectController.delete);
router.post('/projects/members', hasPermission('MANAGE_PROJECTS'), projectController.addMember);
router.delete('/projects/members/:projectId/:userId', hasPermission('MANAGE_PROJECTS'), projectController.removeMember);



router.get('/budget', hasPermission('VIEW_BUDGET'), budgetListAccess, budgetController.list);
// Module Budget (consultation détaillée + édition) : Finance uniquement (MANAGE_BUDGET).
// VIEW_BUDGET ne sert qu'à choisir une ligne budgétaire du projet dans le formulaire de réquisition.
router.get('/budget/search', hasPermission('VIEW_BUDGET'), budgetController.search);
router.get('/budget/summary', hasPermission('MANAGE_BUDGET'), budgetController.getSummary);
router.get('/budget/:id', hasPermission('MANAGE_BUDGET'), budgetController.getOne);
router.post('/budget', hasPermission('MANAGE_BUDGET'), budgetController.create);
router.post('/budget/expenses', hasPermission('MANAGE_BUDGET'), budgetController.addExpense);
router.put('/budget/:id', hasPermission('MANAGE_BUDGET'), budgetController.update);
router.delete('/budget/:id', hasPermission('MANAGE_BUDGET'), budgetController.delete);

router.get('/budget/by-project/:projectId', hasPermission('VIEW_BUDGET'), budgetController.getByProject);

// ============================================
// ROUTES DES BONS DE RÉCEPTION (GRN)
// ============================================
router.get('/goods-receipts',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  grnController.getAll.bind(grnController)
);
router.get('/goods-receipts/:id/pdf',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  grnController.generatePDF.bind(grnController)
);
router.get('/goods-receipts/:id',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  grnController.getById.bind(grnController)
);
router.post('/goods-receipts',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  grnController.create.bind(grnController)
);
router.get('/purchase-orders/:poId/goods-receipts',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  grnController.getByPO.bind(grnController)
);
router.patch('/goods-receipts/:id/status',
  authenticate, hasPermission('APPROVE_PURCHASE_ORDERS'),
  grnController.updateStatus.bind(grnController)
);

// ============================================
// ROUTES DES NOTES D'ACCEPTATION DE SERVICE (SAN)
// ============================================
router.get('/service-acceptance-notes',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  sanController.getAll.bind(sanController)
);
router.get('/service-acceptance-notes/:id',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  sanController.getById.bind(sanController)
);
router.post('/service-acceptance-notes',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  sanController.create.bind(sanController)
);
router.get('/purchase-orders/:poId/service-acceptance-notes',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  sanController.getByPO.bind(sanController)
);

// ============================================
// ROUTES DES FACTURES
// ============================================
router.get('/invoices',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  invoiceController.getAll.bind(invoiceController)
);
router.get('/invoices/:id',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  invoiceController.getById.bind(invoiceController)
);
router.post('/invoices',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  invoiceController.create.bind(invoiceController)
);
router.post('/invoices/:id/match',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  invoiceController.runMatch.bind(invoiceController)
);
router.post('/invoices/:id/approve',
  authenticate, hasPermission('APPROVE_PURCHASE_ORDERS'),
  invoiceController.approve.bind(invoiceController)
);
router.post('/invoices/:id/reject',
  authenticate, hasPermission('APPROVE_PURCHASE_ORDERS'),
  invoiceController.reject.bind(invoiceController)
);

// ============================================
// ROUTES DES PAIEMENTS
// ============================================
router.get('/payments',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  paymentController.getAll.bind(paymentController)
);
router.get('/payments/:id',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  paymentController.getById.bind(paymentController)
);
router.post('/payments',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  paymentController.create.bind(paymentController)
);
router.post('/payments/:id/approve',
  authenticate, hasPermission('APPROVE_PURCHASE_ORDERS'),
  paymentController.approve.bind(paymentController)
);
router.patch('/payments/:id/status',
  authenticate, hasPermission('APPROVE_PURCHASE_ORDERS'),
  paymentController.updateStatus.bind(paymentController)
);
router.get('/payments/:id/pdf',
  authenticate, hasPermission('VIEW_PURCHASE_ORDERS'),
  paymentController.generatePDF.bind(paymentController)
);

// ============================================
// APPELS D'OFFRES (procurement)
// ============================================
router.get('/tenders', hasPermission('MANAGE_TENDERS'), tenderController.list.bind(tenderController));
router.get('/tenders/candidates', hasPermission('MANAGE_TENDERS'), tenderController.candidates.bind(tenderController));
router.get('/tenders/eligible-count', hasPermission('MANAGE_TENDERS'), tenderController.eligibleCount.bind(tenderController));
router.get('/tenders/by-requisition/:requisitionId', hasPermission('MANAGE_TENDERS'), tenderController.getByRequisition.bind(tenderController));
router.get('/tenders/:id', hasPermission('MANAGE_TENDERS'), tenderController.getOne.bind(tenderController));
router.get('/tenders/:id/export/excel', hasPermission('MANAGE_TENDERS'), tenderController.exportExcel.bind(tenderController));
router.post('/tenders', hasPermission('MANAGE_TENDERS'), tenderController.create.bind(tenderController));
router.put('/tenders/:id', hasPermission('MANAGE_TENDERS'), tenderController.update.bind(tenderController));
router.post('/tenders/:id/close', hasPermission('MANAGE_TENDERS'), tenderController.close.bind(tenderController));
router.post('/tenders/:id/cancel', hasPermission('MANAGE_TENDERS'), tenderController.cancel.bind(tenderController));
router.post('/tenders/:id/award', hasPermission('MANAGE_TENDERS'), tenderController.award.bind(tenderController));

// ============================================
// PORTAIL FOURNISSEUR
// ============================================
router.get('/supplier-portal/dashboard', hasPermission('SUPPLIER_PORTAL'), tenderController.supplierDashboard.bind(tenderController));
router.get('/supplier-portal/me', hasPermission('SUPPLIER_PORTAL'), supplierPortalController.getMe.bind(supplierPortalController));
router.put('/supplier-portal/me', hasPermission('SUPPLIER_PORTAL'),
  supplierPortalController.handleFiles,
  supplierPortalController.updateMe.bind(supplierPortalController));
router.get('/supplier-portal/me/documents/:documentId/file', hasPermission('SUPPLIER_PORTAL'), supplierPortalController.getMyDocument.bind(supplierPortalController));
router.get('/supplier-portal/tenders', hasPermission('SUPPLIER_PORTAL'), tenderController.supplierList.bind(tenderController));
router.get('/supplier-portal/tenders/:id', hasPermission('SUPPLIER_PORTAL'), tenderController.supplierGetOne.bind(tenderController));
router.put('/supplier-portal/tenders/:id/submission', hasPermission('SUPPLIER_PORTAL'), tenderController.supplierSubmit.bind(tenderController));
router.get('/supplier-portal/tenders/:id/submission/pdf', hasPermission('SUPPLIER_PORTAL'), tenderController.supplierSubmissionPdf.bind(tenderController));

router.use('/upload',  uploadRoutes);
module.exports = router;
