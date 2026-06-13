// task_listener.js
const { EventSource } = require('eventsource');
require('dotenv').config();
const debug = require('debug');
const RequisitionModel = require('../models/RequisitionModel');
const UserModel = require('../models/UserModel');
const notificationService = require('../services/NotificationService');
// Create debug loggers with different namespaces
const logInfo = debug('task-listener:info');
const logError = debug('task-listener:error');
const logEvent = debug('task-listener:event');
const logDebug = debug('task-listener:debug');
const logSse = debug('task-listener:sse');


const BASE_URL = process.env.CAMUNDA_URL || 'http://localhost:8080';
const USERNAME = process.env.CAMUNDA_USERNAME || 'superuser@goflow.com';
const PASSWORD = process.env.CAMUNDA_PASSWORD || 'superUser123';
const PROCESS_KEY = process.env.PROCUREMENT_BPMN_PROCESS || '';

// Create Basic Auth header
const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

let eventSource = null;
let reconnectDelay = 5000;
const maxReconnectDelay = 60000;

// Custom console logger for important messages (always visible)
const consoleLog = {
    info: (msg, ...args) => console.log(`\x1b[36m${msg}\x1b[0m`, ...args),
    success: (msg, ...args) => console.log(`\x1b[32m✅ ${msg}\x1b[0m`, ...args),
    error: (msg, ...args) => console.log(`\x1b[31m❌ ${msg}\x1b[0m`, ...args),
    warn: (msg, ...args) => console.log(`\x1b[33m⚠️ ${msg}\x1b[0m`, ...args),
    event: (msg, ...args) => console.log(`\x1b[35m📨 ${msg}\x1b[0m`, ...args),
    separator: () => console.log('\x1b[90m─\x1b[0m'.repeat(60))
};

function connectSSE(io) {
    let url = `${BASE_URL}/events/tasks`;

    // Add process key filter if provided
    if (PROCESS_KEY) {
        url += `?processKeys=${PROCESS_KEY}`;
        logInfo('Filtering by process key: %s', PROCESS_KEY);
    }

    logSse('Connecting to SSE URL: %s', url);
    consoleLog.info('\n📡 Connecting to SSE...');
    logDebug('URL: %s', url);
    logDebug('Auth: Basic %s:******', USERNAME);

    eventSource = new EventSource(url, {
        fetch: (input, init) => {
            return fetch(input, {
                ...init,
                headers: {
                    ...init.headers,
                    'Authorization': `Basic ${basicAuth}`
                }
            });
        }
    });

    eventSource.onopen = () => {
        logSse('SSE connection opened');
        consoleLog.success('SSE connection established');
        consoleLog.info('👂 Listening for task events...\n');
        consoleLog.separator();
        reconnectDelay = 5000;
    };

    eventSource.addEventListener('connected', (event) => {
        logEvent('Connected event received: %s', event.data);
        consoleLog.success(`Connected with ID: ${event.data}`);
    });

    eventSource.addEventListener('task', async (event) => {
        try {
            const data = JSON.parse(event.data);
            logEvent('Event received: %O', data);

            // Vérifier si c'est un événement de tâche
            if (data.eventType === 'TASK_CREATED') {
                await handleTaskCreated(data, io);
            } else if (data.eventType === 'TASK_CLAIMED') {
                await handleTaskClaimed(data);
            } else if (data.eventType === 'TASK_COMPLETED') {
                await handleTaskCompleted(data);
            } else if (data.eventType === 'TASK_FAILED') {
                await handleTaskFailed(data);
            } else if (data.eventType === 'TASK_CANCELLED') {
                await handleTaskCancelled(data);
            }
        } catch (err) {
            logError('Failed to parse event: %s', err.message);
            logError('Raw event data: %s', event.data);
        }
    });

    eventSource.addEventListener('ping', (event) => {
        logDebug('Keep-alive ping received: %s', event.data);
    });

    eventSource.onerror = (error) => {
        logError('SSE error: %s', error.message || error);
        logError('EventSource readyState: %d', eventSource.readyState);

        if (eventSource.readyState === 2) { // CLOSED
            eventSource.close();
            setTimeout(() => {
                reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
                logDebug('Reconnecting with delay: %d ms', reconnectDelay);
                connectSSE();
            }, reconnectDelay);
        }
    };
}


