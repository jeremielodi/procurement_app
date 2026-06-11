// backend/src/controllers/TaskController.js
const UserModel = require('../models/UserModel');
const camundaService = require('../services/CamundaService');

/**
 * Récupérer les tâches assignées à un utilisateur
 * GET /api/tasks/user?assignee=john.doe
 */
async function getUserTasks(req, res) {
    try {
        const { assignee, processInstanceId } = req.query;
        const currentUserId = req.user.id;
        const user = await UserModel.findById(currentUserId);
        const profiles = user.profiles.map(p => p.id.replace('prof_', '')) || [];
        console.log(profiles);

        let tasks = [];
        if (processInstanceId) {
            tasks = await camundaService.getUserTasks(null, processInstanceId);
        } else {
            tasks = await camundaService.getUserTasks(null);
        }

        let userTasks = [];
        if(profiles.includes('admin')){
            userTasks = tasks;
        }
        else {
         
            // assigne taskes 
            const assigneeTasks = (tasks || []).filter(t => (t.assignee == currentUserId) || profiles.includes( t.candidateGroup));
            userTasks.push(...assigneeTasks);
        } 
        if (!assignee) {
            return res.status(400).json({
                success: false,
                message: 'assignee est requis'
            });
        }

        let enrichedTasks = [];
        // Enrichir les tâches avec des informations supplémentaires
        if (userTasks) {

            enrichedTasks = await Promise.all(
                userTasks.map(async (task) => {
                    let variables = null;

                    try {
                        variables = await camundaService.getProcessVariables(task.processInstanceId);
                    } catch (e) {
                        console.log(`No variables found for task ${task.id}`);
                    }

                    return {
                        id: task.id,
                        name: task.taskName || task.name,
                        candidateGroup: task.candidateGroup,
                        processInstanceId: task.processInstanceId,
                        executionId: task.executionId,
                        taskDefinitionKey: task.taskDefinitionKey,
                        assignee: task.assignee,
                        created: task.createTime,
                        due: task.dueDate,
                        state: task.status,
                        followUp: task.followUpDate,
                        priority: task.priority,
                        status: task.assignee ? 'ASSIGNED' : 'UNASSIGNED',
                        variables: variables,
                        canClaim: !task.assignee,
                        canComplete: task.assignee === assignee
                    };
                })
            );
        }

        res.json({
            success: true,
            data: enrichedTasks,
            count: enrichedTasks.length
        });
    } catch (error) {
        console.error('Error getting user tasks:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des tâches utilisateur',
            error: error.message
        });
    }
}

/**
 * Récupérer les tâches d'un groupe
 * GET /api/tasks/group?candidateGroup=managers
 */
async function getGroupTasks(req, res) {
    try {
        const { candidateGroup, processInstanceId } = req.query;

        if (!candidateGroup) {
            return res.status(400).json({
                success: false,
                message: 'candidateGroup est requis'
            });
        }

        const tasks = await camundaService.getGroupTasks(candidateGroup, processInstanceId);

        res.json({
            success: true,
            data: tasks,
            count: tasks.length
        });
    } catch (error) {
        console.error('Error getting group tasks:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des tâches de groupe',
            error: error.message
        });
    }
}

/**
 * Récupérer le formulaire d'une tâche
 * GET /api/tasks/:taskId/form
 */
async function getTaskForm(req, res) {
    try {
        const { taskId } = req.params;
        // Formulaire générique car Camunda 7 n'a pas de stockage de formulaire natif
        const form = {
            key: 'generic-form',
            title: 'Traitement de la tâche',
            fields: [
                {
                    id: 'comment',
                    label: 'Commentaire',
                    type: 'textarea',
                    required: false,
                    placeholder: 'Ajoutez un commentaire...'
                },
                {
                    id: 'approved',
                    label: 'Approuver',
                    type: 'checkbox',
                    required: false,
                    defaultValue: false
                }
            ]
        };

        res.json({
            success: true,
            data: form
        });
    } catch (error) {
        console.error('Error getting task form:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération du formulaire',
            error: error.message
        });
    }
}

/**
 * Réclamer une tâche (assigner à soi-même)
 * POST /api/tasks/:taskId/claim
 */
