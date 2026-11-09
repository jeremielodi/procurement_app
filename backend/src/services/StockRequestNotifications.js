// backend/src/services/StockRequestNotifications.js
// Notifications des demandes au magasin (in-app + temps réel, langue du destinataire — notification.stockRequest.*) :
//  - à valider → validateurs (chef du projet / intérimaire, responsable du département ou administrateurs)
//  - à servir → magasiniers du dépôt (accès au dépôt + ISSUE_STOCK ; à défaut les administrateurs de l'entreprise)
//  - décisions (validée, rejetée, servie, servie en partie, soldée, rouverte) → demandeur
// N'interrompt jamais la requête ; l'auteur de l'action n'est pas notifié.
const db = require('../config/database');
const i18n = require('../i18n');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const stockRequestModel = require('../models/StockRequestModel');

const link = (id) => `/stock/requests/${id}`;

async function send(req, userIds, key, vars, id) {
  for (const userId of [...new Set(userIds.map(String))]) {
    if (String(userId) === String(req.user?.id)) continue;
    try {
      const user = await userModel.findById(userId);
      const T = i18n.translator(user?.language);
      const title = T(`notification.stockRequest.${key}Title`, vars);
      const message = T(`notification.stockRequest.${key}Message`, vars);
      await notificationModel.create({ userId, title, message, type: 'INFO', link: link(id) });
      req.io?.to(`user-${userId}`).emit('notification', { title, message, type: 'INFO', link: link(id), timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Notification demande au magasin :', error.message);
    }
  }
}

async function load(id) {
  return db.one(
    `SELECT r.id, r.request_number, r.requester_id, r.warehouse_id, r.enterprise_id, w.name AS warehouse_name,
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS requester_name
     FROM stock_requests r JOIN warehouses w ON w.id = r.warehouse_id JOIN users u ON u.id = r.requester_id WHERE r.id = $1`,
    [id]
  );
}

async function servers(r) {
  const ids = [];
  for (const userId of await stockRequestModel.warehouseUsers(r.warehouse_id)) {
    if (await userModel.hasPermission(userId, 'ISSUE_STOCK')) ids.push(userId);
  }
  if (ids.length) return ids;
  return (await db.select(
    `SELECT u.id FROM users u JOIN user_profiles up ON up.user_id = u.id AND up.profile_id = 'prof_admin'
     WHERE u.is_active AND u.enterprise_id = $1`,
    [r.enterprise_id]
  )).map(x => x.id);
}

const vars = (r, extra = {}) => ({ number: r.request_number, name: r.requester_name, warehouse: r.warehouse_name, ...extra });

module.exports = {
  /** Nouvelle demande : validateurs si elle attend une validation, sinon magasiniers */
  async created(req, id, status) {
    const r = await load(id);
    if (!r) return;
    if (status === 'PENDING_VALIDATION') await send(req, await stockRequestModel.validators(id), 'toValidate', vars(r), id);
    else await send(req, await servers(r), 'toServe', vars(r), id);
  },
  async validated(req, id) {
    const r = await load(id);
    if (!r) return;
    await send(req, [r.requester_id], 'validated', vars(r), id);
    await send(req, await servers(r), 'toServe', vars(r), id);
  },
  async rejected(req, id, reason) {
    const r = await load(id);
    if (r) await send(req, [r.requester_id], 'rejected', vars(r, { reason }), id);
  },
  /** Après un bon de sortie : servie entièrement ou en partie */
  async served(req, id, status) {
    const r = await load(id);
    if (r) await send(req, [r.requester_id], status === 'SERVED' ? 'served' : 'partiallyServed', vars(r), id);
  },
  /** Bon de sortie annulé : la demande est de nouveau à servir */
  async reopened(req, id, issueNumber) {
    const r = await load(id);
    if (r) await send(req, [r.requester_id, ...(await servers(r))], 'reopened', vars(r, { issue: issueNumber }), id);
  },
  async closed(req, id, reason) {
    const r = await load(id);
    if (r) await send(req, [r.requester_id], 'closed', vars(r, { reason }), id);
  },
  /** Retrait par le demandeur : validateurs ou magasiniers qui l'attendaient */
  async cancelled(req, id, previousStatus) {
    const r = await load(id);
    if (!r) return;
    const to = previousStatus === 'PENDING_VALIDATION' ? await stockRequestModel.validators(id) : await servers(r);
    await send(req, to, 'cancelled', vars(r), id);
  },
};
