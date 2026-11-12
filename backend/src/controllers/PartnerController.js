// backend/src/controllers/PartnerController.js
// Partenaires de l'entreprise (migration 66) : registre (MANAGE_PARTNERS ; lecture aussi avec VIEW_STOCK / ISSUE_STOCK),
// comptes de l'espace partenaire (mot de passe saisi par l'administrateur — avec la fiche pour le responsable, ou
// depuis la fiche —, identifiants envoyés par email si possible ; activation / désactivation).
const db = require('../config/database');
const partnerModel = require('../models/PartnerModel');
const accessService = require('../services/PartnerAccessService');
const { audit, AUDIT } = require('../utils/auditLog');

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback, error: error.message });
}

const TRACKED = ['code', 'name', 'partner_type', 'location_id', 'address', 'contact_name', 'contact_title', 'phone', 'email', 'notes', 'is_active'];
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

/**
 * Compte du responsable demandé avec la fiche (`managerPassword` dans le corps de POST / PUT /partners) : tout est
 * contrôlé AVANT d'enregistrer le partenaire (pas de partenaire enregistré avec un compte refusé).
 * current = fiche existante (modification). Renvoie null si aucun compte n'est demandé.
 */
async function checkManagerAccount(body, current = null) {
  const password = body.managerPassword === undefined || body.managerPassword === null ? '' : String(body.managerPassword);
  if (!password) return null;
  const pick = (key, col) => String((body[key] !== undefined ? body[key] : current?.[col]) || '').trim();
  const name = pick('contactName', 'contact_name');
  const email = pick('email', 'email').toLowerCase();
  if (!name) throw fail(400, 'MANAGER_NAME_REQUIRED', 'Nom du responsable obligatoire pour créer son compte');
  if (!EMAIL_RE.test(email)) throw fail(400, 'MANAGER_EMAIL_REQUIRED', 'Email du responsable obligatoire pour créer son compte');
  if (password.length < 8) throw fail(400, 'PASSWORD_TOO_SHORT', 'Mot de passe : 8 caractères au moins');
  const existing = await db.one('SELECT partner_id FROM users WHERE LOWER(email) = $1', [email]);
  if (existing) {
    throw current && String(existing.partner_id) === String(current.id)
      ? fail(409, 'MANAGER_HAS_ACCOUNT', 'Le responsable a déjà un compte')
      : fail(409, 'EMAIL_IN_USE', 'Un compte existe déjà avec cet email');
  }
  const [firstName, ...rest] = name.split(/\s+/);
  return { email, firstName, lastName: rest.join(' '), position: pick('contactTitle', 'contact_title'), password, language: body.managerLanguage };
}

/** Création du compte du responsable (après l'enregistrement de la fiche) + audit */
async function createManagerAccount(req, partner, manager) {
  const { account } = await accessService.createAccount(partner.id, manager, { grantedBy: req.user.id });
  await audit(req, AUDIT.PARTNER_ACCOUNT_CREATED, {
    entity: { type: 'partner', id: partner.id, label: `${partner.code} — ${partner.name}` },
    target: { id: account.id, email: account.email },
    details: { email: account.email, manager: true, emailed: account.emailed },
  });
  return account;
}

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

  /** POST /partners { …fiche, managerPassword?, managerLanguage? } — managerPassword : crée aussi le compte du responsable */
  async create(req, res) {
    try {
      const body = req.body || {};
      await partnerModel.checkFields(body, { enterpriseId: req.enterpriseId }); // fiche valide avant le compte
      const manager = await checkManagerAccount(body);
      const created = await partnerModel.create(body, { userId: req.user.id, enterpriseId: req.enterpriseId });
      await audit(req, AUDIT.PARTNER_CREATED, { entity: { type: 'partner', id: created.id, label: `${created.code} — ${created.name}` } });
      const account = manager ? await createManagerAccount(req, created, manager) : null;
      res.status(201).json({ success: true, data: await partnerModel.getById(created.id), account, message: 'Partenaire enregistré' });
    } catch (error) { return sendError(res, error, 'Erreur lors de l\'enregistrement du partenaire'); }
  },

  /** PUT /partners/:id { …champs modifiés, managerPassword? } — managerPassword : crée le compte du responsable s'il n'en a pas */
  async update(req, res) {
    try {
      const body = req.body || {};
      const current = await partnerModel.getById(req.params.id);
      if (!current) return res.status(404).json({ success: false, message: 'Partenaire introuvable' });
      await partnerModel.checkFields(body, { enterpriseId: req.enterpriseId, partnerId: current.id, partial: true });
      const manager = await checkManagerAccount(body, current);
      if (manager && !current.is_active && body.isActive !== true) throw fail(409, 'PARTNER_INACTIVE', 'Partenaire inactif');
      const { before, after } = await partnerModel.update(req.params.id, body, { enterpriseId: req.enterpriseId });
      const changed = TRACKED.filter(k => String(before[k] ?? '') !== String(after[k] ?? ''));
      if (changed.length) {
        await audit(req, AUDIT.PARTNER_UPDATED, {
          entity: { type: 'partner', id: after.id, label: `${after.code} — ${after.name}` },
          oldValue: Object.fromEntries(changed.map(k => [k, before[k]])),
          details: Object.fromEntries(changed.map(k => [k, after[k]])),
        });
      }
      const account = manager ? await createManagerAccount(req, after, manager) : null;
      res.json({ success: true, data: await partnerModel.getById(req.params.id), account, message: 'Partenaire modifié' });
    } catch (error) { return sendError(res, error, 'Erreur lors de la modification du partenaire'); }
  },

  /**
   * POST /partners/:id/accounts { email, firstName, lastName, position, language, password } — compte de l'espace
   * partenaire (sans email : compte du responsable, à partir de la fiche). Mot de passe obligatoire, saisi par
   * l'administrateur ; identifiants envoyés par email si possible (emailed = false : à communiquer soi-même).
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
        details: { email: account.email, manager: fromManager, emailed: account.emailed },
      });
      res.status(201).json({ success: true, data: account, message: account.emailed ? 'Accès créé : identifiants envoyés par email' : 'Accès créé (email non envoyé : communiquez le mot de passe)' });
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
