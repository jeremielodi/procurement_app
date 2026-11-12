// backend/src/controllers/PartnerPortalController.js
// Espace partenaire (migration 66) — comptes prof_partner, contexte { enterpriseId, partnerId } posé par tenantContext.
// Le partenaire voit les envois qui lui sont destinés, confirme leur réception ligne par ligne (quantité reçue) et
// consulte ce qu'il détient (équipements, articles reçus non rendus). Jamais les données d'un autre partenaire.
const db = require('../config/database');
const stockIssueModel = require('../models/StockIssueModel');
const equipmentModel = require('../models/StockEquipmentModel');
const stockIssuePdfService = require('../services/StockIssuePdfService');
const { notify } = require('./StockIssueController');
const i18n = require('../i18n');
const { audit, AUDIT } = require('../utils/auditLog');

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message, line: error.line });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

/** Envoi du partenaire connecté (sinon null → 404) */
async function myIssue(req) {
  const issue = await stockIssueModel.getById(req.params.id);
  return issue && issue.destination_type === 'PARTNER' && String(issue.partner_id) === String(req.partnerId) ? issue : null;
}

module.exports = {
  /** GET /partner-portal/me — partenaire, entreprise, compteurs */
  async me(req, res) {
    try {
      const partner = await db.one(
        `SELECT p.id, p.code, p.name, p.partner_type, p.address, p.contact_name, p.contact_title, p.phone, p.email,
                l.name AS location_name, e.id AS enterprise_id, e.name AS enterprise_name, (e.logo_path IS NOT NULL) AS enterprise_has_logo,
                (SELECT COUNT(*)::int FROM stock_issues si WHERE si.partner_id = p.id AND si.status = 'ISSUED' AND si.acknowledged_at IS NULL) AS pending_count,
                (SELECT COUNT(*)::int FROM stock_issues si WHERE si.partner_id = p.id AND si.status = 'ISSUED' AND si.acknowledged_at IS NOT NULL) AS received_count,
                (SELECT COUNT(*)::int FROM stock_units un WHERE un.partner_id = p.id AND un.status = 'AT_PARTNER') AS unit_count
         FROM partners p JOIN locations l ON l.id = p.location_id JOIN enterprise e ON e.id = p.enterprise_id
         WHERE p.id = $1`,
        [req.partnerId]
      );
      res.json({ success: true, data: partner });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement de l\'espace partenaire'); }
  },

  /** GET /partner-portal/transfers?status=pending|received|cancelled&search=&page= */
  async transfers(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const status = String(req.query.status || '');
      const { rows, total } = await stockIssueModel.list({
        partnerId: req.partnerId, destinationType: 'PARTNER', search: req.query.search,
        inTransit: status === 'pending' ? '1' : undefined,
        acknowledged: status === 'received' ? '1' : undefined,
        status: status === 'cancelled' ? 'CANCELLED' : status === 'received' ? 'ISSUED' : undefined,
        limit, offset: (page - 1) * limit,
      });
      res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des envois'); }
  },

  async transfer(req, res) {
    try {
      const issue = await myIssue(req);
      if (!issue) return res.status(404).json({ success: false, message: 'Envoi introuvable' });
      issue.can_receive = issue.status === 'ISSUED' && !issue.acknowledged_at;
      res.json({ success: true, data: issue });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement de l\'envoi'); }
  },

  /** POST /partner-portal/transfers/:id/receive { lines: [{ lineId, receivedQuantity }], comment } */
  async receive(req, res) {
    try {
      const current = await myIssue(req);
      if (!current) return res.status(404).json({ success: false, message: 'Envoi introuvable' });
      const result = await stockIssueModel.receivePartner(current.id, { userId: req.user.id, comment: req.body?.comment, lines: req.body?.lines, source: 'PORTAL' });
      const issue = await stockIssueModel.getById(current.id);
      await audit(req, AUDIT.PARTNER_TRANSFER_RECEIVED, {
        entity: { type: 'stock_issue', id: issue.id, label: issue.issue_number },
        details: { partner: issue.partner_name, source: 'PORTAL', linesWithLoss: result.linesWithLoss },
        enterpriseId: issue.enterprise_id,
      });
      // Le magasinier qui a expédié est prévenu (manque signalé dans le message)
      if (issue.issued_by) {
        await notify(req, issue.issued_by, result.linesWithLoss ? 'partnerReceivedWithLoss' : 'partnerReceived',
          { number: issue.issue_number, name: issue.partner_name, count: result.linesWithLoss }, `/stock/issues/${issue.id}`);
      }
      res.json({ success: true, data: { ...result, issue }, message: 'Réception confirmée' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la confirmation de la réception'); }
  },

  async pdf(req, res) {
    try {
      const issue = await myIssue(req);
      if (!issue) return res.status(404).json({ success: false, message: 'Envoi introuvable' });
      const result = await stockIssuePdfService.generate(issue.id, { lang: i18n.fromRequest(req), lines: issue.lines });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="${String(issue.issue_number).replace(/[^\w.-]+/g, '_')}.pdf"`);
      res.end(result.pdf);
    } catch (error) { return sendError(res, error, 'Erreur lors de la génération du PDF'); }
  },

  /** GET /partner-portal/holdings — articles reçus non rendus (équipements « chez le partenaire » compris) */
  async holdings(req, res) {
    try {
      res.json({ success: true, data: await equipmentModel.holdings(null, { partnerId: req.partnerId }) });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement du matériel détenu'); }
  },
};
