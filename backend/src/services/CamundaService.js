// backend/src/services/CamundaService.js
const axios = require('axios');
const FormData = require('form-data');

// Configuration
let baseUrl = process.env.CAMUNDA_REST_URL || 'http://localhost:8080/engine-rest';
let bearerToken = process.env.CAMUNDA_BEARER_TOKEN || null;
let username = process.env.CAMUNDA_USERNAME || null;
let password = process.env.CAMUNDA_PASSWORD || null;

// Create axios instance
let client = axios.create({
  baseURL: baseUrl,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Obtenir les headers d'authentification
 */
function getAuthHeaders() {
  const headers = {};

  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  } else if (username && password) {
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
    headers['Authorization'] = `Basic ${basicAuth}`;
  }

  return headers;
}

/**
 * Mettre à jour les headers d'authentification
 */
function updateAuthHeaders() {
  const headers = getAuthHeaders();

  // Update default headers
  client.defaults.headers.common = {
    ...client.defaults.headers.common,
    ...headers
  };

  return headers;
}

/**
 * S'authentifier auprès de Camunda pour obtenir un token
 */
async function authenticate() {
  try {
    // If we have credentials, try to get a token
    if (username && password) {
      const authUrl = `http://localhost:8080/auth/login`;

      const response = await axios.post(authUrl, {
        email: username,
        password: password
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.data && response.data.access_token) {
        bearerToken = response.data.access_token;
        updateAuthHeaders();
        return { success: true, token: bearerToken };
      }
    }

    // If no authentication configured, continue without
    console.log('⚠️ No Camunda authentication configured, continuing without auth');
    updateAuthHeaders();
    return { success: true };
  } catch (error) {
    console.error('Camunda authentication error:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

// Add response interceptor for error handling
client.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config;

    // If unauthorized and haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      console.log('Unauthorized, trying to re-authenticate...');
      const authResult = await authenticate();

      if (authResult.success && bearerToken) {
        originalRequest.headers['Authorization'] = `Bearer ${bearerToken}`;
        return client(originalRequest);
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Déterminer le type de variable pour Camunda
 */
function getVariableType(value) {
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') return 'Double';
  if (typeof value === 'boolean') return 'Boolean';
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return 'Array';
  if (typeof value === 'object') return 'Object';
  return 'String';
}

/**
 * Vérifier la connexion à Camunda
 */
async function checkConnection() {
  try {
    const response = await client.get('/engine');

    if (response.status === 200) {
      console.log('✅ Camunda connection successful');
      return { success: true };
    } else {
      console.log(`❌ Camunda connection failed: ${response.status}`);
      return { success: false, status: response.status };
    }
  } catch (error) {
    console.error('Camunda connection error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Démarrer un processus Camunda
 */
async function startProcess(processKey, variables) {
  try {
    const camundaVariables = {};
    for (const [key, value] of Object.entries(variables)) {
      camundaVariables[key] = { value, type: getVariableType(value) };
    }

    const response = await client.post(`http://localhost:8080/engine-rest/v2/process-definitions/${processKey}/start`, {
      variables: camundaVariables
    });

    return {
      success: true,
      processInstanceId: response.data.processInstanceId || response.data.id,
      definitionId: response.data.definitionId
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * Récupérer les tâches d'un processus
 */
async function getProcessTasks(processInstanceId) {
  try {
    const response = await client.get('/tasks', {
      params: { processInstanceId }
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching tasks:');
    return [];
  }
}

/**
 * Récupérer les tâches assignées à un utilisateur
 */
async function getUserTasks(assignee, processInstanceId = null) {
  try {
    const params = { assignee };
    if (processInstanceId) {
      params.processInstanceId = processInstanceId;
    }

    const response = await client.get('/tasks', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching user tasks:', error);
    return [];
  }
}


/**
 * Récupérer les tâches assignées à un utilisateur
 */
async function getJobById(taskId) {
  try {
    
    const response = await client.get(`/jobs/${taskId}`, {  });
    return response.data || {};
  } catch (error) {
    console.error('Error fetching user tasks:', error);
    return [];
  }
}
/**
 * Récupérer les tâches candidates pour un groupe
 */
async function getGroupTasks(candidateGroup, processInstanceId = null) {
  try {
    const params = { candidateGroup };
    if (processInstanceId) {
      params.processInstanceId = processInstanceId;
    }

    const response = await client.get('/task', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching group tasks:', error);
    return [];
  }
}

/**
 * Compléter une tâche
 */
async function completeTask(taskId, variables = {}) {
  try {
    const camundaVariables = {};
    for (const [key, value] of Object.entries(variables)) {
      camundaVariables[key] = { value, type: getVariableType(value) };
    }

    const response = await client.post(`/tasks/${taskId}/complete`, {
      variables: camundaVariables
    });

    return { success: true };
  } catch (error) {
    console.error('Error completing task:', error);
    return { success: false, error: error.response?.data?.message || error.message };
  }
}

/**
 * Assigner une tâche à un utilisateur
 */
async function assignTask(taskId, userId) {
  try {
    const response = await client.post(`/tasks/${taskId}/claim`, {
      assignee: userId
    });

    return { success: true };
  } catch (error) {
    console.error('Error assigning task:', error);
    return { success: false, error: error.response?.data?.message || error.message };
  }
}

/**
 * Récupérer les variables d'un processus
 */
async function getProcessVariables(processInstanceId) {
  try {
    const response = await client.get(`/process-instance/${processInstanceId}/variables`);

    const variables = response.data;
    const result = {};

    for (const [key, value] of Object.entries(variables)) {
      result[key] = value.value;
    }

    return result;
  } catch (error) {
    console.error('Error fetching process variables:', error);
    return {};
  }
}

/**
 * Définir les variables d'un processus
 */
async function setProcessVariables(processInstanceId, variables) {
  try {
    const camundaVariables = {};
    for (const [key, value] of Object.entries(variables)) {
      camundaVariables[key] = { value, type: getVariableType(value) };
    }

    const response = await client.post(`/process-instance/${processInstanceId}/variables`,
      camundaVariables
    );

    return { success: true };
  } catch (error) {
    console.error('Error setting process variables:', error);
    return { success: false, error: error.response?.data?.message || error.message };
  }
}

/**
 * Suspendre un processus
 */
async function suspendProcess(processInstanceId) {
  try {
    const response = await client.put(`/process-instance/${processInstanceId}/suspended`, {
      suspended: true
    });

    return { success: true };
  } catch (error) {
    console.error('Error suspending process:', error);
    return { success: false, error: error.response?.data?.message || error.message };
  }
}

/**
 * Reprendre un processus
 */
async function resumeProcess(processInstanceId) {
  try {
    const response = await client.put(`/process-instance/${processInstanceId}/suspended`, {
      suspended: false
    });

    return { success: true };
  } catch (error) {
    console.error('Error resuming process:', error);
    return { success: false, error: error.response?.data?.message || error.message };
  }
}

/**
 * Supprimer un processus
 */
async function deleteProcess(processInstanceId, reason = null) {
  try {
    let url = `/process-instance/${processInstanceId}`;
    if (reason) {
      url += `?deleteReason=${encodeURIComponent(reason)}`;
    }

    const response = await client.delete(url);

    return { success: true };
  } catch (error) {
    console.error('Error deleting process:', error);
    return { success: false, error: error.response?.data?.message || error.message };
  }
}

/**
 * Terminer un processus (le marquer comme terminé)
 * POST /process-instance/{id}/end
 */
async function terminateProcess(processInstanceId, variables = {}) {
  try {
    const camundaVariables = {};
    for (const [key, value] of Object.entries(variables)) {
      camundaVariables[key] = { value, type: getVariableType(value) };
    }
    
    const response = await client.post(`/process-instance/${processInstanceId}/end`, {
      variables: camundaVariables
    });
    
    console.log(`✅ Process ${processInstanceId} terminated successfully (marked as completed)`);
    return { success: true };
  } catch (error) {
    console.error('Error terminating process:', error);
    return { 
      success: false, 
      error: error.response?.data?.message || error.message 
    };
  }
}

/**
 * Marquer un processus comme terminé (alternative)
 * Utilise la modification des variables pour indiquer la fin
 */
async function setProcessCompleted(processInstanceId, reason = null) {
  try {
    // Définir une variable pour indiquer que le processus est terminé
    const variables = {
      processCompleted: true,
      completedAt: new Date().toISOString(),
      ...(reason && { completionReason: reason })
    };
    
    await setProcessVariables(processInstanceId, variables);
    
    // Terminer le processus
    return await terminateProcess(processInstanceId, variables);
  } catch (error) {
    console.error('Error setting process completed:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Terminer un processus avec modification des variables
 * POST /process-instance/{id}/end
 */
async function endProcess(processInstanceId, variables = {}) {
  try {
    const camundaVariables = {};
    for (const [key, value] of Object.entries(variables)) {
      camundaVariables[key] = { value, type: getVariableType(value) };
    }

    const response = await client.post(`/process-instance/${processInstanceId}/end`, {
      variables: camundaVariables
    });

    console.log(`✅ Process ${processInstanceId} ended successfully`);
    return { success: true };
  } catch (error) {
    console.error('Error ending process:', error);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * Modifier l'état d'un processus (correction de la méthode existante)
 * PUT /process-instance/{id}/suspended
 */
async function setProcessState(processInstanceId, suspended) {
  try {
    const response = await client.put(`/process-instance/${processInstanceId}/suspended`, {
      suspended: suspended
    });

    const status = suspended ? 'suspended' : 'resumed';
    console.log(`✅ Process ${processInstanceId} ${status}`);
    return { success: true };
  } catch (error) {
    console.error(`Error ${suspended ? 'suspending' : 'resuming'} process:`, error);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * Arrêter un processus avec une raison (pour budget insuffisant)
 * Cette méthode combine la modification du statut et l'ajout d'une variable
 */
async function stopProcessWithReason(processInstanceId, reason, additionalVariables = {}) {
  try {
    // 1. Définir les variables pour indiquer la raison
    const variables = {
      processStopped: true,
      stopReason: reason,
      stoppedAt: new Date().toISOString(),
      ...additionalVariables
    };

    await setProcessVariables(processInstanceId, variables);

    // 2. Terminer le processus
    const result = await deleteProcess(processInstanceId, reason);

    if (result.success) {
      console.log(`✅ Process ${processInstanceId} stopped. Reason: ${reason}`);
    }

    return result;
  } catch (error) {
    console.error('Error stopping process:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Récupérer l'état d'un processus
 * GET /process-instance/{id}
 */
async function getProcessState(processInstanceId) {
  try {
    const response = await client.get(`/process-instance/${processInstanceId}`);
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    if (error.response?.status === 404) {
      // Processus déjà terminé, vérifier dans l'historique
      const history = await getProcessHistory(processInstanceId);
      if (history) {
        return {
          success: true,
          data: { ...history, ended: true },
          ended: true
        };
      }
    }
    console.error('Error getting process state:', error);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * Signaler un échec de tâche avec arrêt du processus
 * POST /external-task/{id}/failure
 */
async function failTaskAndStopProcess(taskId, processInstanceId, errorMessage, retries = 0) {
  try {
    // 1. Signaler l'échec de la tâche
    const failureResponse = await client.post(`/external-task/${taskId}/failure`, {
      workerId: WORKER_ID,
      errorMessage: errorMessage,
      retries: retries,
      retryTimeout: 5000
    });

    // 2. Si plus de retries, arrêter le processus
    if (retries === 0) {
      await stopProcessWithReason(processInstanceId, errorMessage);
    }

    return { success: true };
  } catch (error) {
    console.error('Error failing task:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Récupérer l'historique d'un processus
 */
async function getProcessHistory(processInstanceId) {
  try {
    const response = await client.get(`/history/process-instance/${processInstanceId}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching process history:');
    return null;
  }
}

/**
 * Récupérer les activités d'un processus
 */
async function getProcessActivities(processInstanceId) {
  try {
    const response = await client.get('/history/activity-instance', {
      params: { processInstanceId }
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching process activities:', error);
    return [];
  }
}

/**
 * Récupérer le diagramme BPMN d'un processus
 */
async function getProcessDiagram(processDefinitionId) {
  try {
    const response = await client.get(`/process-definition/${processDefinitionId}/xml`);
    return response.data.bpmn20Xml;
  } catch (error) {
    console.error('Error fetching process diagram:', error);
    return null;
  }
}

/**
 * Déployer un fichier BPMN
 */
async function deployProcess(bpmnXml, deploymentName) {
  try {
    const formData = new FormData();
    const blob = Buffer.from(bpmnXml, 'utf-8');

    formData.append('deployment-name', deploymentName);
    formData.append('data', blob, `${deploymentName}.bpmn`);

    const headers = {
      ...formData.getHeaders(),
      ...getAuthHeaders()
    };

    const response = await client.post('/deployment/create', formData, {
      headers
    });

    return { success: true, deploymentId: response.data.id };
  } catch (error) {
    console.error('Error deploying process:', error);
    return { success: false, error: error.response?.data?.message || error.message };
  }
}

/**
 * Mettre à jour la configuration
 */
function updateConfig(newConfig) {
  if (newConfig.baseUrl) {
    baseUrl = newConfig.baseUrl;
    client.defaults.baseURL = baseUrl;
  }
  if (newConfig.bearerToken !== undefined) {
    bearerToken = newConfig.bearerToken;
  }
  if (newConfig.username) {
    username = newConfig.username;
  }
  if (newConfig.password) {
    password = newConfig.password;
  }
  updateAuthHeaders();
}

// Initialize authentication on module load
authenticate().catch(console.error);

// Export des fonctions
module.exports = {
  // Authentication
  authenticate,
  checkConnection,
  updateConfig,

  // Process management
  startProcess,
  suspendProcess: (id) => setProcessState(id, true),
  resumeProcess: (id) => setProcessState(id, false),
  deleteProcess,
  getProcessHistory,
  getProcessVariables,
  setProcessVariables,
  getProcessActivities,
  getProcessDiagram,
  setProcessState,
  deleteProcess,
  terminateProcess,
  endProcess,
  stopProcessWithReason,

  // Task management
  getProcessTasks,
  getJobById,
  getUserTasks,
  getGroupTasks,
  completeTask,
  assignTask,

  // Deployment
  deployProcess,

  // Utilities
  getVariableType,
  getAuthHeaders
};