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

// Libellés français des tâches (même table que client/src/utils/taskLabels.js)
const TASK_LABELS = {
  Activity_ValidationN1_Manager: 'Approbation hiérarchique N1 (Manager)',
  Activity_ValidationN2_Finance: 'Approbation hiérarchique N2 (Finance)',
  Activity_ValidationN3_DG:      'Approbation hiérarchique N3 (Direction Générale)',
  Activity_BudgetAdjustment:     'Ajustement budgétaire',
  Activity_DetermineType:        'Déterminer la méthode d\'achat',
  Activity_DirectPurchase:       'Achat direct',
  Activity_RequestQuotations:    'Demande de devis multiples',
  Activity_RFPProcess:           'Appel d\'offres (RFP)',
  Activity_SoleSource:           'Justification source unique',
  Activity_CreatePO:             'Créer le bon de commande',
  Activity_POApproval:           'Approbation du bon de commande',
  Activity_SupplierConfirmation: 'Confirmation de commande fournisseur',
  Activity_GoodsReceipt:         'Bon de réception (GRN)',
  Activity_ServiceAcceptance:    'Acceptation de service (SAN)',
  Activity_EnterInvoice:         'Saisie de la facture fournisseur',
  Activity_ProcessPayment:       'Traitement du paiement',
};

// URL de l'application (servie par le backend) utilisée dans les liens des emails
const APP_URL = (process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

const logInfo = debug('task-listener:info');
const logError = debug('task-listener:error');
const logEvent = debug('task-listener:event');
const logDebug = debug('task-listener:debug');
const logSse = debug('task-listener:sse');

const BASE_URL = process.env.CAMUNDA_URL || 'http://localhost:8080';
const USERNAME = process.env.CAMUNDA_USERNAME || 'superuser@goflow.com';
const PASSWORD = process.env.CAMUNDA_PASSWORD || 'superUser123';
const PROCESS_KEY = process.env.PROCUREMENT_BPMN_PROCESS || '';

console.log(USERNAME, " ", PASSWORD);

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
  const title = `Nouvelle tâche: ${taskName}`;
  const message = `Une nouvelle tâche "${taskName}" est disponible pour le groupe ${candidateGroup}.`;

  for (const user of users) {
    await emitNotification(user.id, title, message, 'TASK_CREATED', link);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  logInfo('Notified %d user(s) in group %s', users.length, candidateGroup);
}

/**
 * Email aux utilisateurs actifs ayant le profil du candidateGroup ET membres du projet de la réquisition
 */
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
    if (!requisition) return;

    const recipients = await db.select(
      `SELECT DISTINCT u.email, u.first_name
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
    if (recipients.length === 0) {
      logInfo('No project member with profile %s for requisition %s, no email sent', candidateGroup, requisitionId);
      return;
    }

    const label = TASK_LABELS[taskDefinitionKey] || taskName;
    const link = `${APP_URL}/requisitions/${requisitionId}/tasks`;
    const amount = Number(requisition.estimated_amount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
    const subject = `[procureApp] Nouvelle tâche : ${label} — ${requisition.requisition_number}`;

    for (const recipient of recipients) {
      const html = `
        <div style="font-family: Arial, sans-serif; color: #1f2937; max-width: 600px;">
          <h2 style="color: #1d4ed8;">Nouvelle tâche à traiter</h2>
          <p>Bonjour ${recipient.first_name || ''},</p>
          <p>La tâche <strong>${label}</strong> est disponible pour votre groupe.</p>
          <table style="border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Réquisition</td><td><strong>${requisition.requisition_number}</strong></td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Objet</td><td>${requisition.title || '-'}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Projet</td><td>${requisition.project_code || ''} ${requisition.project_name || ''}</td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Montant</td><td>${amount} ${requisition.currency || ''}</td></tr>
          </table>
          <p><a href="${link}" style="background: #2563eb; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">Ouvrir la tâche</a></p>
          <p style="font-size: 12px; color: #9ca3af;">Message automatique — procureApp</p>
        </div>`;
      await EmailNotificationService.sendEmail(recipient.email, subject, html);
    }
    logInfo('Task email sent to %d user(s) of group %s', recipients.length, candidateGroup);
  } catch (err) {
    logError('Failed to send task emails: %s', err.message);
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
      task_definition_id: task.TaskDefinitionKey,
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

  const candidateGroup = task.candidateGroup;
  if (!candidateGroup) {
    logDebug('No candidate group for task %s, skipping notification', task.taskId);
    return;
  }

  const requisitionId = await getRequisitionIdForProcess(task.processInstanceId);
  if (!requisitionId) {
    logDebug('No requisitionId for task %s, skipping notification', task.taskId);
    return;
  }

  await notifyCandidateGroup(
    candidateGroup,
    task.taskId,
    task.taskName,
    task.processInstanceId,
    requisitionId,
    task.taskDefinitionKey
  );

  await emailCandidateGroup(candidateGroup, task.taskName, task.taskDefinitionKey, requisitionId);
}

async function handleTaskClaimed(task) {
  logEvent('Task claimed: %s (ID: %s) by %s', task.taskName, task.taskId, task.assignee || 'unknown');

  if (!task.assignee) return;

  const requisitionId = await getRequisitionIdForProcess(task.processInstanceId);
  await emitNotification(
    task.assignee,
    `Tâche réclamée: ${task.taskName}`,
    `Vous avez pris en charge la tâche "${task.taskName}".`,
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
module.exports = { startTaskListener: main };
