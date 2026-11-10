// backend/src/services/ProcurementAgentService.js
// Agent achats de la réquisition (migration 58) : choisi par le chef de projet en approuvant la réquisition, parmi les
// utilisateurs actifs ayant le profil Achats sur son projet (fonction SQL user_can_be_procurement_agent). Les étapes
// achats de la réquisition (groupe BpmnGo « procurement ») et les routes du bon de commande / de l'appel d'offres lui
// sont réservées — l'administrateur garde la main. Remplaçable par le chef de projet (ou son intérimaire) et
// l'administrateur tant que la réquisition est en cours.
const db = require('../config/database');
const i18n = require('../i18n');
const camundaService = require('./CamundaService');
const notificationModel = require('../models/NotificationModel');
const userModel = require('../models/UserModel');
const { audit, AUDIT } = require('../utils/auditLog');
const EmailNotificationService = require('./EmailNotificationService');
const { appLink } = require('../utils/appUrl');

const PROCUREMENT_GROUP = 'procurement';
// Réquisition terminée ou arrêtée : l'agent n'est plus modifiable
const CLOSED_STATUSES = ['DRAFT', 'REJECTED', 'CANCELLED', 'COMPLETED'];

const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });
const NAME = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
const NAME_SQL = (a) => `TRIM(COALESCE(${a}.first_name, '') || ' ' || COALESCE(${a}.last_name, ''))`;

/** Étape d'un groupe réservé à l'agent achats */
const isProcurementTask = (task) => String(task?.candidateGroup || '').replace(/^prof_/, '') === PROCUREMENT_GROUP;

/** Agent désigné peut traiter : pas d'agent, l'agent lui-même, ou l'administrateur */
const allowed = (agentId, user) => !agentId || user.isAdmin || String(agentId) === String(user.id);

async function isAdmin(userId) {
  const row = await db.one(`SELECT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = $1 AND profile_id = 'prof_admin') AS ok`, [userId]);
  return !!row?.ok;
}

