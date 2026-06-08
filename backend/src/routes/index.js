// backend/src/routes/index.js
const express = require('express');
const router = express.Router();
const requisitionController = require('../controllers/RequisitionController');
const supplierModel = require('../models/SupplierModel');
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
const { authenticate, hasPermission, hasAnyPermission } = require('../middleware/auth');

const uploadRoutes = require('./upload');

// ============================================
// ROUTES D'AUTHENTIFICATION (publiques)
// ============================================
router.post('/auth/login', authController.login);
router.get('/auth/profile', authenticate, authController.getProfile);

router.use(authenticate);
// ============================================
// ROUTES DES RÉQUISITIONS (protégées)
// ============================================
router.post('/requisitions',
  authenticate,
  hasPermission('CREATE_REQUISITIONS'),
  (req, res) => requisitionController.create(req, res)
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
router.get('/suppliers',
  authenticate,
  hasPermission('VIEW_SUPPLIERS'),
  async (req, res) => {
    try {
      const suppliers = await supplierModel.getPrequalifiedSuppliers();
      res.json({ success: true, data: suppliers });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

router.post('/suppliers',
  authenticate,
  hasPermission('MANAGE_SUPPLIERS'),
  async (req, res) => {
    try {
      const result = await supplierModel.create(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

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
router.get('/dashboard/stats',
  authenticate,
  hasPermission('VIEW_DASHBOARD'),
  dashboardController.getStats
);

router.get('/dashboard/charts',
  authenticate,
  hasPermission('VIEW_DASHBOARD'),
  dashboardController.getChartData
);

router.get('/dashboard/recent-requisitions',
  authenticate,
  hasPermission('VIEW_DASHBOARD'),
  dashboardController.getRecentRequisitions
);

router.get('/dashboard/recent-activities',
  authenticate,
  hasPermission('VIEW_DASHBOARD'),
  dashboardController.getRecentActivities
);

router.get('/dashboard/department-summary',
  authenticate,
  hasPermission('VIEW_DASHBOARD'),
  dashboardController.getDepartmentSummary
);

router.get('/dashboard/supplier-summary',
  authenticate,
  hasPermission('VIEW_DASHBOARD'),
  dashboardController.getSupplierSummary
);

router.get('/dashboard/kpis',
  authenticate,
  hasPermission('VIEW_DASHBOARD'),
  dashboardController.getKPIs
);

// ============================================
// ROUTES DU WORKFLOW (protégées)
// ============================================
router.get('/workflow/process/:processInstanceId/history',
  authenticate,
  hasPermission('VIEW_REQUISITIONS'),
  workflowController.getProcessHistory
);

router.get('/workflow/process/:processInstanceId/status',
  authenticate,
  hasPermission('VIEW_REQUISITIONS'),
  workflowController.getProcessStatus
);

router.get('/workflow/process/:processInstanceId/tasks',
  authenticate,
  hasPermission('VIEW_REQUISITIONS'),
  workflowController.getProcessTasks
);

router.get('/workflow/process/:processInstanceId/variables',
  authenticate,
  hasPermission('VIEW_REQUISITIONS'),
  workflowController.getProcessVariables
);

router.post('/workflow/process/:processInstanceId/suspend',
  authenticate,
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


router.get('/profiles', hasPermission('MANAGE_USERS'), profileController.list);
router.get('/profiles/permissions', hasPermission('MANAGE_USERS'), profileController.getPermissions);
router.get('/profiles/:id', hasPermission('MANAGE_USERS'), profileController.getOne);
router.get('/profiles/:profileId/permissions', hasPermission('MANAGE_USERS'), profileController.getProfilePermissions);
router.post('/profiles/', hasPermission('MANAGE_USERS'), profileController.create);
router.put('/profiles/:id',hasPermission('MANAGE_USERS'), profileController.update);
router.delete('/profiles/:id', profileController.delete);
router.post('/profiles/:profileId/permissions/:permissionId', hasPermission('MANAGE_USERS'), profileController.assignPermission);
router.delete('/profiles/:profileId/permissions/:permissionId', hasPermission('MANAGE_USERS'), profileController.removePermission);



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



router.get('/budget', hasPermission('VIEW_BUDGET'), budgetController.list);
router.get('/budget/search', hasPermission('VIEW_BUDGET'), budgetController.search);
router.get('/budget/summary', hasPermission('VIEW_BUDGET'), budgetController.getSummary);
router.get('/budget/:id', hasPermission('VIEW_BUDGET'), budgetController.getOne);
router.post('/budget', hasPermission('MANAGE_BUDGET'), budgetController.create);
router.post('/budget/expenses', hasPermission('MANAGE_BUDGET'), budgetController.addExpense);
router.put('/budget/:id', hasPermission('MANAGE_BUDGET'), budgetController.update);
router.delete('/budget/:id', hasPermission('MANAGE_BUDGET'), budgetController.delete);

router.get('/budget/by-project/:projectId', hasPermission('VIEW_BUDGET'), budgetController.getByProject);

router.use('/upload',  uploadRoutes);
module.exports = router;