async function claimTask(req, res) {
    try {
        const { taskId } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'userId est requis'
            });
        }

        const result = await camundaService.assignTask(taskId, userId);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                message: result.error || 'Erreur lors de la prise en charge'
            });
        }

        res.json({
            success: true,
            message: `Tâche ${taskId} réclamée par ${userId}`
        });
    } catch (error) {
        console.error('Error claiming task:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la réclamation de la tâche',
            error: error.message
        });
    }
}

/**
 * Compléter une tâche (avec soumission du formulaire)
 * POST /api/tasks/:taskId/complete
 */
async function completeTask(req, res) {
    try {
        const { taskId } = req.params;
        const { variables, comment } = req.body;

        // Préparer les variables
        const taskVariables = {};
        if (variables) {
            for (const [key, value] of Object.entries(variables)) {
                taskVariables[key] = value;
            }
        }

        // Ajouter le commentaire si présent
        if (comment) {
            taskVariables.comment = comment;
        }

        const result = await camundaService.completeTask(taskId, taskVariables);

        if (!result.success) {
            return res.status(500).json({
                success: false,
                message: result.error || 'Erreur lors de la complétion'
            });
        }

        res.json({
            success: true,
            message: 'Tâche complétée avec succès'
        });
    } catch (error) {
        console.error('Error completing task:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la complétion de la tâche',
            error: error.message
        });
    }
}

/**
 * Récupérer les tâches d'un processus
 * GET /api/tasks/process/:processInstanceId
 */
async function getTasksByProcess(req, res) {
    try {
        const { processInstanceId } = req.params;

        if (!processInstanceId) {
            return res.status(400).json({
                success: false,
                message: 'processInstanceId est requis'
            });
        }

        // Récupérer les tâches actives
        const activeTasks = await camundaService.getProcessTasks(processInstanceId);

        // Formater les tâches
        const allTasks = (activeTasks || []).map(task => ({
            id: task.id,
            name: task.taskName || task.name,
            processInstanceId: task.processInstanceId,
            executionId: task.executionId,
            taskDefinitionKey: task.taskDefinitionKey,
            assignee: task.assignee,
            created: task.createdAt,
            candidateGroup: task.candidateGroup,
            due: task.dueDate,
            followUp: task.followUpDate,
            priority: task.priority,
            completedAt: task.completedAt,
            status: task.status =='completed'?  'COMPLETED' : 'PENDING'
        }));

        res.json({
            success: true,
            data: allTasks,
            count: allTasks.length,
            processInstanceId
        });
    } catch (error) {
        console.error('Error getting tasks by process:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des tâches du processus',
            error: error.message
        });
    }
}

/**
 * Récupérer le nombre de tâches en attente pour un processus
 * GET /api/tasks/process/:processInstanceId/count
 */
async function getPendingTasksCount(req, res) {
    try {
        const { processInstanceId } = req.params;

        const activeTasks = await camundaService.getProcessTasks(processInstanceId);
        const pendingCount = (activeTasks || []).filter(t => !t.endTime).length;

        res.json({
            success: true,
            count: pendingCount,
            processInstanceId
        });
    } catch (error) {
        console.error('Error getting pending tasks count:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du comptage des tâches en attente',
            error: error.message
        });
    }
}

/**
 * Récupérer les détails d'une tâche
 * GET /api/tasks/:taskId
 */
async function getTaskById(req, res) {
    try {
        const { taskId } = req.params;

        // Récupérer la tâche via Camunda
        const tasks = await camundaService.getProcessTasks();
        const task = (tasks || []).find(t => t.id === taskId);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Tâche non trouvée'
            });
        }

        const variables = await camundaService.getProcessVariables(task.processInstanceId);

        res.json({
            success: true,
            data: {
                id: task.id,
                name: task.name,
                processInstanceId: task.processInstanceId,
                assignee: task.assignee,
                created: task.createTime,
                due: task.dueDate,
                priority: task.priority,
                variables: variables
            }
        });
    } catch (error) {
        console.error('Error getting task by id:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération de la tâche',
            error: error.message
        });
    }
}

// Export des fonctions
module.exports = {
    getUserTasks,
    getGroupTasks,
    getTaskForm,
    claimTask,
    completeTask,
    getTasksByProcess,
    getPendingTasksCount,
    getTaskById
};