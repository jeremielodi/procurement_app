// backend/src/controllers/StockRequestController.js
// Demandes internes au magasin (migration 56) : création par tout utilisateur de l'entreprise, validation / rejet (option
// de l'entreprise ; validateur = chef du projet ou intérimaire, sinon responsable du département, sinon administrateur,
// jamais le demandeur — tentative tracée SOD_VIOLATION_BLOCKED), retrait par le demandeur, solde du reste par un magasinier.
// Le service passe par un bon de sortie (POST /stock-issues { stockRequestId, lines: [{ requestLineId, … }] }).
// Consultation : demandeur, validateur, VIEW_STOCK.
const stockRequestModel = require('../models/StockRequestModel');
const userModel = require('../models/UserModel');
const warehouseModel = require('../models/WarehouseModel');
const notify = require('../services/StockRequestNotifications');
const { audit, AUDIT } = require('../utils/auditLog');
const { block, same } = require('../utils/segregation');

function sendError(res, error, fallback) {
  if (error.status) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message, line: error.line, details: error.details });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

const entity = (r) => ({ type: 'stock_request', id: r.id, label: r.request_number });

/** Droits de l'utilisateur sur la demande (affichage et contrôles) */
async function rights(req, r) {
  const userId = req.user.id;
  const isRequester = same(r.requester_id, userId);
  const viewStock = await userModel.hasPermission(userId, 'VIEW_STOCK');
  const validator = r.status === 'PENDING_VALIDATION' && !isRequester && await stockRequestModel.canValidate(r.id, userId);
  const open = ['TO_SERVE', 'PARTIALLY_SERVED'].includes(r.status);
  const server = open && await userModel.hasPermission(userId, 'ISSUE_STOCK') && await warehouseModel.canOperate(userId, r.warehouse_id);
  const nothingServed = !(r.issues || []).some(i => i.status !== 'CANCELLED');
  return {
    canView: isRequester || viewStock || validator || await stockRequestModel.canValidate(r.id, userId),
    can_validate: validator,
    can_cancel: isRequester && ['PENDING_VALIDATION', 'TO_SERVE'].includes(r.status) && nothingServed,
    can_serve: server,
    can_close: server,
    self_validation: r.status === 'PENDING_VALIDATION' && isRequester,
  };
}

async function loadVisible(req) {
  const r = await stockRequestModel.getById(req.params.id);
  if (!r) return null;
  const flags = await rights(req, r);
  return flags.canView ? Object.assign(r, flags) : null;
}

