// backend/src/controllers/TaskController.js
const UserModel = require('../models/UserModel');
const requisitionModel = require('../models/RequisitionModel');
const camundaService = require('../services/CamundaService');
const db = require('../config/database');
const tenant = require('../utils/tenant');
const segregation = require('../utils/segregation');
const { taskLabel, PERSONAL_TASKS } = require('../utils/workflowLabels');
const revisionService = require('../services/RequisitionRevisionService');
const approvalPolicy = require('../utils/approvalPolicy');
const supplierBankService = require('../services/SupplierBankService');
const { audit, AUDIT } = require('../utils/auditLog');
const projectAccess = require('../utils/projectAccess');

/** Réquisitions de l'entreprise courante liées à ces process GoFlow → Map(processInstanceId → réquisition) */
async function requisitionsOfEnterprise(processIds) {
  if (!processIds.length) return new Map();
  const params = [processIds];
  const rows = await db.select(
    `SELECT id, requisition_number, title, project_id, requester_id, process_instance_id FROM requisitions
     WHERE process_instance_id = ANY($1)${tenant.filter('enterprise_id', params)}`,
    params
  );
  return new Map(rows.map(r => [r.process_instance_id, r]));
}

/** Tâche active de l'entreprise courante (+ projectId de sa réquisition), sinon null (on ne révèle pas les tâches des autres entreprises) */
async function findEnterpriseTask(taskId) {
  const task = ((await camundaService.getProcessTasks()) || []).find(t => t.id === taskId);
  if (!task) return null;
  const requisition = (await requisitionsOfEnterprise([task.processInstanceId].filter(Boolean))).get(task.processInstanceId);
  return requisition ? { ...task, projectId: requisition.project_id || null, requesterId: requisition.requester_id || null } : null;
}
const supplierConfirmationService = require('../services/SupplierConfirmationService');
const invoiceModel = require('../models/InvoiceModel');
const paymentModel = require('../models/PaymentModel');

// Task definition keys for each approval level (must match BPMN Activity IDs)
const REQUISITION_APPROVAL_TASKS = [
  'Activity_ValidationN1_Manager',
  'Activity_ValidationN2_Finance',
  'Activity_ValidationN3_DG'
];

/**
 * Cette approbation est-elle la dernière (approved = true → réquisition approuvée) ? Niveau retenu pour la réquisition
 * (approval_level, calculé par check_budget selon la politique du projet) ; réquisition antérieure : seuils de la
 * politique effective appliqués au montant.
 */
function isFinalApprovalLevel(taskDefinitionKey, { approvalLevel, amount, policy }) {
  const level = approvalLevel || approvalPolicy.levelFor(amount, policy || approvalPolicy.DEFAULT_POLICY);
  return approvalPolicy.LEVEL_TASKS[level] === taskDefinitionKey || taskDefinitionKey === 'Activity_ValidationN3_DG';
}

/**
 * Charger l'utilisateur courant avec ses groupes Camunda.
 * 'prof_manager' → 'manager' (correspond au candidateGroup BPMN). groups = tous ses profils ; scope = où ils
 * s'exercent (profils de workflow liés au projet : utils/projectAccess)
 */
async function getCurrentUserContext(userId) {
  const [user, scope] = await Promise.all([UserModel.findById(userId), projectAccess.loadScope(userId)]);
  const groups = (user?.profiles || []).map(p => p.id.replace('prof_', ''));
  return { id: userId, email: user?.email, groups, isAdmin: groups.includes('admin'), scope };
}

/**
 * L'utilisateur a le groupe de la tâche sur le projet de sa réquisition. Étape du groupe « requester » (SAN…) d'une
 * réquisition d'un autre : seulement s'il voit les réquisitions du projet (migration 30 — un simple demandeur ne voit
 * que les siennes)
 */
const inGroupOnProject = (task, currentUser, projectId, requesterId = null) =>
  projectAccess.groupsOnProject(currentUser.scope, projectId).has(task.candidateGroup)
  && (task.candidateGroup !== 'requester' || !requesterId || String(requesterId) === String(currentUser.id)
    || projectAccess.seesProjectRequisitions(currentUser.scope, projectId));