/**
 * Traiter un événement de tâche créée
 */
async function handleTaskCreated(task, io) {
    logEvent(`✨ Tâche créée: ${task.taskName} (ID: ${task.taskId})`);
    logDebug(`Task details: %O`, task);

    // Vérifier si la tâche a un groupe candidat
    let candidateGroup = task.candidateGroup;

    if (candidateGroup) {
        // Essayer de récupérer l'ID de réquisition
        let requisitionId = null;
        if (task.processInstanceId) {
            const requisitions = await RequisitionModel.findAll({ processInstanceId: task.processInstanceId });
            if (requisitions && requisitions.length > 0) {
                requisitionId = requisitions[0].id;
            }
        }

        if (requisitionId) {
            // Notifier le groupe candidat
            await notifyCandidateGroup(
                io,
                candidateGroup,
                task.taskId,
                task.taskName,
                task.processInstanceId,
                requisitionId,
                task.taskDefinitionKey
            );
        } else {
            logDebug(`No requisitionId for task ${task.taskId}, skipping notification`);
        }
    } else {
        logDebug(`No candidate group for task ${task.taskId}, skipping notification`);
    }
}



/**
 * Traiter un événement de tâche réclamée
 */
async function handleTaskClaimed(task) {
    logEvent(`👤 Tâche réclamée: ${task.taskName} (ID: ${task.taskId}) par ${task.assignee || 'inconnu'}`);

    // Notifier l'assignataire qu'il a réclamé la tâche
    if (task.assignee && task.assignee.includes('@')) {
        let requisitionId = null;
        if (task.processInstanceId) {
            const requisitions = await RequisitionModel.findAll({ processInstanceId: task.processInstanceId });
            if (requisitions && requisitions.length > 0) {
                requisitionId = requisitions[0].id;
            }
        }
        await notifyUser(task.assignee, task.taskName, task.taskId, requisitionId);
    }
}

/**
 * Traiter un événement de tâche complétée
 */
async function handleTaskCompleted(task) {
    logEvent(`✅ Tâche complétée: ${task.taskName} (ID: ${task.taskId})`);
}

/**
 * Traiter un événement de tâche échouée
 */
async function handleTaskFailed(task) {
    logEvent(`❌ Tâche échouée: ${task.taskName} (ID: ${task.taskId})`);
}

/**
 * Traiter un événement de tâche annulée
 */
async function handleTaskCancelled(task) {
    logEvent(`🗑️ Tâche annulée: ${task.taskName} (ID: ${task.taskId})`);
}


/**
  * Émettre une notification via Socket.IO
  */
async function emitNotification(io, userId, title, message, type, link) {
    await notificationService.sendNotification(userId, title,message,"INFO",link,);
    if (io) {
        io.to(`user-${userId}`).emit('notification', {
            title,
            message,
            type,
            link,
            timestamp: new Date().toISOString()
        });
        console.log(`🔔 [Socket] Notification sent to user ${userId}: ${title}`);
    }
}
/**
 * Récupérer les utilisateurs par profil BPMN via UserModel
 */
async function getUsersByProfile(profileId) {
    try {
        logDebug(`Searching users with profile: ${profileId}`);
        // Utiliser UserModel.findAll avec le filtre profileId
        const users = await UserModel.findAll({ profileId });

        logInfo(`Found ${users.length} user(s) with profile ${profileId}`);
        return users;
    } catch (error) {
        logError(`Failed to get users by profile: ${error.message}`);
        return [];
    }
}
/**
 * Notifier tous les utilisateurs d'un groupe candidat
 */
