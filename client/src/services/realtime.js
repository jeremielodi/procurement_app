// src/services/realtime.js — connexion Socket.io unique de l'application.
// Ouverte par AuthContext à la connexion (token JWT dans le handshake), fermée à la déconnexion.
import io from 'socket.io-client'

let socket = null
const subscribers = new Set()
const notify = () => subscribers.forEach(fn => fn())

export function connectRealtime(token) {
  if (socket || !token) return socket
  // Même serveur que la page (en dev, le proxy Vite redirige /socket.io vers le backend)
  socket = io(import.meta.env.VITE_WS_URL || window.location.origin, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  })
  socket.on('connect', notify)
  socket.on('disconnect', notify)
  socket.on('connect_error', (err) => console.error('WebSocket connection error:', err.message))
  notify()
  return socket
}

export function disconnectRealtime() {
  if (!socket) return
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
  notify()
}

export const getSocket = () => socket

/** Abonnement aux changements (connexion / déconnexion / remplacement du socket) */
export function subscribeRealtime(fn) {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}
