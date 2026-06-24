// backend/src/controllers/TaskController.js
const UserModel = require('../models/UserModel');
const camundaService = require('../services/CamundaService');
const db = require('../config/database');
const grnModel     = require('../models/GoodsReceiptModel');
const invoiceModel = require('../models/InvoiceModel');
const paymentModel = require('../models/PaymentModel');

// Task definition keys for each approval level (must match BPMN Activity IDs)
const REQUISITION_APPROVAL_TASKS = [
  'Activity_ValidationN1_Manager',
  'Activity_ValidationN2_Finance',
  'Activity_ValidationN3_DG'
];

// Amount thresholds matching the BPMN gateways
const THRESHOLD_N1 = 25000;
const THRESHOLD_N2 = 100000;

/**
 * Determine if this approval level is the final one for this amount,
 * i.e. approved=true here means the requisition is fully approved.
 */
function isFinalApprovalLevel(taskDefinitionKey, estimatedAmount) {
  const amount = parseFloat(estimatedAmount) || 0;
  if (taskDefinitionKey === 'Activity_ValidationN1_Manager' && amount < THRESHOLD_N1) return true;
  if (taskDefinitionKey === 'Activity_ValidationN2_Finance' && amount >= THRESHOLD_N1 && amount < THRESHOLD_N2) return true;
  if (taskDefinitionKey === 'Activity_ValidationN3_DG') return true;
  return false;
}

/**
 * GET /api/tasks/user
 * Récupérer les tâches de l'utilisateur courant (basé sur ses profils Camunda)
 */
async function getUserTasks(req, res) {
  try {
    const { assignee, processInstanceId } = req.query;
    const currentUserId = req.user.id;
    const user = await UserModel.findById(currentUserId);
    // Strip 'prof_' prefix: 'prof_manager' → 'manager' matches BPMN candidateGroup
    const profiles = (user.profiles || []).map(p => p.id.replace('prof_', ''));

    let tasks = [];
    if (processInstanceId) {
      tasks = await camundaService.getUserTasks(null, processInstanceId);
    } else {
      tasks = await camundaService.getUserTasks(null);
    }

    let userTasks = [];
    if (profiles.includes('admin')) {
      userTasks = tasks;
    } else {
      userTasks = (tasks || []).filter(
        t => t.assignee == currentUserId || profiles.includes(t.candidateGroup)
      );
    }

    // Garder uniquement les tâches dont le processInstanceId correspond
    // à une réquisition existante en base
    if (userTasks.length > 0) {
      const processIds = [...new Set(userTasks.map(t => t.processInstanceId).filter(Boolean))];
      if (processIds.length > 0) {
        const rows = await db.select(
          `SELECT process_instance_id FROM requisitions WHERE process_instance_id = ANY($1)`,
          [processIds]
        );
        const validIds = new Set(rows.map(r => r.process_instance_id));
        userTasks = userTasks.filter(t => validIds.has(t.processInstanceId));
      } else {
        userTasks = [];
      }
    }

    const enrichedTasks = await Promise.all(
      (userTasks || []).map(async (task) => {
        let variables = null;
        try {
          variables = await camundaService.getProcessVariables(task.processInstanceId);
        } catch (e) {
          // non-blocking — no variables available yet
        }

        return {
          id: task.id,
          name: task.taskName || task.name,
          candidateGroup: task.candidateGroup,
          processInstanceId: task.processInstanceId,
          executionId: task.executionId,
          taskDefinitionKey: task.taskDefinitionKey,
          assignee: task.assignee,
          created: task.createTime,
          due: task.dueDate,
          state: task.status,
          followUp: task.followUpDate,
          priority: task.priority,
          status: task.assignee ? 'ASSIGNED' : 'UNASSIGNED',
          variables,
          canClaim: !task.assignee,
          canComplete: task.assignee === assignee
        };
      })
    );

    res.json({ success: true, data: enrichedTasks, count: enrichedTasks.length });
  } catch (error) {
    console.error('Error getting user tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des tâches utilisateur',
      error: error.message
    });
  }
}

