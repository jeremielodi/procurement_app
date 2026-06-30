// backend/src/controllers/WorkflowController.js
const workFlowModel = require('../models/workFlowModel');
const camundaService = require('../services/CamundaService');

/**
 * Récupérer l'historique d'un processus
 * GET /api/workflow/process/:processInstanceId/history
 */
async function getProcessHistory(req, res) {
  try {
    const { processInstanceId } = req.params;
    
    if (!processInstanceId) {
      return res.status(400).json({
        success: false,
        message: 'processInstanceId est requis'
      });
    }
    
    // Récupérer l'historique du processus
    const history = await camundaService.getProcessHistory(processInstanceId);
    
    // Récupérer les activités du processus
    // const activities = await camundaService.getProcessActivities(processInstanceId);
    
    // Récupérer les tâches du processus
    const tasks = await camundaService.getProcessTasks(processInstanceId);
    
    // Récupérer les variables du processus
    const variables = await camundaService.getProcessVariables(processInstanceId);
    const flow = await workFlowModel.getByProcessInstanceId(processInstanceId);
    res.json({
      success: true,
      data: {
        workflow: flow,
        process: history,
        // activities: activities,
        tasks: tasks,
        variables: variables
      }
    });
  } catch (error) {
    console.error('Error getting process history:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de l\'historique du processus',
      error: error.message
    });
  }
}

/**
 * Récupérer le statut d'un processus
 * GET /api/workflow/process/:processInstanceId/status
 */
async function getProcessStatus(req, res) {
  try {
    const { processInstanceId } = req.params;
    
    if (!processInstanceId) {
      return res.status(400).json({
        success: false,
        message: 'processInstanceId est requis'
      });
    }
    
    // Récupérer le statut du processus
    let processInstance;
    try {
      // Essayer de récupérer le processus actif
      const response = await camundaService.client.get(`/process-instance/${processInstanceId}`);
      processInstance = response.data;
    } catch (error) {
      // Si le processus n'est plus actif, vérifier dans l'historique
      const history = await camundaService.getProcessHistory(processInstanceId);
      processInstance = history;
      processInstance.status = 'COMPLETED';
    }
    
    res.json({
      success: true,
      data: processInstance
    });
  } catch (error) {
    console.error('Error getting process status:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du statut du processus',
      error: error.message
    });
  }
}

/**
 * Récupérer les tâches d'un processus
 * GET /api/workflow/process/:processInstanceId/tasks
 */
async function getProcessTasks(req, res) {
  try {
    const { processInstanceId } = req.params;
    
    if (!processInstanceId) {
      return res.status(400).json({
        success: false,
        message: 'processInstanceId est requis'
      });
    }
    
    // Récupérer les tâches actives
    let activeTasks = [];
    try {
      activeTasks = await camundaService.getProcessTasks(processInstanceId);
      activeTasks = activeTasks.map(t => ({ ...t, status: 'ACTIVE' }));
    } catch (e) {
      console.log('No active tasks found');
    }
    
    // Récupérer l'historique des tâches
    let historyTasks = [];
    try {
      historyTasks = await camundaService.getProcessActivities(processInstanceId);
      // Filtrer uniquement les activités de type userTask
      historyTasks = historyTasks
        .filter(a => a.activityType === 'userTask')
        .map(t => ({ 
          ...t, 
          status: t.endTime ? 'COMPLETED' : 'ACTIVE',
          name: t.activityName,
          id: t.activityId
        }));
    } catch (e) {
      console.log('No history tasks found');
    }
    
    const allTasks = [...activeTasks, ...historyTasks];
    
    res.json({
      success: true,
      data: allTasks,
      count: allTasks.length
    });
  } catch (error) {
    console.error('Error getting process tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des tâches du processus',
      error: error.message
    });
  }
}

/**
 * Suspendre un processus
 * POST /api/workflow/process/:processInstanceId/suspend
 */
async function suspendProcess(req, res) {
  try {
    const { processInstanceId } = req.params;
    
    const result = await camundaService.suspendProcess(processInstanceId);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Erreur lors de la suspension du processus'
      });
    }
    
    res.json({
      success: true,
      message: 'Processus suspendu avec succès'
    });
  } catch (error) {
    console.error('Error suspending process:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suspension du processus',
      error: error.message
    });
  }
}

/**
 * Reprendre un processus
 * POST /api/workflow/process/:processInstanceId/resume
 */
async function resumeProcess(req, res) {
  try {
    const { processInstanceId } = req.params;
    
    const result = await camundaService.resumeProcess(processInstanceId);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Erreur lors de la reprise du processus'
      });
    }
    
    res.json({
      success: true,
      message: 'Processus repris avec succès'
    });
  } catch (error) {
    console.error('Error resuming process:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la reprise du processus',
      error: error.message
    });
  }
}

/**
 * Supprimer un processus
 * DELETE /api/workflow/process/:processInstanceId
 */
async function deleteProcess(req, res) {
  try {
    const { processInstanceId } = req.params;
    const { reason } = req.body;
    
    const result = await camundaService.deleteProcess(processInstanceId, reason);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Erreur lors de la suppression du processus'
      });
    }
    
    res.json({
      success: true,
      message: 'Processus supprimé avec succès'
    });
  } catch (error) {
    console.error('Error deleting process:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression du processus',
      error: error.message
    });
  }
}

/**
 * Récupérer les variables d'un processus
 * GET /api/workflow/process/:processInstanceId/variables
 */
async function getProcessVariables(req, res) {
  try {
    const { processInstanceId } = req.params;
    
    let variables;
    try {
      variables = await camundaService.getProcessVariables(processInstanceId);
    } catch (error) {
      // Si le processus n'est plus actif, récupérer depuis l'historique
      const history = await camundaService.getProcessHistory(processInstanceId);
      variables = history?.variables || {};
    }
    
    res.json({
      success: true,
      data: variables
    });
  } catch (error) {
    console.error('Error getting process variables:');
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des variables du processus',
      error: error.message
    });
  }
}

/**
 * Définir les variables d'un processus
 * POST /api/workflow/process/:processInstanceId/variables
 */
async function setProcessVariables(req, res) {
  try {
    const { processInstanceId } = req.params;
    const { variables } = req.body;
    
    if (!variables || typeof variables !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Les variables sont requises et doivent être un objet'
      });
    }
    
    const result = await camundaService.setProcessVariables(processInstanceId, variables);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Erreur lors de la mise à jour des variables'
      });
    }
    
    res.json({
      success: true,
      message: 'Variables mises à jour avec succès'
    });
  } catch (error) {
    console.error('Error setting process variables:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour des variables du processus',
      error: error.message
    });
  }
}

/**
 * Récupérer le diagramme BPMN d'un processus
 * GET /api/workflow/process/:processDefinitionId/diagram
 */
async function getProcessDiagram(req, res) {
  try {
    const { processDefinitionId } = req.params;
    
    if (!processDefinitionId) {
      return res.status(400).json({
        success: false,
        message: 'processDefinitionId est requis'
      });
    }
    
    const diagram = await camundaService.getProcessDiagram(processDefinitionId);
    
    res.json({
      success: true,
      data: diagram
    });
  } catch (error) {
    console.error('Error getting process diagram:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du diagramme du processus',
      error: error.message
    });
  }
}

// Export des fonctions
module.exports = {
  getProcessHistory,
  getProcessStatus,
  getProcessTasks,
  suspendProcess,
  resumeProcess,
  deleteProcess,
  getProcessVariables,
  setProcessVariables,
  getProcessDiagram
};