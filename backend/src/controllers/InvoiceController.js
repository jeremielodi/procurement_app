// backend/src/controllers/InvoiceController.js
const invoiceModel   = require('../models/InvoiceModel');
const camundaService = require('../services/CamundaService');
const db             = require('../config/database');
const segregation    = require('../utils/segregation');
const { audit, AUDIT } = require('../utils/auditLog');

class InvoiceController {

  async create(req, res) {
    try {
      const {
        invoiceNumber, supplierInvoiceNumber, poId, grnId, supplierId,
        invoiceDate, dueDate, subtotal, taxAmount, totalAmount, currency,
        notes, taskId
      } = req.body;
      const createdBy = req.user?.id;

      if (totalAmount == null || !invoiceDate) {
        return res.status(400).json({ success: false, message: 'totalAmount et invoiceDate sont requis' });
      }
      // Une facture est TOUJOURS rattachée à un bon de commande (lui-même rattaché à une réquisition)
      if (!poId) {
        return res.status(400).json({ success: false, code: 'PO_REQUIRED', message: 'Bon de commande requis : la facture se saisit depuis la tâche de la réquisition' });
      }
      let po;
      try { po = await db.one('SELECT id, status FROM purchase_orders WHERE id = $1', [poId]); } catch (_) { po = null; }
      if (!po) {
        return res.status(404).json({ success: false, message: 'Commande introuvable' });
      }
      if (['PO_REJECTED', 'REJECTED', 'CANCELLED', 'DRAFT', 'PO_PENDING'].includes(po.status)) {
        return res.status(409).json({ success: false, code: 'PO_NOT_INVOICEABLE', message: `Commande au statut ${po.status} : facture impossible` });
      }

      // Facture en double : même fournisseur, même n° de facture fournisseur (hors rejetées / annulées)
      const supplierNumber = invoiceModel.supplierNumberOf({ supplierInvoiceNumber, invoiceNumber });
      const effectiveSupplier = poId
        ? (await db.one('SELECT supplier_id FROM purchase_orders WHERE id = $1', [poId]))?.supplier_id || supplierId
        : supplierId;
      const duplicate = await invoiceModel.findDuplicate(effectiveSupplier, supplierNumber);
      if (duplicate) {
        await audit(req, AUDIT.INVOICE_DUPLICATE_BLOCKED, {
          entity: { type: 'invoice', id: duplicate.id, label: duplicate.invoice_number },
          details: { supplierInvoiceNumber: supplierNumber, supplierId: effectiveSupplier, amount: totalAmount, poId: poId || null },
        });
        return res.status(409).json({
          success: false, code: 'DUPLICATE_INVOICE',
          message: `Facture déjà enregistrée : n° ${supplierNumber} de ce fournisseur = ${duplicate.invoice_number}`,
          details: { invoiceId: duplicate.id, invoiceNumber: duplicate.invoice_number, status: duplicate.status },
        });
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
        invoiceNumber, supplierInvoiceNumber, poId, grnId, supplierId,
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
      // Saisie simultanée : l'index unique uq_invoices_supplier_number tranche
      if (error.code === '23505' && String(error.constraint || error.message).includes('uq_invoices_supplier_number')) {
        return res.status(409).json({ success: false, code: 'DUPLICATE_INVOICE', message: 'Facture déjà enregistrée pour ce fournisseur avec ce numéro' });
      }
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
      // Séparation des tâches : validée par une autre personne que celle qui l'a saisie
      await segregation.assertCanApproveInvoice(req, inv);

      await invoiceModel.approve(id, userId, comments);

      if (taskId) {
        try {
          await camundaService.completeTask(taskId, { invoiceApproved: true });
        } catch (e) { /**/ }
      }

      res.json({ success: true, message: 'Facture approuvée' });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      res.status(500).json({ success: false, message: "Erreur approbation facture", error: error.message });
    }
  }

  async reject(req, res) {
    try {
      const { id } = req.params;
      const { reason, taskId } = req.body;
      const userId = req.user?.id;

      if (!reason) return res.status(400).json({ success: false, message: 'reason requis' });

      const inv = await invoiceModel.findById(id);
      if (!inv) return res.status(404).json({ success: false, message: 'Facture non trouvée' });
      await invoiceModel.reject(id, userId, reason);
      await audit(req, AUDIT.INVOICE_REJECTED, {
        entity: { type: 'invoice', id: inv.id, label: inv.invoice_number },
        details: { reason, amount: inv.total_amount, supplierInvoiceNumber: inv.supplier_invoice_number || null },
      });

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