/**
 * GET /api/tasks/group
 */
async function getGroupTasks(req, res) {
  try {
    const { candidateGroup, processInstanceId } = req.query;

    if (!candidateGroup) {
      return res.status(400).json({ success: false, message: 'candidateGroup est requis' });
    }

    const tasks = await camundaService.getGroupTasks(candidateGroup, processInstanceId);
    res.json({ success: true, data: tasks, count: tasks.length });
  } catch (error) {
    console.error('Error getting group tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des tâches de groupe',
      error: error.message
    });
  }
}

/**
 * GET /api/tasks/:taskId/form
 */
async function getTaskForm(req, res) {
  try {
    const form = {
      key: 'generic-form',
      title: 'Traitement de la tâche',
      fields: [
        { id: 'comment', label: 'Commentaire', type: 'textarea', required: false },
        { id: 'approved', label: 'Approuver', type: 'checkbox', required: false, defaultValue: false }
      ]
    };
    res.json({ success: true, data: form });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur formulaire', error: error.message });
  }
}

/**
 * POST /api/tasks/:taskId/claim
 */
async function claimTask(req, res) {
  try {
    const { taskId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId est requis' });
    }

    const result = await camundaService.assignTask(taskId, userId);
    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error || 'Erreur lors de la prise en charge' });
    }

    res.json({ success: true, message: `Tâche ${taskId} réclamée par ${userId}` });
  } catch (error) {
    console.error('Error claiming task:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la réclamation', error: error.message });
  }
}

function getVariableFromVars(variables, key) {
  if (!variables) return null;
  // variables can be either flat { key: value } or Camunda shape { key: { value } }
  const v = variables[key];
  return v && typeof v === 'object' && 'value' in v ? v.value : v;
}

/**
 * POST /api/tasks/:taskId/complete
 *
 * Body:
 *   variables         – form values { approved, poApproved, comment, … }
 *   comment           – optional top-level comment
 *   taskDefinitionKey – BPMN activity key (e.g. 'Activity_ManagerApproval')
 *   requisitionId     – DB id of the linked requisition
 *   estimatedAmount   – used to determine the final approval level
 */
