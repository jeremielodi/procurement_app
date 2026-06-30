// task_listener.js
const { EventSource } = require('eventsource');
require('dotenv').config();
const debug = require('debug');
const RequisitionModel = require('../models/RequisitionModel');
const UserModel = require('../models/UserModel');
const notificationService = require('../services/NotificationService');

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

async function getUsersByProfile(profileId) {
  try {
    const users = await UserModel.findAll({ profileId });
    logInfo('Found %d user(s) with profile %s', users.length, profileId);
    return users;
  } catch (error) {
    logError('Failed to get users by profile: %s', error.message);
    return [];
  }
}

async function notifyCandidateGroup(candidateGroup, taskId, taskName, processInstanceId, requisitionId, taskDefinitionKey) {
  const users = await getUsersByProfile(candidateGroup);
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

async function getRequisitionIdForProcess(processInstanceId) {
  if (!processInstanceId) return null;
  try {
    const requisitions = await RequisitionModel.findAll({ processInstanceId });
    return requisitions?.[0]?.id || null;
  } catch {
    return null;
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