/** Utilisateurs pouvant être désignés agent achats de la réquisition */
async function candidates(requisitionId) {
  return db.select(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.position, u.avatar_updated_at
     FROM requisitions r JOIN users u ON u.enterprise_id = r.enterprise_id AND u.is_active = true
     WHERE r.id = $1 AND user_can_be_procurement_agent(u.id, r.id)
     ORDER BY u.first_name, u.last_name`,
    [requisitionId]
  );
}

/** Contrôle du choix → utilisateur { id, email, name } ; 400 PROCUREMENT_AGENT_REQUIRED / PROCUREMENT_AGENT_INVALID */
async function checkCandidate(requisitionId, agentId, q = db) {
  if (!agentId) throw fail(400, 'PROCUREMENT_AGENT_REQUIRED', "Choisissez l'agent achats qui traitera la réquisition");
  let row = null;
  try {
    row = await q.one(
      `SELECT u.id, u.email, ${NAME_SQL('u')} AS name, user_can_be_procurement_agent(u.id, $1) AS ok
       FROM users u WHERE u.id = $2`,
      [requisitionId, agentId]
    );
  } catch (_) { /* identifiant mal formé */ }
  if (!row?.ok) {
    throw fail(400, 'PROCUREMENT_AGENT_INVALID', "Cet utilisateur n'a pas le profil Achats sur le projet de la réquisition (ou son compte est désactivé)");
  }
  return { id: row.id, email: row.email, name: row.name || row.email };
}

async function agentOf(requisitionId) {
  if (!requisitionId) return null;
  return (await db.one('SELECT procurement_agent_id FROM requisitions WHERE id = $1', [requisitionId]))?.procurement_agent_id || null;
}

/** Enregistre l'agent (avant de terminer la validation : la notification de l'étape suivante lui est réservée) → ancien agent */
async function assign(requisitionId, agentId, userId) {
  const before = await agentOf(requisitionId);
  await db.exec(
    `UPDATE requisitions SET procurement_agent_id = $2, procurement_agent_assigned_at = CURRENT_TIMESTAMP,
            procurement_agent_assigned_by = $3 WHERE id = $1`,
    [requisitionId, agentId, userId]
  );
  return before;
}

/** Remet l'agent d'avant (validation refusée par BpmnGo) */
async function restore(requisitionId, previousAgentId) {
  await db.exec('UPDATE requisitions SET procurement_agent_id = $2 WHERE id = $1', [requisitionId, previousAgentId || null]);
}

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Agent désigné (ou remplaçant) prévenu dans sa langue : notification in-app + temps réel (socket) ET email
 * (notification.procurementAgent.*, email.procurementAgent.*). Chaque canal est indépendant ; n'interrompt jamais la
 * requête. → { notified, emailed }
 */
async function notifyAgent(req, requisitionId, agentId, key = 'assigned') {
  const sent = { notified: false, emailed: false };
  if (!agentId || String(agentId) === String(req.user?.id)) return sent;
  let r = null;
  let user = null;
  try {
    r = await db.one(
      `SELECT r.requisition_number, r.title, r.estimated_amount, c.format_key AS currency,
              p.code AS project_code, p.name AS project_name, ${NAME_SQL('u')} AS by_name
       FROM requisitions r LEFT JOIN users u ON u.id = $2
       LEFT JOIN projects p ON p.id = r.project_id LEFT JOIN currency c ON c.id = r.currency_id
       WHERE r.id = $1`,
      [requisitionId, req.user?.id || null]
    );
    user = await userModel.findById(agentId);
  } catch (error) {
    console.error('Notification agent achats :', error.message);
    return sent;
  }
  const lang = user?.language;
  const T = i18n.translator(lang);
  const vars = { number: r?.requisition_number, title: r?.title || '', name: r?.by_name || '' };
  const path = `/requisitions/${requisitionId}/tasks`;

  try {
    const title = T(`notification.procurementAgent.${key}Title`, vars);
    const message = T(`notification.procurementAgent.${key}Message`, vars);
    await notificationModel.create({ userId: agentId, title, message, type: 'INFO', link: path });
    req.io?.to(`user-${agentId}`).emit('notification', { title, message, type: 'INFO', link: path, timestamp: new Date().toISOString() });
    sent.notified = true;
  } catch (error) {
    console.error('Notification agent achats :', error.message);
  }

  if (user?.email) {
    try {
      const esc = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapeHtml(v)]));
      const amount = Number(r?.estimated_amount || 0).toLocaleString(i18n.locale(lang), { minimumFractionDigits: 2 });
      const row = (label, value) => `<tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">${label}</td><td>${value}</td></tr>`;
      const html = `
        <div style="font-family: Arial, sans-serif; color: #1f2937; max-width: 600px;">
          <h2 style="color: #1d4ed8;">${T('email.procurementAgent.title')}</h2>
          <p>${T('email.hello', { name: escapeHtml(user.first_name) })}</p>
          <p>${T(`email.procurementAgent.${key}Body`, esc)}</p>
          <table style="border-collapse: collapse; margin: 16px 0;">
            ${row(T('email.task.requisition'), `<strong>${esc.number}</strong>`)}
            ${row(T('email.task.object'), esc.title || '-')}
            ${row(T('email.task.project'), `${escapeHtml(r?.project_code)} ${escapeHtml(r?.project_name)}`)}
            ${row(T('email.task.amount'), `${amount} ${escapeHtml(r?.currency || '')}`)}
          </table>
          <p><a href="${appLink(path)}" style="background: #2563eb; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">${T('email.procurementAgent.open')}</a></p>
          <p style="font-size: 12px; color: #9ca3af;">${T('email.footer')}</p>
        </div>`;
      const result = await EmailNotificationService.sendEmail(user.email, T('email.procurementAgent.subject', vars), html);
      sent.emailed = !!result?.success;
      if (!sent.emailed) console.error('Email agent achats non envoyé :', result?.error || 'échec SMTP');
    } catch (error) {
      console.error('Email agent achats :', error.message);
    }
  }
  return sent;
}

async function load(requisitionId) {
  return db.one(
    `SELECT r.id, r.requisition_number, r.status, r.project_id, r.process_instance_id, r.procurement_agent_id,
            r.procurement_agent_assigned_at, r.procurement_agent_assigned_by
     FROM requisitions r WHERE r.id = $1`,
    [requisitionId]
  );
}

/** Le chef du projet (ou son intérimaire du jour) ou l'administrateur, réquisition en cours avec un agent */
async function canChange(requisition, userId) {
  if (!requisition?.procurement_agent_id || CLOSED_STATUSES.includes(requisition.status)) return false;
  if (await isAdmin(userId)) return true;
  if (!requisition.project_id) return false;
  const row = await db.one('SELECT user_manages_project($1, $2) AS ok', [userId, requisition.project_id]);
  return !!row?.ok;
}

