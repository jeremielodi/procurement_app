// backend/src/controllers/PurchaseOrderController.js
const purchaseOrderModel = require('../models/PurchaseOrderModel');
const camundaService = require('../services/CamundaService');
const db = require('../config/database');
const i18n = require('../i18n');
const purchaseOrderExportService = require('../services/PurchaseOrderExportService');
const segregation = require('../utils/segregation');
const { audit, AUDIT } = require('../utils/auditLog');

/** Erreur métier { status, code } (séparation des tâches…) sinon 500 */
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
        shippingAddress, totalAmount, currency, items, notes
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

      const result = await purchaseOrderModel.create({
        requisitionId, taskId: taskId || null, supplierId, orderDate, deliveryDate,
        shippingAddress, totalAmount, currency, notes,
        items: items || [],
        createdBy: req.user.id // jamais une valeur du client (séparation des tâches)
      });

      // Étape GoFlow « Créer le bon de commande » de CETTE réquisition (le taskId du client n'est retenu que s'il
      // correspond : une autre tâche ne doit jamais être terminée par la création d'une commande)
      try {
        let camundaTaskId = null;
        if (requisition.process_instance_id) {
          const tasks = await camundaService.getProcessTasks(requisition.process_instance_id);
          const createTasks = (tasks || []).filter(t => t.taskDefinitionKey === 'Activity_CreatePO');
          camundaTaskId = (createTasks.find(t => t.id === taskId) || createTasks[0])?.id || null;
        }
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
          const tasks = await camundaService.getProcessTasks(reqRow.process_instance_id);
          const poTask = (tasks || []).find(t => t.taskDefinitionKey === 'Activity_POApproval');
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
          const tasks = await camundaService.getProcessTasks(reqRow.process_instance_id);
          const poTask = (tasks || []).find(t => t.taskDefinitionKey === 'Activity_POApproval');
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
