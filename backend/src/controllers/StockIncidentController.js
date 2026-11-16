// backend/src/controllers/StockIncidentController.js
// Rapports d'incident sur les articles détenus (migration 68) : déclaration par le détenteur (ses articles) ou par le
// magasin pour son compte (ISSUE_STOCK + natures / projets autorisés) ; validation / rejet par le chef du projet ou son
// intérimaire (à défaut l'administrateur), jamais le détenteur ni le déclarant (SOD_VIOLATION_BLOCKED) ; retrait par le
// détenteur ou le déclarant tant qu'il attend. Consultation : détenteur, déclarant, validateur, VIEW_STOCK (natures /
// projets autorisés). PDF à signer.
const stockIncidentModel = require('../models/StockIncidentModel');
const userModel = require('../models/UserModel');
const notify = require('../services/StockIncidentNotifications');
const pdfService = require('../services/StockIncidentPdfService');
const i18n = require('../i18n');
const { audit, AUDIT } = require('../utils/auditLog');
const { block, same } = require('../utils/segregation');
const stockNature = require('../utils/stockNature');
const stockProject = require('../utils/stockProject');

function sendError(res, error, fallback) {
  if (error.status) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message, line: error.line, available: error.available, details: error.details });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

const entity = (i) => ({ type: 'stock_incident', id: i.id, label: i.incident_number });
const notFound = (res) => res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Rapport d\'incident introuvable' });

/** Rapport visible par l'utilisateur, avec ses droits (can_validate, can_cancel, self_validation, validators) */
async function loadVisible(req) {
  const i = await stockIncidentModel.getById(req.params.id);
  if (!i) return null;
  const userId = req.user.id;
  const party = same(i.holder_id, userId) || same(i.reported_by, userId);
  const validator = await stockIncidentModel.canValidate(i.id, userId);
  i.hidden_line_count = 0;
  if (!party && !validator) {
    if (!(await userModel.hasPermission(userId, 'VIEW_STOCK'))) return null;
    if (!stockProject.isAllowed(await stockProject.allowed(), i.project_id)) return null;
    const { lines, hidden } = await stockNature.splitLines(i.lines);
    if (!lines.length) return null;
    i.lines = lines;
    i.hidden_line_count = hidden;
  }
  const pending = i.status === 'PENDING';
  i.can_validate = pending && validator;
  i.can_cancel = pending && party;
  i.self_validation = pending && party;
  i.validators = pending ? await stockIncidentModel.validators(i.id) : [];
  return i;
}