async function person(userId) {
  if (!userId) return null;
  return db.one(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.position, u.is_active, u.avatar_updated_at FROM users u WHERE u.id = $1`,
    [userId]
  );
}

/** GET /requisitions/:id/procurement-agent → { agent, eligible, assignedAt, assignedBy, canChange, candidates } */
async function state(requisitionId, userId) {
  const r = await load(requisitionId);
  if (!r) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
  const [agent, assignedBy, change, eligible] = await Promise.all([
    person(r.procurement_agent_id),
    person(r.procurement_agent_assigned_by),
    canChange(r, userId),
    r.procurement_agent_id
      ? db.one('SELECT user_can_be_procurement_agent($1, $2) AS ok', [r.procurement_agent_id, r.id]).then(x => !!x?.ok)
      : false,
  ]);
  // Candidats : pour le chef de projet qui valide (fenêtre d'approbation) et pour un remplacement
  const pmOrAdmin = change || await isAdmin(userId)
    || (r.project_id && !!(await db.one('SELECT user_manages_project($1, $2) AS ok', [userId, r.project_id]))?.ok);
  return {
    agent,
    eligible,
    assignedAt: r.procurement_agent_assigned_at,
    assignedBy,
    canChange: change,
    candidates: pmOrAdmin ? await candidates(r.id) : [],
  };
}

/**
 * Libère les étapes achats ouvertes prises en charge par quelqu'un d'autre que le nouvel agent (sinon elles resteraient
 * bloquées chez l'ancien agent). N'interrompt jamais le changement.
 */
async function releaseOpenTasks(processInstanceId, agentEmail) {
  if (!processInstanceId) return 0;
  let released = 0;
  try {
    const tasks = (await camundaService.getProcessTasks(processInstanceId)) || [];
    for (const task of tasks.filter(t => isProcurementTask(t) && t.status !== 'completed' && t.assignee && t.assignee !== agentEmail)) {
      const result = await camundaService.unassignTask(task.id);
      if (result?.success) released++;
    }
  } catch (error) {
    console.error('Libération des étapes achats :', error.message);
  }
  return released;
}

/** PUT /requisitions/:id/procurement-agent { agentId } — remplacement par le chef de projet ou l'administrateur */
async function change(req, requisitionId, agentId) {
  const r = await load(requisitionId);
  if (!r) throw fail(404, 'NOT_FOUND', 'Réquisition introuvable');
  if (!r.procurement_agent_id || CLOSED_STATUSES.includes(r.status)) {
    throw fail(409, 'PROCUREMENT_AGENT_LOCKED', "L'agent achats ne peut être changé que sur une réquisition approuvée et en cours");
  }
  if (!(await canChange(r, req.user.id))) {
    throw fail(403, 'NOT_ALLOWED', "Seuls le chef du projet et l'administrateur peuvent changer l'agent achats");
  }
  const agent = await checkCandidate(r.id, agentId);
  if (String(agent.id) === String(r.procurement_agent_id)) return { changed: false, released: 0 };
  const before = await person(r.procurement_agent_id);
  await assign(r.id, agent.id, req.user.id);
  await db.insert('workflow_history', {
    entity_type: 'requisition', entity_id: r.id, process_instance_id: r.process_instance_id,
    action: 'PROCUREMENT_AGENT_CHANGED',
    comments: JSON.stringify({ from: before ? NAME(before) : null, to: agent.name }),
    performed_by: req.user.id, performed_at: new Date(),
  });
  const released = await releaseOpenTasks(r.process_instance_id, agent.email);
  await audit(req, AUDIT.PROCUREMENT_AGENT_CHANGED, {
    entity: { type: 'requisition', id: r.id, label: r.requisition_number },
    oldValue: { procurementAgent: before ? `${NAME(before)} <${before.email}>` : null },
    details: { procurementAgent: `${agent.name} <${agent.email}>`, releasedTasks: released },
  });
  await notifyAgent(req, r.id, agent.id, 'changed');
  return { changed: true, released };
}

/**
 * Middleware de route : document d'une réquisition dont l'agent achats est désigné → lui seul (ou l'administrateur).
 * kind : requisition | purchaseOrder | tender ; identifiant absent ou introuvable : laisse passer (le contrôleur répond).
 */
const REQUISITION_OF = {
  requisition: 'SELECT id, procurement_agent_id, requisition_number FROM requisitions WHERE id = $1',
  purchaseOrder: `SELECT r.id, r.procurement_agent_id, r.requisition_number FROM purchase_orders po
                  JOIN requisitions r ON r.id = po.requisition_id WHERE po.id = $1`,
  tender: `SELECT r.id, r.procurement_agent_id, r.requisition_number FROM tenders t
           JOIN requisitions r ON r.id = t.requisition_id WHERE t.id = $1`,
};

function requireProcurementAgent(kind, pick) {
  return async (req, res, next) => {
    try {
      const id = pick(req);
      if (id == null || id === '') return next();
      let r = null;
      try { r = await db.one(REQUISITION_OF[kind], [id]); } catch (_) { return next(); }
      if (!r?.procurement_agent_id || String(r.procurement_agent_id) === String(req.user.id) || await isAdmin(req.user.id)) return next();
      await audit(req, AUDIT.TASK_COMPLETION_DENIED, {
        entity: { type: 'requisition', id: r.id, label: r.requisition_number },
        details: { reason: 'NOT_PROCUREMENT_AGENT', document: kind, documentId: id, route: `${req.method} ${req.baseUrl}${req.route?.path || ''}` },
      });
      const agent = await person(r.procurement_agent_id);
      return res.status(403).json({
        success: false, code: 'NOT_PROCUREMENT_AGENT',
        message: `Cette réquisition est traitée par l'agent achats désigné${agent ? ` (${NAME(agent)})` : ''}`,
        details: { agent: agent ? NAME(agent) : null },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  };
}

module.exports = {
  PROCUREMENT_GROUP, isProcurementTask, allowed, candidates, checkCandidate, agentOf, assign, restore, notifyAgent,
  state, change, requireProcurementAgent,
};
