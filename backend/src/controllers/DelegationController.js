// backend/src/controllers/DelegationController.js
// Intérim du chef de projet (migration 53) — voir services/DelegationService.js
const delegationService = require('../services/DelegationService');
const userModel = require('../models/UserModel');

// Administrateur d'entreprise : déclare / termine l'absence de n'importe quel utilisateur de son entreprise
const isAdminOf = (req) => userModel.hasPermission(req.user.id, 'MANAGE_USERS');

const sendError = (res, error) => (error.status
  ? res.status(error.status).json({ success: false, code: error.code, message: error.message, details: error.details })
  : res.status(500).json({ success: false, message: error.message }));

class DelegationController {
  /** GET /delegations?userId=&current=1 → { data, canDelegate } (canDelegate : la personne concernée est chef de projet) */
  async list(req, res) {
    try {
      const isAdmin = await isAdminOf(req);
      const data = await delegationService.list({
        userId: req.user.id, isAdmin, forUserId: req.query.userId || null, current: req.query.current,
      });
      const target = isAdmin && req.query.userId ? req.query.userId : req.user.id;
      res.json({ success: true, data, canDelegate: await delegationService.canDelegate(target) });
    } catch (error) { sendError(res, error); }
  }

  /** GET /delegations/candidates — intérimaires possibles */
  async candidates(req, res) {
    try {
      res.json({ success: true, data: await delegationService.candidates() });
    } catch (error) { sendError(res, error); }
  }

  /** POST /delegations { delegatorId?, delegateId, startDate, endDate, reason } */
  async create(req, res) {
    try {
      const data = await delegationService.create(req, req.body || {}, { isAdmin: await isAdminOf(req) });
      res.status(201).json({ success: true, data });
    } catch (error) { sendError(res, error); }
  }

  /** POST /delegations/:id/end — fin anticipée */
  async end(req, res) {
    try {
      res.json({ success: true, data: await delegationService.end(req, req.params.id, { isAdmin: await isAdminOf(req) }) });
    } catch (error) { sendError(res, error); }
  }
}

module.exports = new DelegationController();
