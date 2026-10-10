// backend/src/controllers/TaskController.js
const UserModel = require('../models/UserModel');
const camundaService = require('../services/CamundaService');
const db = require('../config/database');
const tenant = require('../utils/tenant');
const segregation = require('../utils/segregation');
const { taskLabel } = require('../utils/workflowLabels');
const supplierBankService = require('../services/SupplierBankService');
const { audit, AUDIT } = require('../utils/auditLog');

/** Process GoFlow appartenant à l'entreprise courante (via la réquisition liée) */
async function processIdsOfEnterprise(processIds) {
  if (!processIds.length) return new Set();
  const params = [processIds];
  const rows = await db.select(
    `SELECT process_instance_id FROM requisitions WHERE process_instance_id = ANY($1)${tenant.filter('enterprise_id', params)}`,
    params
  );
  return new Set(rows.map(r => r.process_instance_id));
}

/** Tâche active de l'entreprise courante, sinon null (on ne révèle pas les tâches des autres entreprises) */
async function findEnterpriseTask(taskId) {
  const task = ((await camundaService.getProcessTasks()) || []).find(t => t.id === taskId);
  if (!task) return null;
  const allowed = await processIdsOfEnterprise([task.processInstanceId].filter(Boolean));
  return allowed.has(task.processInstanceId) ? task : null;
}
const grnModel     = require('../models/GoodsReceiptModel');
const supplierConfirmationService = require('../services/SupplierConfirmationService');
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
 * Charger l'utilisateur courant avec ses groupes Camunda.
 * 'prof_manager' → 'manager' (correspond au candidateGroup BPMN)
 */
async function getCurrentUserContext(userId) {
  const user = await UserModel.findById(userId);
  const groups = (user?.profiles || []).map(p => p.id.replace('prof_', ''));
  return { id: userId, email: user?.email, groups, isAdmin: groups.includes('admin') };
}

// GoFlow stocke l'assignee par email (cf. claim) ; l'id est accepté pour les anciennes tâches
function isMine(task, currentUser) {
  return !!task.assignee && (task.assignee === currentUser.email || task.assignee === currentUser.id);
}

/**
 * Droits d'un utilisateur sur une tâche. conflict = code de séparation des tâches (utils/segregation, ex. SELF_APPROVAL :
 * approuver sa propre réquisition) → ni prise en charge ni complétion, raison renvoyée dans blockedReason.
 */
function getTaskPermissions(task, currentUser, conflict = null) {
  const isCompleted = task.status === 'completed';
  const inGroup = currentUser.isAdmin || currentUser.groups.includes(task.candidateGroup);
  return {
    isMine: isMine(task, currentUser),
    canClaim: !isCompleted && !task.assignee && inGroup && !conflict,
    // Libérer : la personne qui l'a prise, ou un admin (ex. collègue absent)
    canUnclaim: !isCompleted && !!task.assignee && (isMine(task, currentUser) || currentUser.isAdmin),
    canComplete: !isCompleted && isMine(task, currentUser) && !conflict,
    blockedReason: conflict || null,
  };
}

const conflictOf = (conflicts, task) => conflicts.get(`${task.processInstanceId}|${task.taskDefinitionKey}`) || null;

/**
 * GET /api/tasks/user
 * Récupérer les tâches de l'utilisateur courant (basé sur ses profils Camunda)
 */
