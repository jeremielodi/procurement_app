// backend/src/services/NotificationService.js
const notificationModel = require('../models/NotificationModel');

class NotificationService {
  constructor(io) {
    this.io = io;
  }

  /**
   * Envoyer une notification à un utilisateur
   */
  async sendNotification(userId, title, message, type = 'INFO', link = null) {
    try {
      // Sauvegarder en base de données
      const notification = await notificationModel.create({
        userId,
        title,
        message,
        type,
        link
      });
      
      // Émettre via WebSocket
      if (this.io) {
        this.io.to(`user-${userId}`).emit('notification', {
          notification: {
            id: notification.id,
            title,
            message,
            type,
            link,
            created_at: new Date(),
            read: false
          }
        });
      }
      
      return notification;
    } catch (error) {
      console.error('Error sending notification:', error);
      throw error;
    }
  }

  /**
   * Récupérer toutes les notifications non lues d'un utilisateur
   */
  async getUnreadNotifications(userId) {
    try {
      const notifications = await notificationModel.getUserNotifications(userId, true);
      return {
        success: true,
        data: notifications,
        count: notifications.length,
        userId: userId
      };
    } catch (error) {
      console.error('Error getting unread notifications:', error);
      throw error;
    }
  }

  /**
   * Récupérer toutes les notifications d'un utilisateur
   */
  async getUserNotifications(userId, unreadOnly = false) {
    try {
      const notifications = await notificationModel.getUserNotifications(userId, unreadOnly);
      return {
        success: true,
        data: notifications,
        count: notifications.length,
        userId: userId,
        unreadOnly: unreadOnly
      };
    } catch (error) {
      console.error('Error getting user notifications:', error);
      throw error;
    }
  }

  /**
   * Récupérer une notification par ID
   */
  async getNotificationById(id) {
    try {
      const notification = await notificationModel.getById(id);
      if (!notification) {
        throw new Error('Notification non trouvée');
      }
      return {
        success: true,
        data: notification
      };
    } catch (error) {
      console.error('Error getting notification by id:', error);
      throw error;
    }
  }

  /**
   * Compter les notifications non lues d'un utilisateur
   */
  async getUnreadCount(userId) {
    try {
      const count = await notificationModel.getUnreadCount(userId);
      return {
        success: true,
        count: count,
        userId: userId
      };
    } catch (error) {
      console.error('Error getting unread count:', error);
      throw error;
    }
  }

