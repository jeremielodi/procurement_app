// backend/src/controllers/PurchaseOrderController.js
const purchaseOrderModel = require('../models/PurchaseOrderModel');
const camundaService = require('../services/CamundaService');
const db = require('../config/database');
const i18n = require('../i18n');
const purchaseOrderExportService = require('../services/PurchaseOrderExportService');
const segregation = require('../utils/segregation');
const { audit, AUDIT } = require('../utils/auditLog');
const orderTasks = require('../services/OrderTaskService');
const allocationService = require('../services/SupplierAllocationService');
const approvalPolicy = require('../utils/approvalPolicy');
const projectAccess = require('../utils/projectAccess');
const { PO_REVIEW_TASK, PO_APPROVAL_TASKS, TASK_CANDIDATE_GROUPS } = require('../utils/workflowLabels');

// Groupe BpmnGo qui approuve un bon de commande selon son niveau (migration 51 : N1 / N2 / N3 sur la commande)
const LEVEL_GROUPS = { N1: 'manager', N2: 'manager_n2', N3: 'manager_n3' };

/** Étape BpmnGo ouverte de ce bon parmi keys (null si aucune ou BpmnGo injoignable) → { task, projectId } */
async function openStepOf(po, keys) {
  const r = po.requisition_id
    ? await db.one('SELECT process_instance_id, project_id FROM requisitions WHERE id = $1', [po.requisition_id])
    : null;
  let task = null;
  if (r?.process_instance_id) {
    try {
      task = await orderTasks.findForPurchaseOrder(r.process_instance_id, keys, po.id);
    } catch (err) {
      console.error('[PO] Étape BpmnGo (non bloquant) :', err.message);
    }
  }
  return { task, projectId: r?.project_id || null };
}

/**
 * Étape d'approbation ouverte de ce bon (N1 / N2 / N3, ou l'ancienne approbation Direction d'un processus démarré
 * avant) et groupe attendu : celui de l'étape BpmnGo, à défaut celui du niveau enregistré sur le bon.
 * → { task, group, projectId }
 */
async function approvalStepOf(po) {
  const { task, projectId } = await openStepOf(po, PO_APPROVAL_TASKS);
  const group = task ? TASK_CANDIDATE_GROUPS[task.taskDefinitionKey] : LEVEL_GROUPS[po.approval_level] || null;
  return { task, group, projectId };
}

/** 409 PO_IN_REVIEW : le bon attend sa révision (migration 52) — pas encore d'approbation N1 / N2 / N3 */
async function assertNotInReview(po) {
  if ((await openStepOf(po, PO_REVIEW_TASK)).task) {
    throw Object.assign(new Error('Ce bon de commande attend sa révision : il sera approuvé ensuite selon son niveau'), { status: 409, code: 'PO_IN_REVIEW' });
  }
}

/** L'utilisateur a le groupe attendu sur le projet (administrateur : oui ; aucun groupe connu : contrôle de la route) */
async function hasApprovalGroup(userId, { group, projectId }) {
  if (!group) return true;
  const scope = await projectAccess.loadScope(userId);
  return scope.isAdmin || projectAccess.groupsOnProject(scope, projectId).has(group);
}

/** 403 NOT_APPROVAL_LEVEL : le bon revient à un autre niveau de manager */
function levelError(po, group) {
  const level = Object.keys(LEVEL_GROUPS).find(k => LEVEL_GROUPS[k] === group);
  return Object.assign(
    new Error(level
      ? `Ce bon de commande (niveau ${level}) doit être approuvé par un Manager niveau ${level.slice(1)} du projet`
      : "Vous n'avez pas le profil qui approuve ce bon de commande sur ce projet"),
    { status: 403, code: 'NOT_APPROVAL_LEVEL', details: { level: level || null, poNumber: po.po_number } }
  );
}

/**
 * Part d'une réquisition répartie entre plusieurs fournisseurs à laquelle appartient un nouveau bon de commande :
 * celle de la tâche « Créer le bon de commande » choisie, sinon celle du fournisseur. null sans répartition ;
 * { error } si la part ne correspond pas (fournisseur d'une autre part, part déjà commandée).
 */