async function getUserTasks(req, res) {
  try {
    const { processInstanceId } = req.query;
    const currentUser = await getCurrentUserContext(req.user.id);

    const [activeTasks, completedTasks] = await Promise.all([
      camundaService.getUserTasks(null, processInstanceId || null),
      camundaService.getCompletedTasks({ assignee: currentUser.email, processInstanceId })
    ]);

    // Tâches actives visibles : celles de ses groupes (ou toutes pour l'admin) ;
    // tâches terminées : uniquement celles qu'il a lui-même traitées
    let userTasks = [
      ...(activeTasks || []).filter(t => currentUser.isAdmin || isMine(t, currentUser) || currentUser.groups.includes(t.candidateGroup)),
      ...(completedTasks || [])
    ];

    // Garder uniquement les tâches dont le processInstanceId correspond
    // à une réquisition existante en base
    if ((userTasks || []).length > 0) {
      const processIds = [...new Set(userTasks.map(t => t.processInstanceId).filter(Boolean))];
      if (processIds.length > 0) {
        // Réquisitions existantes ET de l'entreprise courante
        const validIds = await processIdsOfEnterprise(processIds);
        userTasks = userTasks.filter(t => validIds.has(t.processInstanceId));
      } else {
        userTasks = [];
      }
    }

    // Réquisition de chaque tâche, lue en base (les variables GoFlow peuvent manquer) : « Mes tâches » renvoie
    // vers l'onglet tâches de la réquisition, seul endroit où une tâche est prise en charge et traitée
    const reqRows = userTasks.length
      ? await db.select(
        'SELECT id, requisition_number, title, process_instance_id FROM requisitions WHERE process_instance_id = ANY($1)',
        [[...new Set(userTasks.map(t => t.processInstanceId).filter(Boolean))]]
      )
      : [];
    const reqByProcess = new Map(reqRows.map(r => [r.process_instance_id, r]));
    const conflicts = await segregation.taskConflicts((userTasks || []).filter(t => t.status !== 'completed'), currentUser.id);
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
          created: task.createdAt || task.createTime,
          completedAt: task.completedAt,
          due: task.dueDate,
          state: task.status,
          followUp: task.followUpDate,
          priority: task.priority,
          status: task.status === 'completed' ? 'COMPLETED' : (task.assignee ? 'ASSIGNED' : 'UNASSIGNED'),
          variables,
          requisitionId: reqByProcess.get(task.processInstanceId)?.id || null,
          requisitionNumber: reqByProcess.get(task.processInstanceId)?.requisition_number || null,
          requisitionTitle: reqByProcess.get(task.processInstanceId)?.title || null,
          ...getTaskPermissions(task, currentUser, conflictOf(conflicts, task))
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

    const all = (await camundaService.getGroupTasks(candidateGroup, processInstanceId)) || [];
    const allowed = await processIdsOfEnterprise([...new Set(all.map(t => t.processInstanceId).filter(Boolean))]);
    const tasks = all.filter(t => allowed.has(t.processInstanceId));
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
    const currentUser = await getCurrentUserContext(req.user.id);

    const task = await findEnterpriseTask(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Tâche introuvable ou déjà terminée' });
    }
    if (task.assignee) {
      return res.status(409).json({ success: false, message: `Tâche déjà prise en charge par ${task.assignee}` });
    }
    const conflict = await segregation.taskConflict(task, currentUser.id);
    if (conflict) {
      const error = await segregation.block(req, {
        code: conflict,
        message: 'Séparation des tâches : vous ne pouvez pas approuver votre propre demande — un autre membre du groupe doit la traiter',
        entity: { type: 'task', id: task.taskDefinitionKey, label: taskLabel(task.taskDefinitionKey) || task.taskName || task.name },
        details: { taskId, processInstanceId: task.processInstanceId, step: 'claim' },
      });
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    if (!getTaskPermissions(task, currentUser).canClaim) {
      return res.status(403).json({
        success: false,
        message: `Cette tâche est réservée au groupe « ${task.candidateGroup} »`
      });
    }

    // L'assignee est toujours l'email de l'utilisateur connecté (pas une valeur venant du client)
    const result = await camundaService.assignTask(taskId, currentUser.email);
    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error || 'Erreur lors de la prise en charge' });
    }

    res.json({ success: true, message: `Tâche ${taskId} réclamée par ${currentUser.email}` });
  } catch (error) {
    console.error('Error claiming task:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la réclamation', error: error.message });
  }
}

/**
 * POST /api/tasks/:taskId/unclaim — rend la tâche à son groupe (GoFlow : TASK_UNCLAIMED)
 */
async function unclaimTask(req, res) {
  try {
    const { taskId } = req.params;
    const currentUser = await getCurrentUserContext(req.user.id);

    const task = await findEnterpriseTask(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Tâche introuvable ou déjà terminée' });
    }
    if (!task.assignee) {
      return res.status(409).json({ success: false, message: 'Cette tâche n\'est prise en charge par personne' });
    }
    if (!getTaskPermissions(task, currentUser).canUnclaim) {
      return res.status(403).json({ success: false, message: `Seul(e) ${task.assignee} ou un administrateur peut libérer cette tâche` });
    }

    const result = await camundaService.unassignTask(taskId);
    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error || 'Erreur lors de la libération' });
    }

    res.json({ success: true, message: `Tâche ${taskId} libérée` });
  } catch (error) {
    console.error('Error unclaiming task:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la libération', error: error.message });
  }
}