module.exports = {
  /** GET /stock-incidents?scope=mine|toValidate|all&status=&type=&search=&page= */
  async list(req, res) {
    try {
      let scope = ['mine', 'toValidate', 'all'].includes(req.query.scope) ? req.query.scope : 'mine';
      if (scope === 'all' && !(await userModel.hasPermission(req.user.id, 'VIEW_STOCK'))) scope = 'mine';
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const { rows, total } = await stockIncidentModel.list({
        scope, userId: req.user.id, status: req.query.status, type: req.query.type, search: req.query.search, limit, offset: (page - 1) * limit,
      });
      res.json({ success: true, data: rows, scope, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des rapports d\'incident'); }
  },

  /** GET /stock-incidents/counts — rapports à valider par l'utilisateur */
  async counts(req, res) {
    try {
      res.json({ success: true, data: { toValidate: await stockIncidentModel.countToValidate(req.user.id) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du comptage des rapports'); }
  },

  async get(req, res) {
    try {
      const i = await loadVisible(req);
      if (!i) return notFound(res);
      res.json({ success: true, data: i });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement du rapport'); }
  },

  /** POST /stock-incidents { holderId?, incidentType, incidentDate, incidentPlace, circumstances, policeReference, lines } */
  async create(req, res) {
    try {
      if (!req.enterpriseId) return res.status(403).json({ success: false, message: 'Réservé aux utilisateurs d\'une entreprise' });
      const body = req.body || {};
      const holderId = body.holderId || req.user.id;
      const onBehalf = !same(holderId, req.user.id);
      if (onBehalf && !(await userModel.hasPermission(req.user.id, 'ISSUE_STOCK'))) {
        return res.status(403).json({ success: false, code: 'NOT_ALLOWED', message: 'Seul le magasin peut déclarer un incident pour le compte d\'un employé' });
      }
      const result = await stockIncidentModel.create(body, { userId: req.user.id, holderId, enterpriseId: req.enterpriseId, onBehalf });
      const created = await stockIncidentModel.getById(result.id);
      await audit(req, AUDIT.STOCK_INCIDENT_REPORTED, {
        entity: entity(created),
        details: {
          type: created.incident_type, holder: created.holder_email, onBehalf,
          lines: created.lines.map(l => ({ item: l.item_code, serial: l.serial_number || undefined, quantity: l.quantity })),
        },
      });
      await notify.reported(req, result.id);
      res.status(201).json({ success: true, data: result, message: 'Rapport d\'incident envoyé' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la déclaration de l\'incident'); }
  },

  /** POST /stock-incidents/:id/validate { employeeLiable, comment } */
  async validate(req, res) {
    try {
      const i = await loadVisible(req);
      if (!i) return notFound(res);
      if (same(i.holder_id, req.user.id) || same(i.reported_by, req.user.id)) {
        throw await block(req, { message: 'Séparation des tâches : le rapport doit être validé par une autre personne que le détenteur ou le déclarant', entity: entity(i), details: { document: 'stock_incident' } });
      }
      const liable = req.body?.employeeLiable;
      await stockIncidentModel.validate(i.id, {
        userId: req.user.id, comment: req.body?.comment,
        employeeLiable: liable === true || liable === 'true' ? true : liable === false || liable === 'false' ? false : undefined,
      });
      const after = await stockIncidentModel.getById(i.id);
      await audit(req, AUDIT.STOCK_INCIDENT_VALIDATED, {
        entity: entity(i),
        details: { type: i.incident_type, holder: i.holder_email, employeeLiable: after.employee_liable, comment: after.decision_comment, onBehalfOf: after.on_behalf_of_name || undefined },
      });
      await notify.validated(req, i.id);
      res.json({ success: true, data: after, message: 'Rapport d\'incident validé' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la validation du rapport'); }
  },

  /** POST /stock-incidents/:id/reject { reason } */
  async reject(req, res) {
    try {
      const i = await loadVisible(req);
      if (!i) return notFound(res);
      if (same(i.holder_id, req.user.id) || same(i.reported_by, req.user.id)) {
        throw await block(req, { message: 'Séparation des tâches : vous ne pouvez pas rejeter votre propre rapport', entity: entity(i), details: { document: 'stock_incident' } });
      }
      const reason = String(req.body?.reason || '').trim();
      await stockIncidentModel.reject(i.id, { userId: req.user.id, reason });
      await audit(req, AUDIT.STOCK_INCIDENT_REJECTED, { entity: entity(i), details: { reason } });
      await notify.rejected(req, i.id, reason);
      res.json({ success: true, data: await stockIncidentModel.getById(i.id), message: 'Rapport d\'incident rejeté' });
    } catch (error) { return sendError(res, error, 'Erreur lors du rejet du rapport'); }
  },

  /** POST /stock-incidents/:id/cancel { reason } — retrait par le détenteur ou le déclarant */
  async cancel(req, res) {
    try {
      const i = await loadVisible(req);
      if (!i) return notFound(res);
      await stockIncidentModel.cancel(i.id, { userId: req.user.id, reason: req.body?.reason });
      await audit(req, AUDIT.STOCK_INCIDENT_CANCELLED, { entity: entity(i), details: { reason: req.body?.reason || null } });
      await notify.cancelled(req, i.id);
      res.json({ success: true, data: await stockIncidentModel.getById(i.id), message: 'Rapport d\'incident retiré' });
    } catch (error) { return sendError(res, error, 'Erreur lors du retrait du rapport'); }
  },

  /** GET /stock-incidents/:id/pdf?lang= */
  async pdf(req, res) {
    try {
      const i = await loadVisible(req);
      if (!i) return notFound(res);
      const result = await pdfService.generate(i.id, { lang: i18n.fromRequest(req), lines: i.lines });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="${String(result.inc.incident_number).replace(/[^\w.-]+/g, '_')}.pdf"`);
      res.end(result.pdf);
    } catch (error) { return sendError(res, error, 'Erreur lors de la génération du PDF'); }
  },
};
