// src/components/Notifications/NotificationBell.jsx
import React, { useState, useEffect, useRef } from 'react'
import { Bell, Check, X, Clock, ShoppingCart, FileText, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { notificationService } from '../../services/notificationService'
import { useAuth } from '../../hooks/useAuth'
import { formatDistanceToNow, isValid } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import io from 'socket.io-client'

const getNotificationIcon = (type) => {
  switch (type) {
    case 'REQUISITION_CREATED':
      return <ShoppingCart size={16} className="text-blue-500" />
    case 'REQUISITION_APPROVED':
      return <CheckCircle size={16} className="text-green-500" />
    case 'REQUISITION_REJECTED':
      return <XCircle size={16} className="text-red-500" />
    case 'BUDGET_CHECKED':
      return <AlertCircle size={16} className="text-yellow-500" />
    case 'PO_CREATED':
      return <FileText size={16} className="text-purple-500" />
    case 'SUCCESS':
      return <CheckCircle size={16} className="text-green-500" />
    case 'ERROR':
      return <XCircle size={16} className="text-red-500" />
    case 'WARNING':
      return <AlertCircle size={16} className="text-yellow-500" />
    case 'INFO':
      return <Bell size={16} className="text-blue-500" />
    default:
      return <Bell size={16} className="text-gray-500" />
  }
}

const getNotificationColor = (type) => {
  switch (type) {
    case 'REQUISITION_CREATED':
      return 'bg-blue-50 border-blue-200'
    case 'REQUISITION_APPROVED':
      return 'bg-green-50 border-green-200'
    case 'REQUISITION_REJECTED':
      return 'bg-red-50 border-red-200'
    case 'BUDGET_CHECKED':
      return 'bg-yellow-50 border-yellow-200'
    case 'PO_CREATED':
      return 'bg-purple-50 border-purple-200'
    case 'SUCCESS':
      return 'bg-green-50 border-green-200'
    case 'ERROR':
      return 'bg-red-50 border-red-200'
    case 'WARNING':
      return 'bg-yellow-50 border-yellow-200'
    default:
      return 'bg-gray-50 border-gray-200'
  }
}

// Fonction pour formater la date de manière sécurisée
const formatDateSafe = (dateString) => {
  if (!dateString) return 'Date inconnue'
  
  const date = new Date(dateString)
  if (!isValid(date)) return 'Date invalide'
  
  try {
    return formatDistanceToNow(date, { addSuffix: true, locale: fr })
  } catch (error) {
    console.error('Error formatting date:', error)
    return 'Date inconnue'
  }
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [socket, setSocket] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const dropdownRef = useRef(null)
  const { user } = useAuth()

  // Récupérer l'ID de l'utilisateur connecté depuis le contexte d'authentification
  const userId = user?.id

  // Initialiser la connexion WebSocket
  useEffect(() => {
    if (!userId) return

    const SOCKET_URL = import.meta.env.VITE_WS_URL || 'http://localhost:5000'
    
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    })

    newSocket.on('connect', () => {
      console.log('🔌 WebSocket connected for user:', userId)
      setIsConnected(true)
      // Rejoindre la room de l'utilisateur
      newSocket.emit('join', userId)
    })

    newSocket.on('disconnect', () => {
      console.log('🔌 WebSocket disconnected')
      setIsConnected(false)
    })

    newSocket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error)
      setIsConnected(false)
    })

    // Écouter les nouvelles notifications
    newSocket.on('notification', (data) => {
      console.log('🔔 New notification received via WebSocket:', data)
      
      // Vérifier que la notification est pour cet utilisateur
      if (data.userId === userId || !data.userId) {
        setNotifications(prev => [data, ...prev])
        setUnreadCount(prev => prev + 1)
        
        // Afficher un toast
        toast.custom((t) => (
          <div className="max-w-md w-full bg-white shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5">
            <div className="flex-1 w-0 p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0 pt-0.5">
                  {getNotificationIcon(data.type)}
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm font-medium text-gray-900">{data.title}</p>
                  <p className="mt-1 text-sm text-gray-500">{data.message}</p>
                </div>
              </div>
            </div>
            <div className="flex border-l border-gray-200">
              <button
                onClick={() => {
                  toast.dismiss(t.id)
                  if (data.link) window.location.href = data.link
                }}
                className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                Voir
              </button>
            </div>
          </div>
        ), { duration: 5000, position: 'top-right' })
      }
    })

    setSocket(newSocket)

    return () => {
      if (newSocket) {
        newSocket.disconnect()
      }
    }
  }, [userId])

  // Charger les notifications depuis l'API
  const loadNotifications = async () => {
    if (!userId) return
    
    setIsLoading(true)
    try {
      const result = await notificationService.getUserNotifications(userId)
      // S'assurer que les notifications ont une date valide
      const validNotifications = (result.data || []).map(notif => ({
        ...notif,
        created_at: notif.created_at || new Date().toISOString()
      }))
      setNotifications(validNotifications)
      
      const unreadResult = await notificationService.getUnreadCount(userId)
      setUnreadCount(unreadResult.count || 0)
    } catch (error) {
      console.error('Error loading notifications:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadNotifications()
    // Rafraîchir toutes les 30 secondes (fallback)
    const interval = setInterval(loadNotifications, 30000)
    return () => clearInterval(interval)
  }, [userId])

  // Fermer le dropdown quand on clique en dehors
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleMarkAsRead = async (notificationId) => {
    try {
      await notificationService.markAsRead(notificationId)
      setNotifications(prev => 
        prev.map(notif => 
          notif.id === notificationId ? { ...notif, read: true } : notif
        )
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Error marking notification as read:', error)
    }
  }

  const handleMarkAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead(userId)
      setNotifications(prev => prev.map(notif => ({ ...notif, read: true })))
      setUnreadCount(0)
    } catch (error) {
      console.error('Error marking all as read:', error)
    }
  }

  const handleNotificationClick = (notification) => {
    if (!notification.read) {
      handleMarkAsRead(notification.id)
    }
    if (notification.link) {
      window.location.href = notification.link
    }
    setIsOpen(false)
  }

  const handleDelete = async (notificationId, e) => {
    e.stopPropagation()
    try {
      await notificationService.delete(notificationId)
      setNotifications(prev => prev.filter(n => n.id !== notificationId))
      if (notifications.find(n => n.id === notificationId)?.read === false) {
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    } catch (error) {
      console.error('Error deleting notification:', error)
    }
  }

  // Ne pas afficher si l'utilisateur n'est pas connecté
  if (!userId) return null

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Indicateur de connexion WebSocket */}
      {!isConnected && (
        <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" title="WebSocket déconnecté" />
      )}
      
      {/* Bouton de notification */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-bold leading-none text-white bg-red-500 rounded-full transform translate-x-1/2 -translate-y-1/2">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown des notifications */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden">
          {/* En-tête */}
          <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
            <div>
              <h3 className="text-lg font-semibold text-gray-800">Notifications</h3>
              <p className="text-xs text-gray-500 mt-1">
                {unreadCount} non lue{unreadCount > 1 ? 's' : ''}
              </p>
              {!isConnected && (
                <p className="text-xs text-red-500 mt-1">⚠️ Connexion temps réel instable</p>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
              >
                Tout marquer comme lu
              </button>
            )}
          </div>

          {/* Liste des notifications */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bell size={48} className="text-gray-300 mb-3" />
                <p className="text-gray-500 font-medium">Aucune notification</p>
                <p className="text-sm text-gray-400 mt-1">Vous serez notifié des activités importantes</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`
                    p-4 border-b border-gray-100 cursor-pointer transition-all duration-200
                    ${!notification.read ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}
                    ${getNotificationColor(notification.type)}
                  `}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {getNotificationIcon(notification.type)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <p className={`text-sm font-medium ${!notification.read ? 'text-gray-900' : 'text-gray-700'}`}>
                          {notification.title}
                        </p>
                        <button
                          onClick={(e) => handleDelete(notification.id, e)}
                          className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 rounded hover:bg-gray-100"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {notification.message}
                      </p>
                      
                      <div className="flex items-center gap-2 mt-2">
                        <Clock size={12} className="text-gray-400" />
                        <p className="text-xs text-gray-400">
                          {formatDateSafe(notification.created_at)}
                        </p>
                        {!notification.read && <span className="ml-2 w-2 h-2 bg-blue-600 rounded-full"></span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pied de page */}
          {notifications.length > 0 && (
            <div className="p-3 border-t border-gray-200 bg-gray-50 text-center">
              <button
                onClick={() => {
                  setIsOpen(false)
                  window.location.href = '/notifications'
                }}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Voir toutes les notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}