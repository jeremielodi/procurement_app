// backend/src/controllers/StockIssueController.js
// Bons de sortie de stock — vers un employé, un autre dépôt (transfert) ou un département : création (ISSUE_STOCK +
// accès au dépôt source), consultation (VIEW_STOCK, ou la personne qui doit confirmer la réception), accusé de
// réception, annulation, PDF.
const stockIssueModel = require('../models/StockIssueModel');
const stockIssuePdfService = require('../services/StockIssuePdfService');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const db = require('../config/database');
const i18n = require('../i18n');
const { audit, AUDIT } = require('../utils/auditLog');

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

/** Personnes concernées par une sortie : bénéficiaire ; département sans bénéficiaire → son responsable ;
 *  transfert → utilisateurs actifs ayant accès au dépôt de destination et admins de l'entreprise */
async function receivers(issue) {
  if (issue.destination_type === 'WAREHOUSE') {
    const rows = await db.select(
      `SELECT u.id FROM users u
       WHERE u.is_active AND u.enterprise_id = $2
         AND (EXISTS (SELECT 1 FROM warehouse_users wu WHERE wu.warehouse_id = $1 AND wu.user_id = u.id)
              OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id = 'prof_admin'))`,
      [issue.destination_warehouse_id, issue.enterprise_id]
    );
    return rows.map(r => r.id);
  }
  if (issue.recipient_id) return [issue.recipient_id];
  return issue.department_manager_id ? [issue.department_manager_id] : [];
}

async function notifyReceivers(req, issue, key, link) {
  const vars = {
    number: issue.issue_number, department: issue.department_name,
    from: issue.warehouse_name, to: issue.destination_warehouse_name,
  };
  for (const userId of await receivers(issue)) {
    if (String(userId) !== String(req.user.id)) await notify(req, userId, key, vars, link);
  }
}

/** Lien de la notification : « Mes articles reçus » pour une personne, sinon la fiche du bon */
const issueLink = (issue) => (issue.destination_type !== 'WAREHOUSE' && issue.recipient_id ? `/my-items/${issue.id}` : `/stock/issues/${issue.id}`);

/** Consultation d'un bon : VIEW_STOCK, bénéficiaire, ou personne qui peut en confirmer la réception */
async function canView(req, issue) {
  if (String(issue.recipient_id) === String(req.user.id)) return true;
  if (await userModel.hasPermission(req.user.id, 'VIEW_STOCK')) return true;
  return stockIssueModel.canAcknowledge(issue, req.user.id);
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

  /** GET /stock-issues/destinations — dépôts (transfert) et départements actifs de l'entreprise */
  async destinations(req, res) {
    try {
      res.json({ success: true, data: await stockIssueModel.destinations() });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des destinations'); }
  },

  async get(req, res) {
    try {
      const issue = await stockIssueModel.getById(req.params.id);
      if (!issue || !(await canView(req, issue))) return res.status(404).json({ success: false, message: 'Bon de sortie introuvable' });
      issue.can_acknowledge = issue.status === 'ISSUED' && !issue.acknowledged_at && await stockIssueModel.canAcknowledge(issue, req.user.id);
      res.json({ success: true, data: issue });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement du bon de sortie'); }
  },

  async create(req, res) {
    try {
      const b = req.body || {};
      if (!b.warehouseId) return res.status(400).json({ success: false, code: 'REQUIRED', message: 'Dépôt requis' });
      const result = await stockIssueModel.create(
        {
          destinationType: b.destinationType || 'USER', warehouseId: b.warehouseId, recipientId: b.recipientId,
          destinationWarehouseId: b.destinationWarehouseId, departmentId: b.departmentId,
          projectId: b.projectId, purpose: b.purpose, lines: b.lines,
        },
        { userId: req.user.id }
      );
      const issue = await stockIssueModel.getById(result.id);
      const key = issue.destination_type === 'WAREHOUSE' ? 'transfer'
        : issue.destination_type === 'DEPARTMENT' && !issue.recipient_id ? 'departmentIssued' : 'issued';
      await notifyReceivers(req, issue, key, issueLink(issue));
      res.status(201).json({ success: true, data: result, message: 'Sortie enregistrée' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la sortie de stock'); }
  },

  /** POST /stock-issues/:id/acknowledge { comment } — confirmation de réception (voir StockIssueModel.canAcknowledge) */
  async acknowledge(req, res) {
    try {
      await stockIssueModel.acknowledge(req.params.id, { userId: req.user.id, comment: req.body?.comment });
      const issue = await stockIssueModel.getById(req.params.id);
      if (issue.issued_by && String(issue.issued_by) !== String(req.user.id)) {
        await notify(req, issue.issued_by, 'acknowledged', { number: issue.issue_number, name: issue.acknowledged_by_name }, `/stock/issues/${issue.id}`);
      }
      res.json({ success: true, data: issue, message: 'Réception confirmée' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la confirmation'); }
  },

  /** POST /stock-issues/:id/receive { lines: [{ lineId, receivedQuantity }], comment } — réception d'un transfert (quantités reçues) */
  async receive(req, res) {
    try {
      const result = await stockIssueModel.receiveTransfer(req.params.id, { userId: req.user.id, comment: req.body?.comment, lines: req.body?.lines });
      const issue = await stockIssueModel.getById(req.params.id);
      if (issue.issued_by && String(issue.issued_by) !== String(req.user.id)) {
        await notify(req, issue.issued_by, 'acknowledged', { number: issue.issue_number, name: issue.acknowledged_by_name }, `/stock/issues/${issue.id}`);
      }
      res.json({ success: true, data: { ...result, issue }, message: 'Transfert réceptionné' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la réception du transfert'); }
  },

  /** POST /stock-issues/:id/cancel { reason } — écritures inverses (retour en stock / retour au dépôt source) */
  async cancel(req, res) {
    try {
      const reason = String(req.body?.reason || '').trim();
      if (!reason) return res.status(400).json({ success: false, code: 'REASON_REQUIRED', message: 'Motif obligatoire' });
      const result = await stockIssueModel.cancel(req.params.id, { userId: req.user.id, reason });
      await audit(req, AUDIT.STOCK_ISSUE_CANCELLED, {
        entity: { type: 'stock_issue', id: result.id, label: result.issueNumber },
        details: { reason, destinationType: result.destinationType, reversedMovements: result.reversedMovements },
      });
      const issue = await stockIssueModel.getById(req.params.id);
      await notifyReceivers(req, issue, issue.destination_type === 'WAREHOUSE' ? 'transferCancelled' : 'cancelled', issueLink(issue));
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
