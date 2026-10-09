// backend/src/utils/auditLog.js
// Journal d'audit (table audit_logs, migration 12_audit_logs.sql) : événements de sécurité des comptes.
// N'interrompt jamais la requête : une erreur d'écriture est seulement loguée.
// Ne jamais y mettre de mot de passe ni de token.
const db = require('../config/database');

/** Actions enregistrées (colonne action) */
const AUDIT = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGIN_BLOCKED: 'LOGIN_BLOCKED', // trop d'échecs (utils/loginThrottle) : mot de passe non vérifié
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_CHANGE_FAILED: 'PASSWORD_CHANGE_FAILED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',   // lien de confirmation envoyé
  PASSWORD_RESET_CONFIRMED: 'PASSWORD_RESET_CONFIRMED',   // nouveau mot de passe envoyé
  PASSWORD_RESET_INVALID_LINK: 'PASSWORD_RESET_INVALID_LINK',
  PASSWORD_RESET_BY_ADMIN: 'PASSWORD_RESET_BY_ADMIN',
  SUPPLIER_REGISTERED: 'SUPPLIER_REGISTERED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_DELETED: 'USER_DELETED',
  WAREHOUSE_ACCESS_CHANGED: 'WAREHOUSE_ACCESS_CHANGED',
  AUDIT_LOG_EXPORTED: 'AUDIT_LOG_EXPORTED', // export Excel du journal (filtres, nombre de lignes)
};

// Adresse locale / privée : la requête arrive par un reverse proxy (Caddy, Nginx, Docker)
const PRIVATE_IP = /^(?:::1$|fc|fd|(?:::ffff:)?(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.))/i;

/**
 * Adresse IP du client. X-Forwarded-For n'est retenu que si la connexion vient d'un proxy local / privé
 * (sinon n'importe quel client pourrait écrire une fausse IP). On prend la DERNIÈRE adresse de l'en-tête :
 * c'est celle ajoutée par notre proxy ; les précédentes peuvent venir du client (Nginx
 * $proxy_add_x_forwarded_for ajoute à l'en-tête reçu) et serviraient à contourner la limitation des connexions.
 */
function clientIp(req) {
  const remote = req?.socket?.remoteAddress || req?.ip || '';
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean).pop();
  const ip = forwarded && PRIVATE_IP.test(remote) ? forwarded : remote;
  return ip.slice(0, 45) || null;
}

/**
 * Écrit une ligne d'audit.
 * @param {object} req      requête Express (IP, user-agent, req.user = auteur par défaut)
 * @param {string} action   AUDIT.*
 * @param {object} [opts]
 *   actor     { id, email, enterprise_id } — auteur (défaut : req.user ; null pour un visiteur)
 *   target    { id, email, enterprise_id } — compte concerné (entity_type 'user')
 *   details   objet JSON (new_value) : email saisi, motif d'échec, champs modifiés…
 *   oldValue  objet JSON (old_value) : valeurs avant modification
 */
async function audit(req, action, { actor, target, details, oldValue } = {}) {
  try {
    const who = actor === undefined ? req?.user || null : actor;
    let enterpriseId = who?.enterprise_id || who?.enterpriseId || (who && req?.enterpriseId) || target?.enterprise_id || target?.enterpriseId || null;
    // Routes ouvertes avant tenantContext (mot de passe, déconnexion) : entreprise lue sur le compte
    const accountId = who?.id || target?.id;
    if (!enterpriseId && accountId) {
      enterpriseId = (await db.one('SELECT enterprise_id FROM users WHERE id = $1', [accountId]))?.enterprise_id || null;
    }
    await db.insert('audit_logs', {
      user_id: who?.id || null,
      user_email: who?.email || null,
      enterprise_id: enterpriseId,
      action,
      entity_type: target ? 'user' : null,
      entity_id: target?.id || null,
      old_value: oldValue ? JSON.stringify(oldValue) : null,
      new_value: details ? JSON.stringify(details) : null,
      ip_address: clientIp(req),
      user_agent: String(req?.headers?.['user-agent'] || '').slice(0, 500) || null,
    });
  } catch (error) {
    console.error('Audit %s non enregistré : %s', action, error.message);
  }
}

module.exports = { audit, AUDIT, clientIp };
