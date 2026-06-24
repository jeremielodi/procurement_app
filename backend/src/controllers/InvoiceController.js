// backend/src/controllers/InvoiceController.js
const invoiceModel   = require('../models/InvoiceModel');
const camundaService = require('../services/CamundaService');
const db             = require('../config/database');

class InvoiceController {

  async create(req, res) {
    try {
      const {
        invoiceNumber, poId, grnId, supplierId,
        invoiceDate, dueDate, subtotal, taxAmount, totalAmount, currency,
        notes, taskId
      } = req.body;
      const createdBy = req.user?.id;

      if (totalAmount == null || !invoiceDate) {
        return res.status(400).json({ success: false, message: 'totalAmount et invoiceDate sont requis' });
      }

      if (poId) {
        let po;
        try { po = await db.one('SELECT id FROM purchase_orders WHERE id = $1', [poId]); } catch (_) { po = null; }
        if (!po) {
          return res.status(404).json({ success: false, message: 'Commande introuvable' });
        }
      }

      // Resolve process_instance_id for Camunda lookup
      let processInstanceId = null;
      if (poId) {
        try {
          const row = await db.one(
            'SELECT process_instance_id FROM requisitions WHERE id = (SELECT requisition_id FROM purchase_orders WHERE id = $1)',
            [poId]
          );
          processInstanceId = row?.process_instance_id || null;
        } catch { /**/ }
      }

      const result = await invoiceModel.create({
        invoiceNumber, poId, grnId, supplierId,
        invoiceDate, dueDate, subtotal, taxAmount, totalAmount, currency,
        notes, createdBy, processInstanceId, camundaTaskId: taskId || null
      });

      // Complete Camunda Activity_EnterInvoice task
      let camundaTaskCompleted = false;
      const completionVars = {
        invoiceId: result.id,
        invoiceNumber: result.invoiceNumber,
        invoiceAmount: totalAmount,
        invoiceValid: result.invoiceValid,
        matchStatus: result.match_status
      };

      if (taskId) {
        try {
          await camundaService.completeTask(taskId, completionVars);
          camundaTaskCompleted = true;
        } catch (e) {
          console.error('[Invoice] Camunda completeTask (non-fatal):', e.message);
        }
      } else if (processInstanceId) {
        try {
          const tasks = await camundaService.getProcessTasks(processInstanceId);
          const invoiceTask = (tasks || []).find(t => t.taskDefinitionKey === 'Activity_EnterInvoice');
          if (invoiceTask) {
            await camundaService.completeTask(invoiceTask.id, completionVars);
            camundaTaskCompleted = true;
          }
        } catch (e) {
          console.error('[Invoice] Camunda auto-complete (non-fatal):', e.message);
        }
      }

      if (req.io) {
        req.io.emit('invoice-created', { invoiceId: result.id, poId, matchStatus: result.match_status });
      }

      res.status(201).json({
        success: true,
        data: result,
        camundaTaskCompleted,
        message: `Facture créée — rapprochement: ${result.match_status}`
      });
    } catch (error) {
      console.error('Error creating invoice:', error);
      res.status(500).json({ success: false, message: 'Erreur création facture', error: error.message });
    }
  }

  async getAll(req, res) {
    try {
      const { poId, grnId, status, matchStatus, page = 1, limit = 20 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const [data, total] = await Promise.all([
        invoiceModel.findAll({ poId, grnId, status, matchStatus, limit: parseInt(limit), offset }),
        invoiceModel.count({ status, matchStatus })
      ]);

      res.json({
        success: true, data,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération factures', error: error.message });
    }
  }

  async getById(req, res) {
    try {
      const inv = await invoiceModel.findById(req.params.id);
      if (!inv) return res.status(404).json({ success: false, message: 'Facture non trouvée' });
      res.json({ success: true, data: inv });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur récupération facture', error: error.message });
    }
  }

  async runMatch(req, res) {
    try {
      const inv = await invoiceModel.findById(req.params.id);
      if (!inv) return res.status(404).json({ success: false, message: 'Facture non trouvée' });
      const result = await invoiceModel.runThreeWayMatch(req.params.id);
      res.json({ success: true, data: result, message: `Rapprochement: ${result.match_status}` });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur rapprochement', error: error.message });
    }
  }

  async approve(req, res) {
    try {
      const { id } = req.params;
      const { comments, taskId } = req.body;
      const userId = req.user?.id;

      const inv = await invoiceModel.findById(id);
      if (!inv) return res.status(404).json({ success: false, message: 'Facture non trouvée' });

      await invoiceModel.approve(id, userId, comments);

      if (taskId) {
        try {
          await camundaService.completeTask(taskId, { invoiceApproved: true });
        } catch (e) { /**/ }
      }

      res.json({ success: true, message: 'Facture approuvée' });
    } catch (error) {
      res.status(500).json({ success: false, message: "Erreur approbation facture", error: error.message });
    }
  }

  async reject(req, res) {
    try {
      const { id } = req.params;
      const { reason, taskId } = req.body;
      const userId = req.user?.id;

      if (!reason) return res.status(400).json({ success: false, message: 'reason requis' });

      await invoiceModel.reject(id, userId, reason);

      if (taskId) {
        try {
          await camundaService.completeTask(taskId, { invoiceApproved: false, rejectionReason: reason });
        } catch (e) { /**/ }
      }

      res.json({ success: true, message: 'Facture rejetée' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur rejet facture', error: error.message });
    }
  }
}

module.exports = new InvoiceController();
