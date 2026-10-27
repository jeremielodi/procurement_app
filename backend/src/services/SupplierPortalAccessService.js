// backend/src/services/SupplierPortalAccessService.js
// Accès au portail pour un fournisseur saisi à la main par un acheteur (suppliers.user_id NULL) :
// création d'un compte prof_supplier à l'email du fournisseur, mot de passe généré envoyé par email.
// Compte, profil et rattachement au fournisseur sont écrits dans une transaction annulée si l'email ne part pas.
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

/** Compte portail du fournisseur (null si aucun) */
async function accountOf(supplier) {
  if (!supplier?.user_id) return null;
  return db.one(
    `SELECT id, email, is_active, last_login, created_at, language FROM users WHERE id = $1`,
    [supplier.user_id]
  );
}

function invitationHtml(T, { name, email, password, buyer }) {
  return `
    <p>${T('email.hello', { name: escapeHtml(name) })}</p>
    <p>${T('email.supplierAccess.intro', { buyer: escapeHtml(buyer) })}</p>
    <p>${T('email.supplierAccess.credentials')}</p>
    <p>${T('email.supplierAccess.email')} <b>${escapeHtml(email)}</b></p>
    <p style="font-size: 18px; font-family: monospace; background: #f3f4f6; padding: 10px 14px; border-radius: 6px; display: inline-block; letter-spacing: 1px;">${escapeHtml(password)}</p>
    <p><a href="${appLink('/login')}" style="background: #2563eb; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">${T('email.password.login')}</a></p>
    <p>${T('email.supplierAccess.features')}</p>
    <p>${T('email.password.change')}</p>`;
}

/**
 * Crée le compte portail du fournisseur et lui envoie ses identifiants.
 * Refus : 404 NOT_FOUND, 409 ALREADY_HAS_ACCOUNT / SUPPLIER_INACTIVE / EMAIL_IN_USE, 400 EMAIL_REQUIRED, 502 EMAIL_FAILED.
 */
async function grant(supplierId, { language, grantedBy, buyerName }) {
  if (!/^\d+$/.test(String(supplierId))) throw fail(404, 'NOT_FOUND', 'Fournisseur introuvable');
  const lang = i18n.LANGS.includes(language) ? language : 'fr';

  return db.withTransaction(async (tx) => {
    const supplier = await tx.one('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
    if (!supplier) throw fail(404, 'NOT_FOUND', 'Fournisseur introuvable');
    if (supplier.user_id) throw fail(409, 'ALREADY_HAS_ACCOUNT', 'Ce fournisseur a déjà un accès au portail');
    if (supplier.status && supplier.status !== 'ACTIVE') throw fail(409, 'SUPPLIER_INACTIVE', 'Fournisseur inactif');
    const email = String(supplier.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw fail(400, 'EMAIL_REQUIRED', 'Renseignez un email valide pour ce fournisseur');
    if (await tx.one('SELECT id FROM users WHERE LOWER(email) = $1', [email])) {
      throw fail(409, 'EMAIL_IN_USE', 'Un compte existe déjà avec cet email');
    }

    const userId = uuidv4();
    const password = generatePassword();
    const contactName = (supplier.contact_name || supplier.name || '').trim();
    const [firstName, ...rest] = contactName.split(/\s+/);
    await tx.exec(
      `INSERT INTO users (id, username, email, password_hash, first_name, last_name, position, language, is_active, enterprise_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'Fournisseur', $7, true, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [userId, `${email.split('@')[0].slice(0, 40)}_${userId.slice(0, 6)}`, email, await bcrypt.hash(password, 10),
        firstName || supplier.name, rest.join(' ') || null, lang]
    );
    await tx.exec(
      `INSERT INTO user_profiles (user_id, profile_id, assigned_at, assigned_by) VALUES ($1, 'prof_supplier', CURRENT_TIMESTAMP, $2)`,
      [userId, grantedBy]
    );
    await tx.exec('UPDATE suppliers SET user_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [supplier.id, userId]);

    // Dernière étape : sans email, rien n'est enregistré (le fournisseur ne connaîtrait pas son mot de passe)
    const T = i18n.translator(lang);
    const sent = await emailService.sendEmail(email, T('email.supplierAccess.subject'),
      invitationHtml(T, { name: contactName || supplier.name, email, password, buyer: buyerName || 'procureApp' }));
    if (!sent?.success) throw fail(502, 'EMAIL_FAILED', 'Email non envoyé : accès non créé');

    return { supplier, account: { id: userId, email, is_active: true, last_login: null, language: lang } };
  });
}

module.exports = { grant, accountOf };
