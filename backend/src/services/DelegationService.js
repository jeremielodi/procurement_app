// backend/src/services/DelegationService.js
// Intérim du chef de projet pendant son absence (migration 53_manager_delegations.sql).
// Délégation PAR PERSONNE : pendant la période, l'intérimaire valide les réquisitions de tous les projets dont
// l'absent est chef (le titulaire garde la main) — groupe « project_manager » accordé par utils/projectAccess.loadScope.
// Déclarée par le chef lui-même ou par l'administrateur d'entreprise (MANAGE_USERS) ; fin automatique à la date de fin
// ou anticipée (end). Une seule délégation à la fois par personne (périodes qui se chevauchent refusées).
const db = require('../config/database');
const tenant = require('../utils/tenant');
const i18n = require('../i18n');
const notificationService = require('./NotificationService');
const { audit, AUDIT } = require('../utils/auditLog');

const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SELECT = `
  SELECT d.id, d.delegator_id, d.delegate_id, d.start_date, d.end_date, d.reason, d.created_at, d.ended_at, d.created_by,
         TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')) AS delegator_name, a.email AS delegator_email,
         TRIM(COALESCE(b.first_name, '') || ' ' || COALESCE(b.last_name, '')) AS delegate_name, b.email AS delegate_email,
         delegation_active(d) AS active,
         (d.ended_at IS NULL AND d.end_date >= CURRENT_DATE) AS open,
         (SELECT COUNT(*)::int FROM projects p WHERE p.project_manager_id = d.delegator_id AND COALESCE(p.is_active, true)) AS project_count
  FROM user_delegations d
  JOIN users a ON a.id = d.delegator_id
  JOIN users b ON b.id = d.delegate_id`;

