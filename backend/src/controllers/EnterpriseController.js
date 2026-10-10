// backend/src/controllers/EnterpriseController.js
// Entreprises clientes de procureApp.
//  - Super admin plateforme : liste, création (+ premier administrateur), modification, suspension, suppression
//  - Administrateur d'entreprise : consultation / modification des informations de SON entreprise
//  - Tout utilisateur : GET /enterprises/current (sa propre entreprise : nom, logo, devise)
const bcrypt = require('bcrypt');
const { audit, AUDIT } = require('../utils/auditLog');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const i18n = require('../i18n');
const enterpriseModel = require('../models/EnterpriseModel');
const { saveLogo, removeLogo, sendLogo } = require('../utils/logoUpload');
const dailyReportService = require('../services/DailyRequisitionReportService');

// Journal d'audit : champs suivis d'une entreprise
const ENTERPRISE_FIELDS = ['name', 'code', 'address', 'phone', 'email', 'website', 'tax_id', 'registration_number', 'currency_id', 'is_active'];
const pickEnterprise = (e) => Object.fromEntries(ENTERPRISE_FIELDS.map(f => [f, e?.[f] ?? null]));

const LOGO_DIR = 'enterprise-logos';

function validate(b, { creating }) {
  const errors = [];
  if (creating || b.name !== undefined) { if (!String(b.name || '').trim()) errors.push('Nom requis'); }
  if (creating || b.code !== undefined) {
    if (!/^[A-Za-z0-9_-]{2,20}$/.test(String(b.code || '').trim())) errors.push('Code : 2 à 20 caractères (lettres, chiffres, - ou _)');
  }
  if (creating && !b.currencyId) errors.push('Devise requise');
  if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) errors.push('Email invalide');
  return errors;
}

async function checkUnique(b, excludeId) {
  if (b.name) {
    const e = await enterpriseModel.findByName(b.name);
    if (e && e.id !== excludeId) return 'Une entreprise avec ce nom existe déjà';
  }
  if (b.code) {
    const e = await enterpriseModel.findByCode(b.code);
    if (e && e.id !== excludeId) return 'Une entreprise avec ce code existe déjà';
  }
  return null;
}

/** Crée un administrateur (profil prof_admin) rattaché à l'entreprise */
async function createAdmin(enterpriseId, a, createdBy) {
  const email = String(a.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('Email de l\'administrateur invalide'), { status: 400 });
  if (!a.password || a.password.length < 8) throw Object.assign(new Error('Mot de passe de l\'administrateur : 8 caractères minimum'), { status: 400 });
  if (await db.one('SELECT 1 FROM users WHERE LOWER(email) = $1', [email])) {
    throw Object.assign(new Error('Un compte existe déjà avec cet email'), { status: 409 });
  }
  const id = uuidv4();
  const t = db.transaction();
  t.addInsertQuery('users', {
    id, username: `${email.split('@')[0].slice(0, 40)}_${id.slice(0, 6)}`, email,
    password_hash: await bcrypt.hash(a.password, 10),
    first_name: a.firstName || null, last_name: a.lastName || null, position: 'Administrateur',
    language: i18n.normalizeLang(a.language),
    is_active: true, enterprise_id: enterpriseId, created_at: new Date(), updated_at: new Date(),
  });
  t.addInsertQuery('user_profiles', { user_id: id, profile_id: 'prof_admin', assigned_at: new Date(), assigned_by: createdBy });
  await t.execute();
  return { id, email };
}

