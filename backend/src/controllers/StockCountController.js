// backend/src/controllers/StockCountController.js
// Inventaires (COUNT_STOCK : ouvrir, compter, annuler ; ADJUST_STOCK : valider les écarts) et ajustements ponctuels
// (ADJUST_STOCK). Consultation : VIEW_STOCK.
const countModel = require('../models/StockCountModel');
const { audit, AUDIT } = require('../utils/auditLog');

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message, line: error.line, pending: error.pending });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}
const paging = (req) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
};

module.exports = {
  async list(req, res) {
    try {
      const { limit, page, offset } = paging(req);
      const { rows, total } = await countModel.list({ ...req.query, limit, offset });
      res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des inventaires'); }
  },

  async get(req, res) {
    try {
      const count = await countModel.get(req.params.id);
      if (!count) return res.status(404).json({ success: false, message: 'Inventaire introuvable' });
      res.json({ success: true, data: count });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement de l\'inventaire'); }
  },

  /** POST /stock-counts { warehouseId, categoryId?, comment? } */
  async open(req, res) {
    try {
      const b = req.body || {};
      if (!b.warehouseId) return res.status(400).json({ success: false, code: 'REQUIRED', message: 'Dépôt requis' });
      res.status(201).json({ success: true, data: await countModel.open(b, { userId: req.user.id }), message: 'Inventaire ouvert' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'ouverture de l\'inventaire'); }
  },

  /** PUT /stock-counts/:id/lines { entries: [{ lineId, countedQuantity, note }] } */
  async record(req, res) {
    try {
      res.json({ success: true, data: await countModel.recordCounts(req.params.id, req.body?.entries, { userId: req.user.id }) });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement du comptage'); }
  },

  /** POST /stock-counts/:id/lines { stockItemId, lotId | lotNumber + expiryDate, countedQuantity, note } */
  async addLine(req, res) {
    try {
      res.status(201).json({ success: true, data: await countModel.addLine(req.params.id, req.body || {}, { userId: req.user.id }) });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'ajout de la ligne'); }
  },

  async validate(req, res) {
    try {
      const result = await countModel.validate(req.params.id, { userId: req.user.id });
      await audit(req, AUDIT.STOCK_COUNT_VALIDATED, {
        entity: { type: 'stock_count', id: result.id, label: result.countNumber }, details: { adjustedLines: result.adjustedLines },
      });
      res.json({ success: true, data: result, message: 'Inventaire validé' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la validation de l\'inventaire'); }
  },

  async cancel(req, res) {
    try {
      res.json({ success: true, data: await countModel.cancel(req.params.id, { userId: req.user.id, reason: req.body?.reason }), message: 'Inventaire annulé' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'annulation de l\'inventaire'); }
  },

  async listAdjustments(req, res) {
    try {
      const { limit, page, offset } = paging(req);
      const { rows, total } = await countModel.listAdjustments({ ...req.query, limit, offset });
      res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des ajustements'); }
  },

  /** POST /stock-adjustments { warehouseId, stockItemId, lotId?, unitId?, quantity, reason, comment } */
  async createAdjustment(req, res) {
    try {
      const result = await countModel.createAdjustment(req.body || {}, { userId: req.user.id });
      const b = req.body || {};
      await audit(req, AUDIT.STOCK_ADJUSTED, {
        entity: { type: 'stock_adjustment', id: result.id, label: result.adjustmentNumber },
        details: { reason: b.reason, comment: b.comment || null, quantity: b.quantity, stockItemId: b.stockItemId, warehouseId: b.warehouseId, unitId: b.unitId || null, movement: result.movementNumber },
      });
      res.status(201).json({ success: true, data: result, message: 'Ajustement enregistré' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'ajustement'); }
  },
};
