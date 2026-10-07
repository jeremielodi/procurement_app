// backend/src/controllers/StockIssueController.js
// Bons de sortie de stock vers un utilisateur : création (ISSUE_STOCK + accès au dépôt), consultation
// (VIEW_STOCK, ou le bénéficiaire pour ses propres bons), accusé de réception (bénéficiaire), annulation, PDF.
const stockIssueModel = require('../models/StockIssueModel');
const stockIssuePdfService = require('../services/StockIssuePdfService');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const i18n = require('../i18n');

function sendError(res, error, fallback) {
  if (error.status) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message, line: error.line, available: error.available });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

/** Notification in-app (+ temps réel) dans la langue du destinataire ; n'interrompt jamais la requête */
async function notify(req, userId, key, vars, link) {
  try {
    const user = await userModel.findById(userId);
    const T = i18n.translator(user?.language);
    const title = T(`notification.stockIssue.${key}Title`, vars);
    const message = T(`notification.stockIssue.${key}Message`, vars);
    await notificationModel.create({ userId, title, message, type: 'INFO', link });
    req.io?.to(`user-${userId}`).emit('notification', { title, message, type: 'INFO', link, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Notification bon de sortie :', error.message);
  }
}

/** Consultation d'un bon : VIEW_STOCK, ou bénéficiaire */
async function canView(req, issue) {
  if (String(issue.recipient_id) === String(req.user.id)) return true;
  return userModel.hasPermission(req.user.id, 'VIEW_STOCK');
}

module.exports = {
  /** GET /stock-issues — ?mine=1 : bons dont je suis bénéficiaire (sans VIEW_STOCK : toujours les miens) */
  async list(req, res) {
    try {
      const mine = ['1', 'true'].includes(String(req.query.mine)) || !(await userModel.hasPermission(req.user.id, 'VIEW_STOCK'));
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const { rows, total } = await stockIssueModel.list({ ...req.query, mine, userId: req.user.id, limit, offset: (page - 1) * limit });
      res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des sorties'); }
  },

  /** GET /stock-issues/recipients?q= — bénéficiaires possibles (utilisateurs actifs de l'entreprise) */
  async recipients(req, res) {
    try {
      res.json({ success: true, data: await stockIssueModel.recipients(req.query.q) });
    } catch (error) { return sendError(res, error, 'Erreur lors de la recherche des bénéficiaires'); }
  },

  async get(req, res) {
    try {
      const issue = await stockIssueModel.getById(req.params.id);
      if (!issue || !(await canView(req, issue))) return res.status(404).json({ success: false, message: 'Bon de sortie introuvable' });
      res.json({ success: true, data: issue });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement du bon de sortie'); }
  },

  async create(req, res) {
    try {
      const b = req.body || {};
      if (!b.warehouseId || !b.recipientId) return res.status(400).json({ success: false, code: 'REQUIRED', message: 'Dépôt et bénéficiaire requis' });
      const result = await stockIssueModel.create(
        { warehouseId: b.warehouseId, recipientId: b.recipientId, projectId: b.projectId, purpose: b.purpose, lines: b.lines },
        { userId: req.user.id }
      );
      if (String(result.recipientId) !== String(req.user.id)) {
        await notify(req, result.recipientId, 'issued', { number: result.issueNumber }, `/my-items/${result.id}`);
      }
      res.status(201).json({ success: true, data: result, message: 'Sortie enregistrée' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la sortie de stock'); }
  },

  /** POST /stock-issues/:id/acknowledge { comment } — le bénéficiaire confirme avoir reçu les articles */
  async acknowledge(req, res) {
    try {
      await stockIssueModel.acknowledge(req.params.id, { userId: req.user.id, comment: req.body?.comment });
      const issue = await stockIssueModel.getById(req.params.id);
      if (issue.issued_by && String(issue.issued_by) !== String(req.user.id)) {
        await notify(req, issue.issued_by, 'acknowledged', { number: issue.issue_number, name: issue.recipient_name }, `/stock/issues/${issue.id}`);
      }
      res.json({ success: true, data: issue, message: 'Réception confirmée' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la confirmation'); }
  },

  /** POST /stock-issues/:id/cancel { reason } — retour en stock (écritures inverses) */
  async cancel(req, res) {
    try {
      const reason = String(req.body?.reason || '').trim();
      if (!reason) return res.status(400).json({ success: false, code: 'REASON_REQUIRED', message: 'Motif obligatoire' });
      const result = await stockIssueModel.cancel(req.params.id, { userId: req.user.id, reason });
      if (String(result.recipientId) !== String(req.user.id)) {
        await notify(req, result.recipientId, 'cancelled', { number: result.issueNumber }, `/my-items/${result.id}`);
      }
      res.json({ success: true, data: result, message: 'Sortie annulée' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'annulation de la sortie'); }
  },

  /** GET /stock-issues/:id/pdf?lang= — bon de sortie à imprimer et signer */
  async pdf(req, res) {
    try {
      const issue = await stockIssueModel.getById(req.params.id);
      if (!issue || !(await canView(req, issue))) return res.status(404).json({ success: false, message: 'Bon de sortie introuvable' });
      const result = await stockIssuePdfService.generate(req.params.id, { lang: i18n.fromRequest(req) });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="${String(issue.issue_number).replace(/[^\w.-]+/g, '_')}.pdf"`);
      res.end(result.pdf);
    } catch (error) { return sendError(res, error, 'Erreur lors de la génération du PDF'); }
  },
};
