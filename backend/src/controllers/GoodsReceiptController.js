// backend/src/controllers/GoodsReceiptController.js
const grnModel       = require('../models/GoodsReceiptModel');
const camundaService = require('../services/CamundaService');
const db             = require('../config/database');

class GoodsReceiptController {

  async create(req, res) {
    try {
      const { poId, grnItems = [], observations, taskId } = req.body;
      const receivedBy = req.body.receivedBy || req.user?.id;

      if (!poId) {
        return res.status(400).json({ success: false, message: 'poId est requis' });
      }

      let po;
      try { po = await db.one('SELECT id FROM purchase_orders WHERE id = $1', [poId]); } catch (_) { po = null; }
      if (!po) {
        return res.status(404).json({ success: false, message: 'Commande introuvable' });
      }

      const result = await grnModel.create({ poId, receivedBy, grnItems, observations });

      // Complete Camunda Activity_GoodsReceipt task
      let camundaTaskCompleted = false;
      const completionVars = {
        grnId: result.id,
        grnNumber: result.grnNumber,
        grnCompliant: result.grnCompliant,
        receiptStatus: result.status
      };

      if (taskId) {
        try {
          await camundaService.completeTask(taskId, completionVars);
          camundaTaskCompleted = true;
        } catch (e) {
          console.error('[GRN] Camunda completeTask (non-fatal):', e.message);
        }
      } else {
        // Auto-find the task via process_instance_id of the linked requisition
        try {
          const row = await db.one(
            `SELECT r.process_instance_id
             FROM requisitions r
             JOIN purchase_orders po ON po.requisition_id = r.id
             WHERE po.id = $1`,
            [poId]
          );
          if (row?.process_instance_id) {
            const tasks = await camundaService.getProcessTasks(row.process_instance_id);
            const grnTask = (tasks || []).find(t => t.taskDefinitionKey === 'Activity_GoodsReceipt');
            if (grnTask) {
              await camundaService.completeTask(grnTask.id, completionVars);
              camundaTaskCompleted = true;
            }
          }
        } catch (e) {
          console.error('[GRN] Camunda auto-complete (non-fatal):', e.message);
        }
      }

      if (req.io) {
        req.io.emit('grn-created', { grnId: result.id, poId, grnCompliant: result.grnCompliant });
      }

      res.status(201).json({
        success: true,
        data: result,
        camundaTaskCompleted,
        message: 'Bon de réception créé avec succès'
      });
    } catch (error) {
      console.error('Error creating GRN:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la création du GRN', error: error.message });
    }
  }

  async getAll(req, res) {
    try {
      const { poId, status, page = 1, limit = 20 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const [data, total] = await Promise.all([
        grnModel.findAll({ poId, status, limit: parseInt(limit), offset }),
        grnModel.count({ poId, status })
      ]);

      res.json({
        success: true,
        data,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération GRN', error: error.message });
    }
  }

  async getById(req, res) {
    try {
      const grn = await grnModel.findById(req.params.id);
      if (!grn) return res.status(404).json({ success: false, message: 'GRN non trouvé' });
      res.json({ success: true, data: grn });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération GRN', error: error.message });
    }
  }

  async getByPO(req, res) {
    try {
      const { poId } = req.params;
      let po;
      try { po = await db.one('SELECT id FROM purchase_orders WHERE id = $1', [poId]); } catch (_) { po = null; }
      if (!po) return res.status(404).json({ success: false, message: 'Commande introuvable' });
      const data = await grnModel.findByPOId(poId);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération GRN', error: error.message });
    }
  }

  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!status) return res.status(400).json({ success: false, message: 'status requis' });
      await grnModel.updateStatus(id, status);
      res.json({ success: true, message: 'Statut mis à jour' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur mise à jour statut', error: error.message });
    }
  }
}

module.exports = new GoodsReceiptController();
