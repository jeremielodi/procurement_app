// backend/src/controllers/StockEquipmentController.js
// Équipements (n° de série), détentions par utilisateur et retours en stock.
const equipmentModel = require('../models/StockEquipmentModel');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const stockModel = require('../models/StockModel');
const i18n = require('../i18n');
const db = require('../config/database');

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message, line: error.line, remaining: error.remaining });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

const page = (req, max = 200) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, max);
  const p = Math.max(parseInt(req.query.page) || 1, 1);
  return { limit, page: p, offset: (p - 1) * limit };
};

module.exports = {
  /** GET /stock-holdings?userId= | ?departmentId= — ce que détient un employé ou un département (VIEW_STOCK) */
  async holdings(req, res) {
    try {
      if (req.query.departmentId) {
        const department = await db.one('SELECT id, code, name FROM departments WHERE id::text = $1', [String(req.query.departmentId)]);
        if (!department) return res.status(404).json({ success: false, message: 'Département introuvable' });
        return res.json({ success: true, data: await equipmentModel.holdings(null, { departmentId: department.id }), department });
      }
      if (!req.query.userId) return res.status(400).json({ success: false, message: 'userId ou departmentId requis' });
      const user = await userModel.findById(req.query.userId);
      if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
      res.json({
        success: true,
        data: await equipmentModel.holdings(req.query.userId),
        user: { id: user.id, first_name: user.firstName, last_name: user.lastName, email: user.email, is_active: user.isActive },
      });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des détentions'); }
  },

  /** GET /stock-holdings/mine — ce que je détiens (tout utilisateur) */
  async myHoldings(req, res) {
    try {
      res.json({ success: true, data: await equipmentModel.holdings(req.user.id) });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des détentions'); }
  },

  /** POST /stock-returns { warehouseId, returnedBy | departmentId, lines: [{ issueLineId, quantity, condition }], comment } */
  async createReturn(req, res) {
    try {
      const b = req.body || {};
      if (!b.warehouseId || (!b.returnedBy && !b.departmentId)) {
        return res.status(400).json({ success: false, code: 'REQUIRED', message: 'Dépôt et employé (ou département) requis' });
      }
      const result = await equipmentModel.createReturn(
        { warehouseId: b.warehouseId, returnedBy: b.departmentId ? null : b.returnedBy, departmentId: b.departmentId || null, lines: b.lines, comment: b.comment },
        { userId: req.user.id }
      );
      if (!b.departmentId && String(b.returnedBy) !== String(req.user.id)) {
        try {
          const user = await userModel.findById(b.returnedBy);
          const T = i18n.translator(user?.language);
          const title = T('notification.stockReturn.title', { number: result.returnNumber });
          const message = T('notification.stockReturn.message', { number: result.returnNumber, count: result.lines });
          await notificationModel.create({ userId: b.returnedBy, title, message, type: 'INFO', link: '/my-items' });
          req.io?.to(`user-${b.returnedBy}`).emit('notification', { title, message, type: 'INFO', link: '/my-items', timestamp: new Date().toISOString() });
        } catch (e) { console.error('Notification retour :', e.message); }
      }
      res.status(201).json({ success: true, data: result, message: 'Retour enregistré' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement du retour'); }
  },

  async listReturns(req, res) {
    try {
      const { limit, page: p, offset } = page(req);
      const { rows, total } = await equipmentModel.listReturns({ ...req.query, limit, offset });
      res.json({ success: true, data: rows, pagination: { page: p, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des retours'); }
  },

  async getReturn(req, res) {
    try {
      const ret = await equipmentModel.getReturn(req.params.id);
      if (!ret) return res.status(404).json({ success: false, message: 'Bon de retour introuvable' });
      res.json({ success: true, data: ret });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement du retour'); }
  },

  /** GET /stock-units?status=&stockItemId=&warehouseId=&holderId=&search= */
  async units(req, res) {
    try {
      const { limit, page: p, offset } = page(req, 500);
      const { rows, total } = await equipmentModel.units({ ...req.query, limit, offset });
      res.json({ success: true, data: rows, pagination: { page: p, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des équipements'); }
  },

  /** GET /stock-units/:id — fiche et historique (mouvements de l'unité) */
  async getUnit(req, res) {
    try {
      const unit = await equipmentModel.getUnit(req.params.id);
      if (!unit || unit.status === 'VOID') return res.status(404).json({ success: false, message: 'Équipement introuvable' });
      const history = await stockModel.movements({ unitId: req.params.id, limit: 200 });
      res.json({ success: true, data: { ...unit, history: history.rows } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement de l\'équipement'); }
  },

  /** POST /stock-units/register { stockItemId, warehouseId, units: [{ serialNumber, assetTag }] } — parc existant */
  async registerUnits(req, res) {
    try {
      const b = req.body || {};
      const result = await equipmentModel.registerUnits({ stockItemId: b.stockItemId, warehouseId: b.warehouseId, units: b.units || [] }, { userId: req.user.id });
      res.status(201).json({ success: true, data: result, message: 'Équipements enregistrés' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement des équipements'); }
  },

  /** PUT /stock-units/:id { assetTag, notes, condition, retire, reason } */
  async updateUnit(req, res) {
    try {
      const b = req.body || {};
      await equipmentModel.updateUnit(req.params.id, {
        assetTag: b.assetTag, notes: b.notes, condition: b.condition, retire: b.retire === true, reason: b.reason,
      }, { userId: req.user.id });
      res.json({ success: true, data: await equipmentModel.getUnit(req.params.id), message: 'Équipement mis à jour' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la mise à jour de l\'équipement'); }
  },
};
