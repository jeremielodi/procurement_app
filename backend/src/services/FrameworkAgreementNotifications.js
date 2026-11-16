// backend/src/services/FrameworkAgreementNotifications.js
// Notifications des accords-cadres (in-app + temps réel, langue du destinataire — notification.frameworkAgreement.*) :
//  - soumis / étape chef de projet franchie → personnes qui peuvent décider maintenant (chefs de projet, puis DG)
//  - approuvé (étape intermédiaire), activé, rejeté → auteur (et personne qui l'a soumis)
// N'interrompt jamais la requête ; l'auteur de l'action n'est pas notifié.
const db = require('../config/database');
const i18n = require('../i18n');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const model = require('../models/FrameworkAgreementModel');

const link = (id) => `/framework-agreements/${id}`;

async function send(req, userIds, key, vars, id, type = 'INFO') {
  for (const userId of [...new Set(userIds.filter(Boolean).map(String))]) {
    if (String(userId) === String(req.user?.id)) continue;
    try {
      const user = await userModel.findById(userId);
      const T = i18n.translator(user?.language);
      const title = T(`notification.frameworkAgreement.${key}Title`, vars);
      const message = T(`notification.frameworkAgreement.${key}Message`, vars);
      await notificationModel.create({ userId, title, message, type, link: link(id) });
      req.io?.to(`user-${userId}`).emit('notification', { title, message, type, link: link(id), timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Notification accord-cadre :', error.message);
    }
  }
}

async function load(id) {
  return db.one(
    `SELECT a.id, a.agreement_number, a.title, a.created_by, a.submitted_by, s.name AS supplier
     FROM framework_agreements a JOIN suppliers s ON s.id = a.supplier_id WHERE a.id = $1`,
    [id]
  );
}

const vars = (a, req, extra = {}) => ({ number: a.agreement_number, title: a.title, supplier: a.supplier, ...extra });

async function actorName(req) {
  const u = await userModel.findById(req.user.id).catch(() => null);
  return `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || req.user.email;
}

async function toValidators(req, a, extra = {}) {
  const ids = (await model.validators(a.id)).map(v => v.id);
  await send(req, ids, 'toValidate', vars(a, req, { name: await actorName(req), ...extra }), a.id);
}

module.exports = {
  async submitted(req, id) {
    const a = await load(id);
    if (a) await toValidators(req, a);
  },
  /** Décision prise : result = { step, decision, status } du modèle */
  async decided(req, id, result, comment) {
    const a = await load(id);
    if (!a) return;
    const name = await actorName(req);
    const owners = [a.created_by, a.submitted_by];
    if (result.decision === 'REJECTED') {
      await send(req, owners, 'rejected', vars(a, req, { name, reason: comment || '' }), a.id, 'WARNING');
    } else if (result.status === 'ACTIVE') {
      await send(req, owners, 'activated', vars(a, req, { name }), a.id);
    } else {
      await send(req, owners, 'stepApproved', vars(a, req, { name }), a.id);
      await toValidators(req, a);
    }
  },
};