function getVariableFromVars(variables, key) {
  if (!variables) return null;
  // variables can be either flat { key: value } or Camunda shape { key: { value } }
  const v = variables[key];
  return v && typeof v === 'object' && 'value' in v ? v.value : v;
}

/**
 * Document créé depuis une tâche GoFlow (GRN, SAN, facture, paiement) → workflow_history, rattaché à la RÉQUISITION
 * (entity_id est un UUID : l'id entier du bon de commande y échouait) ; le n° du bon et le document sont dans comments
 * (JSON lu par RequisitionTimelineService). N'interrompt jamais la complétion de la tâche.
 */
async function logDocumentEvent({ requisitionId, poId, taskId, userId, taskName, action, document = null, comment = null }) {
  try {
    const po = poId ? await db.one('SELECT id, po_number FROM purchase_orders WHERE id = $1', [poId]) : null;
    await db.exec(
      `INSERT INTO workflow_history (entity_type, entity_id, process_instance_id, task_id, task_name, action, comments, performed_by, performed_at)
       SELECT 'requisition', r.id, r.process_instance_id, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP FROM requisitions r WHERE r.id = $1`,
      [requisitionId, taskId, taskName, action,
       JSON.stringify({ poId: po?.id || poId || null, poNumber: po?.po_number || null, document, comment }), userId]
    );
  } catch (error) {
    console.error('Historique %s non enregistré : %s', action, error.message);
  }
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
      taskDefinitionKey: bodyTaskKey,
      requisitionId: bodyRequisitionId,
      estimatedAmount
    } = req.body;
    const userId = req.user?.id;

    // La tâche doit appartenir à un processus de l'entreprise courante
    const task = await findEnterpriseTask(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Tâche introuvable ou déjà terminée' });
    }

    // Contrôles côté serveur (jamais sur les valeurs envoyées par le client) : groupe de la tâche, prise en charge,
    // séparation des tâches. La clé et la réquisition viennent de GoFlow / de la base.
    const taskDefinitionKey = task.taskDefinitionKey || bodyTaskKey;
    const currentUser = await getCurrentUserContext(userId);
    if (!(currentUser.isAdmin || currentUser.groups.includes(task.candidateGroup) || isMine(task, currentUser))) {
      await audit(req, AUDIT.TASK_COMPLETION_DENIED, {
        entity: { type: 'task', id: taskDefinitionKey, label: taskLabel(task.taskDefinitionKey || taskDefinitionKey) || task.taskName || task.name },
        details: { taskId, reason: 'NOT_IN_GROUP', candidateGroup: task.candidateGroup },
      });
      return res.status(403).json({ success: false, code: 'TASK_NOT_IN_GROUP', message: `Cette tâche est réservée au groupe « ${task.candidateGroup} »` });
    }
    if (task.assignee && !isMine(task, currentUser) && !currentUser.isAdmin) {
      await audit(req, AUDIT.TASK_COMPLETION_DENIED, {
        entity: { type: 'task', id: taskDefinitionKey, label: taskLabel(task.taskDefinitionKey || taskDefinitionKey) || task.taskName || task.name },
        details: { taskId, reason: 'CLAIMED_BY_OTHER', assignee: task.assignee },
      });
      return res.status(409).json({ success: false, code: 'TASK_CLAIMED_BY_OTHER', message: `Tâche prise en charge par ${task.assignee}` });
    }
    const conflict = await segregation.taskConflict({ ...task, taskDefinitionKey }, userId);
    if (conflict) {
      const error = await segregation.block(req, {
        code: conflict,
        message: 'Séparation des tâches : vous ne pouvez pas approuver votre propre demande — un autre membre du groupe doit la traiter',
        entity: { type: 'task', id: taskDefinitionKey, label: taskLabel(task.taskDefinitionKey || taskDefinitionKey) || task.taskName || task.name },
        details: { taskId, processInstanceId: task.processInstanceId, step: 'complete' },
      });
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    const linkedRequisition = task.processInstanceId
      ? await db.one('SELECT id FROM requisitions WHERE process_instance_id = $1', [task.processInstanceId])
      : null;
    const requisitionId = linkedRequisition?.id || bodyRequisitionId;

    // Paiement saisi depuis la tâche : refusé AVANT de terminer l'étape si les coordonnées bancaires ne sont pas vérifiées
    if (taskDefinitionKey === 'Activity_ProcessPayment' && variables.amount) {
      await supplierBankService.assertPayable(req, { invoiceId: variables.invoiceId || null, poId: variables.poId || null });
    }

    // Build Camunda variables
    const taskVariables = { ...variables };
    if (comment) taskVariables.comment = comment;
    // Ajustement budgétaire terminé sans décision explicite (ancienne fenêtre générique) : abandon, comme avant —
    // la relance de la vérification passe par POST /requisitions/:id/budget-adjustment
    if (taskDefinitionKey === 'Activity_BudgetAdjustment' && typeof taskVariables.budgetAdjusted !== 'boolean') {
      taskVariables.budgetAdjusted = false;
    }

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
              observations,
              warehouseId: variables.warehouseId || null
            }, { userId });
            // Inject grnCompliant into the Camunda variables (already completed above,
            // so we just store the result in workflow history)
            await logDocumentEvent({
              requisitionId, poId, taskId, userId, taskName: 'Activity_GoodsReceipt',
              action: grnResult.grnCompliant ? 'GRN_COMPLETE' : 'GRN_PARTIAL',
              document: { type: 'grn', id: grnResult.id, number: grnResult.grnNumber, status: grnResult.status },
            });
          }
        }

        // --- Service Acceptance task (requester) ---
        if (taskDefinitionKey === 'Activity_ServiceAcceptance') {
          const serviceAccepted = variables.serviceAccepted ?? variables.accepted ?? true;
          const poId = variables.poId;
          if (poId) {
            await logDocumentEvent({
              requisitionId, poId, taskId, userId, taskName: 'Activity_ServiceAcceptance',
              action: serviceAccepted ? 'SERVICE_ACCEPTED' : 'SERVICE_REJECTED',
              comment: variables.comments || null,
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
            await logDocumentEvent({
              requisitionId, poId, taskId, userId, taskName: 'Activity_EnterInvoice',
              action: invResult.invoiceValid ? 'INVOICE_MATCHED' : 'INVOICE_MISMATCH',
              document: { type: 'invoice', id: invResult.id, number: invResult.invoiceNumber, status: invResult.match_status },
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
            await logDocumentEvent({
              requisitionId, poId, taskId, userId, taskName: 'Activity_ProcessPayment', action: 'PAYMENT_RECORDED',
              document: { type: 'payment', id: payResult.id, number: payResult.paymentNumber, amount: variables.amount },
            });
          }
        }

        // --- Ajustement budgétaire abandonné depuis « Mes tâches » : réquisition annulée ---
        if (taskDefinitionKey === 'Activity_BudgetAdjustment' && taskVariables.budgetAdjusted === false) {
          await db.exec(
            `UPDATE requisitions SET status = 'CANCELLED', rejected_reason = COALESCE($2, 'Abandonnée après budget insuffisant'),
                    updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'BUDGET_INSUFFICIENT'`,
            [requisitionId, comment ? `Abandonnée après budget insuffisant — ${String(comment).slice(0, 500)}` : null]
          );
        }

        // --- Confirmation fournisseur (achats, depuis « Mes tâches ») : réponse enregistrée sur le bon ---
        if (taskDefinitionKey === 'Activity_SupplierConfirmation') {
          const po = await db.one(
            `SELECT id, supplier_response FROM purchase_orders WHERE requisition_id = $1 AND status IN ('PO_APPROVED', 'PO_SENT')
             ORDER BY created_at DESC LIMIT 1`,
            [requisitionId]
          );
          if (po && po.supplier_response !== 'CONFIRMED') {
            await supplierConfirmationService.respond(po.id, {
              response: 'CONFIRMED', deliveryDate: variables.confirmedDeliveryDate || null,
              reference: variables.supplierReference || null, comment: comment || variables.comment || null,
            }, { userId, source: 'PROCUREMENT', io: req.io, skipTask: true });
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
    if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details });
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

    const [currentUser, activeTasks, completedTasks] = await Promise.all([
      getCurrentUserContext(req.user.id),
      camundaService.getProcessTasks(processInstanceId),
      camundaService.getCompletedTasks({ processInstanceId })
    ]);

    const conflicts = await segregation.taskConflicts(activeTasks || [], currentUser.id);
    const allTasks = [...(activeTasks || []), ...(completedTasks || [])].map(task => ({
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
      status: task.status === 'completed' ? 'COMPLETED' : 'PENDING',
      ...getTaskPermissions(task, currentUser, task.status === 'completed' ? null : conflictOf(conflicts, task))
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
  unclaimTask,
  completeTask,
  getTasksByProcess,
  getPendingTasksCount,
  getTaskById
};
