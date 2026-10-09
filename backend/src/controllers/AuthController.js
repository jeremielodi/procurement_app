// backend/src/controllers/AuthController.js
const userModel = require('../models/UserModel');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const emailService = require('../services/EmailNotificationService');
const { generatePassword } = require('../utils/passwordGenerator');
const { appLink } = require('../utils/appUrl');
const i18n = require('../i18n');
const { audit, AUDIT, clientIp } = require('../utils/auditLog');
const loginThrottle = require('../utils/loginThrottle');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Mot de passe oublié : limites anti-abus (mémoire du processus)
const RESET_EMAIL_INTERVAL_MS = 5 * 60 * 1000;   // 1 nouveau mot de passe / email / 5 min
const RESET_IP_WINDOW_MS = 15 * 60 * 1000;       // 5 demandes / IP / 15 min
const RESET_IP_MAX = 5;
const RESET_LINK_TTL = '1h';                     // validité du lien de confirmation
const lastResetByEmail = new Map();
const resetRequestsByIp = new Map();

const FORGOT_RESPONSE = {
  success: true,
  message: 'Si un compte actif correspond à cet email, un lien de confirmation vient de lui être envoyé.'
};

// Confirmations en cours (évite deux mots de passe envoyés pour un double clic)
const confirmingUsers = new Set();

