// backend/src/controllers/FrameworkAgreementController.js
// Accords-cadres (migration 69) : saisie / modification du brouillon / soumission / suspension / clôture
// (MANAGE_FRAMEWORK_AGREEMENTS), validation par le chef de chaque projet listé (ou son intérimaire) puis par le directeur
// général — jamais l'auteur (SOD_VIOLATION_BLOCKED). Consultation : VIEW_FRAMEWORK_AGREEMENTS, ou personne concernée
// par la validation (sinon 404).
const model = require('../models/FrameworkAgreementModel');
const userModel = require('../models/UserModel');
const notify = require('../services/FrameworkAgreementNotifications');
const { audit, AUDIT } = require('../utils/auditLog');
const { block, same } = require('../utils/segregation');

function sendError(res, error, fallback) {
  if (error.status) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message, line: error.line, details: error.details });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

const entity = (a) => ({ type: 'framework_agreement', id: a.id, label: a.agreement_number });
const notFound = (res) => res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Accord-cadre introuvable' });

async function perms(userId) {
  const [manage, view] = await Promise.all([
    userModel.hasPermission(userId, 'MANAGE_FRAMEWORK_AGREEMENTS'),
    userModel.hasPermission(userId, 'VIEW_FRAMEWORK_AGREEMENTS'),
  ]);
  return { manage, view: view || manage };
}

/** Contrat visible par l'utilisateur, avec ses droits */
async function loadVisible(req) {
  const a = await model.getById(req.params.id);
  if (!a) return null;
  const userId = req.user.id;
  const p = await perms(userId);
  const author = same(a.created_by, userId);
  if (!p.view && !author && !(await model.isInvolved(a.id, userId))) return null;
  const pending = a.status === 'PENDING_VALIDATION';
  const validator = pending && await model.canValidate(a.id, userId);
  a.can_edit = p.manage && a.status === 'DRAFT';
  a.can_submit = p.manage && a.status === 'DRAFT';
  a.can_decide = validator;
  a.self_validation = pending && author;
  a.can_cancel = p.manage && ['DRAFT', 'PENDING_VALIDATION'].includes(a.status);
  a.can_suspend = p.manage && a.status === 'ACTIVE';
  a.can_reactivate = p.manage && a.status === 'SUSPENDED';
  a.can_close = p.manage && ['ACTIVE', 'SUSPENDED'].includes(a.status);
  a.can_attach = p.manage && !['CLOSED', 'CANCELLED'].includes(a.status);
  a.validators = pending ? await model.validators(a.id) : [];
  return a;
}

const STATUS_AUDIT_MESSAGES = {
  suspend: 'Accord-cadre suspendu', reactivate: 'Accord-cadre réactivé', close: 'Accord-cadre clôturé', cancel: 'Accord-cadre annulé',
};