async function lotForNewOrder(requisition, { taskId, supplierId }) {
  const lots = await allocationService.list(requisition.id);
  if (!lots.length) return null;
  const err = (status, code, message) => ({ error: { status, code, message } });
  const fromTask = taskId ? await orderTasks.lotOfTask(taskId) : null;
  const lot = fromTask
    ? lots.find(l => String(l.id) === String(fromTask))
    : lots.find(l => String(l.supplier_id) === String(supplierId));
  if (!lot) return err(409, 'LOT_SUPPLIER_MISMATCH', 'Ce fournisseur n\'a aucune part dans la répartition de cette réquisition');
  if (String(lot.supplier_id) !== String(supplierId)) {
    return err(409, 'LOT_SUPPLIER_MISMATCH', `Cette part revient à ${lot.supplier_name}`);
  }
  // Une part = un bon de commande (bon rejeté : la part s'arrête, comme le processus sans répartition)
  if (lot.po_id) {
    return err(409, 'LOT_ALREADY_ORDERED', `La part de ${lot.supplier_name} a déjà son bon de commande (${lot.po_number})`);
  }
  return lot;
}

/**
 * Lignes reprises d'une réquisition : la ligne doit appartenir à CETTE réquisition et la quantité commandée
 * (cumul des bons actifs) ne dépasse pas quantité × fréquence de la réquisition. null si tout va bien, sinon { error }
 */
async function checkRequisitionQuantities(requisitionId, items) {
  const wanted = new Map();
  for (const it of items || []) {
    if (!it.requisitionItemId) continue;
    const key = String(it.requisitionItemId);
    wanted.set(key, (wanted.get(key) || 0) + (Number(it.quantity) || 0));
  }
  if (!wanted.size) return null;
  const rows = await db.select(
    `SELECT ri.id, ri.item_description, (ri.quantity * COALESCE(ri.frequency, 1))::float8 AS allowed,
            COALESCE((SELECT SUM(poi.quantity) FROM purchase_order_items poi
                        JOIN purchase_orders po ON po.id = poi.purchase_order_id
                       WHERE poi.requisition_item_id = ri.id
                         AND po.status NOT IN ('PO_REJECTED', 'PO_CANCELLED', 'CANCELLED', 'REJECTED')), 0)::float8 AS ordered
       FROM requisition_items ri
      WHERE ri.requisition_id = $1 AND ri.id = ANY($2::int[])`,
    [requisitionId, [...wanted.keys()].map(Number)]
  );
  const err = (code, message, details) => ({ error: { status: 400, code, message, details } });
  for (const [id, quantity] of wanted) {
    const row = rows.find(r => String(r.id) === id);
    if (!row) return err('ITEM_NOT_IN_REQUISITION', 'Article absent de cette réquisition', { requisitionItemId: id });
    const remaining = row.allowed - row.ordered;
    if (quantity > remaining + 0.0001) {
      return err('ITEM_QUANTITY_EXCEEDS_REQUISITION',
        `« ${row.item_description} » : ${quantity} commandé(s), ${remaining} au plus (quantité × fréquence de la réquisition)`,
        { requisitionItemId: id, description: row.item_description, quantity, allowed: row.allowed, ordered: row.ordered, remaining });
    }
  }
  return null;
}

/** Erreur métier { status, code } (séparation des tâches…) sinon 500 */
/** Texte libre facultatif (conditions, instructions) : vide → null */
const clip = (v) => String(v ?? '').trim().slice(0, 2000) || null;

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

class PurchaseOrderController {