/** Utilisateur actif de l'entreprise courante, ni fournisseur ni super admin → { id, email, language, first_name } ou null */
async function enterpriseUser(userId) {
  if (!userId) return null;
  const params = [String(userId)];
  return db.one(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.language, u.enterprise_id FROM users u
     WHERE u.id::text = $1 AND u.is_active = true AND u.enterprise_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id IN ('prof_supplier', 'prof_superadmin'))
       ${tenant.filter('u.enterprise_id', params)}`,
    params
  );
}

/** Chef d'au moins un projet actif : seul cas où un intérim a un effet (2026-11-06, choix de l'utilisateur) */
async function managesProjects(userId) {
  if (!userId) return false;
  const row = await db.one(
    'SELECT EXISTS (SELECT 1 FROM projects WHERE project_manager_id::text = $1 AND COALESCE(is_active, true)) AS ok',
    [String(userId)]
  );
  return !!row?.ok;
}

const fullName = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;

class DelegationService {
  /** L'utilisateur peut avoir un intérimaire (chef de projet) */
  canDelegate(userId) {
    return managesProjects(userId);
  }

  /**
   * Délégations visibles : les siennes (absent ou intérimaire) ; administrateur (MANAGE_USERS) : toute l'entreprise,
   * ou celles d'un utilisateur (userId). current=1 : en cours ou à venir seulement.
   */
  async list({ userId, isAdmin, forUserId, current }) {
    const params = [];
    let sql = `${SELECT} WHERE 1=1${tenant.filter('d.enterprise_id', params)}`;
    const who = isAdmin ? forUserId : userId;
    if (who) {
      params.push(String(who));
      sql += ` AND (d.delegator_id::text = $${params.length} OR d.delegate_id::text = $${params.length})`;
    }
    if (['1', 'true', true].includes(current)) sql += ' AND d.ended_at IS NULL AND d.end_date >= CURRENT_DATE';
    sql += ' ORDER BY d.start_date DESC, d.created_at DESC LIMIT 200';
    return db.select(sql, params);
  }

  /** Utilisateurs pouvant assurer l'intérim (actifs de l'entreprise, hors fournisseurs / super admin) */
  async candidates() {
    const params = [];
    return db.select(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.position FROM users u
       WHERE u.is_active = true AND u.enterprise_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM user_profiles up WHERE up.user_id = u.id AND up.profile_id IN ('prof_supplier', 'prof_superadmin'))
         ${tenant.filter('u.enterprise_id', params)}
       ORDER BY u.first_name, u.last_name`,
      params
    );
  }

  /**
   * Déclarer une absence : { delegatorId (défaut : soi-même ; autre = administrateur), delegateId, startDate, endDate, reason }
   * 400 DELEGATE_REQUIRED / DELEGATE_INVALID / DELEGATE_SELF / DATES_INVALID / END_IN_PAST, 403 NOT_ALLOWED,
   * 409 DELEGATION_OVERLAP
   */
  async create(req, { delegatorId, delegateId, startDate, endDate, reason }, { isAdmin }) {
    const userId = req.user.id;
    const absentId = delegatorId || userId;
    if (String(absentId) !== String(userId) && !isAdmin) {
      throw fail(403, 'NOT_ALLOWED', "Seul l'administrateur peut déclarer l'absence d'un autre utilisateur");
    }
    if (!delegateId) throw fail(400, 'DELEGATE_REQUIRED', "Choisissez l'intérimaire");
    if (String(delegateId) === String(absentId)) throw fail(400, 'DELEGATE_SELF', "L'intérimaire doit être une autre personne");
    if (!DATE_RE.test(String(startDate || '')) || !DATE_RE.test(String(endDate || '')) || endDate < startDate) {
      throw fail(400, 'DATES_INVALID', 'Dates de début et de fin invalides');
    }
    const [absent, delegate] = await Promise.all([enterpriseUser(absentId), enterpriseUser(delegateId)]);
    if (!absent) throw fail(400, 'DELEGATOR_INVALID', 'Utilisateur absent introuvable ou inactif');
    // Réservé aux chefs de projet : l'intérim ne porte que sur la validation des réquisitions de leurs projets
    if (!(await managesProjects(absent.id))) {
      throw fail(400, 'NOT_PROJECT_MANAGER', "L'intérim est réservé aux chefs de projet : cet utilisateur n'est chef d'aucun projet actif");
    }
    if (!delegate) throw fail(400, 'DELEGATE_INVALID', 'Intérimaire introuvable ou inactif dans votre entreprise');

    const row = await db.withTransaction(async (tx) => {
      // Une délégation à la fois : verrou sur l'absent, puis contrôle du chevauchement
      await tx.one('SELECT id FROM users WHERE id = $1 FOR UPDATE', [absent.id]);
      const today = (await tx.one('SELECT CURRENT_DATE::text AS d')).d;
      if (endDate < today) throw fail(400, 'END_IN_PAST', 'La date de fin est déjà passée');
      const overlap = await tx.one(
        `SELECT d.start_date, d.end_date, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS delegate_name
         FROM user_delegations d JOIN users u ON u.id = d.delegate_id
         WHERE d.delegator_id = $1 AND d.ended_at IS NULL AND d.start_date <= $3::date AND d.end_date >= $2::date`,
        [absent.id, startDate, endDate]
      );
      if (overlap) {
        throw fail(409, 'DELEGATION_OVERLAP', `Une délégation couvre déjà cette période (${overlap.delegate_name}, du ${overlap.start_date} au ${overlap.end_date})`,
          { startDate: overlap.start_date, endDate: overlap.end_date, delegate: overlap.delegate_name });
      }
      return tx.one(
        `INSERT INTO user_delegations (enterprise_id, delegator_id, delegate_id, start_date, end_date, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [absent.enterprise_id, absent.id, delegate.id, startDate, endDate, String(reason || '').trim().slice(0, 500) || null, userId]
      );
    });

    await audit(req, AUDIT.DELEGATION_CREATED, {
      entity: { type: 'delegation', id: row.id, label: `${fullName(absent)} → ${fullName(delegate)}` },
      details: { delegator: absent.email, delegate: delegate.email, startDate, endDate, reason: reason || null },
    });
    // Intérimaire prévenu (dans sa langue)
    const t = i18n.translator(delegate.language);
    await notificationService.sendNotification(delegate.id,
      t('notification.delegation.title'),
      t('notification.delegation.message', { name: fullName(absent), start: startDate, end: endDate }),
      'INFO', '/tasks').catch(() => {});
    return this.get(row.id);
  }

  async get(id) {
    return db.one(`${SELECT} WHERE d.id = $1`, [id]);
  }

  /** Fin anticipée : l'absent, l'intérimaire ou l'administrateur. 404 / 403 NOT_ALLOWED / 409 ALREADY_ENDED */
  async end(req, id, { isAdmin }) {
    const d = await this.get(id);
    if (!d) throw fail(404, 'NOT_FOUND', 'Délégation introuvable');
    const userId = String(req.user.id);
    if (!isAdmin && ![String(d.delegator_id), String(d.delegate_id)].includes(userId)) {
      throw fail(403, 'NOT_ALLOWED', 'Seuls la personne absente, son intérimaire ou un administrateur peuvent y mettre fin');
    }
    if (!d.open) throw fail(409, 'ALREADY_ENDED', 'Cette délégation est déjà terminée');
    await db.exec('UPDATE user_delegations SET ended_at = CURRENT_TIMESTAMP, ended_by = $2 WHERE id = $1', [id, req.user.id]);
    await audit(req, AUDIT.DELEGATION_ENDED, {
      entity: { type: 'delegation', id, label: `${d.delegator_name || d.delegator_email} → ${d.delegate_name || d.delegate_email}` },
      details: { startDate: d.start_date, endDate: d.end_date },
    });
    return this.get(id);
  }
}

module.exports = new DelegationService();
