// backend/src/services/FrameworkAgreementAlerts.js
// Alertes des accords-cadres (migration 69), une seule fois par contrat, notification in-app dans la langue du
// destinataire (notification.frameworkAgreement.ceilingAlert* / expiryAlert*) :
//  - plafond consommé à 80 % ou plus : vérifié après chaque bon de commande passé sur le contrat ;
//  - échéance dans 30 jours ou moins : vérifié au démarrage puis toutes les 6 heures (contrats actifs).
// Destinataires : auteur du contrat + utilisateurs actifs de l'entreprise ayant MANAGE_FRAMEWORK_AGREEMENTS.
// N'interrompt jamais l'appelant.
const db = require('../config/database');
const i18n = require('../i18n');
const notificationModel = require('../models/NotificationModel');

const CEILING_RATIO = 0.8;
const EXPIRY_DAYS = 30;
const link = (id) => `/framework-agreements/${id}`;

async function recipients(agreement) {
  const rows = await db.select(
    `SELECT DISTINCT u.id, u.language FROM users u
     WHERE u.is_active AND u.enterprise_id = $1
       AND (u.id = $2 OR EXISTS (
         SELECT 1 FROM user_profiles up JOIN profile_permissions pp ON pp.profile_id = up.profile_id
         JOIN permissions p ON p.id = pp.permission_id AND p.name = 'MANAGE_FRAMEWORK_AGREEMENTS' WHERE up.user_id = u.id))`,
    [agreement.enterprise_id, agreement.created_by]
  );
  return rows;
}

async function notify(agreement, key, vars, io) {
  for (const user of await recipients(agreement)) {
    try {
      const T = i18n.translator(user.language);
      const title = T(`notification.frameworkAgreement.${key}Title`, vars);
      const message = T(`notification.frameworkAgreement.${key}Message`, vars);
      await notificationModel.create({ userId: user.id, title, message, type: 'WARNING', link: link(agreement.id) });
      io?.to(`user-${user.id}`).emit('notification', { title, message, type: 'WARNING', link: link(agreement.id), timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Alerte accord-cadre :', error.message);
    }
  }
}

const fmt = (n) => (Math.round(Number(n) * 100) / 100).toString();

module.exports = {
  CEILING_RATIO, EXPIRY_DAYS,

  /** Après un bon de commande : alerte si le consommé atteint 80 % du plafond (réservée avant l'envoi) */
  async checkCeiling(agreementId, io) {
    try {
      const a = await db.one(
        `UPDATE framework_agreements a SET ceiling_alert_sent_at = NOW()
         WHERE a.id = $1 AND a.ceiling_alert_sent_at IS NULL AND framework_agreement_consumed(a.id) >= a.ceiling_amount * $2
         RETURNING a.id, a.enterprise_id, a.created_by, a.agreement_number, a.title, a.ceiling_amount,
                   framework_agreement_consumed(a.id)::float8 AS consumed,
                   (SELECT format_key FROM currency c WHERE c.id = a.currency_id) AS currency`,
        [agreementId, CEILING_RATIO]
      );
      if (!a) return false;
      const percent = Math.round((a.consumed / Number(a.ceiling_amount)) * 100);
      await notify(a, 'ceilingAlert', {
        number: a.agreement_number, title: a.title, percent, consumed: fmt(a.consumed), ceiling: fmt(a.ceiling_amount), currency: a.currency || '',
      }, io);
      return true;
    } catch (error) {
      console.error('Alerte plafond accord-cadre :', error.message);
      return false;
    }
  },

  /** Contrats actifs arrivant à échéance dans 30 jours ou moins (une alerte par contrat) */
  async checkExpiring(io) {
    const rows = await db.select(
      `UPDATE framework_agreements a SET expiry_alert_sent_at = NOW()
       WHERE a.status = 'ACTIVE' AND a.expiry_alert_sent_at IS NULL AND a.end_date >= CURRENT_DATE AND a.end_date <= CURRENT_DATE + $1::int
       RETURNING a.id, a.enterprise_id, a.created_by, a.agreement_number, a.title, a.end_date, (a.end_date - CURRENT_DATE)::int AS days`,
      [EXPIRY_DAYS]
    );
    for (const a of rows) {
      await notify(a, 'expiryAlert', { number: a.agreement_number, title: a.title, days: a.days, date: String(a.end_date) }, io);
    }
    return rows.length;
  },

  /** Vérification des échéances au démarrage puis toutes les 6 heures */
  start(io) {
    const run = () => this.checkExpiring(io).catch(error => console.error('Alertes d\'échéance des accords-cadres :', error.message));
    setTimeout(run, 20 * 1000).unref?.();
    const timer = setInterval(run, 6 * 60 * 60 * 1000);
    timer.unref?.();
    return timer;
  },
};
