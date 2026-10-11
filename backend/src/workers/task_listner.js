// task_listener.js
const { EventSource } = require('eventsource');
require('dotenv').config();
const debug = require('debug');
const db = require('../config/database');
const tenant = require('../utils/tenant');
const RequisitionModel = require('../models/RequisitionModel');
const UserModel = require('../models/UserModel');
const notificationService = require('../services/NotificationService');
const EmailNotificationService = require('../services/EmailNotificationService');

// Libellés français et rôles (candidateGroups) des tâches : module partagé
const { TASK_LABELS, TASK_CANDIDATE_GROUPS, taskLabel, groupLabel } = require('../utils/workflowLabels');
const i18n = require('../i18n');

// URL de l'application (servie par le backend) utilisée dans les liens des emails
const { APP_URL } = require('../utils/appUrl');

const logInfo = debug('task-listener:info');
const logError = debug('task-listener:error');
const logEvent = debug('task-listener:event');
const logDebug = debug('task-listener:debug');
const logSse = debug('task-listener:sse');

const BASE_URL = process.env.CAMUNDA_URL || 'http://localhost:8080';
const USERNAME = process.env.CAMUNDA_USERNAME || 'superuser@goflow.com';
const PASSWORD = process.env.CAMUNDA_PASSWORD || 'superUser123';
const PROCESS_KEY = process.env.PROCUREMENT_BPMN_PROCESS || '';

const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

let eventSource = null;
let reconnectDelay = 5000;
const maxReconnectDelay = 60000;

// io is set once in main() and shared with all handlers
let _io = null;

const consoleLog = {
  info:      (msg, ...a) => console.log(`\x1b[36m${msg}\x1b[0m`, ...a),
  success:   (msg, ...a) => console.log(`\x1b[32m✅ ${msg}\x1b[0m`, ...a),
  error:     (msg, ...a) => console.log(`\x1b[31m❌ ${msg}\x1b[0m`, ...a),
  warn:      (msg, ...a) => console.log(`\x1b[33m⚠️ ${msg}\x1b[0m`, ...a),
  separator: ()          => console.log('\x1b[90m─\x1b[0m'.repeat(60))
};

function connectSSE() {
  let url = `${BASE_URL}/events/tasks`;
  if (PROCESS_KEY) url += `?processKeys=${PROCESS_KEY}`;

  logSse('Connecting to SSE URL: %s', url);
  consoleLog.info('\n📡 Connecting to SSE...');

  eventSource = new EventSource(url, {
    fetch: (input, init) => fetch(input, {
      ...init,
      headers: { ...init.headers, 'Authorization': `Basic ${basicAuth}` }
    })
  });

  eventSource.onopen = () => {
    logSse('SSE connection opened');
    consoleLog.success('SSE connection established');
    reconnectDelay = 5000;
  };

  eventSource.addEventListener('connected', (event) => {
    logEvent('Connected event received: %s', event.data);
  });

  eventSource.addEventListener('task', async (event) => {
    try {
      const data = JSON.parse(event.data);

      logEvent('Event received: %O', data);

      await logWorkflowHistory(data);

      if      (data.eventType === 'TASK_CREATED')   await handleTaskCreated(data);
      else if (data.eventType === 'TASK_CLAIMED')   await handleTaskClaimed(data);
      else if (data.eventType === 'TASK_UNCLAIMED') logEvent('Task unclaimed: %s (ID: %s)', data.taskName, data.taskId);
      else if (data.eventType === 'TASK_COMPLETED') await handleTaskCompleted(data);
      else if (data.eventType === 'TASK_FAILED')    await handleTaskFailed(data);
      else if (data.eventType === 'TASK_CANCELLED') await handleTaskCancelled(data);
    } catch (err) {
      logError('Failed to parse event: %s', err.message);
    }
  });

  eventSource.addEventListener('ping', () => {
    logDebug('Keep-alive ping received');
  });

  eventSource.onerror = (error) => {
    logError('SSE error: %s', error?.message || error);
    if (eventSource.readyState === 2) { // CLOSED
      eventSource.close();
      setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
        logDebug('Reconnecting in %d ms', reconnectDelay);
        connectSSE(); // _io is already set at module level
      }, reconnectDelay);
    }
  };
}

