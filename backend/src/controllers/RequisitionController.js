// backend/src/controllers/RequisitionController.js
const requisitionModel = require('../models/RequisitionModel');
const userModel = require('../models/UserModel');
const notificationService = require('../services/NotificationService');
const camundaService = require('../services/CamundaService');
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class RequisitionController {

  /**
   * Émettre une notification via Socket.IO
   */
  emitNotification(io, userId, title, message, type, link) {
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
   * Émettre une mise à jour de réquisition
   */
  emitRequisitionUpdate(io, requisitionId, data) {
    if (io) {
      io.to(`requisition-${requisitionId}`).emit('requisition-update', {
        ...data,
        timestamp: new Date().toISOString()
      });
      console.log(`📝 [Socket] Requisition update sent for ${requisitionId}`);
    }
  }

  /**
   * Récupérer l'email d'un utilisateur par son ID
   */
  async getUserEmailById(userId) {
    try {
      const user = await userModel.findById(userId);
      return user?.email || null;
    } catch (error) {
      console.error('Error getting user email:', error);
      return null;
    }
  }

  /**
   * Récupérer le username d'un utilisateur par son ID
   */
  async getUserUsernameById(userId) {
    try {
      const user = await userModel.findById(userId);
      return user?.username || null;
    } catch (error) {
      console.error('Error getting user username:', error);
      return null;
    }
  }

  /**
   * Récupérer les détails d'un projet par son ID
   */
  async getProjectDetails(projectId) {
    try {
      if (!projectId) return null;
      const project = await db.one('SELECT id, code, name FROM projects WHERE id = $1', [projectId]);
      return project;
    } catch (error) {
      console.error('Error getting project details:', error);
      return null;
    }
  }

  /**
   * Récupérer les détails d'une ligne budgétaire par son ID
   */
  async getBudgetLineDetails(budgetLineId) {
    try {
      if (!budgetLineId) return null;
      const budgetLine = await db.one('SELECT id, entity_code, description FROM budget_allocations WHERE id = $1', [budgetLineId]);
      return budgetLine;
    } catch (error) {
      console.error('Error getting budget line details:', error);
      return null;
    }
  }

  /**
   * Créer une nouvelle réquisition
   */
 /**
 * Créer une nouvelle réquisition
 */

 // backend/src/controllers/RequisitionController.js (méthode create corrigée)

/**
 * Créer une nouvelle réquisition
 */
async create(req, res) {
  try {
    const {
      title, description, department, projectId,
      estimatedAmount, currency, priority, justification, items
    } = req.body;

    const userId = req.user?.id || 1;
    const io = req.io;

    // Récupérer l'email et le username de l'utilisateur
    const userEmail = await this.getUserEmailById(userId);
    const userUsername = await this.getUserUsernameById(userId);
    
    // Récupérer les détails du projet
    const projectDetails = await this.getProjectDetails(projectId);
    const projectCode = projectDetails?.code || null;
    const projectName = projectDetails?.name || null;

    // Préparer les items avec toutes les informations
    const itemsWithDetails = await Promise.all(items.map(async (item) => {
      let budgetLineCode = null;
      let budgetLineDescription = null;
      
      if (item.budgetLineId) {
        const budgetLine = await this.getBudgetLineDetails(item.budgetLineId);
        if (budgetLine) {
          budgetLineCode = budgetLine.entity_code;
          budgetLineDescription = budgetLine.description;
        }
      }
      
      const itemTotal = (item.quantity || 0) * (item.frequency || 1) * (item.unitPrice || 0);
      
      return {
        description: item.description,
        quantity: item.quantity,
        frequency: item.frequency || 1,
        unitPrice: item.unitPrice,
        total: itemTotal,
        budgetLineId: item.budgetLineId,        // ← AJOUTÉ : ID de la ligne budgétaire
        budgetLineCode: budgetLineCode,
        budgetLineDescription: budgetLineDescription,
        specifications: item.specifications || null
      };
    }));

    const totalAmount = itemsWithDetails.reduce((sum, item) => sum + item.total, 0);
    const totalQuantity = itemsWithDetails.reduce((sum, item) => sum + item.quantity, 0);

    const result = await requisitionModel.create({
      title, 
      description, 
      department, 
      projectId,
      projectCode,
      estimatedAmount: totalAmount, 
      currency, 
      priority, 
      justification, 
      items: itemsWithDetails,
      requesterId: userId
    });

    if (result.success) {
      // Émettre une notification de création
      this.emitNotification(
        io, userId,
        'Réquisition en cours de création',
        `Création de votre réquisition ${result.requisitionNumber} en cours...`,
        'INFO',
        `/requisitions/${result.id}`
      );

      // Ajouter l'historique du workflow
      await requisitionModel.addWorkflowHistory({
        processInstanceId: null,
        entityType: 'requisition',
        entityId: result.id,
        taskId: null,
        taskName: 'Création réquisition',
        action: 'CREATED',
        comments: `Création de la réquisition ${result.requisitionNumber} par l'utilisateur ${userEmail || userId}`,
        performedBy: userId
      });

      // Démarrer le processus Camunda avec TOUTES les informations
      const processResult = await camundaService.startProcess(
        process.env.PROCUREMENT_BPMN_PROCESS,
        {
          // === INFORMATIONS GÉNÉRALES ===
          requisitionId: result.id,
          requisitionNumber: result.requisitionNumber,
          requester: userEmail || userId.toString(),
          requesterUsername: userUsername || userId.toString(),
          requesterId: userId,
          
          // === DÉTAILS DE LA RÉQUISITION ===
          title: title || '',
          description: description || '',
          department: department || '',
          priority: priority || 'MEDIUM',
          justification: justification || '',
          estimatedAmount: totalAmount,
          currency: currency || 'USD',
          
          // === INFORMATIONS PROJET ===
          projectId: projectId || '',
          projectCode: projectCode || '',
          projectName: projectName || '',
          
          // === ARTICLES (format JSON avec budgetLineId) ===
          items: JSON.stringify(itemsWithDetails.map(item => ({
            description: item.description,
            quantity: item.quantity,
            frequency: item.frequency,
            unitPrice: item.unitPrice,
            total: item.total,
            budgetLineId: item.budgetLineId,              // ← AJOUTÉ
            budgetLineCode: item.budgetLineCode,
            budgetLineDescription: item.budgetLineDescription
          }))),
          
          // === STATISTIQUES ===
          totalItems: itemsWithDetails.length,
          totalQuantity: totalQuantity,
          
          // === TIMESTAMPS ===
          createdAt: new Date().toISOString(),
          createdBy: userEmail || userId.toString()
        }
      );

      if (processResult.success) {
        await requisitionModel.updateStatus(
          result.id,
          'IN_PROGRESS',
          processResult.processInstanceId
        );

        // Ajouter l'historique du workflow
        await requisitionModel.addWorkflowHistory({
          processInstanceId: processResult.processInstanceId,
          entityType: 'requisition',
          entityId: result.id,
          taskId: null,
          taskName: 'Démarrage processus',
          action: 'PROCESS_STARTED',
          comments: `Processus Camunda démarré avec l'ID: ${processResult.processInstanceId}`,
          performedBy: userId
        });

        // Émettre une mise à jour de statut
        this.emitRequisitionUpdate(io, result.id, {
          status: 'IN_PROGRESS',
          processInstanceId: processResult.processInstanceId
        });

        await sleep(3000);
        
        // Récupérer les tâches avec l'email comme assignee
        const userTasks = await camundaService.getUserTasks(userEmail, processResult.processInstanceId);
        
        const createRequisitionTask = userTasks.filter((t) => t.taskDefinitionKey == 'Activity_CreateRequisition')[0] || {};
        
        if (createRequisitionTask.id) {
          // Ajouter l'historique du workflow
          await requisitionModel.addWorkflowHistory({
            processInstanceId: processResult.processInstanceId,
            entityType: 'requisition',
            entityId: result.id,
            taskId: createRequisitionTask.id,
            taskName: createRequisitionTask.name || 'Création réquisition',
            action: 'TASK_STARTED',
            comments: `Début de la tâche: ${createRequisitionTask.name}`,
            performedBy: userId
          });

          await camundaService.completeTask(createRequisitionTask.id, {});
          
          // Ajouter l'historique du workflow
          await requisitionModel.addWorkflowHistory({
            processInstanceId: processResult.processInstanceId,
            entityType: 'requisition',
            entityId: result.id,
            taskId: createRequisitionTask.id,
            taskName: createRequisitionTask.name || 'Création réquisition',
            action: 'TASK_COMPLETED',
            comments: `Tâche "${createRequisitionTask.name}" complétée automatiquement`,
            performedBy: userId
          });
        
        }

        // Ajouter l'historique du workflow
        await requisitionModel.addWorkflowHistory({
          processInstanceId: processResult.processInstanceId,
          entityType: 'requisition',
          entityId: result.id,
          taskId: null,
          taskName: 'Notification',
          action: 'NOTIFICATION_SENT',
          comments: `Notification envoyée à l'utilisateur ${userEmail || userId}: Réquisition créée avec succès`,
          performedBy: userId
        });

        // Notifier le demandeur
        await notificationService.sendNotification(
          userId,
          'Réquisition créée avec succès',
          `Votre réquisition ${result.requisitionNumber} a été créée et le processus a démarré.`,
          'REQUISITION_CREATED',
          `/requisitions/${result.id}`
        );

        // Émettre la notification finale
        this.emitNotification(
          io, userId,
          'Réquisition créée avec succès ✅',
          `Votre réquisition ${result.requisitionNumber} a été créée et le processus a démarré.`,
          'SUCCESS',
          `/requisitions/${result.id}`
        );

        // Émettre une mise à jour de la liste des réquisitions
        if (io) {
          io.emit('requisitions-list-update', {
            action: 'CREATE',
            requisitionId: result.id,
            requisitionNumber: result.requisitionNumber
          });
        }
      } else {
        // Ajouter l'historique du workflow - échec
        await requisitionModel.addWorkflowHistory({
          processInstanceId: null,
          entityType: 'requisition',
          entityId: result.id,
          taskId: null,
          taskName: 'Démarrage processus',
          action: 'PROCESS_START_FAILED',
          comments: `Échec du démarrage du processus Camunda: ${processResult.error}`,
          performedBy: userId
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Réquisition créée avec succès',
        data: result
      });
    }
  } catch (error) {
    console.error('Error creating requisition:', error);
    
    // Ajouter l'historique du workflow - erreur
    try {
      await requisitionModel.addWorkflowHistory({
        processInstanceId: null,
        entityType: 'requisition',
        entityId: null,
        taskId: null,
        taskName: 'Création réquisition',
        action: 'ERROR',
        comments: `Erreur lors de la création: ${error.message}`,
        performedBy: req.user?.id || 1
      });
    } catch (historyError) {
      console.error('Error adding error history:', historyError);
    }
    
    // Émettre une notification d'erreur
    if (req.io) {
      this.emitNotification(
        req.io, req.user?.id || 1,
        'Erreur lors de la création',
        `La création de la réquisition a échoué: ${error.message}`,
        'ERROR',
        null
      );
    }
    
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de la réquisition',
      error: error.message
    });
  }
}

  /**
   * Supprimer une réquisition
   */
  async delete(req, res) {
    try {
      const { id } = req.params;
      const io = req.io;
      
      const requisition = await requisitionModel.findById(id);

      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Réquisition non trouvée'
        });
      }

      const requisitionNumber = requisition.requisition_number;
      
      await requisitionModel.delete(id);
      
      // Émettre une notification de suppression
      if (io) {
        this.emitNotification(
          io, requisition.requester_id,
          'Réquisition supprimée',
          `Votre réquisition ${requisitionNumber} a été supprimée`,
          'WARNING',
          null
        );
        
        // Émettre une mise à jour de la liste
        io.emit('requisitions-list-update', {
          action: 'DELETE',
          requisitionId: id,
          requisitionNumber: requisitionNumber
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Réquisition supprimée'
      });
    } catch (error) {
      console.error('Error delete requisition:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la suppression de la réquisition',
        error: error.message
      });
    }
  }
  
  /**
   * Récupérer une réquisition
   */
  async getOne(req, res) {
    try {
      const { id } = req.params;
      const requisition = await requisitionModel.findById(id);

      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Réquisition non trouvée'
        });
      }

      return res.json({
        success: true,
        data: requisition
      });
    } catch (error) {
      console.error('Error fetching requisition:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de la réquisition'
      });
    }
  }

  /**
   * Liste des réquisitions
   */
  async list(req, res) {
    try {
      const { status, department, fromDate, toDate, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      const requisitions = await requisitionModel.findAll({
        status,
        department,
        fromDate,
        toDate,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      const totalResult = await db.one(
        "SELECT COUNT(*) as total FROM requisitions",
        []
      );

      return res.json({
        success: true,
        data: requisitions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(totalResult.total),
          pages: Math.ceil(totalResult.total / limit)
        }
      });
    } catch (error) {
      console.error('Error listing requisitions:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des réquisitions'
      });
    }
  }

  /**
   * Ajouter l'historique du workflow
   */
  async addWorkflowHistory(req, res) {
    try {
      const { processInstanceId, entityType, entityId, taskId, taskName, action, comments } = req.body;
      const userId = req.user?.id || 1;
      const io = req.io;

      const result = await requisitionModel.addWorkflowHistory({
        processInstanceId,
        entityType,
        entityId,
        taskId,
        taskName,
        action,
        comments,
        performedBy: userId
      });

      // Émettre une mise à jour du workflow
      if (io && processInstanceId) {
        io.to(`workflow-${processInstanceId}`).emit('workflow-history-update', {
          taskId,
          taskName,
          action,
          comments,
          performedBy: userId,
          timestamp: new Date().toISOString()
        });
      }

      return res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error adding workflow history:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'ajout de l\'historique'
      });
    }
  }

  /**
   * Approuver une réquisition
   */
  async approve(req, res) {
    try {
      const { id } = req.params;
      const { comments } = req.body;
      const userId = req.user?.id || 1;
      const io = req.io;

      const requisition = await requisitionModel.findById(id);
      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Réquisition non trouvée'
        });
      }

      const result = await requisitionModel.approve(id, userId, comments);

      // Émettre une notification d'approbation
      this.emitNotification(
        io, requisition.requester_id,
        'Réquisition approuvée ✅',
        `Votre réquisition ${requisition.requisition_number} a été approuvée`,
        'SUCCESS',
        `/requisitions/${id}`
      );

      // Émettre une mise à jour de la réquisition
      this.emitRequisitionUpdate(io, id, {
        status: 'APPROVED',
        approvedBy: userId,
        approvedAt: new Date().toISOString(),
        comments: comments
      });

      return res.json({
        success: true,
        message: 'Réquisition approuvée avec succès',
        data: result
      });
    } catch (error) {
      console.error('Error approving requisition:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'approbation de la réquisition',
        error: error.message
      });
    }
  }

  /**
   * Rejeter une réquisition
   */
  async reject(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const userId = req.user?.id || 1;
      const io = req.io;

      const requisition = await requisitionModel.findById(id);
      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Réquisition non trouvée'
        });
      }

      const result = await requisitionModel.reject(id, userId, reason);

      // Émettre une notification de rejet
      this.emitNotification(
        io, requisition.requester_id,
        'Réquisition rejetée ❌',
        `Votre réquisition ${requisition.requisition_number} a été rejetée. Motif: ${reason}`,
        'ERROR',
        `/requisitions/${id}`
      );

      // Émettre une mise à jour de la réquisition
      this.emitRequisitionUpdate(io, id, {
        status: 'REJECTED',
        rejectedBy: userId,
        rejectedAt: new Date().toISOString(),
        rejectionReason: reason
      });

      return res.json({
        success: true,
        message: 'Réquisition rejetée',
        data: result
      });
    } catch (error) {
      console.error('Error rejecting requisition:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors du rejet de la réquisition',
        error: error.message
      });
    }
  }

  /**
   * Soumettre une réquisition
   */
  async submit(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id || 1;
      const io = req.io;
      const userEmail = await this.getUserEmailById(userId);

      const requisition = await requisitionModel.findById(id);
      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Réquisition non trouvée'
        });
      }

      const result = await requisitionModel.submit(id);

      // Émettre une notification de soumission
      this.emitNotification(
        io, userId,
        'Réquisition soumise 📤',
        `Votre réquisition ${requisition.requisition_number} a été soumise pour approbation`,
        'INFO',
        `/requisitions/${id}`
      );

      // Émettre une mise à jour de la réquisition
      this.emitRequisitionUpdate(io, id, {
        status: 'PENDING',
        submittedAt: new Date().toISOString(),
        submittedBy: userEmail || userId
      });

      return res.json({
        success: true,
        message: 'Réquisition soumise avec succès',
        data: result
      });
    } catch (error) {
      console.error('Error submitting requisition:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la soumission de la réquisition',
        error: error.message
      });
    }
  }

  /**
   * Annuler une réquisition
   */
  async cancel(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const userId = req.user?.id || 1;
      const io = req.io;

      const requisition = await requisitionModel.findById(id);
      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Réquisition non trouvée'
        });
      }

      const result = await requisitionModel.cancel(id, reason);

      // Émettre une notification d'annulation
      this.emitNotification(
        io, requisition.requester_id,
        'Réquisition annulée',
        `Votre réquisition ${requisition.requisition_number} a été annulée. Motif: ${reason || 'Non spécifié'}`,
        'WARNING',
        `/requisitions/${id}`
      );

      // Émettre une mise à jour de la réquisition
      this.emitRequisitionUpdate(io, id, {
        status: 'CANCELLED',
        cancelledAt: new Date().toISOString(),
        cancellationReason: reason
      });

      return res.json({
        success: true,
        message: 'Réquisition annulée avec succès',
        data: result
      });
    } catch (error) {
      console.error('Error cancelling requisition:', error);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'annulation de la réquisition',
        error: error.message
      });
    }
  }
}

module.exports = new RequisitionController();