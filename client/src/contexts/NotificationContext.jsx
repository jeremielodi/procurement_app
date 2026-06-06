// src/contexts/NotificationContext.jsx
import React, { createContext, useState, useEffect, useCallback } from 'react'
import { notificationService } from '../services/notificationService'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAuth } from '../hooks/useAuth'

export const NotificationContext = createContext(null)

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const { user } = useAuth()

  const loadNotifications = useCallback(async () => {
    if (!user?.id) return
    
    try {
      const result = await notificationService.getUserNotifications(user.id)
      setNotifications(result.data || [])
      
      const unreadResult = await notificationService.getUnreadCount(user.id)
      setUnreadCount(unreadResult.count || 0)
    } catch (error) {
      console.error('Error loading notifications:', error)
    }
  }, [user?.id])

  useEffect(() => {
    loadNotifications()
    const interval = setInterval(loadNotifications, 30000)
    return () => clearInterval(interval)
  }, [loadNotifications])

  // WebSocket pour notifications en temps réel
  useWebSocket('notification', (data) => {
    if (data.userId === user?.id) {
      setNotifications(prev => [data.notification, ...prev])
      setUnreadCount(prev => prev + 1)
    }
  })

  const markAsRead = async (notificationId) => {
    await notificationService.markAsRead(notificationId)
    await loadNotifications()
  }

  const markAllAsRead = async () => {
    if (user?.id) {
      await notificationService.markAllAsRead(user.id)
      await loadNotifications()
    }
  }

  const addNotification = (notification) => {
    setNotifications(prev => [notification, ...prev])
    setUnreadCount(prev => prev + 1)
  }

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        addNotification,
        loadNotifications
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}