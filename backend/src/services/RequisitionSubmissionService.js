// backend/src/services/RequisitionSubmissionService.js
// Soumission d'un brouillon (migration 67_requisition_drafts.sql, 2026-11-13).
// Choix de l'utilisateur : une réquisition est créée en BROUILLON (DRAFT) — le demandeur peut la modifier
// (PUT /requisitions/:id), la supprimer, puis la SOUMETTRE : c'est seulement là que le processus BpmnGo démarre.
//  - seul le demandeur soumet (403 NOT_REQUESTER), seulement un brouillon (409 NOT_DRAFT)
//  - projet avec un chef de projet actif autre que le demandeur (contrôlé de nouveau : il a pu changer)
//  - réservation DRAFT → PENDING (deux clics simultanés : un seul démarrage), version 1 enregistrée (photo de ce que
//    le chef de projet valide), puis démarrage BpmnGo avec les valeurs ACTUELLES en base ; refus de BpmnGo → la
//    réquisition redevient un brouillon (502 BPMNGO_ERROR), le demandeur peut réessayer
const db = require('../config/database');
const camundaService = require('./CamundaService');
const notificationService = require('./NotificationService');
const requisitionModel = require('../models/RequisitionModel');
const revisionService = require('./RequisitionRevisionService');
const projectManagers = require('../utils/projectManager');
const { getEnterpriseCurrencyCode } = require('../utils/enterpriseCurrency');

const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/** Variables de démarrage du processus, lues en base (état actuel du brouillon) */
async function processVariables(req, requester, projectManager) {
  const items = await db.select(
    `SELECT ri.item_description AS description, ri.quantity::float8 AS quantity, COALESCE(ri.frequency, 1)::float8 AS frequency,
            ri.unit_price::float8 AS "unitPrice",
            COALESCE(ri.total_amount, ri.quantity * COALESCE(ri.frequency, 1) * ri.unit_price)::float8 AS total,
            ri.budget_line_id AS "budgetLineId", COALESCE(ba.entity_code, ri.budget_line_code) AS "budgetLineCode",
            ba.description AS "budgetLineDescription"
     FROM requisition_items ri LEFT JOIN budget_allocations ba ON ba.id = ri.budget_line_id
     WHERE ri.requisition_id = $1 ORDER BY ri.id`,
    [req.id]
  );
  const total = items.reduce((s, i) => s + num(i.total), 0);
  const currency = req.currency_id
    ? (await db.one('SELECT format_key FROM currency WHERE id = $1', [req.currency_id]))?.format_key
    : null;
  return {
    // === INFORMATIONS GÉNÉRALES ===
    requisitionId: req.id,
    requisitionNumber: req.requisition_number,
    requester: requester?.email || String(req.requester_id),
    requesterUsername: requester?.username || String(req.requester_id),
    requesterId: req.requester_id,
    // === DÉTAILS ===
    title: req.title || '',
    description: req.description || '',
    departmentId: req.department_id || '',
    departementCode: req.department_code || '',
    priority: req.priority || 'MEDIUM',
    justification: req.justification || '',
    estimatedAmount: total,
    currency: currency || await getEnterpriseCurrencyCode(),
    currencyId: req.currency_id,
    // === PROJET ===
    projectId: req.project_id || '',
    projectCode: req.project_code || '',
    projectName: req.project_name || '',
    // Validation par le chef de projet (information ; le droit est contrôlé sur le chef ACTUEL en base)
    projectManager: projectManager.email,
    projectManagerId: projectManager.id,
    // === ARTICLES ===
    items: JSON.stringify(items),
    totalItems: items.length,
    totalQuantity: items.reduce((s, i) => s + num(i.quantity), 0),
    // === CIRCUIT ===
    revisionSupported: true,          // « Corriger la réquisition » (migration 25)
    approvalFlow: 'PROJECT_MANAGER',  // circuit du 2026-11-06
    requisitionVersion: req.version || 1,
    // === DATES ===
    createdAt: new Date(req.created_at || Date.now()).toISOString(),
    submittedAt: new Date().toISOString(),
    createdBy: requester?.email || String(req.requester_id),
  };
}

function emit(io, userId, requisition, payload) {
  if (!io) return;
  io.to(`user-${userId}`).emit('notification', { ...payload, link: `/requisitions/${requisition.id}`, timestamp: new Date().toISOString() });
  io.to(`requisition-${requisition.id}`).emit('requisition-update', { status: 'IN_PROGRESS', timestamp: new Date().toISOString() });
  io.emit('requisitions-list-update', { action: 'SUBMIT', requisitionId: requisition.id, requisitionNumber: requisition.requisition_number });
}