async function notifyCandidateGroup(io, candidateGroup, taskId, taskName, processInstanceId, requisitionId = null, taskDefinitionKey = null) {


    const groupLabel = candidateGroup;
    logInfo(`📢 Notifying candidate group: ${groupLabel} (${candidateGroup})`);

    // Récupérer les utilisateurs du groupe
    const users = await getUsersByProfile(candidateGroup);

    if (users.length === 0) {
        logInfo(`No users found for candidate group: ${candidateGroup}`);
        return;
    }

    // Construire le lien en fonction du type de tâche
    let link = `/tasks/${taskId}`;
    if (requisitionId) {
        link = `/requisitions/${requisitionId}/tasks`;
    }

    // Construire le message de notification
    const title = `📋 Nouvelle tâche: ${taskName}`;
    const message = `Une nouvelle tâche "${taskName}" est disponible pour le groupe ${groupLabel}. Veuillez la prendre en charge.`;

    // Envoyer les notifications à tous les utilisateurs du groupe
    let sentCount = 0;
    for (const user of users) {
        await emitNotification(io, user.id, title, message, 'TASK_CREATED', link);
        logDebug(`Notification sent to user ${user.email} (${user.id})`);
        sentCount++;
        // Petit délai pour ne pas surcharger le serveur
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    logInfo(`✅ Notified ${sentCount} user(s) in group ${candidateGroup}`);
}



/**
 * Envoyer une notification à un utilisateur via l'API backend
 */
async function sendNotification(userId, title, message, type, link) {
    try {
        logDebug(`Sending notification to user ${userId}: ${title}`);

        const response = await axios.post(`${BACKEND_URL}/api/notifications`, {
            userId,
            title,
            message,
            type: type || 'TASK_CREATED',
            link
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data.success) {
            logDebug(`Notification sent successfully to user ${userId}`);
        }
        return response.data;
    } catch (error) {
        logError(`Failed to send notification to user ${userId}: ${error.message}`);
        return null;
    }
}

async function testConnection() {
    try {
        logDebug('Testing server connection to %s/health', BASE_URL);

        const response = await fetch(`${BASE_URL}/health`, {
            headers: { 'Authorization': `Basic ${basicAuth}` }
        });

        logDebug('Health check response: %d %s', response.status, response.statusText);
        return response.ok;
    } catch (error) {
        logError('Server connection failed: %s', error.message);
        return false;
    }
}

async function main(io) {
    consoleLog.separator();
    consoleLog.info('🎧 TASK EVENT LISTENER');
    consoleLog.separator();
    console.log(`📍 Server: ${BASE_URL}`);
    console.log(`👤 User: ${USERNAME}`);
    console.log(`📦 Node.js: ${process.version}`);
    if (PROCESS_KEY) {
        console.log(`🔍 Filtering by process key: ${PROCESS_KEY}`);
    } else {
        console.log(`🔍 Listening to all process keys`);
    }
    consoleLog.separator();

    // Test connection first
    const isReachable = await testConnection();
    if (!isReachable) {
        consoleLog.error('\nServer not reachable. Please check:');
        console.log('   1. GoFlow server is running on port 8080');
        console.log('   2. CAMUNDA_URL environment variable is correct');
        console.log('   3. Network connectivity');
        process.exit(1);
    }

    // Connect to SSE
    connectSSE(io);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    consoleLog.warn('\n\nShutting down...');
    logInfo('SIGINT received, closing connection');
    if (eventSource) {
        eventSource.close();
        consoleLog.success('SSE connection closed');
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    consoleLog.warn('\n\nShutting down...');
    logInfo('SIGTERM received, closing connection');
    if (eventSource) {
        eventSource.close();
        consoleLog.success('SSE connection closed');
    }
    process.exit(0);
});


// Run
main().catch((error) => {
    logError('Fatal error: %s', error.message);
    consoleLog.error(`Fatal error: ${error.message}`);
    process.exit(1);
});

module.exports = { startTaskListener: main };