async function completeTask(req, res) {
  try {
    const { taskId } = req.params;
    const {
      variables = {},
      comment,
      taskDefinitionKey,
      requisitionId,
      estimatedAmount
    } = req.body;
    const userId = req.user?.id;

    // Build Camunda variables
    const taskVariables = { ...variables };
    if (comment) taskVariables.comment = comment;

    // 1. Complete the Camunda user task
    const result = await camundaService.completeTask(taskId, taskVariables);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Erreur lors de la complétion'
      });
    }

    // 2. Sync DB state based on task type
    if (taskDefinitionKey && requisitionId) {
      try {
        // --- Requisition approval tasks (N1 / N2 / N3) ---
        if (REQUISITION_APPROVAL_TASKS.includes(taskDefinitionKey)) {
          const approved = variables.approved;

          if (approved === false) {
            await db.update('requisitions', {
              status: 'REJECTED',
              rejected_at: new Date(),
              updated_at: new Date()
            }, 'id', requisitionId);
          } else if (approved === true && isFinalApprovalLevel(taskDefinitionKey, estimatedAmount)) {
            await db.update('requisitions', {
              status: 'APPROVED',
              approved_at: new Date(),
              updated_at: new Date()
            }, 'id', requisitionId);
          }

          await db.insert('workflow_history', {
            entity_type: 'requisition',
            entity_id: requisitionId,
            task_id: taskId,
            task_name: taskDefinitionKey,
            action: approved ? 'APPROVED' : 'REJECTED',
            comments: comment || null,
            performed_by: userId,
            performed_at: new Date()
          });
        }

        // --- GRN task (logistic) ---
        if (taskDefinitionKey === 'Activity_GoodsReceipt') {
          const grnItems  = variables.grnItems  || [];
          const observations = variables.observations || null;
          const poId = variables.poId || getVariableFromVars(variables, 'poId');

          if (poId) {
            const grnResult = await grnModel.create({
              poId,
              receivedBy: userId,
              grnItems: Array.isArray(grnItems) ? grnItems : JSON.parse(grnItems || '[]'),
              observations
            });
            // Inject grnCompliant into the Camunda variables (already completed above,
            // so we just store the result in workflow history)
            await db.insert('workflow_history', {
              entity_type: 'purchase_order',
              entity_id:   poId,
              task_id:     taskId,
              task_name:   'Activity_GoodsReceipt',
              action:      grnResult.grnCompliant ? 'GRN_COMPLETE' : 'GRN_PARTIAL',
              comments:    `GRN ${grnResult.grnNumber} — statut: ${grnResult.status}`,
              performed_by: userId,
              performed_at: new Date()
            });
          }
        }

        // --- Service Acceptance task (requester) ---
        if (taskDefinitionKey === 'Activity_ServiceAcceptance') {
          const serviceAccepted = variables.serviceAccepted ?? variables.accepted ?? true;
          const poId = variables.poId;
          if (poId) {
            await db.insert('workflow_history', {
              entity_type: 'purchase_order',
              entity_id:   poId,
              task_id:     taskId,
              task_name:   'Activity_ServiceAcceptance',
              action:      serviceAccepted ? 'SERVICE_ACCEPTED' : 'SERVICE_REJECTED',
              comments:    variables.comments || null,
              performed_by: userId,
              performed_at: new Date()
            });
          }
        }

        // --- Enter Invoice task (finance) ---
        if (taskDefinitionKey === 'Activity_EnterInvoice') {
          const poId = variables.poId;
          if (variables.totalAmount && poId) {
            const grnId = variables.grnId || null;
            const invResult = await invoiceModel.create({
              poId,
              grnId,
              invoiceDate: variables.invoiceDate || new Date().toISOString().split('T')[0],
              dueDate:     variables.dueDate || null,
              subtotal:    variables.subtotal || variables.totalAmount,
              taxAmount:   variables.taxAmount || 0,
              totalAmount: variables.totalAmount,
              currency:    variables.currency || null,
              notes:       variables.notes || null,
              createdBy:   userId,
              camundaTaskId: taskId
            });
            // Patch the already-sent Camunda variables with invoiceValid
            // (the completeTask call above already ran — this is just for DB logging)
            await db.insert('workflow_history', {
              entity_type: 'purchase_order',
              entity_id:   poId,
              task_id:     taskId,
              task_name:   'Activity_EnterInvoice',
              action:      invResult.invoiceValid ? 'INVOICE_MATCHED' : 'INVOICE_MISMATCH',
              comments:    `Facture ${invResult.invoiceNumber} — rapprochement: ${invResult.match_status}`,
              performed_by: userId,
              performed_at: new Date()
            });
          }
        }

        // --- Process Payment task (finance) ---
        if (taskDefinitionKey === 'Activity_ProcessPayment') {
          const invoiceId = variables.invoiceId || null;
          const poId      = variables.poId || null;
          if (variables.amount && (invoiceId || poId)) {
            const payResult = await paymentModel.create({
              invoiceId,
              poId,
              paymentDate:   variables.paymentDate || new Date().toISOString().split('T')[0],
              amount:        variables.amount,
              currency:      variables.currency || null,
              paymentMethod: variables.paymentMethod || 'BANK_TRANSFER',
              reference:     variables.reference || null,
              bankAccount:   variables.bankAccount || null,
              notes:         variables.notes || null,
              createdBy:     userId,
              camundaTaskId: taskId
            });
            await db.insert('workflow_history', {
              entity_type: 'purchase_order',
              entity_id:   poId || invoiceId,
              task_id:     taskId,
              task_name:   'Activity_ProcessPayment',
              action:      'PAYMENT_RECORDED',
              comments:    `Paiement ${payResult.paymentNumber} — ${variables.amount}`,
              performed_by: userId,
              performed_at: new Date()
            });
          }
        }

        // --- PO Approval task ---
        if (taskDefinitionKey === 'Activity_POApproval') {
          const poApproved = variables.poApproved;

          const rows = await db.select(
            'SELECT id FROM purchase_orders WHERE requisition_id = $1 ORDER BY created_at DESC LIMIT 1',
            [requisitionId]
          );

          if (rows.length > 0) {
            const poId = rows[0].id;
            await db.update('purchase_orders', {
              status: poApproved ? 'PO_APPROVED' : 'PO_REJECTED',
              approved_by: poApproved ? userId : null,
              approved_at: poApproved ? new Date() : null,
              updated_at: new Date()
            }, 'id', poId);

            await db.insert('approvals', {
              entity_type: 'purchase_order',
              entity_id: poId,
              approver_id: userId,
              status: poApproved ? 'APPROVED' : 'REJECTED',
              comments: comment || null,
              approved_at: new Date()
            });
          }
        }
      } catch (dbError) {
        // DB sync failure is logged but must not fail the response
        // because the Camunda task is already completed
        console.error('[TaskController] DB sync error after task completion:', dbError.message);
      }
    }

    res.json({ success: true, message: 'Tâche complétée avec succès' });
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la complétion de la tâche',
      error: error.message
    });
  }
}

