// backend/src/controllers/GoodsReceiptController.js
const grnModel       = require('../models/GoodsReceiptModel');
const camundaService = require('../services/CamundaService');
const db             = require('../config/database');
const i18n           = require('../i18n');
const grnExportService = require('../services/GoodsReceiptExportService');
const { audit, AUDIT } = require('../utils/auditLog');

/** Annulation d'un GRN tracée dans le journal d'audit */
const auditCancel = (req, result) => audit(req, AUDIT.GOODS_RECEIPT_CANCELLED, {
  entity: { type: 'goods_receipt', id: result.id, label: result.grnNumber },
  details: { reason: req.body?.reason || null, reversedMovements: result.reversedMovements },
});

// Erreurs métier du modèle ({ status, code }) → réponse HTTP ; le reste → 500
function sendError(res, error, fallback) {
  if (error.status) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message, line: error.line, remaining: error.remaining });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

class GoodsReceiptController {

  async create(req, res) {
    try {
      const { poId, grnItems = [], observations, taskId, warehouseId } = req.body;
      const receivedBy = req.body.receivedBy || req.user?.id;

      if (!poId) {
        return res.status(400).json({ success: false, message: 'poId est requis' });
      }

      let po;
      try { po = await db.one('SELECT id FROM purchase_orders WHERE id = $1', [poId]); } catch (_) { po = null; }
      if (!po) {
        return res.status(404).json({ success: false, message: 'Commande introuvable' });
      }

      const result = await grnModel.create({ poId, receivedBy, grnItems, observations, warehouseId }, { userId: req.user.id });

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
      return sendError(res, error, 'Erreur lors de la création du GRN');
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

  /** GET /api/goods-receipts/:id/pdf — aperçu / téléchargement du bon de réception */
  async generatePDF(req, res) {
    try {
      const result = await grnExportService.generatePDF(req.params.id, { lang: i18n.fromRequest(req) });
      if (!result) return res.status(404).json({ success: false, message: 'GRN introuvable' });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="${String(result.grn.grn_number).replace(/[^\w.-]+/g, '_')}.pdf"`);
      res.end(result.pdf);
    } catch (error) {
      console.error('Error generating GRN PDF:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la génération du PDF', error: error.message });
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
      const current = await grnModel.findById(id);
      if (!current) return res.status(404).json({ success: false, message: 'GRN non trouvé' });
      if (current.status === 'CANCELLED') {
        return res.status(409).json({ success: false, code: 'ALREADY_CANCELLED', message: 'GRN annulé : statut figé' });
      }
      // Annulation : écritures de stock inverses (jamais un simple changement de statut)
      if (status === 'CANCELLED') {
        const result = await grnModel.cancel(id, { userId: req.user.id, reason: req.body.reason });
        await auditCancel(req, result);
        return res.json({ success: true, data: result, message: 'GRN annulé' });
      }
      await grnModel.updateStatus(id, status);
      res.json({ success: true, message: 'Statut mis à jour' });
    } catch (error) {
      return sendError(res, error, 'Erreur mise à jour statut');
    }
  }

  /** POST /goods-receipts/:id/cancel { reason } — annule la réception et ses entrées en stock */
  async cancel(req, res) {
    try {
      const result = await grnModel.cancel(req.params.id, { userId: req.user.id, reason: req.body?.reason });
      await auditCancel(req, result);
      res.json({ success: true, data: result, message: 'GRN annulé' });
    } catch (error) {
      return sendError(res, error, 'Erreur lors de l\'annulation du GRN');
    }
  }
}

module.exports = new GoodsReceiptController();
