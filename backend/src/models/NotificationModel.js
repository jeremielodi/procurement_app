// backend/src/models/NotificationModel.js
const db = require('../config/database');

class NotificationModel {
  /**
   * Créer une notification
   */
  async create(notificationData) {
    const { userId, title, message, type, link } = notificationData;
    
    const result = await db.insert('notifications', {
      user_id: userId,
      title,
      message,
      type: type || 'INFO',
      link: link || null,
      read: false,
      created_at: new Date()
    });
    
    return result;
  }

  /**
   * Récupérer les notifications d'un utilisateur
   */
  async getUserNotifications(userId, unreadOnly = false) {
    let sql = `
      SELECT * FROM notifications 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `;
    const params = [userId];
    
    if (unreadOnly) {
      sql = `
        SELECT * FROM notifications 
        WHERE user_id = $1 AND read = false 
        ORDER BY created_at DESC
      `;
    }
    
    return await db.select(sql, params);
  }

  /**
   * Récupérer une notification par ID
   */
  async getById(id) {
    return await db.one('SELECT * FROM notifications WHERE id = $1', [id]);
  }

  /**
   * Marquer une notification comme lue
   */
  async markAsRead(id) {
    return await db.update('notifications', { read: true }, 'id', id);
  }

  /**
   * Marquer toutes les notifications d'un utilisateur comme lues
   */
  async markAllAsRead(userId) {
    const sql = 'UPDATE notifications SET read = true WHERE user_id = $1 AND read = false';
    return await db.exec(sql, [userId]);
  }

  /**
   * Supprimer une notification
   */
  async delete(id) {
    return await db.delete('notifications', 'id', id);
  }

  /**
   * Supprimer toutes les notifications d'un utilisateur
   */
  async deleteAll(userId) {
    const sql = 'DELETE FROM notifications WHERE user_id = $1';
    return await db.exec(sql, [userId]);
  }

  /**
   * Compter les notifications non lues
   */
  async getUnreadCount(userId) {
    const result = await db.one(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false',
      [userId]
    );
    return parseInt(result.count);
  }
}

module.exports = new NotificationModel();