/**
 * GET /api/tasks/process/:processInstanceId
 */
async function getTasksByProcess(req, res) {
  try {
    const { processInstanceId } = req.params;

    if (!processInstanceId) {
      return res.status(400).json({ success: false, message: 'processInstanceId est requis' });
    }

    const activeTasks = await camundaService.getProcessTasks(processInstanceId);

    const allTasks = (activeTasks || []).map(task => ({
      id: task.id,
      name: task.taskName || task.name,
      processInstanceId: task.processInstanceId,
      executionId: task.executionId,
      taskDefinitionKey: task.taskDefinitionKey,
      assignee: task.assignee,
      created: task.createdAt,
      candidateGroup: task.candidateGroup,
      due: task.dueDate,
      followUp: task.followUpDate,
      priority: task.priority,
      completedAt: task.completedAt,
      status: task.status === 'completed' ? 'COMPLETED' : 'PENDING'
    }));

    res.json({ success: true, data: allTasks, count: allTasks.length, processInstanceId });
  } catch (error) {
    console.error('Error getting tasks by process:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des tâches du processus',
      error: error.message
    });
  }
}

async function getPendingTasksCount(req, res) {
  try {
    const { processInstanceId } = req.params;
    const activeTasks = await camundaService.getProcessTasks(processInstanceId);
    const pendingCount = (activeTasks || []).filter(t => !t.endTime).length;
    res.json({ success: true, count: pendingCount, processInstanceId });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur comptage tâches', error: error.message });
  }
}

async function getTaskById(req, res) {
  try {
    const { taskId } = req.params;
    const tasks = await camundaService.getProcessTasks();
    const task = (tasks || []).find(t => t.id === taskId);

    if (!task) {
      return res.status(404).json({ success: false, message: 'Tâche non trouvée' });
    }

    const variables = await camundaService.getProcessVariables(task.processInstanceId);
    res.json({
      success: true,
      data: {
        id: task.id,
        name: task.name,
        processInstanceId: task.processInstanceId,
        assignee: task.assignee,
        created: task.createTime,
        due: task.dueDate,
        priority: task.priority,
        variables
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur récupération tâche', error: error.message });
  }
}

module.exports = {
  getUserTasks,
  getGroupTasks,
  getTaskForm,
  claimTask,
  completeTask,
  getTasksByProcess,
  getPendingTasksCount,
  getTaskById
};