class EnterpriseController {
  /** GET /enterprises — super admin : toutes ; sinon : uniquement la sienne (compatibilité formulaires) */
  async list(req, res) {
    try {
      if (req.isSuperAdmin) {
        const data = await enterpriseModel.findAll({ search: req.query.search });
        return res.json({ success: true, data, total: data.length });
      }
      const own = req.enterpriseId ? await enterpriseModel.findById(req.enterpriseId) : null;
      res.json({ success: true, data: own ? [own] : [], total: own ? 1 : 0 });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** GET /enterprises/current (alias /enterprises/default) — entreprise de l'utilisateur connecté */
  async getCurrent(req, res) {
    try {
      if (!req.enterpriseId) return res.json({ success: true, data: null });
      res.json({ success: true, data: await enterpriseModel.findById(req.enterpriseId) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** GET /enterprises/:id — super admin, ou sa propre entreprise */
  async getOne(req, res) {
    try {
      if (!req.isSuperAdmin && req.params.id !== req.enterpriseId) {
        return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      }
      const enterprise = await enterpriseModel.findById(req.params.id);
      if (!enterprise) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      const admins = req.isSuperAdmin ? await enterpriseModel.getAdmins(enterprise.id) : undefined;
      res.json({ success: true, data: { ...enterprise, admins } });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** POST /enterprises (super admin, multipart) — entreprise + premier administrateur optionnel */
  async create(req, res) {
    try {
      const b = req.body;
      const errors = validate(b, { creating: true });
      if (errors.length) return res.status(400).json({ success: false, message: errors.join(' · ') });
      const dup = await checkUnique(b);
      if (dup) return res.status(409).json({ success: false, message: dup });
      if (b.adminEmail && await db.one('SELECT 1 FROM users WHERE LOWER(email) = $1', [String(b.adminEmail).trim().toLowerCase()])) {
        return res.status(409).json({ success: false, message: 'Un compte existe déjà avec l\'email de l\'administrateur' });
      }

      let enterprise = await enterpriseModel.create(b);
      if (req.file) {
        await enterpriseModel.setLogo(enterprise.id, await saveLogo(req.file, LOGO_DIR, enterprise.code));
        enterprise = await enterpriseModel.findById(enterprise.id);
      }
      let admin = null;
      if (b.adminEmail) {
        admin = await createAdmin(enterprise.id, {
          email: b.adminEmail, password: b.adminPassword, firstName: b.adminFirstName, lastName: b.adminLastName, language: b.adminLanguage,
        }, req.user.id);
      }
      await audit(req, AUDIT.ENTERPRISE_CREATED, {
        entity: { type: 'enterprise', id: enterprise.id, label: enterprise.name }, enterpriseId: enterprise.id,
        details: { ...pickEnterprise(enterprise), admin: admin?.email || null },
      });
      res.status(201).json({ success: true, data: { ...enterprise, admin }, message: 'Entreprise créée' });
    } catch (error) {
      res.status(error.status || 500).json({ success: false, message: error.message });
    }
  }

  /** PUT /enterprises/:id (super admin) et PUT /enterprises/current (admin d'entreprise) — multipart, logo optionnel */
  async update(req, res) {
    try {
      const id = req.params.id || req.enterpriseId;
      if (!id || (!req.isSuperAdmin && id !== req.enterpriseId)) {
        return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      }
      const existing = await enterpriseModel.findById(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });

      const b = { ...req.body };
      if (!req.isSuperAdmin) delete b.code; // le code (préfixe, identifiant) est fixé par la plateforme
      const errors = validate(b, { creating: false });
      if (errors.length) return res.status(400).json({ success: false, message: errors.join(' · ') });
      const dup = await checkUnique(b, id);
      if (dup) return res.status(409).json({ success: false, message: dup });

      let enterprise = await enterpriseModel.update(id, b);
      if (req.file) {
        await enterpriseModel.setLogo(id, await saveLogo(req.file, LOGO_DIR, enterprise.code || id));
        await removeLogo(existing.logo_path);
        enterprise = await enterpriseModel.findById(id);
      }
      const before = pickEnterprise(existing);
      const after = pickEnterprise(enterprise);
      const changed = ENTERPRISE_FIELDS.filter(f => String(before[f] ?? '') !== String(after[f] ?? ''));
      if (changed.length || req.file) {
        await audit(req, AUDIT.ENTERPRISE_UPDATED, {
          entity: { type: 'enterprise', id, label: enterprise.name }, enterpriseId: id,
          oldValue: Object.fromEntries(changed.map(f => [f, before[f]])),
          details: { ...Object.fromEntries(changed.map(f => [f, after[f]])), ...(req.file ? { logo: 'changed' } : {}) },
        });
      }
      res.json({ success: true, data: enterprise, message: 'Entreprise mise à jour' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ---------- Rapport quotidien des réquisitions (administrateur d'entreprise) ----------

  /** GET /enterprises/current/daily-report — option, destinataires, dernier envoi */
  async dailyReportStatus(req, res) {
    try {
      if (!req.enterpriseId) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      res.json({ success: true, data: await dailyReportService.status(req.enterpriseId) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** PUT /enterprises/current/daily-report { enabled } */
  async setDailyReport(req, res) {
    try {
      if (!req.enterpriseId) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      const enabled = req.body?.enabled === true || req.body?.enabled === 'true';
      const before = await db.one('SELECT name, daily_report_enabled FROM enterprise WHERE id = $1', [req.enterpriseId]);
      await db.exec('UPDATE enterprise SET daily_report_enabled = $2, last_update = CURRENT_TIMESTAMP WHERE id = $1', [req.enterpriseId, enabled]);
      if (before && before.daily_report_enabled !== enabled) {
        await audit(req, AUDIT.ENTERPRISE_UPDATED, {
          entity: { type: 'enterprise', id: req.enterpriseId, label: before.name },
          oldValue: { daily_report_enabled: before.daily_report_enabled }, details: { daily_report_enabled: enabled },
        });
      }
      res.json({ success: true, data: await dailyReportService.status(req.enterpriseId) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** POST /enterprises/current/daily-report/test — envoie maintenant le rapport à l'utilisateur connecté */
  async sendDailyReportTest(req, res) {
    try {
      if (!req.enterpriseId) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      const result = await dailyReportService.sendTest(req.enterpriseId, req.user.id);
      if (result.reason) return res.status(409).json({ success: false, code: result.reason, data: result });
      if (!result.sent) return res.status(502).json({ success: false, code: 'EMAIL_FAILED', data: result });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** PATCH /enterprises/:id/active (super admin) — suspendre / réactiver */
  async setActive(req, res) {
    try {
      const enterprise = await enterpriseModel.setActive(req.params.id, req.body.isActive);
      if (!enterprise) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      await audit(req, enterprise.is_active ? AUDIT.ENTERPRISE_ACTIVATED : AUDIT.ENTERPRISE_DEACTIVATED, {
        entity: { type: 'enterprise', id: enterprise.id, label: enterprise.name }, enterpriseId: enterprise.id,
      });
      res.json({ success: true, data: enterprise, message: enterprise.is_active ? 'Entreprise réactivée' : 'Entreprise suspendue' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** DELETE /enterprises/:id (super admin) — uniquement une entreprise vide */
  async delete(req, res) {
    try {
      const existing = await enterpriseModel.findById(req.params.id);
      const result = await enterpriseModel.delete(req.params.id);
      if (result.reason === 'NOT_FOUND') return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      if (result.reason === 'NOT_EMPTY') {
        return res.status(400).json({ success: false, message: 'Impossible : l\'entreprise a des utilisateurs ou des réquisitions. Suspendez-la plutôt.' });
      }
      await removeLogo(existing?.logo_path);
      res.json({ success: true, message: 'Entreprise supprimée' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /** POST /enterprises/:id/admins (super admin) — ajouter un administrateur d'entreprise */
  async addAdmin(req, res) {
    try {
      if (!(await enterpriseModel.findById(req.params.id))) {
        return res.status(404).json({ success: false, message: 'Entreprise non trouvée' });
      }
      const admin = await createAdmin(req.params.id, req.body, req.user.id);
      res.status(201).json({ success: true, data: admin, message: 'Administrateur créé' });
    } catch (error) {
      res.status(error.status || 500).json({ success: false, message: error.message });
    }
  }

  /** GET /public/enterprises/:id/logo (public — utilisé dans <img>) */
  async getLogo(req, res) {
    try {
      const e = await db.one('SELECT logo_path FROM enterprise WHERE id::text = $1', [req.params.id]);
      return await sendLogo(res, e?.logo_path);
    } catch (error) {
      res.status(500).end();
    }
  }
}

module.exports = new EnterpriseController();
module.exports.createAdmin = createAdmin;
