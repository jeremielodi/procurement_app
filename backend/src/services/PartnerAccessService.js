// backend/src/services/PartnerAccessService.js
// Comptes de l'espace partenaire (migration 66), créés par l'entreprise depuis la fiche du partenaire :
// utilisateur prof_partner SANS entreprise (n'apparaît dans aucune liste d'utilisateurs), users.partner_id,
// mot de passe généré envoyé par email. Compte et profil sont écrits dans une transaction annulée si l'email ne part pas.
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const emailService = require('./EmailNotificationService');
const { generatePassword } = require('../utils/passwordGenerator');
const { appLink } = require('../utils/appUrl');
const i18n = require('../i18n');

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function invitationHtml(T, { name, email, password, partner, enterprise }) {
  return `
    <p>${T('email.hello', { name: escapeHtml(name) })}</p>
    <p>${T('email.partnerAccess.intro', { enterprise: escapeHtml(enterprise), partner: escapeHtml(partner) })}</p>
    <p>${T('email.partnerAccess.credentials')}</p>
    <p>${T('email.partnerAccess.email')} <b>${escapeHtml(email)}</b></p>
    <p style="font-size: 18px; font-family: monospace; background: #f3f4f6; padding: 10px 14px; border-radius: 6px; display: inline-block; letter-spacing: 1px;">${escapeHtml(password)}</p>
    <p><a href="${appLink('/login')}" style="background: #2563eb; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">${T('email.password.login')}</a></p>
    <p>${T('email.partnerAccess.features')}</p>
    <p>${T('email.password.change')}</p>`;
}

/**
 * Crée un compte de l'espace partenaire et envoie ses identifiants.
 * { email, firstName, lastName, position, language, password? } — password fourni (≥ 8 caractères) : défini par
 * l'administrateur, qui le communique lui-même (aucun email) ; sinon généré et envoyé par email.
 * Refus : 400 EMAIL_REQUIRED / NAME_REQUIRED / PASSWORD_TOO_SHORT, 409 PARTNER_INACTIVE / EMAIL_IN_USE, 502 EMAIL_FAILED.
 */
async function createAccount(partnerId, { email, firstName, lastName, position, language, password: chosen }, { grantedBy }) {
  const lang = i18n.LANGS.includes(language) ? language : 'fr';
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) throw fail(400, 'EMAIL_REQUIRED', 'Email valide obligatoire');
  const first = String(firstName || '').trim().slice(0, 100);
  if (!first) throw fail(400, 'NAME_REQUIRED', 'Prénom obligatoire');
  const manual = chosen !== undefined && chosen !== null && chosen !== '';
  if (manual && String(chosen).length < 8) throw fail(400, 'PASSWORD_TOO_SHORT', 'Mot de passe : 8 caractères au moins');

  return db.withTransaction(async (tx) => {
    const partner = await tx.one(
      `SELECT p.id, p.name, p.is_active, e.name AS enterprise_name
       FROM partners p JOIN enterprise e ON e.id = p.enterprise_id WHERE p.id = $1 FOR UPDATE OF p`,
      [partnerId]
    );
    if (!partner) throw fail(404, 'NOT_FOUND', 'Partenaire introuvable');
    if (!partner.is_active) throw fail(409, 'PARTNER_INACTIVE', 'Partenaire inactif');
    if (await tx.one('SELECT id FROM users WHERE LOWER(email) = $1', [mail])) {
      throw fail(409, 'EMAIL_IN_USE', 'Un compte existe déjà avec cet email');
    }

    const userId = uuidv4();
    const password = manual ? String(chosen) : generatePassword();
    await tx.exec(
      `INSERT INTO users (id, username, email, password_hash, first_name, last_name, position, language, is_active, enterprise_id, partner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NULL, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [userId, `${mail.split('@')[0].slice(0, 40)}_${userId.slice(0, 6)}`, mail, await bcrypt.hash(password, 10),
        first, String(lastName || '').trim().slice(0, 100) || null, String(position || '').trim().slice(0, 150) || null, lang, partner.id]
    );
    await tx.exec(
      `INSERT INTO user_profiles (user_id, profile_id, assigned_at, assigned_by) VALUES ($1, 'prof_partner', CURRENT_TIMESTAMP, $2)`,
      [userId, grantedBy]
    );

    const created = { id: userId, email: mail, first_name: first, last_name: lastName || null, is_active: true, language: lang, emailed: !manual };
    if (manual) return { partner, account: created };

    // Dernière étape : sans email, rien n'est enregistré (le partenaire ne connaîtrait pas son mot de passe)
    const T = i18n.translator(lang);
    const sent = await emailService.sendEmail(mail, T('email.partnerAccess.subject', { enterprise: partner.enterprise_name }),
      invitationHtml(T, { name: `${first} ${lastName || ''}`.trim(), email: mail, password, partner: partner.name, enterprise: partner.enterprise_name }));
    if (!sent?.success) throw fail(502, 'EMAIL_FAILED', 'Email non envoyé : compte non créé');

    return { partner, account: created };
  });
}

module.exports = { createAccount };
