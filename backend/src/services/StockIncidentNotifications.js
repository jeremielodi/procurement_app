// backend/src/services/StockIncidentNotifications.js
// Notifications des rapports d'incident (in-app + temps réel, langue du destinataire — notification.stockIncident.*) :
//  - déclaré → validateurs (chef du projet / intérimaire, à défaut administrateurs) ; détenteur si le magasin l'a saisi
//  - validé → détenteur, déclarant, magasiniers des dépôts d'où les articles sont sortis (accès + ISSUE_STOCK)
//  - rejeté → détenteur et déclarant ; retiré → validateurs
// N'interrompt jamais la requête ; l'auteur de l'action n'est pas notifié.
const db = require('../config/database');
const i18n = require('../i18n');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const stockIncidentModel = require('../models/StockIncidentModel');

const link = (id) => `/stock/incidents/${id}`;

async function send(req, userIds, key, vars, id) {
  for (const userId of [...new Set(userIds.filter(Boolean).map(String))]) {
    if (String(userId) === String(req.user?.id)) continue;
    try {
      const user = await userModel.findById(userId);
      const T = i18n.translator(user?.language);
      const v = { ...vars, type: T(`notification.stockIncident.types.${vars.type}`) };
      const title = T(`notification.stockIncident.${key}Title`, v);
      const message = T(`notification.stockIncident.${key}Message`, v);
      await notificationModel.create({ userId, title, message, type: key === 'rejected' ? 'WARNING' : 'INFO', link: link(id) });
      req.io?.to(`user-${userId}`).emit('notification', { title, message, type: 'INFO', link: link(id), timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Notification rapport d\'incident :', error.message);
    }
  }
}

async function load(id) {
  return db.one(
    `SELECT i.id, i.incident_number, i.incident_type, i.holder_id, i.reported_by,
            TRIM(COALESCE(h.first_name, '') || ' ' || COALESCE(h.last_name, '')) AS holder_name,
            TRIM(COALESCE(v.first_name, '') || ' ' || COALESCE(v.last_name, '')) AS validator_name
     FROM stock_incidents i JOIN users h ON h.id = i.holder_id LEFT JOIN users v ON v.id = COALESCE(i.validated_by, i.rejected_by)
     WHERE i.id = $1`,
    [id]
  );
}

/** Magasiniers des dépôts d'où sont sortis les articles du rapport */
async function storekeepers(id) {
  const users = await db.select(
    `SELECT DISTINCT wu.user_id FROM stock_incident_lines l JOIN stock_issue_lines il ON il.id = l.issue_line_id
     JOIN stock_issues si ON si.id = il.issue_id JOIN warehouse_users wu ON wu.warehouse_id = si.warehouse_id
     JOIN users u ON u.id = wu.user_id AND u.is_active WHERE l.incident_id = $1`,
    [id]
  );
  const ids = [];
  for (const u of users) if (await userModel.hasPermission(u.user_id, 'ISSUE_STOCK')) ids.push(u.user_id);
  return ids;
}

const vars = (i, extra = {}) => ({ number: i.incident_number, name: i.holder_name, type: i.incident_type, validator: i.validator_name, ...extra });
const validatorIds = async (id) => (await stockIncidentModel.validators(id)).map(v => v.id);

module.exports = {
  async reported(req, id) {
    const i = await load(id);
    if (!i) return;
    await send(req, await validatorIds(id), 'toValidate', vars(i), id);
    if (String(i.reported_by) !== String(i.holder_id)) await send(req, [i.holder_id], 'reportedForYou', vars(i), id);
  },
  async validated(req, id) {
    const i = await load(id);
    if (!i) return;
    await send(req, [i.holder_id, i.reported_by], 'validated', vars(i), id);
    await send(req, (await storekeepers(id)).filter(u => ![i.holder_id, i.reported_by].map(String).includes(String(u))), 'storeInfo', vars(i), id);
  },
  async rejected(req, id, reason) {
    const i = await load(id);
    if (i) await send(req, [i.holder_id, i.reported_by], 'rejected', vars(i, { reason }), id);
  },
  async cancelled(req, id) {
    const i = await load(id);
    if (i) await send(req, await validatorIds(id), 'cancelled', vars(i), id);
  },
};
