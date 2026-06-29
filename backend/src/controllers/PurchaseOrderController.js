// backend/src/controllers/PurchaseOrderController.js
const purchaseOrderModel = require('../models/PurchaseOrderModel');
const camundaService = require('../services/CamundaService');
const db = require('../config/database');
const purchaseOrderExportService = require('../services/PurchaseOrderExportService');

class PurchaseOrderController {

  async create(req, res) {
    try {
      const {
        requisitionId, taskId, supplierId, orderDate, deliveryDate,
        shippingAddress, totalAmount, currency, items, notes, createdBy
      } = req.body;

      if (!requisitionId || !supplierId || !totalAmount) {
        return res.status(400).json({
          success: false,
          message: 'requisitionId, supplierId et totalAmount sont requis'
        });
      }

      const result = await purchaseOrderModel.create({
        requisitionId, taskId: taskId || null, supplierId, orderDate, deliveryDate,
        shippingAddress, totalAmount, currency, notes,
        items: items || [],
        createdBy: createdBy || req.user?.id || 1
      });

      // Complete the Camunda task — use taskId directly if provided, otherwise look it up
      try {
        let camundaTaskId = taskId;
        if (!camundaTaskId) {
          const reqRow = await db.one(
            'SELECT process_instance_id FROM requisitions WHERE id = $1',
            [requisitionId]
          );
          if (reqRow?.process_instance_id) {
            const tasks = await camundaService.getProcessTasks(reqRow.process_instance_id);
            const found = (tasks || []).find(t => t.taskDefinitionKey === 'Activity_CreatePO');
            if (found) camundaTaskId = found.id;
          }
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
      const { status, supplierId, requisitionId, search, fromDate, toDate, page = 1, limit = 20 } = req.query;
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
      res.json({ success: true, data: purchaseOrder });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération commande', error: error.message });
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
      const { approverId, comments, taskId } = req.body;
      const userId = req.user?.id || approverId;

      const existing = await purchaseOrderModel.findById(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Commande non trouvée' });

      if (existing.status !== 'PO_PENDING') {
        return res.status(400).json({ success: false, message: 'Seules les commandes en attente peuvent être approuvées' });
      }

      let camundaTaskCompleted = false;

      if (taskId) {
        try {
          await camundaService.completeTask(taskId, { poApproved: true, comment: comments });
          camundaTaskCompleted = true;
        } catch (err) {
          console.error('[PO approve] Camunda completeTask (non-fatal):', err.message);
        }
      } else if (existing.requisition_id) {
        try {
          const reqRow = await db.one(
            'SELECT process_instance_id FROM requisitions WHERE id = $1',
            [existing.requisition_id]
          );
          if (reqRow?.process_instance_id) {
            const tasks = await camundaService.getProcessTasks(reqRow.process_instance_id);
            const poTask = (tasks || []).find(t => t.taskDefinitionKey === 'Activity_POApproval');
            if (poTask) {
              await camundaService.completeTask(poTask.id, { poApproved: true, comment: comments });
              camundaTaskCompleted = true;
            }
          }
        } catch (err) {
          console.error('[PO approve] Camunda lookup (non-fatal):', err.message);
        }
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
      console.error('Error approving purchase order:', error);
      res.status(500).json({ success: false, message: "Erreur lors de l'approbation", error: error.message });
    }
  }

  /**
   * POST /purchase-orders/:id/reject
   * Body: { approverId, reason, taskId? }
   */
  async reject(req, res) {
    try {
      const { id } = req.params;
      const { approverId, reason, taskId } = req.body;
      const userId = req.user?.id || approverId;

      if (!reason) {
        return res.status(400).json({ success: false, message: 'La raison du rejet est requise' });
      }

      const existing = await purchaseOrderModel.findById(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Commande non trouvée' });

      if (existing.status !== 'PO_PENDING') {
        return res.status(400).json({ success: false, message: 'Seules les commandes en attente peuvent être rejetées' });
      }

      let camundaTaskCompleted = false;

      if (taskId) {
        try {
          await camundaService.completeTask(taskId, { poApproved: false, comment: reason });
          camundaTaskCompleted = true;
        } catch (err) {
          console.error('[PO reject] Camunda completeTask (non-fatal):', err.message);
        }
      } else if (existing.requisition_id) {
        try {
          const reqRow = await db.one(
            'SELECT process_instance_id FROM requisitions WHERE id = $1',
            [existing.requisition_id]
          );
          if (reqRow?.process_instance_id) {
            const tasks = await camundaService.getProcessTasks(reqRow.process_instance_id);
            const poTask = (tasks || []).find(t => t.taskDefinitionKey === 'Activity_POApproval');
            if (poTask) {
              await camundaService.completeTask(poTask.id, { poApproved: false, comment: reason });
              camundaTaskCompleted = true;
            }
          }
        } catch (err) {
          console.error('[PO reject] Camunda lookup (non-fatal):', err.message);
        }
      }

      await purchaseOrderModel.reject(id, userId, reason);

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

      const pdfBuffer = await purchaseOrderExportService.generatePDF(po);
      const filename = `PO-${po.po_number || id}.pdf`;

      res.set({
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      pdfBuffer.length,
      });
      res.end(pdfBuffer);
    } catch (error) {
      console.error('Error generating PO PDF:', error);
      res.status(500).json({ success: false, message: 'Erreur génération PDF', error: error.message });
    }
  }
}

module.exports = new PurchaseOrderController();
