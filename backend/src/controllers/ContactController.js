// backend/src/controllers/ContactController.js
// Formulaire de contact du site vitrine (public) : le message est envoyé par email à CONTACT_EMAIL,
// avec Reply-To = adresse du visiteur (on lui répond directement depuis sa messagerie).
const emailService = require('../services/EmailNotificationService');
const i18n = require('../i18n');

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'jeremielodi@gmail.com';

// Anti-abus (mémoire du processus) : 5 messages / IP / heure
const IP_WINDOW_MS = 60 * 60 * 1000;
const IP_MAX = 5;
const requestsByIp = new Map();

const LIMITS = { name: 100, email: 255, company: 150, phone: 40, message: 5000 };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Une seule ligne (pas de retour chariot dans l'objet du mail)
const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

class ContactController {
  /**
   * POST /public/contact { name, email, company?, phone?, message, website? }
   * `website` = champ piège invisible : rempli par un robot → réponse « succès » sans envoi.
   */
  async send(req, res) {
    const body = req.body || {};
    const data = {
      name: oneLine(body.name),
      email: oneLine(body.email).toLowerCase(),
      company: oneLine(body.company),
      phone: oneLine(body.phone),
      message: String(body.message ?? '').trim(),
    };

    const errors = {};
    if (!data.name) errors.name = 'required';
    if (!/^\S+@\S+\.\S+$/.test(data.email)) errors.email = 'invalid';
    if (data.message.length < 10) errors.message = 'tooShort';
    for (const [k, max] of Object.entries(LIMITS)) if (data[k].length > max) errors[k] = 'tooLong';
    if (Object.keys(errors).length) {
      return res.status(400).json({ success: false, message: 'Formulaire invalide', errors });
    }

    if (body.website) return res.json({ success: true });

    const now = Date.now();
    const ip = req.ip || 'unknown';
    const recent = (requestsByIp.get(ip) || []).filter(ts => now - ts < IP_WINDOW_MS);
    if (recent.length >= IP_MAX) {
      return res.status(429).json({ success: false, message: 'Trop de messages. Réessayez plus tard.' });
    }
    requestsByIp.set(ip, [...recent, now]);

    // Email au propriétaire du site, en français (email.contact.* des locales)
    const T = i18n.translator(i18n.DEFAULT_LANG);
    const row = (label, value) => value
      ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap">${label}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`
      : '';
    const html = `
      <p>${T('email.contact.intro')}</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${row(T('email.contact.name'), data.name)}
        ${row(T('email.contact.email'), data.email)}
        ${row(T('email.contact.company'), data.company)}
        ${row(T('email.contact.phone'), data.phone)}
        ${row(T('email.contact.language'), i18n.fromRequest(req).toUpperCase())}
      </table>
      <div style="margin-top:12px;padding:12px 14px;background:#f3f4f6;border-radius:6px;white-space:pre-wrap">${escapeHtml(data.message)}</div>
      <p style="color:#6b7280;font-size:12px">${T('email.contact.replyHint')}</p>`;
    const subject = T('email.contact.subject', { name: data.name, company: data.company ? ` (${data.company})` : '' });

    const sent = await emailService.sendEmail(CONTACT_EMAIL, subject, html, { replyTo: { name: data.name, address: data.email } });
    if (!sent.success) {
      console.error('Formulaire de contact : email non envoyé (%s)', sent.error);
      return res.status(502).json({ success: false, code: 'EMAIL_FAILED', message: 'Message non envoyé, réessayez plus tard' });
    }
    console.log('✉️  Message de contact reçu de %s', data.email);
    res.json({ success: true });
  }
}

module.exports = new ContactController();
