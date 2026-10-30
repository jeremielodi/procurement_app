// backend/src/controllers/StockEntryController.js
// Bons d'entrée en stock hors bon de commande (don, achat hors système, retour, autre) : saisie (RECORD_STOCK_ENTRIES +
// accès au dépôt), validation / refus par une AUTRE personne (VALIDATE_STOCK_ENTRIES + accès au dépôt ; tentative sur
// son propre bon tracée SOD_VIOLATION_BLOCKED), retrait par l'auteur, annulation d'un bon validé (écritures inverses),
// consultation (VIEW_STOCK), PDF à signer.
const stockEntryModel = require('../models/StockEntryModel');
const stockEntryPdfService = require('../services/StockEntryPdfService');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const warehouseModel = require('../models/WarehouseModel');
const i18n = require('../i18n');
const { audit, AUDIT } = require('../utils/auditLog');
const { block, same } = require('../utils/segregation');

function sendError(res, error, fallback) {
  if (error.status) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message, line: error.line });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

/** Notification in-app (+ temps réel) dans la langue du destinataire ; n'interrompt jamais la requête */
async function notify(req, userId, key, vars, link) {
  try {
    const user = await userModel.findById(userId);
    const T = i18n.translator(user?.language);
    const title = T(`notification.stockEntry.${key}Title`, vars);
    const message = T(`notification.stockEntry.${key}Message`, vars);
    await notificationModel.create({ userId, title, message, type: 'INFO', link });
    req.io?.to(`user-${userId}`).emit('notification', { title, message, type: 'INFO', link, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Notification bon d\'entrée :', error.message);
  }
}

/** Auteur du bon prévenu d'une décision prise par quelqu'un d'autre */
async function notifyAuthor(req, entry, key) {
  if (entry.created_by && !same(entry.created_by, req.user.id)) {
    const actor = await userModel.findById(req.user.id).catch(() => null);
    const name = `${actor?.first_name || ''} ${actor?.last_name || ''}`.trim() || req.user.email;
    await notify(req, entry.created_by, key, { number: entry.entry_number, name }, `/stock/entries/${entry.id}`);
  }
}

const entity = (entry) => ({ type: 'stock_entry', id: entry.id, label: entry.entry_number });

/** Refus tracé : validation / refus de son propre bon */
async function assertNotAuthor(req, entry) {
  if (same(entry.created_by, req.user.id)) {
    throw await block(req, {
      code: 'SELF_VALIDATION',
      message: 'Séparation des tâches : le bon d\'entrée doit être validé par une autre personne que celle qui l\'a saisi',
      entity: entity(entry),
      details: { document: 'stock_entry' },
    });
  }
}

module.exports = {
  /** GET /stock-entries — filtres warehouseId, entryType, status, search, fromDate, toDate ; pagination */
  async list(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const { rows, total } = await stockEntryModel.list({ ...req.query, limit, offset: (page - 1) * limit });
      res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des bons d\'entrée'); }
  },

  /** GET /stock-entries/:id — + actions possibles pour l'utilisateur connecté */
  async get(req, res) {
    try {
      const entry = await stockEntryModel.getById(req.params.id);
      if (!entry) return res.status(404).json({ success: false, message: 'Bon d\'entrée introuvable' });
      const userId = req.user.id;
      const [canValidatePerm, canRecord, onWarehouse] = await Promise.all([
        userModel.hasPermission(userId, 'VALIDATE_STOCK_ENTRIES'),
        userModel.hasPermission(userId, 'RECORD_STOCK_ENTRIES'),
        warehouseModel.canOperate(userId, entry.warehouse_id),
      ]);
      const isAuthor = same(entry.created_by, userId);
      const pending = entry.status === 'PENDING';
      entry.self_validation = pending && isAuthor && canValidatePerm;
      entry.can_validate = pending && !isAuthor && canValidatePerm && onWarehouse;
      entry.can_withdraw = pending && isAuthor && canRecord && onWarehouse;
      entry.can_cancel = entry.status === 'VALIDATED' && canValidatePerm && onWarehouse;
      res.json({ success: true, data: entry });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement du bon d\'entrée'); }
  },

  /** POST /stock-entries — saisie (en attente de validation) ; valideurs prévenus */
  async create(req, res) {
    try {
      const b = req.body || {};
      const result = await stockEntryModel.create({
        entryType: b.entryType, warehouseId: b.warehouseId, origin: b.origin, deliveredBy: b.deliveredBy, reference: b.reference,
        reason: b.reason, projectId: b.projectId, currencyId: b.currencyId, lines: b.lines,
      }, { userId: req.user.id });
      const entry = await stockEntryModel.getById(result.id);
      for (const userId of await stockEntryModel.validators(entry)) {
        await notify(req, userId, 'toValidate', { number: entry.entry_number, warehouse: entry.warehouse_name, name: entry.created_by_name }, `/stock/entries/${entry.id}`);
      }
      res.status(201).json({ success: true, data: result, message: 'Bon d\'entrée enregistré — en attente de validation' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement du bon d\'entrée'); }
  },

  /** POST /stock-entries/:id/validate { comment } — le stock augmente */
  async validate(req, res) {
    try {
      const current = await stockEntryModel.getById(req.params.id);
      if (!current) return res.status(404).json({ success: false, message: 'Bon d\'entrée introuvable' });
      await assertNotAuthor(req, current);
      const result = await stockEntryModel.validate(req.params.id, { userId: req.user.id, comment: req.body?.comment });
      await audit(req, AUDIT.STOCK_ENTRY_VALIDATED, {
        entity: entity(current),
        details: { entryType: current.entry_type, warehouse: current.warehouse_name, lines: current.lines.length, movements: result.movements, totalValue: current.total_value },
      });
      await notifyAuthor(req, current, 'validated');
      res.json({ success: true, data: await stockEntryModel.getById(req.params.id), message: 'Bon d\'entrée validé — articles entrés en stock' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la validation du bon d\'entrée'); }
  },

  /** POST /stock-entries/:id/reject { reason } */
  async reject(req, res) {
    try {
      const current = await stockEntryModel.getById(req.params.id);
      if (!current) return res.status(404).json({ success: false, message: 'Bon d\'entrée introuvable' });
      await assertNotAuthor(req, current);
      const reason = String(req.body?.reason || '').trim();
      await stockEntryModel.reject(req.params.id, { userId: req.user.id, reason });
      await audit(req, AUDIT.STOCK_ENTRY_REJECTED, { entity: entity(current), details: { reason } });
      await notifyAuthor(req, current, 'rejected');
      res.json({ success: true, data: await stockEntryModel.getById(req.params.id), message: 'Bon d\'entrée refusé' });
    } catch (error) { return sendError(res, error, 'Erreur lors du refus du bon d\'entrée'); }
  },

  /** POST /stock-entries/:id/cancel { reason } — retrait par l'auteur (en attente) ou annulation d'un bon validé (écritures inverses) */
  async cancel(req, res) {
    try {
      const current = await stockEntryModel.getById(req.params.id);
      if (!current) return res.status(404).json({ success: false, message: 'Bon d\'entrée introuvable' });
      const reason = String(req.body?.reason || '').trim();
      const canValidate = await userModel.hasPermission(req.user.id, 'VALIDATE_STOCK_ENTRIES');
      if (current.status === 'PENDING' && !(await userModel.hasPermission(req.user.id, 'RECORD_STOCK_ENTRIES'))) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Permission insuffisante' });
      }
      const result = await stockEntryModel.cancel(req.params.id, { userId: req.user.id, reason, canValidate });
      await audit(req, AUDIT.STOCK_ENTRY_CANCELLED, {
        entity: entity(current), details: { reason, wasValidated: result.wasValidated, reversedMovements: result.reversedMovements },
      });
      await notifyAuthor(req, current, 'cancelled');
      res.json({ success: true, data: await stockEntryModel.getById(req.params.id), message: 'Bon d\'entrée annulé' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'annulation du bon d\'entrée'); }
  },

  /** GET /stock-entries/:id/pdf?lang= — bon d'entrée à imprimer et signer */
  async pdf(req, res) {
    try {
      const result = await stockEntryPdfService.generate(req.params.id, { lang: i18n.fromRequest(req) });
      if (!result) return res.status(404).json({ success: false, message: 'Bon d\'entrée introuvable' });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="${String(result.entry.entry_number).replace(/[^\w.-]+/g, '_')}.pdf"`);
      res.end(result.pdf);
    } catch (error) { return sendError(res, error, 'Erreur lors de la génération du PDF'); }
  },
};