module.exports = {
  /** GET /stock-requests/options — dépôts, départements, projets ; validation exigée ou non */
  async options(req, res) {
    try {
      res.json({ success: true, data: { ...(await stockRequestModel.options()), validationRequired: await stockRequestModel.validationRequired(req.enterpriseId) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des choix'); }
  },

  /** GET /stock-requests/items?warehouseId=&q= — articles stockables avec la quantité disponible dans le dépôt */
  async items(req, res) {
    try {
      res.json({ success: true, data: await stockRequestModel.items({ warehouseId: req.query.warehouseId, q: req.query.q }) });
    } catch (error) { return sendError(res, error, 'Erreur lors de la recherche des articles'); }
  },

  /** GET /stock-requests/counts — demandes à valider / à servir par l'utilisateur */
  async counts(req, res) {
    try {
      res.json({ success: true, data: await stockRequestModel.counts(req.user.id, { canServe: await userModel.hasPermission(req.user.id, 'ISSUE_STOCK') }) });
    } catch (error) { return sendError(res, error, 'Erreur lors du comptage des demandes'); }
  },

  /** GET /stock-requests?scope=mine|toValidate|toServe|all&status=&warehouseId=&search= */
  async list(req, res) {
    try {
      let scope = ['mine', 'toValidate', 'toServe', 'all'].includes(req.query.scope) ? req.query.scope : 'mine';
      if (scope === 'all' && !(await userModel.hasPermission(req.user.id, 'VIEW_STOCK'))) scope = 'mine';
      if (scope === 'toServe' && !(await userModel.hasPermission(req.user.id, 'ISSUE_STOCK'))) scope = 'mine';
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const { rows, total } = await stockRequestModel.list({
        scope, userId: req.user.id, status: req.query.status, warehouseId: req.query.warehouseId, search: req.query.search,
        limit, offset: (page - 1) * limit,
      });
      res.json({ success: true, data: rows, scope, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des demandes'); }
  },

  async get(req, res) {
    try {
      const r = await loadVisible(req);
      if (!r) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Demande introuvable' });
      res.json({ success: true, data: r });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement de la demande'); }
  },

  async create(req, res) {
    try {
      if (!req.enterpriseId) return res.status(403).json({ success: false, message: 'Réservé aux utilisateurs d\'une entreprise' });
      const result = await stockRequestModel.create(req.body || {}, { userId: req.user.id, enterpriseId: req.enterpriseId });
      await notify.created(req, result.id, result.status);
      res.status(201).json({ success: true, data: result, message: 'Demande envoyée' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la création de la demande'); }
  },

  /** POST /stock-requests/:id/validate { lines: [{ lineId, validatedQuantity }], comment } */
  async validate(req, res) {
    try {
      const r = await loadVisible(req);
      if (!r) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Demande introuvable' });
      if (same(r.requester_id, req.user.id)) {
        throw await block(req, { message: 'Séparation des tâches : la demande doit être validée par une autre personne que le demandeur', entity: entity(r), details: { document: 'stock_request' } });
      }
      await stockRequestModel.validate(r.id, { userId: req.user.id, lines: req.body?.lines, comment: req.body?.comment });
      const after = await stockRequestModel.getById(r.id);
      await audit(req, AUDIT.STOCK_REQUEST_VALIDATED, {
        entity: entity(r),
        details: { lines: after.lines.map(l => ({ item: l.item_code, requested: l.requested_quantity, validated: l.validated_quantity })), comment: req.body?.comment || null },
      });
      await notify.validated(req, r.id);
      res.json({ success: true, data: after, message: 'Demande validée' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la validation de la demande'); }
  },

  /** POST /stock-requests/:id/reject { reason } */
  async reject(req, res) {
    try {
      const r = await loadVisible(req);
      if (!r) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Demande introuvable' });
      if (same(r.requester_id, req.user.id)) {
        throw await block(req, { message: 'Séparation des tâches : vous ne pouvez pas rejeter votre propre demande', entity: entity(r), details: { document: 'stock_request' } });
      }
      const reason = String(req.body?.reason || '').trim();
      await stockRequestModel.reject(r.id, { userId: req.user.id, reason });
      await audit(req, AUDIT.STOCK_REQUEST_REJECTED, { entity: entity(r), details: { reason } });
      await notify.rejected(req, r.id, reason);
      res.json({ success: true, data: await stockRequestModel.getById(r.id), message: 'Demande rejetée' });
    } catch (error) { return sendError(res, error, 'Erreur lors du rejet de la demande'); }
  },

  /** POST /stock-requests/:id/cancel { reason } — retrait par le demandeur tant que rien n'est servi */
  async cancel(req, res) {
    try {
      const r = await loadVisible(req);
      if (!r) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Demande introuvable' });
      await stockRequestModel.cancel(r.id, { userId: req.user.id, reason: req.body?.reason });
      await notify.cancelled(req, r.id, r.status);
      res.json({ success: true, data: await stockRequestModel.getById(r.id), message: 'Demande retirée' });
    } catch (error) { return sendError(res, error, 'Erreur lors du retrait de la demande'); }
  },

  /** POST /stock-requests/:id/close { reason } — le reste ne sera pas servi (ISSUE_STOCK + accès au dépôt) */
  async close(req, res) {
    try {
      const r = await loadVisible(req);
      if (!r) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Demande introuvable' });
      const reason = String(req.body?.reason || '').trim();
      await stockRequestModel.close(r.id, { userId: req.user.id, reason });
      await audit(req, AUDIT.STOCK_REQUEST_CLOSED, {
        entity: entity(r),
        details: { reason, lines: r.lines.map(l => ({ item: l.item_code, served: l.served_quantity, remaining: l.remaining_quantity })) },
      });
      await notify.closed(req, r.id, reason);
      res.json({ success: true, data: await stockRequestModel.getById(r.id), message: 'Demande soldée' });
    } catch (error) { return sendError(res, error, 'Erreur lors du solde de la demande'); }
  },

  /** GET|PUT /enterprises/current/stock-requests { validationRequired } — option de validation de l'entreprise */
  async getSettings(req, res) {
    try {
      res.json({ success: true, data: { validationRequired: await stockRequestModel.validationRequired(req.enterpriseId) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement de l\'option'); }
  },

  async setSettings(req, res) {
    try {
      const required = req.body?.validationRequired === true || req.body?.validationRequired === 'true';
      const before = await stockRequestModel.validationRequired(req.enterpriseId);
      await stockRequestModel.setValidationRequired(req.enterpriseId, required);
      if (before !== required) {
        await audit(req, AUDIT.ENTERPRISE_UPDATED, {
          entity: { type: 'enterprise', id: req.enterpriseId, label: null },
          oldValue: { stock_request_validation: before }, details: { stock_request_validation: required },
        });
      }
      res.json({ success: true, data: { validationRequired: required } });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement de l\'option'); }
  },
};
