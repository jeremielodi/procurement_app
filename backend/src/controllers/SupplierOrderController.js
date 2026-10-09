// backend/src/controllers/SupplierOrderController.js
// Bons de commande et confirmation fournisseur :
//  - portail fournisseur (SUPPLIER_PORTAL) : mes commandes, détail, PDF, confirmer / décliner
//  - achats (CREATE_PURCHASE_ORDERS) : enregistrer la réponse reçue hors portail (téléphone, email)
const db = require('../config/database');
const confirmationService = require('../services/SupplierConfirmationService');
const purchaseOrderModel = require('../models/PurchaseOrderModel');
const purchaseOrderExportService = require('../services/PurchaseOrderExportService');
const i18n = require('../i18n');

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

/** Fournisseur lié au compte connecté */
const mySupplier = (userId) => db.one('SELECT id, name FROM suppliers WHERE user_id = $1', [userId]);

async function supplierOr404(req, res) {
  const supplier = await mySupplier(req.user.id);
  if (!supplier) {
    res.status(404).json({ success: false, code: 'NO_SUPPLIER', message: 'Aucune fiche fournisseur liée à ce compte' });
    return null;
  }
  return supplier;
}

module.exports = {
  /** GET /supplier-portal/orders?status=TO_CONFIRM */
  async myOrders(req, res) {
    try {
      const supplier = await supplierOr404(req, res);
      if (!supplier) return;
      res.json({ success: true, data: await confirmationService.listForSupplier(supplier.id, { status: req.query.status }) });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des commandes'); }
  },

  /** GET /supplier-portal/orders/:id */
  async myOrder(req, res) {
    try {
      const supplier = await supplierOr404(req, res);
      if (!supplier) return;
      const po = await confirmationService.getForSupplier(req.params.id, supplier.id);
      if (!po) return res.status(404).json({ success: false, message: 'Bon de commande introuvable' });
      res.json({ success: true, data: po });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement de la commande'); }
  },

  /** GET /supplier-portal/orders/:id/pdf?lang= */
  async myOrderPdf(req, res) {
    try {
      const supplier = await supplierOr404(req, res);
      if (!supplier) return;
      if (!(await confirmationService.getForSupplier(req.params.id, supplier.id))) {
        return res.status(404).json({ success: false, message: 'Bon de commande introuvable' });
      }
      const po = await purchaseOrderModel.findById(req.params.id);
      const pdf = await purchaseOrderExportService.generatePDF(po, { lang: i18n.fromRequest(req) });
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${String(po.po_number).replace(/[^\w.-]+/g, '_')}.pdf"` });
      res.end(pdf);
    } catch (error) { return sendError(res, error, 'Erreur lors de la génération du PDF'); }
  },

  /** POST /supplier-portal/orders/:id/confirm { deliveryDate, reference, comment } */
  async confirm(req, res) {
    try {
      const supplier = await supplierOr404(req, res);
      if (!supplier) return;
      const b = req.body || {};
      const result = await confirmationService.respond(req.params.id,
        { response: 'CONFIRMED', deliveryDate: b.deliveryDate, reference: b.reference, comment: b.comment },
        { userId: req.user.id, source: 'PORTAL', supplierId: supplier.id, io: req.io });
      res.json({ success: true, data: result, message: 'Commande confirmée' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la confirmation'); }
  },

  /** POST /supplier-portal/orders/:id/decline { comment } */
  async decline(req, res) {
    try {
      const supplier = await supplierOr404(req, res);
      if (!supplier) return;
      const result = await confirmationService.respond(req.params.id,
        { response: 'DECLINED', comment: req.body?.comment },
        { userId: req.user.id, source: 'PORTAL', supplierId: supplier.id, io: req.io });
      res.json({ success: true, data: result, message: 'Refus transmis à l\'acheteur' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'envoi du refus'); }
  },

  /** POST /purchase-orders/:id/supplier-response { response, deliveryDate, reference, comment } — saisie par les achats */
  async recordResponse(req, res) {
    try {
      const b = req.body || {};
      const result = await confirmationService.respond(req.params.id,
        { response: b.response || 'CONFIRMED', deliveryDate: b.deliveryDate, reference: b.reference, comment: b.comment },
        { userId: req.user.id, source: 'PROCUREMENT', io: req.io });
      res.json({ success: true, data: result, message: result.response === 'CONFIRMED' ? 'Confirmation enregistrée' : 'Refus enregistré' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement de la réponse du fournisseur'); }
  },
};
