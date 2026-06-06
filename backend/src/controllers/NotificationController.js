// backend/src/controllers/NotificationController.js
const notificationModel = require('../models/NotificationModel');

class NotificationController {
  /**
   * Récupérer toutes les notifications d'un utilisateur
   */
  async getUserNotifications(req, res) {
    try {
      const { userId } = req.params;
      const { unread } = req.query;
      
      const unreadOnly = unread === 'true';
      const notifications = await notificationModel.getUserNotifications(userId, unreadOnly);
      
      res.json({
        success: true,
        data: notifications,
        count: notifications.length
      });
    } catch (error) {
      console.error('Error getting user notifications:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des notifications',
        error: error.message
      });
    }
  }

  /**
   * Récupérer une notification par ID
   */
  async getNotificationById(req, res) {
    try {
      const { id } = req.params;
      const notification = await notificationModel.getById(id);
      
      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification non trouvée'
        });
      }
      
      res.json({
        success: true,
        data: notification
      });
    } catch (error) {
      console.error('Error getting notification:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération de la notification',
        error: error.message
      });
    }
  }

  /**
   * Créer une notification
   */
  async createNotification(req, res) {
    try {
      const { userId, title, message, type, link } = req.body;
      
      if (!userId || !title || !message) {
        return res.status(400).json({
          success: false,
          message: 'userId, title et message sont requis'
        });
      }
      
      const notification = await notificationModel.create({
        userId,
        title,
        message,
        type: type || 'INFO',
        link: link || null
      });
      
      // Émettre via Socket.io si disponible
      if (req.io) {
        req.io.to(`user-${userId}`).emit('new_notification', {
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
      
      res.status(201).json({
        success: true,
        data: notification,
        message: 'Notification créée avec succès'
      });
    } catch (error) {
      console.error('Error creating notification:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la création de la notification',
        error: error.message
      });
    }
  }

  /**
   * Marquer une notification comme lue
   */
  async markAsRead(req, res) {
    try {
      const { id } = req.params;
      
      const notification = await notificationModel.getById(id);
      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification non trouvée'
        });
      }
      
      await notificationModel.markAsRead(id);
      
      res.json({
        success: true,
        message: 'Notification marquée comme lue'
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du marquage de la notification',
        error: error.message
      });
    }
  }

  /**
   * Marquer toutes les notifications comme lues
   */
  async markAllAsRead(req, res) {
    try {
      const { userId } = req.params;
      
      await notificationModel.markAllAsRead(userId);
      
      res.json({
        success: true,
        message: 'Toutes les notifications ont été marquées comme lues'
      });
    } catch (error) {
      console.error('Error marking all as read:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du marquage des notifications',
        error: error.message
      });
    }
  }

  /**
   * Compter les notifications non lues - CORRECTION ICI
   */
  async getUnreadCount(req, res) {
    try {
      const { userId } = req.params;
      
      // Vérifier que userId est valide
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'userId invalide'
        });
      }
      
      const count = await notificationModel.getUnreadCount(userId);
      
      res.json({
        success: true,
        count: count,
        userId: userId
      });
    } catch (error) {
      console.error('Error getting unread count:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du comptage des notifications',
        error: error.message
      });
    }
  }

  /**
   * Supprimer une notification
   */
  async deleteNotification(req, res) {
    try {
      const { id } = req.params;
      
      const notification = await notificationModel.getById(id);
      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification non trouvée'
        });
      }
      
      await notificationModel.delete(id);
      
      res.json({
        success: true,
        message: 'Notification supprimée avec succès'
      });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la suppression de la notification',
        error: error.message
      });
    }
  }

  /**
   * Supprimer toutes les notifications d'un utilisateur
   */
  async deleteAllNotifications(req, res) {
    try {
      const { userId } = req.params;
      
      await notificationModel.deleteAll(userId);
      
      res.json({
        success: true,
        message: 'Toutes les notifications ont été supprimées'
      });
    } catch (error) {
      console.error('Error deleting all notifications:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la suppression des notifications',
        error: error.message
      });
    }
  }
}

module.exports = new NotificationController();