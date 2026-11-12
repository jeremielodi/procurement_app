// backend/src/controllers/GoodsReceiptController.js
const grnModel       = require('../models/GoodsReceiptModel');
const camundaService = require('../services/CamundaService');
const orderTasks = require('../services/OrderTaskService');
const db             = require('../config/database');
const i18n           = require('../i18n');
const grnExportService = require('../services/GoodsReceiptExportService');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const warehouseModel = require('../models/WarehouseModel');
const { audit, AUDIT } = require('../utils/auditLog');
const { block, same } = require('../utils/segregation');
const stockNature = require('../utils/stockNature');

/** Notification in-app (+ temps réel) dans la langue du destinataire ; n'interrompt jamais la requête */
async function notify(req, userId, key, vars, link) {
  try {
    const user = await userModel.findById(userId);
    const T = i18n.translator(user?.language);
    const title = T(`notification.grnStore.${key}Title`, vars);
    const message = T(`notification.grnStore.${key}Message`, vars);
    await notificationModel.create({ userId, title, message, type: 'INFO', link });
    req.io?.to(`user-${userId}`).emit('notification', { title, message, type: 'INFO', link, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Notification confirmation du magasin :', error.message);
  }
}
const userName = async (req) => {
  const u = await userModel.findById(req.user.id).catch(() => null);
  return `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || req.user.email;
};

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
      const { poId, grnItems = [], observations, taskId, warehouseId, closeRemaining, closeReason } = req.body;
      const receivedBy = req.body.receivedBy || req.user?.id;

      if (!poId) {
        return res.status(400).json({ success: false, message: 'poId est requis' });
      }

      let po;
      try { po = await db.one('SELECT id FROM purchase_orders WHERE id = $1', [poId]); } catch (_) { po = null; }
      if (!po) {
        return res.status(404).json({ success: false, message: 'Commande introuvable' });
      }

      const result = await grnModel.create({
        poId, receivedBy, grnItems, observations, warehouseId,
        closeRemaining: closeRemaining === true || closeRemaining === 'true', closeReason,
      }, { userId: req.user.id });
      if (result.deliveryClosed) {
        await audit(req, AUDIT.PO_DELIVERY_CLOSED, {
          entity: { type: 'purchase_order', id: poId, label: result.grnNumber },
          details: { reason: String(closeReason || '').trim(), grnNumber: result.grnNumber },
        });
      }

      // Complete Camunda Activity_GoodsReceipt task
      let camundaTaskCompleted = false;
      const completionVars = {
        grnId: result.id,
        grnNumber: result.grnNumber,
        grnCompliant: result.grnCompliant,
        // Reste à livrer → nouvelle SAN puis nouveau GRN ; tout livré ou reliquat soldé → facture
        deliveryComplete: result.deliveryComplete,
        receiptStatus: result.status
      };

      // Étape BpmnGo de CE bon de commande (réquisition répartie : une réception par part) ; le taskId du client
      // n'est retenu que s'il désigne cette étape
      try {
        const row = await db.one(
          `SELECT r.process_instance_id
           FROM requisitions r
           JOIN purchase_orders po ON po.requisition_id = r.id
           WHERE po.id = $1`,
          [poId]
        );
        const grnTask = row?.process_instance_id
          ? await orderTasks.findForPurchaseOrder(row.process_instance_id, 'Activity_GoodsReceipt', poId, taskId)
          : null;
        if (grnTask) {
          await camundaService.completeTask(grnTask.id, completionVars);
          camundaTaskCompleted = true;
        }
      } catch (e) {
        console.error('[GRN] Camunda completeTask (non-fatal):', e.message);
      }

      if (req.io) {
        req.io.emit('grn-created', { grnId: result.id, poId, grnCompliant: result.grnCompliant });
      }

      // Entrée en magasin à confirmer : les personnes du dépôt (sauf l'auteur) sont prévenues
      try {
        const grn = await grnModel.findById(result.id);
        if (grn?.warehouse_id) {
          const vars = { number: grn.grn_number, warehouse: grn.warehouse_name, name: grn.received_by_name || '' };
          for (const userId of await grnModel.storeConfirmers(grn)) await notify(req, userId, 'toConfirm', vars, `/goods-receipts/${grn.id}`);
        }
      } catch (e) {
        console.error('[GRN] notification du magasin (non-fatal):', e.message);
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
      // Confirmation de l'entrée en magasin : accès au dépôt, réception active et non confirmée, pas son propre GRN
      const pending = grn.status !== 'CANCELLED' && !!grn.warehouse_id && !grn.store_confirmed_at;
      const onWarehouse = pending && await warehouseModel.canOperate(req.user.id, grn.warehouse_id);
      grn.store_self_confirmation = onWarehouse && same(grn.received_by, req.user.id);
      // … et toutes les natures des articles entrés en stock autorisées (migration 63)
      const naturesOk = onWarehouse && !grn.store_self_confirmation && await stockNature.assertSql(
        db, "SELECT DISTINCT si.nature FROM stock_movements m JOIN stock_items si ON si.id = m.stock_item_id WHERE m.source_type = 'GRN' AND m.source_id = $1::text",
        [String(grn.id)]
      ).then(() => true, () => false);
      grn.can_store_confirm = onWarehouse && !grn.store_self_confirmation && naturesOk;
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

  /**
   * POST /goods-receipts/:id/items/:itemId/stock-entry { stockItemId, warehouseId, lotNumber, expiryDate, serials }
   * — entrée en stock, après la réception, d'une ligne qui n'y est pas entrée (texte libre / article alors non stockable)
   */
  async stockEntry(req, res) {
    try {
      const { stockItemId, warehouseId, lotNumber, expiryDate, serials } = req.body || {};
      const result = await grnModel.stockEntry(req.params.id, req.params.itemId,
        { stockItemId, warehouseId, lotNumber, expiryDate, serials }, { userId: req.user.id });
      await audit(req, AUDIT.GOODS_RECEIPT_STOCK_ENTRY, {
        entity: { type: 'goods_receipt', id: result.id, label: result.grnNumber },
        details: {
          item: result.itemDescription, stockItem: result.stockItemCode, quantity: result.quantity,
          warehouseId: result.warehouseId, lotNumber: lotNumber || null, stockMovements: result.stockMovements,
        },
      });
      res.json({ success: true, data: result, message: 'Ligne entrée en stock' });
    } catch (error) {
      return sendError(res, error, 'Erreur lors de l\'entrée en stock');
    }
  }

  /**
   * POST /goods-receipts/:id/store-confirm { comment } — le magasin confirme l'entrée des articles reçus (migration 61) :
   * nom, fonction, date et signature imprimés dans le cadre « Dépôt » du bon de réception. Personne ayant accès au dépôt,
   * jamais celle qui a enregistré la réception (403 SELF_VALIDATION, tracé SOD_VIOLATION_BLOCKED).
   */
  async confirmStore(req, res) {
    try {
      const current = await grnModel.findById(req.params.id);
      if (!current) return res.status(404).json({ success: false, code: 'GRN_NOT_FOUND', message: 'GRN introuvable' });
      if (same(current.received_by, req.user.id)) {
        throw await block(req, {
          code: 'SELF_VALIDATION',
          message: 'Séparation des tâches : l\'entrée en magasin doit être confirmée par une autre personne que celle qui a enregistré la réception',
          entity: { type: 'goods_receipt', id: current.id, label: current.grn_number },
          details: { document: 'goods_receipt' },
        });
      }
      const result = await grnModel.confirmStore(req.params.id, { userId: req.user.id, comment: req.body?.comment });
      await audit(req, AUDIT.GOODS_RECEIPT_STORE_CONFIRMED, {
        entity: { type: 'goods_receipt', id: result.id, label: result.grnNumber },
        details: { warehouse: current.warehouse_name, comment: result.comment },
      });
      if (current.received_by) {
        await notify(req, current.received_by, 'confirmed', { number: current.grn_number, warehouse: current.warehouse_name, name: await userName(req) },
          `/goods-receipts/${current.id}`);
      }
      res.json({ success: true, data: await grnModel.findById(req.params.id), message: 'Entrée en magasin confirmée' });
    } catch (error) {
      return sendError(res, error, 'Erreur lors de la confirmation de l\'entrée en magasin');
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