class RequisitionSubmissionService {
  /** Soumettre un brouillon → démarrage du processus BpmnGo. Renvoie { status, processInstanceId } */
  async submit(requisitionId, userId, io = null) {
    const req = await db.one(
      `SELECT r.*, d.code AS department_code, p.code AS project_code, p.name AS project_name
       FROM requisitions r LEFT JOIN departments d ON d.id = r.department_id LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.id = $1`,
      [requisitionId]
    );
    if (!req) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
    if (String(req.requester_id) !== String(userId)) throw fail(403, 'NOT_REQUESTER', 'Seul le demandeur peut soumettre sa réquisition');
    if (req.status !== 'DRAFT' || req.process_instance_id) throw fail(409, 'NOT_DRAFT', 'Cette réquisition a déjà été soumise');
    const itemCount = Number((await db.one('SELECT COUNT(*) AS n FROM requisition_items WHERE requisition_id = $1', [req.id]))?.n || 0);
    if (!itemCount) throw fail(400, 'ITEMS_REQUIRED', 'Au moins un article est requis');

    // Chef de projet actuel (il valide seul) : 400 PROJECT_REQUIRED, 409 PROJECT_MANAGER_MISSING / REQUESTER_IS_PROJECT_MANAGER
    const projectManager = await projectManagers.forRequisition(req.project_id, req.requester_id);
    const requester = await db.one('SELECT email, username FROM users WHERE id = $1', [req.requester_id]);

    // Réservation : un seul démarrage même avec deux soumissions simultanées
    const reserved = await db.one(
      `UPDATE requisitions SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'DRAFT' AND process_instance_id IS NULL RETURNING id`,
      [req.id]
    );
    if (!reserved) throw fail(409, 'NOT_DRAFT', 'Cette réquisition a déjà été soumise');

    let processResult;
    try {
      // Version 1 : ce que le chef de projet a sous les yeux (base de comparaison en cas de correction)
      await revisionService.recordInitialVersion(req.id);
      processResult = await camundaService.startProcess(process.env.PROCUREMENT_BPMN_PROCESS, await processVariables(req, requester, projectManager));
    } catch (error) {
      processResult = { success: false, error: error.message };
    }

    if (!processResult?.success || !processResult.processInstanceId) {
      await db.exec(`UPDATE requisitions SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND process_instance_id IS NULL`, [req.id]);
      await db.exec('DELETE FROM requisition_versions WHERE requisition_id = $1', [req.id]);
      await requisitionModel.addWorkflowHistory({
        processInstanceId: null, entityType: 'requisition', entityId: req.id, taskId: null,
        taskName: 'Démarrage processus', action: 'PROCESS_START_FAILED',
        comments: `Échec du démarrage du processus BpmnGo : ${processResult?.error || 'réponse invalide'}`, performedBy: userId,
      });
      throw fail(502, 'BPMNGO_ERROR', 'BpmnGo n\'a pas démarré le circuit : la réquisition reste un brouillon, réessayez plus tard');
    }

    await db.exec(
      `UPDATE requisitions SET status = 'IN_PROGRESS', process_instance_id = $2, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [req.id, processResult.processInstanceId]
    );
    await requisitionModel.addWorkflowHistory({
      processInstanceId: processResult.processInstanceId, entityType: 'requisition', entityId: req.id, taskId: null,
      taskName: 'Soumission', action: 'SUBMITTED',
      comments: `Réquisition ${req.requisition_number} soumise par ${requester?.email || userId}`, performedBy: userId,
    });
    await requisitionModel.addWorkflowHistory({
      processInstanceId: processResult.processInstanceId, entityType: 'requisition', entityId: req.id, taskId: null,
      taskName: 'Démarrage processus', action: 'PROCESS_STARTED',
      comments: `Processus BpmnGo démarré avec l'ID: ${processResult.processInstanceId}`, performedBy: userId,
    });

    try {
      await notificationService.sendNotification(
        userId, 'Réquisition soumise',
        `Votre réquisition ${req.requisition_number} a été soumise : le circuit d'approbation a démarré.`,
        'REQUISITION_CREATED', `/requisitions/${req.id}`
      );
    } catch (error) {
      console.error('Notification de soumission non envoyée :', error.message);
    }
    emit(io, userId, req, {
      title: 'Réquisition soumise ✅',
      message: `Votre réquisition ${req.requisition_number} a été soumise : le circuit d'approbation a démarré.`,
      type: 'SUCCESS',
    });
    return { status: 'IN_PROGRESS', processInstanceId: processResult.processInstanceId };
  }
}

module.exports = new RequisitionSubmissionService();
