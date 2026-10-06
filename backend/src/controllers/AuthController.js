// backend/src/controllers/AuthController.js
const userModel = require('../models/UserModel');
const jwt = require('jsonwebtoken');

const emailService = require('../services/EmailNotificationService');
const { generatePassword } = require('../utils/passwordGenerator');
const { appLink } = require('../utils/appUrl');
const i18n = require('../i18n');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Mot de passe oublié : limites anti-abus (mémoire du processus)
const RESET_EMAIL_INTERVAL_MS = 5 * 60 * 1000;   // 1 nouveau mot de passe / email / 5 min
const RESET_IP_WINDOW_MS = 15 * 60 * 1000;       // 5 demandes / IP / 15 min
const RESET_IP_MAX = 5;
const lastResetByEmail = new Map();
const resetRequestsByIp = new Map();

const FORGOT_RESPONSE = {
  success: true,
  message: 'Si un compte actif correspond à cet email, un nouveau mot de passe vient de lui être envoyé.'
};

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

/** Génère, envoie puis enregistre le nouveau mot de passe (le mot de passe n'est changé que si l'email est parti) */
async function sendNewPassword(email) {
  const user = await userModel.findActiveByEmail(email);
  if (!user) return;

  const password = generatePassword();
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
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
    return;
  }
  await userModel.resetPassword(user.id, password);
  console.log('🔑 Nouveau mot de passe envoyé à %s', user.email);
}

class AuthController {
  async login(req, res) {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
      }
      
      const result = await userModel.authenticate(email, password);
      
      if (!result.success) {
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
   * le traitement (génération + email) se fait après la réponse.
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
      return res.status(429).json({ success: false, message: 'Trop de demandes. Réessayez dans quelques minutes.' });
    }
    resetRequestsByIp.set(ip, [...ipRequests, now]);

    res.json(FORGOT_RESPONSE);

    // Une seule régénération par email toutes les 5 minutes (évite de bloquer un compte en boucle)
    if (lastResetByEmail.has(email)) return;
    lastResetByEmail.set(email, now);
    sendNewPassword(email).catch(err => console.error('Mot de passe oublié :', err.message));
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
      if (!result.success) return res.status(400).json(result);
      res.json({ success: true, message: 'Mot de passe changé avec succès' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
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