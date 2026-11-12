// backend/src/controllers/PartnerController.js
// Partenaires de l'entreprise (migration 66) : registre (MANAGE_PARTNERS ; lecture aussi avec VIEW_STOCK / ISSUE_STOCK),
// comptes de l'espace partenaire (création avec mot de passe envoyé par email, activation / désactivation).
const partnerModel = require('../models/PartnerModel');
const accessService = require('../services/PartnerAccessService');
const { audit, AUDIT } = require('../utils/auditLog');

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

const TRACKED = ['code', 'name', 'partner_type', 'location_id', 'address', 'contact_name', 'contact_title', 'phone', 'email', 'notes', 'is_active'];

module.exports = {
  /** GET /partners?search=&locationId=&partnerType=&status=active|inactive&page=&limit= */
  async list(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 500);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const { rows, total } = await partnerModel.list({ ...req.query, limit, offset: (page - 1) * limit });
      res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement des partenaires'); }
  },

  async get(req, res) {
    try {
      const partner = await partnerModel.getById(req.params.id);
      if (!partner) return res.status(404).json({ success: false, message: 'Partenaire introuvable' });
      res.json({ success: true, data: partner });
    } catch (error) { return sendError(res, error, 'Erreur lors du chargement du partenaire'); }
  },

  async create(req, res) {
    try {
      const created = await partnerModel.create(req.body || {}, { userId: req.user.id, enterpriseId: req.enterpriseId });
      await audit(req, AUDIT.PARTNER_CREATED, { entity: { type: 'partner', id: created.id, label: `${created.code} — ${created.name}` } });
      res.status(201).json({ success: true, data: await partnerModel.getById(created.id), message: 'Partenaire enregistré' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement du partenaire'); }
  },

  async update(req, res) {
    try {
      const { before, after } = await partnerModel.update(req.params.id, req.body || {}, { enterpriseId: req.enterpriseId });
      const changed = TRACKED.filter(k => String(before[k] ?? '') !== String(after[k] ?? ''));
      if (changed.length) {
        await audit(req, AUDIT.PARTNER_UPDATED, {
          entity: { type: 'partner', id: after.id, label: `${after.code} — ${after.name}` },
          oldValue: Object.fromEntries(changed.map(k => [k, before[k]])),
          details: Object.fromEntries(changed.map(k => [k, after[k]])),
        });
      }
      res.json({ success: true, data: await partnerModel.getById(req.params.id), message: 'Partenaire modifié' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la modification du partenaire'); }
  },

  /**
   * POST /partners/:id/accounts { email, firstName, lastName, position, language, password? } — compte de l'espace partenaire
   * (sans email : compte du responsable, à partir de la fiche). Sans password : généré et envoyé par email (rien n'est
   * créé si l'email ne part pas) ; avec password : défini par l'administrateur, aucun email.
   */
  async createAccount(req, res) {
    try {
      const partner = await partnerModel.getById(req.params.id);
      if (!partner) return res.status(404).json({ success: false, message: 'Partenaire introuvable' });
      const b = req.body || {};
      const fromManager = !b.email;
      const [first, ...rest] = String(partner.contact_name || '').trim().split(/\s+/);
      const data = fromManager
        ? { email: partner.email, firstName: first, lastName: rest.join(' '), position: partner.contact_title, language: b.language, password: b.password }
        : b;
      const { account } = await accessService.createAccount(partner.id, data, { grantedBy: req.user.id });
      await audit(req, AUDIT.PARTNER_ACCOUNT_CREATED, {
        entity: { type: 'partner', id: partner.id, label: `${partner.code} — ${partner.name}` },
        target: { id: account.id, email: account.email },
        details: { email: account.email, manager: fromManager, passwordEmailed: account.emailed },
      });
      res.status(201).json({ success: true, data: account, message: account.emailed ? 'Accès créé : identifiants envoyés par email' : 'Accès créé' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la création de l\'accès'); }
  },

  /** PATCH /partners/:id/accounts/:userId { isActive } */
  async setAccountActive(req, res) {
    try {
      const partner = await partnerModel.getById(req.params.id);
      if (!partner) return res.status(404).json({ success: false, message: 'Partenaire introuvable' });
      const active = !!req.body?.isActive;
      const acc = await partnerModel.setAccountActive(partner.id, req.params.userId, active);
      await audit(req, active ? AUDIT.PARTNER_ACCOUNT_ACTIVATED : AUDIT.PARTNER_ACCOUNT_DEACTIVATED, {
        entity: { type: 'partner', id: partner.id, label: `${partner.code} — ${partner.name}` },
        target: { id: acc.id, email: acc.email },
      });
      res.json({ success: true, data: acc });
    } catch (error) { return sendError(res, error, 'Erreur lors de la modification du compte'); }
  },
};