async function emitNotification(userId, title, message, type, link) {
  let _userId = userId;
  if(userId.indexOf('@') != -1) {
    const user = await UserModel.findByEmail(userId);
    if(user) {
      _userId = user.id;
    }
  }
  await notificationService.sendNotification(_userId, title, message, 'INFO', link);
  if (_io) {
    _io.to(`user-${_userId}`).emit('notification', {
      title, message, type, link,
      timestamp: new Date().toISOString()
    });
    logDebug('Socket notification sent to user %s: %s', userId, title);
  }
}

// Multi-entreprise : seuls les utilisateurs de l'entreprise de la réquisition sont notifiés
async function getUsersByProfile(profileId, requisitionId) {
  try {
    const row = requisitionId
      ? await db.one('SELECT enterprise_id FROM requisitions WHERE id = $1', [requisitionId])
      : null;
    const users = await tenant.run({ enterpriseId: row?.enterprise_id || null }, () => UserModel.findAll({ profileId }));
    logInfo('Found %d user(s) with profile %s', users.length, profileId);
    return users;
  } catch (error) {
    logError('Failed to get users by profile: %s', error.message);
    return [];
  }
}

async function notifyCandidateGroup(candidateGroup, taskId, taskName, processInstanceId, requisitionId, taskDefinitionKey) {
  const users = await getUsersByProfile(candidateGroup, requisitionId);
  if (users.length === 0) {
    logInfo('No users found for candidate group: %s', candidateGroup);
    return;
  }

  const link = requisitionId ? `/requisitions/${requisitionId}/tasks` : `/tasks/${taskId}`;

  // Notification dans la langue de chaque utilisateur
  for (const user of users) {
    const T = i18n.translator(user.language);
    const task = taskDefinitionKey ? taskLabel(taskDefinitionKey, user.language) : taskName;
    const group = (taskDefinitionKey && groupLabel(taskDefinitionKey, user.language)) || candidateGroup;
    const title = T('notification.task.title', { task });
    const message = T('notification.task.message', { task, group });
    await emitNotification(user.id, title, message, 'TASK_CREATED', link);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  logInfo('Notified %d user(s) in group %s', users.length, candidateGroup);
}

/**
 * Email aux utilisateurs actifs ayant le profil du candidateGroup ET membres du projet de la réquisition
 */
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Utilisateurs actifs ayant le profil du groupe, membres du projet de la réquisition, de la même entreprise */
async function getTaskEmailRecipients(candidateGroup, requisitionId) {
  return db.select(
    `SELECT DISTINCT u.email, u.first_name, u.language
     FROM users u
     JOIN user_profiles up ON up.user_id = u.id
     JOIN project_members pm ON pm.user_id = u.id
     JOIN requisitions r ON r.project_id = pm.project_id
     WHERE r.id = $1
       AND up.profile_id IN ($2, $3)
       AND u.is_active = true
       AND u.enterprise_id = r.enterprise_id
       AND u.email IS NOT NULL`,
    [requisitionId, candidateGroup, `prof_${candidateGroup}`]
  );
}

async function emailCandidateGroup(candidateGroup, taskName, taskDefinitionKey, requisitionId) {
  try {
    const requisition = await db.one(
      `SELECT r.requisition_number, r.title, r.estimated_amount, c.format_key AS currency,
              p.code AS project_code, p.name AS project_name
       FROM requisitions r
       LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN currency c ON c.id = r.currency_id
       WHERE r.id = $1`,
      [requisitionId]
    );
    if (!requisition) return { sent: 0, failed: 0, recipients: [] };

    const recipients = await getTaskEmailRecipients(candidateGroup, requisitionId);
    if (recipients.length === 0) {
      consoleLog.warn(`Tâche « ${TASK_LABELS[taskDefinitionKey] || taskName} » (${requisition.requisition_number}) : aucun membre du projet avec le profil ${candidateGroup} — aucun email envoyé`);
      return { sent: 0, failed: 0, recipients: [] };
    }

    const label = TASK_LABELS[taskDefinitionKey] || taskName;
    const link = `${APP_URL}/requisitions/${requisitionId}/tasks`;
    let sent = 0;
    let failed = 0;

    // Email dans la langue de chaque destinataire (email.task.* des locales)
    for (const recipient of recipients) {
      const lang = recipient.language;
      const T = i18n.translator(lang);
      const task = taskDefinitionKey ? taskLabel(taskDefinitionKey, lang) : taskName;
      const amount = Number(requisition.estimated_amount || 0).toLocaleString(i18n.locale(lang), { minimumFractionDigits: 2 });
      const subject = T('email.task.subject', { task, number: requisition.requisition_number });
      const html = `
        <div style="font-family: Arial, sans-serif; color: #1f2937; max-width: 600px;">
          <h2 style="color: #1d4ed8;">${T('email.task.title')}</h2>
          <p>${T('email.hello', { name: escapeHtml(recipient.first_name) })}</p>
          <p>${T('email.task.body', { task: escapeHtml(task) })}</p>
          <table style="border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">${T('email.task.requisition')}</td><td><strong>${escapeHtml(requisition.requisition_number)}</strong></td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">${T('email.task.object')}</td><td>${escapeHtml(requisition.title || '-')}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">${T('email.task.project')}</td><td>${escapeHtml(requisition.project_code)} ${escapeHtml(requisition.project_name)}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">${T('email.task.amount')}</td><td>${amount} ${requisition.currency || ''}</td></tr>
          </table>
          <p><a href="${link}" style="background: #2563eb; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">${T('email.task.open')}</a></p>
          <p style="font-size: 12px; color: #9ca3af;">${T('email.footer')}</p>
        </div>`;
      const result = await EmailNotificationService.sendEmail(recipient.email, subject, html);
      if (result?.success) sent++; else failed++;
    }
    consoleLog.info(`📧 Tâche « ${label} » (${requisition.requisition_number}) : ${sent} email(s) envoyé(s)${failed ? `, ${failed} échec(s)` : ''} au groupe ${candidateGroup}`);
    return { sent, failed, recipients: recipients.map(r => r.email) };
  } catch (err) {
    consoleLog.error(`Envoi des emails de tâche impossible : ${err.message}`);
    return { sent: 0, failed: 0, error: err.message };
  }
}

async function getRequisitionIdForProcess(processInstanceId) {
  if (!processInstanceId) return null;
  try {
    const requisitions = await RequisitionModel.findAll({ processInstanceId });
    return requisitions?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function logWorkflowHistory(task) {
  try {
    const requisitionId = await getRequisitionIdForProcess(task.processInstanceId);
    if (!requisitionId) {
      logDebug('No requisitionId for task %s, skipping workflow_history log', task.taskId);
      return;
    }

    let performedBy = null;
    if (task.assignee) {
      const user = await UserModel.findByEmail(task.assignee);
      if (user) performedBy = user.id;
    }

    await db.insert('workflow_history', {
      process_instance_id: task.processInstanceId,
      entity_type: 'requisition',
      entity_id: requisitionId,
      task_id: task.taskId,
      task_definition_id: task.taskDefinitionKey || task.TaskDefinitionKey,
      task_name: task.taskName,
      action: task.eventType,
      comments: task.variables ? JSON.stringify(task.variables) : null,
      performed_by: performedBy,
      performed_at: task.timestamp ? new Date(task.timestamp) : new Date()
    });
    logDebug('Workflow history logged: %s (%s)', task.taskId, task.eventType);
  } catch (err) {
    logError('Failed to log workflow history: %s', err.message);
  }
}

async function handleTaskCreated(task) {
  logEvent('Task created: %s (ID: %s)', task.taskName, task.taskId);

  // GoFlow peut envoyer la clé avec ou sans majuscule ; rôle déduit du BPMN si absent de l'événement
  const taskDefinitionKey = task.taskDefinitionKey || task.TaskDefinitionKey;
  const candidateGroup = task.candidateGroup || TASK_CANDIDATE_GROUPS[taskDefinitionKey];
  if (!candidateGroup) {
    consoleLog.warn(`Tâche ${task.taskName} (${task.taskId}) sans groupe : aucune notification ni email`);
    return;
  }

  const requisitionId = await getRequisitionIdForProcess(task.processInstanceId);
  if (!requisitionId) {
    logDebug('No requisitionId for task %s, skipping notification', task.taskId);
    return;
  }

  // Notifications in-app et emails indépendants : l'échec de l'un n'empêche pas l'autre
  try {
    await notifyCandidateGroup(candidateGroup, task.taskId, task.taskName, task.processInstanceId, requisitionId, taskDefinitionKey);
  } catch (err) {
    consoleLog.error(`Notifications de la tâche ${task.taskId} impossibles : ${err.message}`);
  }
  return emailCandidateGroup(candidateGroup, task.taskName, taskDefinitionKey, requisitionId);
}

async function handleTaskClaimed(task) {
  logEvent('Task claimed: %s (ID: %s) by %s', task.taskName, task.taskId, task.assignee || 'unknown');

  if (!task.assignee) return;

  const requisitionId = await getRequisitionIdForProcess(task.processInstanceId);
  // Dans la langue de l'utilisateur qui a pris la tâche
  const assignee = task.assignee.includes('@') ? await UserModel.findByEmail(task.assignee) : null;
  const T = i18n.translator(assignee?.language);
  const key = task.taskDefinitionKey || task.TaskDefinitionKey;
  const label = key ? taskLabel(key, assignee?.language) : task.taskName;
  await emitNotification(
    task.assignee,
    T('notification.task.claimedTitle', { task: label }),
    T('notification.task.claimedMessage', { task: label }),
    'INFO',
    requisitionId ? `/requisitions/${requisitionId}/tasks` : `/tasks/${task.taskId}`
  );
}

async function handleTaskCompleted(task) {
  logEvent('Task completed: %s (ID: %s)', task.taskName, task.taskId);
}

async function handleTaskFailed(task) {
  logEvent('Task failed: %s (ID: %s)', task.taskName, task.taskId);
}

async function handleTaskCancelled(task) {
  logEvent('Task cancelled: %s (ID: %s)', task.taskName, task.taskId);
}

async function testConnection() {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      headers: { 'Authorization': `Basic ${basicAuth}` }
    });
    return response.ok;
  } catch (error) {
    logError('Server connection check failed: %s', error.message);
    return false;
  }
}

async function main(io) {
  _io = io; // store for use in reconnect and all handlers

  consoleLog.separator();
  consoleLog.info('🎧 TASK EVENT LISTENER');
  consoleLog.separator();
  console.log(`📍 Server: ${BASE_URL}`);
  console.log(`👤 User: ${USERNAME}`);
  console.log(`🔍 Process key: ${PROCESS_KEY || 'all'}`);
  consoleLog.separator();

  const isReachable = await testConnection();
  if (!isReachable) {
    consoleLog.warn('Camunda not reachable — SSE connection will retry automatically');
  }

  connectSSE();
}

process.on('SIGINT', () => {
  if (eventSource) eventSource.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (eventSource) eventSource.close();
  process.exit(0);
});

// Exported for server.js: startTaskListener(io)
// Do NOT call main() here — it must be called with io from server.js
module.exports = { startTaskListener: main, handleTaskCreated, getTaskEmailRecipients };