  async create(req, res) {
    try {
      const {
        requisitionId, taskId, supplierId, orderDate, deliveryDate,
        shippingAddress, totalAmount, currency, items, notes,
        paymentTerms, deliveryTerms, specialInstructions
      } = req.body;

      if (!requisitionId || !supplierId || !totalAmount) {
        return res.status(400).json({
          success: false,
          code: 'REQUISITION_REQUIRED',
          message: 'requisitionId, supplierId et totalAmount sont requis'
        });
      }
      // Une commande est TOUJOURS rattachée à une réquisition existante (entreprise courante : tenantGuard) et active
      const requisition = await db.one('SELECT id, status, process_instance_id FROM requisitions WHERE id = $1', [requisitionId]);
      if (!requisition) {
        return res.status(404).json({ success: false, code: 'REQUISITION_NOT_FOUND', message: 'Réquisition introuvable' });
      }
      if (['DRAFT', 'REJECTED', 'CANCELLED'].includes(requisition.status)) {
        return res.status(409).json({ success: false, code: 'REQUISITION_NOT_ACTIVE', message: `Réquisition au statut ${requisition.status} : aucune commande possible` });
      }

      // Réquisition répartie entre plusieurs fournisseurs : le bon appartient à une part (celle de la tâche choisie,
      // sinon celle du fournisseur) qui impose le fournisseur et les articles
      const lot = await lotForNewOrder(requisition, { taskId, supplierId });
      if (lot?.error) return res.status(lot.error.status).json({ success: false, code: lot.error.code, message: lot.error.message });
      if (lot) {
        const expected = lot.items.map(i => String(i.id)).sort();
        const given = (items || []).map(i => String(i.requisitionItemId || '')).sort();
        if (given.length !== expected.length || given.some((id, i) => id !== expected[i])) {
          return res.status(400).json({ success: false, code: 'LOT_ITEMS_MISMATCH', message: `Le bon de commande de ${lot.supplier_name} reprend exactement les articles de sa part` });
        }
      }

      // Quantité commandée ≤ quantité × fréquence de la ligne de réquisition (cumul des bons actifs)
      const qtyCheck = await checkRequisitionQuantities(requisition.id, items);
      if (qtyCheck?.error) {
        const { status, code, message, details } = qtyCheck.error;
        return res.status(status).json({ success: false, code, message, details });
      }

      const result = await purchaseOrderModel.create({
        requisitionId, taskId: taskId || null, supplierId, orderDate, deliveryDate,
        shippingAddress, totalAmount, currency, notes,
        // Instructions au fournisseur : ancien champ « notes » accepté (il n'était pas enregistré)
        paymentTerms: clip(paymentTerms), deliveryTerms: clip(deliveryTerms), specialInstructions: clip(specialInstructions ?? notes),
        items: items || [],
        supplierLotId: lot?.id || null,
        createdBy: req.user.id // jamais une valeur du client (séparation des tâches)
      });

      // Étape BpmnGo « Créer le bon de commande » de CETTE réquisition et de CETTE part (le taskId du client n'est
      // retenu que s'il correspond : une autre tâche ne doit jamais être terminée par la création d'une commande)
      try {
        const camundaTaskId = requisition.process_instance_id
          ? (await orderTasks.findCreateTask(requisition.process_instance_id, lot?.id || null, taskId))?.id || null
          : null;
        // Niveau d'approbation du bon (montant + seuils du projet) : Gateway_POApprovalLevel → N1 / N2 / N3
        const approval = await approvalPolicy.assignPurchaseOrderLevel(result.id);
        if (camundaTaskId) {
          await camundaService.completeTask(camundaTaskId, {
            poId: result.id,
            poNumber: result.poNumber,
            totalAmount,
            poApprovalLevel: approval?.level || 'N3'
          });
        }
      } catch (camundaErr) {
        console.error('[PO create] Camunda task completion (non-fatal):', camundaErr.message);
      }

      res.status(201).json({ success: true, data: result, message: 'Commande créée avec succès' });
    } catch (error) {
      console.error('Error creating purchase order:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la création', error: error.message });
    }
  }

  async getAll(req, res) {
    try {
      const { status, requisitionId, search, fromDate, toDate, page = 1, limit = 20 } = req.query;
      // supplier_id accepté aussi (fiche fournisseur)
      const supplierId = req.query.supplierId || req.query.supplier_id;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const purchaseOrders = await purchaseOrderModel.findAll({
        status, supplierId, requisitionId, search, fromDate, toDate,
        limit: parseInt(limit), offset
      });

      const total = await purchaseOrderModel.count({ status, supplierId });

      res.json({
        success: true,
        data: purchaseOrders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Error getting purchase orders:', error);
      res.status(500).json({ success: false, message: 'Erreur récupération commandes', error: error.message });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;
      const purchaseOrder = await purchaseOrderModel.findById(id);
      if (!purchaseOrder) {
        return res.status(404).json({ success: false, message: 'Commande non trouvée' });
      }
      // Séparation des tâches : l'interface remplace « Approuver » par une explication
      purchaseOrder.self_approval = await segregation.isPurchaseOrderSelfApproval(purchaseOrder, req.user.id);
      // Révision (migration 52) : étape ouverte → review_pending ; le réviseur du projet (admin : oui) → can_review
      if (purchaseOrder.status === 'PO_PENDING') {
        const review = await openStepOf(purchaseOrder, PO_REVIEW_TASK);
        purchaseOrder.review_pending = !!review.task;
        if (review.task) purchaseOrder.can_review = await hasApprovalGroup(req.user.id, { group: 'po_reviewer', projectId: review.projectId });
      }
      // Niveau d'approbation (N1 / N2 / N3) : seul un manager de ce niveau sur le projet approuve ou rejette
      if (['PO_PENDING', 'DRAFT'].includes(purchaseOrder.status) && purchaseOrder.approval_level) {
        const projectId = purchaseOrder.requisition_id
          ? (await db.one('SELECT project_id FROM requisitions WHERE id = $1', [purchaseOrder.requisition_id]))?.project_id
          : null;
        purchaseOrder.can_approve_level = await hasApprovalGroup(req.user.id, { group: LEVEL_GROUPS[purchaseOrder.approval_level], projectId });
      }
      res.json({ success: true, data: purchaseOrder });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération commande', error: error.message });
    }
  }

  /** GET /purchase-orders/:id/delivery — suivi des livraisons (commandé / reçu / accepté / reste) */
  async getDelivery(req, res) {
    try {
      const delivery = await purchaseOrderModel.getDelivery(req.params.id);
      if (!delivery) return res.status(404).json({ success: false, message: 'Commande non trouvée' });
      res.json({ success: true, data: delivery });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération du suivi des livraisons', error: error.message });
    }
  }

  /**
   * POST /purchase-orders/:id/close-delivery { reason } — solde le reliquat (le fournisseur ne livrera pas le reste)
   * sans nouvelle réception. L'étape BpmnGo en attente pour cette livraison (SAN ou GRN) est terminée avec
   * deliveryComplete = true : le workflow passe à la facture.
   */
  async closeDelivery(req, res) {
    try {
      const result = await purchaseOrderModel.closeDelivery(req.params.id, { reason: req.body?.reason, userId: req.user.id });
      const reason = String(req.body.reason).trim();
      await audit(req, AUDIT.PO_DELIVERY_CLOSED, {
        entity: { type: 'purchase_order', id: result.poId, label: result.poNumber },
        details: { reason, remaining: result.remaining, accepted: result.accepted },
      });

      let camundaTaskCompleted = false;
      const row = await db.one(
        `SELECT r.id AS requisition_id, r.process_instance_id FROM purchase_orders po JOIN requisitions r ON r.id = po.requisition_id WHERE po.id = $1`,
        [result.poId]
      );
      if (row?.process_instance_id) {
        try {
          const task = await orderTasks.findForPurchaseOrder(row.process_instance_id, ['Activity_ServiceAcceptance', 'Activity_GoodsReceipt'], result.poId);
          if (task) {
            const vars = task.taskDefinitionKey === 'Activity_ServiceAcceptance'
              ? { serviceAccepted: true, deliveryComplete: true, deliveryCloseReason: reason }
              : { grnCompliant: true, deliveryComplete: true, deliveryCloseReason: reason };
            camundaTaskCompleted = !!(await camundaService.completeTask(task.id, vars))?.success;
          }
          await db.exec(
            `INSERT INTO workflow_history (entity_type, entity_id, process_instance_id, task_id, task_name, action, comments, performed_by, performed_at)
             VALUES ('requisition', $1, $2, $3, $4, 'DELIVERY_CLOSED', $5, $6, CURRENT_TIMESTAMP)`,
            [row.requisition_id, row.process_instance_id, task?.id || null, task?.taskDefinitionKey || null,
             JSON.stringify({ poId: result.poId, poNumber: result.poNumber, comment: reason }), req.user.id]
          );
        } catch (e) {
          console.error('[PO] Solde du reliquat — étape BpmnGo (non bloquant) :', e.message);
        }
      }
      res.json({ success: true, data: { ...result, camundaTaskCompleted }, message: 'Reliquat soldé' });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      res.status(500).json({ success: false, message: 'Erreur lors du solde du reliquat', error: error.message });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const existing = await purchaseOrderModel.findById(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Commande non trouvée' });
      if (existing.status !== 'DRAFT') {
        return res.status(400).json({ success: false, message: 'Seules les commandes en brouillon peuvent être modifiées' });
      }
      const result = await purchaseOrderModel.update(id, req.body);
      res.json({ success: true, data: result, message: 'Commande mise à jour' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur mise à jour', error: error.message });
    }
  }

  /**
   * POST /purchase-orders/:id/approve
   * Body: { approverId, comments, taskId? }
   *
   * taskId (optional): Camunda task ID if the caller has it; otherwise the
   * controller finds it via the requisition's process_instance_id.
   */
  async approve(req, res) {
    try {
      const { id } = req.params;
      const { comments } = req.body;
      const userId = req.user.id;

      const existing = await purchaseOrderModel.findById(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Commande non trouvée' });

      if (existing.status !== 'PO_PENDING' && existing.status !== 'DRAFT') {
        return res.status(400).json({ success: false, message: 'Seules les commandes en attente peuvent être approuvées' });
      }
      // Séparation des tâches : ni le créateur du bon, ni le demandeur de la réquisition
      await segregation.assertCanApprovePurchaseOrder(req, existing);
      await assertNotInReview(existing);
      // Niveau du bon (N1 / N2 / N3) : manager de ce niveau sur le projet
      const step = await approvalStepOf(existing);
      if (!(await hasApprovalGroup(userId, step))) throw levelError(existing, step.group);

      let camundaTaskCompleted = false;

      try {
        if (step.task) {
          await camundaService.completeTask(step.task.id, { poApproved: true, poApprovalComment: comments || '' });
          camundaTaskCompleted = true;
        }
      } catch (err) {
        console.error('[PO approve] Camunda lookup (non-fatal):', err.message);
      }


      await purchaseOrderModel.approve(id, userId, comments);

      if (req.io) {
        req.io.to(`user-${existing.created_by}`).emit('notification', {
          title: 'Commande approuvée',
          message: `La commande ${existing.po_number} a été approuvée`,
          type: 'SUCCESS'
        });
      }

      res.json({
        success: true,
        data: { id, status: 'PO_APPROVED' },
        message: 'Commande approuvée avec succès',
        camundaTaskCompleted
      });
    } catch (error) {
      return sendError(res, error, "Erreur lors de l'approbation");
    }
  }

  /**
   * POST /purchase-orders/:id/reject
   * Body: { approverId, reason, taskId? }
   */
  async reject(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const userId = req.user.id;

      if (!reason) {
        return res.status(400).json({ success: false, message: 'La raison du rejet est requise' });
      }

      const existing = await purchaseOrderModel.findById(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Commande non trouvée' });

      if (existing.status !== 'PO_PENDING' || '') {
        return res.status(400).json({ success: false, message: 'Seules les commandes en attente peuvent être rejetées' });
      }

      // Bon en révision : le rejet passe par la révision (POST /purchase-orders/:id/review)
      await assertNotInReview(existing);
      // Niveau du bon (N1 / N2 / N3) : manager de ce niveau sur le projet
      const step = await approvalStepOf(existing);
      if (!(await hasApprovalGroup(userId, step))) throw levelError(existing, step.group);

      let camundaTaskCompleted = false;

      try {
        if (step.task) {
          await camundaService.completeTask(step.task.id, { poApproved: false, poApprovalComment: reason || '' });
          camundaTaskCompleted = true;
        }
      } catch (err) {
        console.error('[PO reject] Camunda lookup (non-fatal):', err.message);
      }

      await purchaseOrderModel.reject(id, userId, reason);
      await audit(req, AUDIT.PURCHASE_ORDER_REJECTED, {
        entity: { type: 'purchase_order', id: existing.id, label: existing.po_number },
        details: { reason, amount: existing.total_amount, supplier: existing.supplier_name || null },
      });

      res.json({
        success: true,
        data: { id, status: 'PO_REJECTED' },
        message: 'Commande rejetée',
        camundaTaskCompleted
      });
    } catch (error) {
      return sendError(res, error, 'Erreur lors du rejet');
    }
  }

  /**
   * POST /purchase-orders/:id/review { decision: APPROVE | REJECT, comment } — révision du bon (migration 52), avant
   * son approbation N1 / N2 / N3. Réviseur du projet (prof_po_reviewer ; admin : oui), ni le créateur du bon ni le
   * demandeur. APPROVE → étape de niveau ; REJECT (motif obligatoire) → bon rejeté, la part s'arrête.
   */
  async review(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const decision = String(req.body?.decision || '').toUpperCase();
      const comment = clip(req.body?.comment);
      if (!['APPROVE', 'REJECT'].includes(decision)) {
        return res.status(400).json({ success: false, code: 'REVIEW_DECISION_REQUIRED', message: 'Choisissez : approuver ou rejeter' });
      }
      if (decision === 'REJECT' && !comment) {
        return res.status(400).json({ success: false, code: 'REVIEW_REASON_REQUIRED', message: 'Indiquez le motif du rejet' });
      }
      const existing = await purchaseOrderModel.findById(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Commande non trouvée' });
      const step = await openStepOf(existing, PO_REVIEW_TASK);
      if (existing.status !== 'PO_PENDING' || !step.task) {
        return res.status(409).json({ success: false, code: 'NOT_IN_REVIEW', message: "Ce bon de commande n'attend pas de révision" });
      }
      // Séparation des tâches : ni le créateur du bon, ni le demandeur de la réquisition
      await segregation.assertCanApprovePurchaseOrder(req, existing);
      if (!(await hasApprovalGroup(userId, { group: 'po_reviewer', projectId: step.projectId }))) {
        return res.status(403).json({ success: false, code: 'NOT_PO_REVIEWER', message: "La révision revient au réviseur des bons de commande du projet" });
      }

      const approved = decision === 'APPROVE';
      // Bon mis à jour puis étape BpmnGo terminée, dans une transaction : refus de BpmnGo = rien d'enregistré
      await db.withTransaction(async (tx) => {
        await tx.exec(
          `UPDATE purchase_orders SET reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP, review_decision = $3::varchar,
                  review_comment = $4, status = CASE WHEN $3::varchar = 'REJECTED' THEN 'PO_REJECTED' ELSE status END,
                  updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [existing.id, userId, approved ? 'APPROVED' : 'REJECTED', comment]
        );
        const done = await camundaService.completeTask(step.task.id, { poReviewed: approved, poReviewComment: comment || '' });
        if (!done?.success) {
          throw Object.assign(new Error(done?.error || "BpmnGo n'a pas accepté la révision"), { status: 502, code: 'BPMNGO_ERROR' });
        }
      });
      // Suivi du workflow : fin de l'étape BpmnGo (poReviewed, poReviewComment) + réviseur lu sur le bon (reviewed_by)
      await audit(req, approved ? AUDIT.PURCHASE_ORDER_REVIEWED : AUDIT.PURCHASE_ORDER_REJECTED, {
        entity: { type: 'purchase_order', id: existing.id, label: existing.po_number },
        details: { step: 'REVIEW', decision: approved ? 'APPROVED' : 'REJECTED', comment, amount: existing.total_amount },
      });
      if (req.io) {
        req.io.to(`user-${existing.created_by}`).emit('notification', {
          title: approved ? 'Bon de commande révisé' : 'Bon de commande rejeté à la révision',
          message: `${existing.po_number} : ${approved ? 'révision approuvée, approbation selon son niveau' : comment}`,
          type: approved ? 'SUCCESS' : 'WARNING',
        });
      }
      res.json({ success: true, data: { id: existing.id, status: approved ? 'PO_PENDING' : 'PO_REJECTED', reviewDecision: approved ? 'APPROVED' : 'REJECTED' } });
    } catch (error) {
      return sendError(res, error, 'Erreur lors de la révision');
    }
  }

  async send(req, res) {
    try {
      const { id } = req.params;
      const existing = await purchaseOrderModel.findById(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Commande non trouvée' });
      if (existing.status !== 'PO_APPROVED') {
        return res.status(400).json({ success: false, message: 'Seules les commandes approuvées peuvent être envoyées' });
      }
      const result = await purchaseOrderModel.send(id);
      res.json({ success: true, data: result, message: 'Commande envoyée au fournisseur' });
    } catch (error) {
      res.status(500).json({ success: false, message: "Erreur lors de l'envoi", error: error.message });
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;
      const existing = await purchaseOrderModel.findById(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Commande non trouvée' });
      if (existing.status !== 'DRAFT') {
        return res.status(400).json({ success: false, message: 'Seules les commandes en brouillon peuvent être supprimées' });
      }
      await purchaseOrderModel.delete(id);
      await audit(req, AUDIT.PURCHASE_ORDER_DELETED, {
        entity: { type: 'purchase_order', id: existing.id, label: existing.po_number },
        oldValue: { status: existing.status, amount: existing.total_amount, supplier: existing.supplier_name || null },
      });
      res.json({ success: true, message: 'Commande supprimée avec succès' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur suppression', error: error.message });
    }
  }

  async getStats(req, res) {
    try {
      const stats = await purchaseOrderModel.getStats();
      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur statistiques', error: error.message });
    }
  }

  async generatePDF(req, res) {
    try {
      const { id } = req.params;
      const po = await purchaseOrderModel.findById(id);
      if (!po) {
        return res.status(404).json({ success: false, message: 'Commande non trouvée' });
      }

      const pdfBuffer = await purchaseOrderExportService.generatePDF(po, { lang: i18n.fromRequest(req) });
      const filename = `PO-${po.po_number || id}.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length,
      });
      res.end(pdfBuffer);
    } catch (error) {
      console.error('Error generating PO PDF:', error);
      res.status(500).json({ success: false, message: 'Erreur génération PDF', error: error.message });
    }
  }
}

module.exports = new PurchaseOrderController();