  /**
   * Marquer une notification comme lue
   */
  async markAsRead(notificationId, userId) {
    try {
      const notification = await notificationModel.getById(notificationId);
      if (!notification) {
        throw new Error('Notification non trouvée');
      }
      
      // Vérifier que la notification appartient à l'utilisateur
      if (notification.user_id !== userId) {
        throw new Error('Non autorisé à modifier cette notification');
      }
      
      await notificationModel.markAsRead(notificationId);
      
      return {
        success: true,
        message: 'Notification marquée comme lue'
      };
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Marquer toutes les notifications d'un utilisateur comme lues
   */
  async markAllAsRead(userId) {
    try {
      await notificationModel.markAllAsRead(userId);
      
      return {
        success: true,
        message: 'Toutes les notifications ont été marquées comme lues'
      };
    } catch (error) {
      console.error('Error marking all as read:', error);
      throw error;
    }
  }

  /**
   * Supprimer une notification
   */
  async deleteNotification(notificationId, userId) {
    try {
      const notification = await notificationModel.getById(notificationId);
      if (!notification) {
        throw new Error('Notification non trouvée');
      }
      
      // Vérifier que la notification appartient à l'utilisateur
      if (notification.user_id !== userId) {
        throw new Error('Non autorisé à supprimer cette notification');
      }
      
      await notificationModel.delete(notificationId);
      
      return {
        success: true,
        message: 'Notification supprimée avec succès'
      };
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw error;
    }
  }

  /**
   * Supprimer toutes les notifications d'un utilisateur
   */
  async deleteAllNotifications(userId) {
    try {
      await notificationModel.deleteAll(userId);
      
      return {
        success: true,
        message: 'Toutes les notifications ont été supprimées'
      };
    } catch (error) {
      console.error('Error deleting all notifications:', error);
      throw error;
    }
  }

  /**
   * Notifier un groupe d'utilisateurs
   */
  async notifyGroup(userIds, title, message, type = 'INFO', link = null) {
    const promises = userIds.map(userId => 
      this.sendNotification(userId, title, message, type, link)
    );
    return await Promise.all(promises);
  }

  /**
   * Notifier les approbateurs d'une réquisition
   */
  async notifyApprovers(requisitionId, approvers, message) {
    const promises = approvers.map(approver =>
      this.sendNotification(
        approver.id,
        'Réquisition à approuver',
        message,
        'APPROVAL_REQUIRED',
        `/requisitions/${requisitionId}`
      )
    );
    return await Promise.all(promises);
  }

  /**
   * Notifier la création d'une réquisition
   */
  async notifyRequisitionCreated(requisitionId, requisitionNumber, requesterId) {
    return await this.sendNotification(
      requesterId,
      'Réquisition créée',
      `Votre réquisition ${requisitionNumber} a été créée avec succès`,
      'REQUISITION_CREATED',
      `/requisitions/${requisitionId}`
    );
  }

  /**
   * Notifier la soumission d'une réquisition
   */
  async notifyRequisitionSubmitted(requisitionId, requisitionNumber, approvers) {
    const promises = approvers.map(approver =>
      this.sendNotification(
        approver.id,
        'Réquisition à valider',
        `La réquisition ${requisitionNumber} nécessite votre validation`,
        'PENDING_APPROVAL',
        `/requisitions/${requisitionId}`
      )
    );
    return await Promise.all(promises);
  }

  /**
   * Notifier l'approbation d'une réquisition
   */
  async notifyRequisitionApproved(requisitionId, requisitionNumber, requesterId, approverName) {
    return await this.sendNotification(
      requesterId,
      'Réquisition approuvée',
      `Votre réquisition ${requisitionNumber} a été approuvée par ${approverName}`,
      'APPROVED',
      `/requisitions/${requisitionId}`
    );
  }

  /**
   * Notifier le rejet d'une réquisition
   */
  async notifyRequisitionRejected(requisitionId, requisitionNumber, requesterId, reason) {
    return await this.sendNotification(
      requesterId,
      'Réquisition rejetée',
      `Votre réquisition ${requisitionNumber} a été rejetée. Motif: ${reason}`,
      'REJECTED',
      `/requisitions/${requisitionId}`
    );
  }

  /**
   * Notifier la création d'une commande
   */
  async notifyPurchaseOrderCreated(poId, poNumber, supplierId, requesterId) {
    // Notifier le demandeur
    await this.sendNotification(
      requesterId,
      'Commande créée',
      `La commande ${poNumber} a été créée`,
      'PO_CREATED',
      `/purchase-orders/${poId}`
    );
    
    // Notifier le fournisseur (si email disponible)
    // Cette partie sera gérée par le fournisseur service
  }

  /**
   * Notifier la livraison d'une commande
   */
  async notifyDeliveryStatus(poId, poNumber, requesterId, status, trackingNumber = null) {
    let message = `La commande ${poNumber} est en cours de livraison`;
    if (trackingNumber) {
      message += ` (N° suivi: ${trackingNumber})`;
    }
    
    return await this.sendNotification(
      requesterId,
      `Livraison - ${status}`,
      message,
      'DELIVERY_UPDATE',
      `/purchase-orders/${poId}`
    );
  }

  /**
   * Notifier un rappel
   */
  async sendReminder(userId, title, message, link = null) {
    return await this.sendNotification(
      userId,
      title,
      message,
      'REMINDER',
      link
    );
  }

  /**
   * Notifier une erreur système
   */
  async notifySystemError(userId, errorMessage, context = null) {
    return await this.sendNotification(
      userId,
      'Erreur système',
      `Une erreur est survenue: ${errorMessage}`,
      'ERROR',
      context
    );
  }

  /**
   * Diffuser une notification à tous les utilisateurs (admin only)
   */
  async broadcastToAllUsers(userIds, title, message, type = 'INFO', link = null) {
    const promises = userIds.map(userId =>
      this.sendNotification(userId, title, message, type, link)
    );
    return await Promise.all(promises);
  }

  /**
   * Obtenir le résumé des notifications pour un utilisateur
   */
  async getNotificationSummary(userId) {
    try {
      const allNotifications = await notificationModel.getUserNotifications(userId, false);
      const unreadCount = await notificationModel.getUnreadCount(userId);
      
      const byType = {
        REQUISITION_CREATED: 0,
        APPROVED: 0,
        REJECTED: 0,
        PENDING_APPROVAL: 0,
        PO_CREATED: 0,
        DELIVERY_UPDATE: 0,
        REMINDER: 0,
        ERROR: 0,
        INFO: 0
      };
      
      allNotifications.forEach(notif => {
        if (byType.hasOwnProperty(notif.type)) {
          byType[notif.type]++;
        } else {
          byType.INFO++;
        }
      });
      
      // Notifications des 7 derniers jours
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const recentNotifications = allNotifications.filter(
        notif => new Date(notif.created_at) >= sevenDaysAgo
      );
      
      return {
        success: true,
        summary: {
          total: allNotifications.length,
          unread: unreadCount,
          read: allNotifications.length - unreadCount,
          byType: byType,
          last7Days: recentNotifications.length
        }
      };
    } catch (error) {
      console.error('Error getting notification summary:', error);
      throw error;
    }
  }
}

module.exports = new NotificationService();