// Tâches attribuées par le processus à une personne (assignee ${requester}) : elle les traite sans le profil
// (PERSONAL_TASKS : ajustement budgétaire, correction de la réquisition)

// GoFlow stocke l'assignee par email (cf. claim) ; l'id est accepté pour les anciennes tâches
function isMine(task, currentUser) {
  return !!task.assignee && (task.assignee === currentUser.email || task.assignee === currentUser.id);
}

/**
 * Droits d'un utilisateur sur une tâche. conflict = code de séparation des tâches (utils/segregation, ex. SELF_APPROVAL :
 * approuver sa propre réquisition) → ni prise en charge ni complétion, raison renvoyée dans blockedReason.
 */
function getTaskPermissions(task, currentUser, conflict = null, projectId = null, requesterId = null) {
  const isCompleted = task.status === 'completed';
  const onProject = inGroupOnProject(task, currentUser, projectId, requesterId);
  const inGroup = currentUser.isAdmin || onProject;
  const groupHere = projectAccess.groupsOnProject(currentUser.scope, projectId).has(task.candidateGroup);
  // Profil détenu, mais pas sur le projet de cette réquisition (profils BPMN liés au projet)
  const notOnProject = !isCompleted && !currentUser.isAdmin && !onProject && !groupHere && currentUser.groups.includes(task.candidateGroup);
  // Demandeur sur le projet, mais réquisition d'un autre (il ne voit que les siennes)
  const notRequester = !isCompleted && !currentUser.isAdmin && !onProject && groupHere;
  const mine = isMine(task, currentUser);
  return {
    isMine: mine,
    canClaim: !isCompleted && !task.assignee && inGroup && !conflict,
    // Libérer : la personne qui l'a prise, ou un admin (ex. collègue absent)
    canUnclaim: !isCompleted && !!task.assignee && (mine || currentUser.isAdmin),
    canComplete: !isCompleted && mine && !conflict && (inGroup || PERSONAL_TASKS.includes(task.taskDefinitionKey)),
    blockedReason: conflict || (notOnProject ? 'NOT_ON_PROJECT' : notRequester ? 'NOT_REQUESTER' : null),
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

    // Réquisition de chaque tâche, lue en base (les variables GoFlow peuvent manquer) : seulement les réquisitions
    // existantes de l'entreprise courante. « Mes tâches » renvoie vers l'onglet tâches de la réquisition, seul
    // endroit où une tâche est prise en charge et traitée
    const reqByProcess = await requisitionsOfEnterprise(
      [...new Set([...(activeTasks || []), ...(completedTasks || [])].map(t => t.processInstanceId).filter(Boolean))]
    );
    const projectOfTask = (t) => reqByProcess.get(t.processInstanceId)?.project_id || null;
    const requesterOfTask = (t) => reqByProcess.get(t.processInstanceId)?.requester_id || null;

    // Tâches actives visibles : celles de ses groupes SUR LE PROJET de la réquisition (ou toutes pour l'admin) ;
    // tâches terminées : uniquement celles qu'il a lui-même traitées
    const userTasks = [
      ...(activeTasks || []).filter(t => currentUser.isAdmin || isMine(t, currentUser) || inGroupOnProject(t, currentUser, projectOfTask(t), requesterOfTask(t))),
      ...(completedTasks || [])
    ].filter(t => reqByProcess.has(t.processInstanceId));

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
          ...getTaskPermissions(task, currentUser, conflictOf(conflicts, task), projectOfTask(task), requesterOfTask(task))
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

    const [all, currentUser] = await Promise.all([
      camundaService.getGroupTasks(candidateGroup, processInstanceId),
      getCurrentUserContext(req.user.id),
    ]);
    const reqByProcess = await requisitionsOfEnterprise([...new Set((all || []).map(t => t.processInstanceId).filter(Boolean))]);
    // Entreprise courante, et groupe de l'utilisateur sur le projet de chaque réquisition (admin : tout)
    const tasks = (all || []).filter(t => reqByProcess.has(t.processInstanceId)
      && (currentUser.isAdmin || inGroupOnProject(t, currentUser, reqByProcess.get(t.processInstanceId).project_id, reqByProcess.get(t.processInstanceId).requester_id)));
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
    const permissions = getTaskPermissions(task, currentUser, null, task.projectId, task.requesterId);
    if (permissions.blockedReason === 'NOT_ON_PROJECT') {
      const error = await projectAccess.deny(req, { projectId: task.projectId, candidateGroup: task.candidateGroup, taskId });
      return res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details });
    }
    if (permissions.blockedReason === 'NOT_REQUESTER') {
      return res.status(403).json({ success: false, code: 'NOT_REQUESTER', message: 'Cette étape revient au demandeur de la réquisition' });
    }
    if (!permissions.canClaim) {
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
    if (!getTaskPermissions(task, currentUser, null, task.projectId, task.requesterId).canUnclaim) {
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
    // Groupe de la tâche SUR LE PROJET de la réquisition (profils BPMN liés au projet) ; tâche personnelle
    // (ajustement budgétaire du demandeur) : la personne désignée
    const onProject = inGroupOnProject(task, currentUser, task.projectId, task.requesterId);
    const personal = PERSONAL_TASKS.includes(taskDefinitionKey) && isMine(task, currentUser);
    // Demandeur sur le projet, mais étape « demandeur » de la réquisition d'un autre
    if (!currentUser.isAdmin && !onProject && !personal && projectAccess.groupsOnProject(currentUser.scope, task.projectId).has(task.candidateGroup)) {
      await audit(req, AUDIT.TASK_COMPLETION_DENIED, {
        entity: { type: 'task', id: taskDefinitionKey, label: taskLabel(task.taskDefinitionKey || taskDefinitionKey) || task.taskName || task.name },
        details: { taskId, reason: 'NOT_REQUESTER', candidateGroup: task.candidateGroup },
      });
      return res.status(403).json({ success: false, code: 'NOT_REQUESTER', message: 'Cette étape revient au demandeur de la réquisition' });
    }
    if (!currentUser.isAdmin && !onProject && !personal && currentUser.groups.includes(task.candidateGroup)) {
      const error = await projectAccess.deny(req, { projectId: task.projectId, candidateGroup: task.candidateGroup, taskId });
      return res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details });
    }
    if (!(currentUser.isAdmin || onProject || personal)) {
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

    // Méthode d'achat : choix obligatoire, au moins aussi exigeant que le montant l'impose
    // (sauf source unique, avec justification) — la classification suivante reprend ce choix
    if (taskDefinitionKey === 'Activity_DetermineType') {
      const requisition = requisitionId
        ? await db.one('SELECT estimated_amount FROM requisitions WHERE id = $1', [requisitionId])
        : null;
      const method = variables.procurementMethod;
      const methodError = requisitionModel.checkChosenMethod(method, requisition?.estimated_amount);
      if (methodError === 'PROCUREMENT_METHOD_REQUIRED') {
        return res.status(400).json({ success: false, code: methodError, message: "Choisissez la méthode d'achat" });
      }
      if (methodError === 'METHOD_BELOW_THRESHOLD') {
        return res.status(400).json({
          success: false, code: methodError,
          requiredMethod: requisitionModel.requiredProcurementMethod(requisition?.estimated_amount),
          message: "Méthode d'achat insuffisante pour le montant de la réquisition"
        });
      }
      if (method === 'SOLE_SOURCE' && !String(variables.justification || '').trim()) {
        return res.status(400).json({ success: false, code: 'JUSTIFICATION_REQUIRED', message: 'Justification obligatoire pour une source unique' });
      }
    }

    // Paiement saisi depuis la tâche : refusé AVANT de terminer l'étape si les coordonnées bancaires ne sont pas vérifiées
    if (taskDefinitionKey === 'Activity_ProcessPayment' && variables.amount) {
      await supplierBankService.assertPayable(req, { invoiceId: variables.invoiceId || null, poId: variables.poId || null });
    }

    // Approbation N1 / N2 / N3 : approuver, rejeter ou renvoyer pour correction (motif obligatoire). Le BPMN attend
    // toujours approved ET returnedForCorrection (Gateway_ApprovalDecision)
    const returnedForCorrection = REQUISITION_APPROVAL_TASKS.includes(taskDefinitionKey)
      && (variables.returnedForCorrection === true || variables.returnedForCorrection === 'true');
    if (REQUISITION_APPROVAL_TASKS.includes(taskDefinitionKey)) {
      if (returnedForCorrection && !String(comment || variables.comment || '').trim()) {
        return res.status(400).json({ success: false, code: 'RETURN_REASON_REQUIRED', message: 'Indiquez ce qui doit être corrigé' });
      }
      if (!returnedForCorrection && typeof variables.approved !== 'boolean') {
        return res.status(400).json({ success: false, code: 'DECISION_REQUIRED', message: 'Choisissez une décision' });
      }
      // Processus démarré avant la mise à jour du BPMN : le renvoi y partirait au rejet
      if (returnedForCorrection && !(await revisionService.supportsRevision(task.processInstanceId))) {
        const error = revisionService.notSupported();
        return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      }
    }

    // Réception et acceptation de service : uniquement par leurs formulaires (le document est créé et le BPMN reçoit
    // grnCompliant / serviceAccepted / deliveryComplete) — jamais d'étape terminée sans son document ; correction de
    // la réquisition : depuis le formulaire de modification (nouvelle version, resubmitted)
    if (taskDefinitionKey === revisionService.REVISE_TASK) {
      return res.status(400).json({
        success: false, code: 'FORM_REQUIRED',
        message: 'Corrigez la réquisition depuis sa fiche (« Corriger »), puis soumettez-la à nouveau'
      });
    }
    if (['Activity_GoodsReceipt', 'Activity_ServiceAcceptance'].includes(taskDefinitionKey)) {
      return res.status(400).json({
        success: false, code: 'FORM_REQUIRED',
        message: 'Cette étape se traite depuis son formulaire (onglet « Tâches » de la réquisition)'
      });
    }

    // Build Camunda variables
    const taskVariables = { ...variables };
    if (comment) taskVariables.comment = comment;
    if (REQUISITION_APPROVAL_TASKS.includes(taskDefinitionKey)) {
      taskVariables.returnedForCorrection = returnedForCorrection;
      if (returnedForCorrection) taskVariables.approved = false;
    }
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
        if (REQUISITION_APPROVAL_TASKS.includes(taskDefinitionKey) && returnedForCorrection) {
          // Renvoyée pour correction : « À corriger », version close avec le motif, demandeur notifié
          await revisionService.markReturned(requisitionId, {
            kind: 'RETURNED', reason: comment || variables.comment, userId, taskKey: taskDefinitionKey, io: req.io,
          });
        } else if (REQUISITION_APPROVAL_TASKS.includes(taskDefinitionKey)) {
          const approved = variables.approved;

          if (approved === false) {
            await db.update('requisitions', {
              status: 'REJECTED',
              rejected_at: new Date(),
              updated_at: new Date()
            }, 'id', requisitionId);
          } else if (approved === true && isFinalApprovalLevel(taskDefinitionKey, await (async () => {
            // Niveau et montant en base (ils ont pu changer après une correction), à défaut le montant du client
            const r = await db.one('SELECT approval_level, estimated_amount, project_id, enterprise_id FROM requisitions WHERE id = $1', [requisitionId]);
            return {
              approvalLevel: r?.approval_level,
              amount: r?.estimated_amount ?? estimatedAmount,
              policy: r ? await approvalPolicy.projectPolicy(r.project_id, r.enterprise_id) : null,
            };
          })())) {
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

        // Réception (GRN) et acceptation de service (SAN) : refusées plus haut (FORM_REQUIRED), traitées par leurs formulaires

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

    const [currentUser, activeTasks, completedTasks, requisition] = await Promise.all([
      getCurrentUserContext(req.user.id),
      camundaService.getProcessTasks(processInstanceId),
      camundaService.getCompletedTasks({ processInstanceId }),
      db.one('SELECT project_id, requester_id FROM requisitions WHERE process_instance_id = $1', [processInstanceId])
    ]);
    const projectId = requisition?.project_id || null;

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
      ...getTaskPermissions(task, currentUser, task.status === 'completed' ? null : conflictOf(conflicts, task), projectId, requisition?.requester_id)
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