module.exports = {
  /** GET /framework-agreements?scope=all|toValidate|involved&status=&supplierId=&projectId=&search=&page= */
  async list(req, res) {
    try {
      const p = await perms(req.user.id);
      let scope = ['all', 'toValidate', 'involved'].includes(req.query.scope) ? req.query.scope : (p.view ? 'all' : 'involved');
      if (scope === 'all' && !p.view) scope = 'involved';
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const { rows, total } = await model.list({
        scope, userId: req.user.id, status: req.query.status, supplierId: req.query.supplierId, projectId: req.query.projectId,
        search: req.query.search, limit, offset: (page - 1) * limit,
      });
      res.json({ success: true, data: rows, scope, canManage: p.manage, canViewAll: p.view, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des accords-cadres'); }
  },

  /** GET /framework-agreements/counts — contrats attendant une décision de l'utilisateur */
  async counts(req, res) {
    try {
      res.json({ success: true, data: { toValidate: await model.countToValidate(req.user.id) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du comptage des accords-cadres'); }
  },

  async get(req, res) {
    try {
      const a = await loadVisible(req);
      if (!a) return notFound(res);
      res.json({ success: true, data: a });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement de l\'accord-cadre'); }
  },

  /** GET /framework-agreements/usable?requisitionId= — contrats utilisables (fenêtre « Méthode d'achat ») */
  async usable(req, res) {
    try {
      if (!req.query.requisitionId) return res.status(400).json({ success: false, code: 'REQUISITION_REQUIRED', message: 'requisitionId requis' });
      res.json({ success: true, data: await model.usableFor(req.query.requisitionId) });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des accords-cadres utilisables'); }
  },

  /** GET /framework-agreements/by-requisition/:requisitionId — contrat retenu pour la réquisition (bon de commande) */
  async byRequisition(req, res) {
    try {
      res.json({ success: true, data: await model.forRequisition(req.params.requisitionId) });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement de l\'accord-cadre de la réquisition'); }
  },

  /** GET /framework-agreements/tender-prefill?tenderId=&supplierId= — fournisseur et bordereau repris d'un AO attribué */
  async tenderPrefill(req, res) {
    try {
      const data = await model.prefillFromTender(req.query.tenderId, req.query.supplierId, { enterpriseId: req.enterpriseId });
      res.json({ success: true, data });
    } catch (error) { return sendError(res, error, 'Erreur lors de la lecture de l\'appel d\'offres'); }
  },

  /** POST /framework-agreements — brouillon */
  async create(req, res) {
    try {
      const result = await model.create(req.body || {}, { userId: req.user.id, enterpriseId: req.enterpriseId });
      const a = await model.getHeader(result.id);
      await audit(req, AUDIT.FRAMEWORK_AGREEMENT_CREATED, {
        entity: entity(a),
        details: { title: a.title, supplier: a.supplier_name, ceiling: a.ceiling_amount, currency: a.currency_code, startDate: a.start_date, endDate: a.end_date, tender: a.tender_number || undefined },
      });
      res.status(201).json({ success: true, data: result, message: 'Accord-cadre enregistré (brouillon)' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement de l\'accord-cadre'); }
  },

  /** PUT /framework-agreements/:id — brouillon seulement */
  async update(req, res) {
    try {
      const result = await model.update(req.params.id, req.body || {}, { enterpriseId: req.enterpriseId });
      const a = await model.getHeader(result.id);
      await audit(req, AUDIT.FRAMEWORK_AGREEMENT_UPDATED, { entity: entity(a), oldValue: result.before, details: result.after });
      res.json({ success: true, data: await model.getById(result.id), message: 'Accord-cadre modifié' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la modification de l\'accord-cadre'); }
  },

  /** POST /framework-agreements/:id/submit */
  async submit(req, res) {
    try {
      await model.submit(req.params.id, { userId: req.user.id });
      const a = await model.getHeader(req.params.id);
      await audit(req, AUDIT.FRAMEWORK_AGREEMENT_SUBMITTED, { entity: entity(a), details: { round: a.submission_round } });
      await notify.submitted(req, a.id);
      res.json({ success: true, data: a, message: 'Accord-cadre soumis à validation' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la soumission de l\'accord-cadre'); }
  },

  /** POST /framework-agreements/:id/decision { decision: APPROVE | REJECT, comment } */
  async decide(req, res) {
    try {
      const a = await loadVisible(req);
      if (!a) return notFound(res);
      if (same(a.created_by, req.user.id)) {
        throw await block(req, {
          message: 'Séparation des tâches : l\'accord-cadre doit être validé par une autre personne que son auteur',
          entity: entity(a), details: { document: 'framework_agreement' },
        });
      }
      const result = await model.decide(a.id, { userId: req.user.id, decision: req.body?.decision, comment: req.body?.comment });
      const action = result.decision === 'REJECTED' ? AUDIT.FRAMEWORK_AGREEMENT_REJECTED
        : result.status === 'ACTIVE' ? AUDIT.FRAMEWORK_AGREEMENT_ACTIVATED : AUDIT.FRAMEWORK_AGREEMENT_APPROVED;
      await audit(req, action, {
        entity: entity(a), details: { step: result.step, projects: result.projects.length ? result.projects : undefined, comment: req.body?.comment || null, round: a.submission_round },
      });
      await notify.decided(req, a.id, result, req.body?.comment);
      const messages = { REJECTED: 'Accord-cadre rejeté — renvoyé en brouillon', ACTIVE: 'Accord-cadre validé — contrat actif' };
      res.json({ success: true, data: { ...result }, message: messages[result.decision === 'REJECTED' ? 'REJECTED' : result.status] || 'Étape validée' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la décision sur l\'accord-cadre'); }
  },

  /** POST /framework-agreements/:id/suspend|reactivate|close|cancel { reason } */
  changeStatus(action) {
    return async (req, res) => {
      try {
        const result = await model.changeStatus(req.params.id, action, { userId: req.user.id, reason: req.body?.reason });
        const a = await model.getHeader(result.id);
        await audit(req, AUDIT.FRAMEWORK_AGREEMENT_STATUS_CHANGED, {
          entity: entity(a), details: { action, from: result.from, to: result.to, reason: req.body?.reason || null },
        });
        res.json({ success: true, data: a, message: STATUS_AUDIT_MESSAGES[action] });
      } catch (error) { return sendError(res, error, 'Erreur lors du changement d\'état de l\'accord-cadre'); }
    };
  },
};
