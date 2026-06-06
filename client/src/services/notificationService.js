// src/services/notificationService.js
import api from './api'

export const notificationService = {
  // Récupérer les notifications d'un utilisateur
  getUserNotifications: async (userId, unreadOnly = false) => {
    const params = unreadOnly ? { unread: true } : {}
    const response = await api.get(`/notifications/${userId}`, { params })
    return response.data
  },

  // Récupérer une notification par ID
  getById: async (id) => {
    const response = await api.get(`/notifications/${id}`)
    return response.data
  },

  // Marquer une notification comme lue
  markAsRead: async (notificationId) => {
    const response = await api.put(`/notifications/${notificationId}/read`)
    return response.data
  },

  // Marquer toutes les notifications comme lues
  markAllAsRead: async (userId) => {
    const response = await api.put(`/notifications/${userId}/read-all`)
    return response.data
  },

  // Supprimer une notification
  delete: async (notificationId) => {
    const response = await api.delete(`/notifications/${notificationId}`)
    return response.data
  },

  // Récupérer le nombre de notifications non lues
  getUnreadCount: async (userId) => {
    const response = await api.get(`/notifications/${userId}/unread-count`)
    return response.data
  },

  // Créer une notification
  create: async (data) => {
    const response = await api.post('/notifications', data)
    return response.data
  },

  // Supprimer toutes les notifications d'un utilisateur
  deleteAll: async (userId) => {
    const response = await api.delete(`/notifications/${userId}/all`)
    return response.data
  }
}