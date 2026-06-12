// task_listener.js
const { EventSource } = require('eventsource');

const BASE_URL = process.env.CAMUNDA_URL || 'http://localhost:8080';
const USERNAME = process.env.CAMUNDA_USERNAME || 'superuser@goflow.com';
const PASSWORD = process.env.CAMUNDA_PASSWORD || 'superUser123';

// Create Basic Auth header
const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

let eventSource = null;
let reconnectDelay = 5000;
const maxReconnectDelay = 60000;

function connectSSE() {
    const url = `${BASE_URL}/events/tasks?clientId=task-listener&processKeys=${process.env.PROCUREMENT_BPMN_PROCESS}`;
    
    console.log(`\n📡 Connecting to SSE...`);
    console.log(`   URL: ${BASE_URL}/events/tasks`);
    console.log(`   Auth: Basic ${USERNAME}:******`);

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
        console.log('\n✅ SSE connection established');
        console.log('👂 Listening for task events...\n');
        console.log('─'.repeat(60));
        reconnectDelay = 5000; // Reset delay on successful connection
    };

    eventSource.addEventListener('connected', (event) => {
        console.log(`✅ Connected with ID: ${event.data}`);
    });

    eventSource.addEventListener('task', (event) => {
        try {
            const task = JSON.parse(event.data);
            
            const eventEmoji = {
                'TASK_CREATED': '✨',
                'TASK_CLAIMED': '👤',
                'TASK_COMPLETED': '✅',
                'TASK_FAILED': '❌',
                'TASK_CANCELLED': '🗑️'
            }[task.eventType] || '📋';

            console.log(`\n${eventEmoji} ${task.eventType}`);
            console.log(`   ID: ${task.taskId}`);
            console.log(`   Name: ${task.taskName || 'N/A'}`);
            console.log(`   Status: ${task.oldStatus || 'new'} → ${task.newStatus}`);
            if (task.assignee) console.log(`   Assignee: ${task.assignee}`);
            if (task.candidateGroup) console.log(`   Candidate Group: ${task.candidateGroup}`);
            console.log(`   Time: ${new Date(task.timestamp).toLocaleTimeString()}`);
            console.log('─'.repeat(60));
        } catch (err) {
            console.error('❌ Error parsing event:', err.message);
            console.log('   Raw data:', event.data);
        }
    });

    eventSource.addEventListener('ping', (event) => {
        console.log(`💓 Keep-alive: ${event.data}`);
    });

    eventSource.onerror = (error) => {
        console.error('\n❌ SSE Error:', error.message || error);
        console.log(`   ReadyState: ${eventSource.readyState}`);
        
        if (eventSource.readyState === 2) { // CLOSED
            eventSource.close();
            console.log(`🔄 Reconnecting in ${reconnectDelay / 1000}s...`);
            setTimeout(() => {
                reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
                connectSSE();
            }, reconnectDelay);
        }
    };
}

async function testConnection() {
    try {
        console.log('\n🏥 Testing server connection...');
        const response = await fetch(`${BASE_URL}/health`, {
            headers: { 'Authorization': `Basic ${basicAuth}` }
        });
        console.log(`   Health check: ${response.status} ${response.statusText}`);
        return response.ok;
    } catch (error) {
        console.error(`   ❌ Cannot reach server: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('\n' + '='.repeat(60));
    console.log('🎧 TASK EVENT LISTENER');
    console.log('='.repeat(60));
    console.log(`📍 Server: ${BASE_URL}`);
    console.log(`👤 User: ${USERNAME}`);
    console.log(`📦 Node.js: ${process.version}`);
    
    // Test connection first
    const isReachable = await testConnection();
    if (!isReachable) {
        console.error('\n❌ Server not reachable. Please check:');
        console.log('   1. GoFlow server is running on port 8080');
        console.log('   2. CAMUNDA_URL environment variable is correct');
        console.log('   3. Network connectivity');
        process.exit(1);
    }
    
    // Connect to SSE
    connectSSE();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down...');
    if (eventSource) {
        eventSource.close();
        console.log('✅ SSE connection closed');
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n👋 Shutting down...');
    if (eventSource) {
        eventSource.close();
        console.log('✅ SSE connection closed');
    }
    process.exit(0);
});

// Run
main().catch(console.error);

module.exports = { startTaskListener: main };