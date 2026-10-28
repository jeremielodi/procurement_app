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

/** Erreur métier { status, code } (séparation des tâches…) sinon 500 */
/** Texte libre facultatif (conditions, instructions) : vide → null */
const clip = (v) => String(v ?? '').trim().slice(0, 2000) || null;

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
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

      const result = await purchaseOrderModel.create({
        requisitionId, taskId: taskId || null, supplierId, orderDate, deliveryDate,
        shippingAddress, totalAmount, currency, notes,
        // Instructions au fournisseur : ancien champ « notes » accepté (il n'était pas enregistré)
        paymentTerms: clip(paymentTerms), deliveryTerms: clip(deliveryTerms), specialInstructions: clip(specialInstructions ?? notes),
        items: items || [],
        supplierLotId: lot?.id || null,
        createdBy: req.user.id // jamais une valeur du client (séparation des tâches)
      });

      // Étape GoFlow « Créer le bon de commande » de CETTE réquisition et de CETTE part (le taskId du client n'est
      // retenu que s'il correspond : une autre tâche ne doit jamais être terminée par la création d'une commande)
      try {
        const camundaTaskId = requisition.process_instance_id
          ? (await orderTasks.findCreateTask(requisition.process_instance_id, lot?.id || null, taskId))?.id || null
          : null;
        if (camundaTaskId) {
          await camundaService.completeTask(camundaTaskId, {
            poId: result.id,
            poNumber: result.poNumber,
            totalAmount
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
   * sans nouvelle réception. L'étape GoFlow en attente pour cette livraison (SAN ou GRN) est terminée avec
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
          console.error('[PO] Solde du reliquat — étape GoFlow (non bloquant) :', e.message);
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

      let camundaTaskCompleted = false;

      try {
        const reqRow = await db.one(
          'SELECT process_instance_id FROM requisitions WHERE id = $1',
          [existing.requisition_id]
        );
        if (reqRow?.process_instance_id) {
          const poTask = await orderTasks.findForPurchaseOrder(reqRow.process_instance_id, 'Activity_POApproval', existing.id);
          if (poTask) {
            await camundaService.completeTask(poTask.id, { poApproved: true, poApprovalComment: comments || '' });
            camundaTaskCompleted = true;
          }
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

      let camundaTaskCompleted = false;

      try {
        const reqRow = await db.one(
          'SELECT process_instance_id FROM requisitions WHERE id = $1',
          [existing.requisition_id]
        );
        if (reqRow?.process_instance_id) {
          const poTask = await orderTasks.findForPurchaseOrder(reqRow.process_instance_id, 'Activity_POApproval', existing.id);
          if (poTask) {
            await camundaService.completeTask(poTask.id, { poApproved: false, poApprovalComment: reason || '' });
            camundaTaskCompleted = true;
          }
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
      console.error('Error rejecting purchase order:', error);
      res.status(500).json({ success: false, message: 'Erreur lors du rejet', error: error.message });
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