function pruneOld(now) {
  for (const [k, t] of lastResetByEmail) if (now - t > RESET_EMAIL_INTERVAL_MS) lastResetByEmail.delete(k);
  for (const [k, list] of resetRequestsByIp) {
    const recent = list.filter(t => now - t < RESET_IP_WINDOW_MS);
    if (recent.length) resetRequestsByIp.set(k, recent); else resetRequestsByIp.delete(k);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const displayName = (user) => [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;

/**
 * Empreinte du mot de passe actuel, incluse dans le lien : dès que le mot de passe change
 * (lien utilisé, changement depuis le profil, réinitialisation par l'admin), tous les liens émis deviennent invalides.
 */
const passwordFingerprint = (hash) => crypto.createHash('sha256').update(String(hash || '')).digest('hex').slice(0, 16);

/** Étape 1 : email avec un lien public de confirmation — le mot de passe n'est PAS modifié */
async function sendResetConfirmation(email, req) {
  const user = await userModel.findActiveByEmail(email);
  if (!user) {
    await audit(req, AUDIT.PASSWORD_RESET_REQUESTED, { actor: null, details: { email, accountFound: false } });
    return;
  }

  const token = jwt.sign(
    { purpose: 'password-reset', uid: user.id, fp: passwordFingerprint(user.password_hash) },
    JWT_SECRET,
    { expiresIn: RESET_LINK_TTL }
  );
  const T = i18n.translator(user.language);
  const html = `
    <p>${T('email.hello', { name: escapeHtml(displayName(user)) })}</p>
    <p>${T('email.passwordRequest.intro')}</p>
    <p><a href="${appLink(`/reset-password?token=${encodeURIComponent(token)}`)}" style="background: #2563eb; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">${T('email.passwordRequest.button')}</a></p>
    <p>${T('email.passwordRequest.expires')}</p>
    <p style="color: #6b7280; font-size: 12px;">${T('email.passwordRequest.ignore')}</p>`;

  const sent = await emailService.sendEmail(user.email, T('email.passwordRequest.subject'), html);
  if (!sent.success) console.error('Mot de passe oublié : lien non envoyé à %s (%s)', user.email, sent.error);
  else console.log('🔗 Lien de réinitialisation envoyé à %s', user.email);
  await audit(req, AUDIT.PASSWORD_RESET_REQUESTED, { actor: null, target: user, details: { email, accountFound: true, emailSent: sent.success } });
}

/** Étape 2 : génère, envoie puis enregistre le nouveau mot de passe (changé seulement si l'email est parti) */
async function sendNewPassword(user) {
  const password = generatePassword();
  const name = displayName(user);
  // Email dans la langue de l'utilisateur (email.password.* des locales)
  const T = i18n.translator(user.language);
  const html = `
    <p>${T('email.hello', { name: escapeHtml(name) })}</p>
    <p>${T('email.password.intro')}</p>
    <p style="font-size: 18px; font-family: monospace; background: #f3f4f6; padding: 10px 14px; border-radius: 6px; display: inline-block; letter-spacing: 1px;">${escapeHtml(password)}</p>
    <p><a href="${appLink('/login')}" style="background: #2563eb; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">${T('email.password.login')}</a></p>
    <p>${T('email.password.change')}</p>
    <p style="color: #6b7280; font-size: 12px;">${T('email.password.warning')}</p>`;

  const sent = await emailService.sendEmail(user.email, T('email.password.subject'), html);
  if (!sent.success) {
    console.error('Mot de passe oublié : email non envoyé à %s, mot de passe inchangé (%s)', user.email, sent.error);
    return false;
  }
  await userModel.resetPassword(user.id, password);
  console.log('🔑 Nouveau mot de passe envoyé à %s', user.email);
  return true;
}

class AuthController {
  async login(req, res) {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
      }

      // Anti force brute : au-delà du seuil d'échecs, le mot de passe n'est même pas vérifié
      const ip = clientIp(req) || 'unknown';
      const lock = loginThrottle.check(email, ip);
      if (lock.blocked) {
        await audit(req, AUDIT.LOGIN_BLOCKED, {
          actor: null, details: { email: String(email).slice(0, 255), scope: lock.scope, retryAfter: lock.retryAfter },
        });
        res.set('Retry-After', String(lock.retryAfter));
        return res.status(429).json({
          success: false, code: 'TOO_MANY_ATTEMPTS', retryAfter: lock.retryAfter,
          message: `Trop de tentatives de connexion. Réessayez dans ${Math.ceil(lock.retryAfter / 60)} min.`,
        });
      }

      const result = await userModel.authenticate(email, password);

      if (!result.success) {
        loginThrottle.recordFailure(email, ip);
        // Motif précis dans le journal uniquement (la réponse ne change pas)
        const known = await userModel.findByEmail(email).catch(() => null);
        const reason = !known ? 'UNKNOWN_EMAIL' : known.isActive === false || known.is_active === false ? 'INACTIVE_ACCOUNT' : 'WRONG_PASSWORD';
        await audit(req, AUDIT.LOGIN_FAILED, {
          actor: null,
          target: known ? { id: known.id, email: known.email, enterprise_id: known.enterpriseId || known.enterprise_id } : null,
          details: { email: String(email).slice(0, 255), reason },
        });
        return res.status(401).json({ success: false, message: result.message });
      }
      
      // Générer le token JWT
      const token = jwt.sign(
        { 
          id: result.user.id, 
          email: result.user.email, 
          username: result.user.username 
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      loginThrottle.recordSuccess(email, ip);
      const loggedIn = { id: result.user.id, email: result.user.email, enterprise_id: result.user.enterpriseId };
      await audit(req, AUDIT.LOGIN_SUCCESS, { actor: loggedIn, target: loggedIn });

      res.json({ 
        success: true, 
        data: { 
          token, 
          user: result.user 
        } 
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * POST /auth/forgot-password { email } — public.
   * Réponse identique que le compte existe ou non (pas d'énumération des comptes) ;
   * après la réponse, envoie un lien de confirmation — le mot de passe n'est changé qu'après validation
   * (POST /auth/reset-password/confirm), une demande faite par un tiers ne modifie donc rien.
   */
  async forgotPassword(req, res) {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 255) {
      return res.status(400).json({ success: false, message: 'Email invalide' });
    }

    const now = Date.now();
    pruneOld(now);
    const ip = req.ip || 'unknown';
    const ipRequests = resetRequestsByIp.get(ip) || [];
    if (ipRequests.length >= RESET_IP_MAX) {
      audit(req, AUDIT.PASSWORD_RESET_REQUESTED, { actor: null, details: { email, rateLimited: true } });
      return res.status(429).json({ success: false, message: 'Trop de demandes. Réessayez dans quelques minutes.' });
    }
    resetRequestsByIp.set(ip, [...ipRequests, now]);

    res.json(FORGOT_RESPONSE);

    // Un seul lien par email toutes les 5 minutes (évite d'inonder une boîte mail)
    if (lastResetByEmail.has(email)) {
      audit(req, AUDIT.PASSWORD_RESET_REQUESTED, { actor: null, details: { email, throttled: true } });
      return;
    }
    lastResetByEmail.set(email, now);
    sendResetConfirmation(email, req).catch(err => console.error('Mot de passe oublié :', err.message));
  }

  /**
   * POST /auth/reset-password/confirm { token } — public (lien reçu par email, page /reset-password).
   * POST et non GET : les antivirus de messagerie qui pré-ouvrent les liens ne déclenchent rien.
   * Lien à usage unique : invalide dès que le mot de passe a changé (empreinte), expire après 1 h.
   */
  async confirmPasswordReset(req, res) {
    const invalid = (target = null) => {
      audit(req, AUDIT.PASSWORD_RESET_INVALID_LINK, { actor: null, target });
      return res.status(400).json({ success: false, code: 'INVALID_LINK', message: 'Lien invalide ou expiré' });
    };
    let payload;
    try {
      payload = jwt.verify(String(req.body?.token || ''), JWT_SECRET);
    } catch {
      return invalid();
    }
    if (payload?.purpose !== 'password-reset' || !payload.uid) return invalid();
    if (confirmingUsers.has(payload.uid)) return res.status(409).json({ success: false, message: 'Confirmation déjà en cours' });

    confirmingUsers.add(payload.uid);
    try {
      const user = await userModel.findActiveForReset(payload.uid);
      if (!user || passwordFingerprint(user.password_hash) !== payload.fp) return invalid(user ? { id: user.id, email: user.email } : null);
      const sent = await sendNewPassword(user);
      await audit(req, AUDIT.PASSWORD_RESET_CONFIRMED, { actor: null, target: { id: user.id, email: user.email }, details: { emailSent: sent } });
      if (!sent) return res.status(502).json({ success: false, code: 'EMAIL_FAILED', message: 'Email non envoyé, mot de passe inchangé' });
      res.json({ success: true, message: 'Un nouveau mot de passe vous a été envoyé par email' });
    } catch (error) {
      console.error('Confirmation mot de passe oublié :', error.message);
      res.status(500).json({ success: false, message: 'Erreur, veuillez réessayer' });
    } finally {
      confirmingUsers.delete(payload.uid);
    }
  }

  /**
   * POST /auth/change-password { oldPassword, newPassword } — utilisateur connecté
   */
  async changePassword(req, res) {
    try {
      const { oldPassword, newPassword } = req.body || {};
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Mot de passe actuel et nouveau mot de passe requis' });
      }
      if (String(newPassword).length < 8) {
        return res.status(400).json({ success: false, message: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
      }
      const result = await userModel.changePassword(req.user.id, oldPassword, newPassword);
      // 400 (et non 401) : un 401 déconnecterait l'utilisateur côté client
      if (!result.success) {
        await audit(req, AUDIT.PASSWORD_CHANGE_FAILED, { target: req.user, details: { reason: 'WRONG_OLD_PASSWORD' } });
        return res.status(400).json(result);
      }
      await audit(req, AUDIT.PASSWORD_CHANGED, { target: req.user });
      res.json({ success: true, message: 'Mot de passe changé avec succès' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * POST /auth/logout — trace la déconnexion (le JWT est sans état : le client supprime le token)
   */
  async logout(req, res) {
    await audit(req, AUDIT.LOGOUT, { target: req.user });
    res.json({ success: true });
  }

  /**
   * PUT /auth/language { language } — langue de l'utilisateur connecté (interface et emails)
   */
  async setLanguage(req, res) {
    try {
      const language = String(req.body?.language || '').toLowerCase();
      if (!i18n.LANGS.includes(language)) {
        return res.status(400).json({ success: false, message: `Langue inconnue (${i18n.LANGS.join(', ')})` });
      }
      await userModel.setLanguage(req.user.id, language);
      res.json({ success: true, data: { language } });
    } catch (error) {
      console.error('Set language error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getProfile(req, res) {
    try {
      const user = await userModel.findById(req.user.id);
      const permissions = await userModel.getUserPermissions(req.user.id);
      const profiles = await userModel.getUserProfiles(req.user.id);
      
      res.json({ 
        success: true, 
        data: { 
          ...user, 
          permissions,
          profiles 
        } 
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new AuthController();