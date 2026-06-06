// src/hooks/useWebSocket.js
import { useEffect, useState, useRef, useCallback } from 'react'
import io from 'socket.io-client'

export const useWebSocket = () => {
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef(null)
  const listenersRef = useRef(new Map())

  const connect = useCallback(() => {
    const SOCKET_URL = import.meta.env.VITE_WS_URL || 'http://localhost:5000'
    
    if (socketRef.current?.connected) {
      return socketRef.current
    }

    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    })

    socketRef.current.on('connect', () => {
      console.log('🔌 WebSocket connected')
      setIsConnected(true)
      
      // Rejoindre la room de l'utilisateur
      const userId = localStorage.getItem('userId')
      if (userId) {
        socketRef.current.emit('join', userId)
      }
    })

    socketRef.current.on('disconnect', () => {
      console.log('🔌 WebSocket disconnected')
      setIsConnected(false)
    })

    socketRef.current.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error)
      setIsConnected(false)
    })

    return socketRef.current
  }, [])

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
      setIsConnected(false)
    }
  }, [])

  const on = useCallback((event, callback) => {
    if (socketRef.current) {
      socketRef.current.on(event, callback)
      listenersRef.current.set(event, callback)
    }
  }, [])

  const off = useCallback((event, callback) => {
    if (socketRef.current) {
      socketRef.current.off(event, callback)
      listenersRef.current.delete(event)
    }
  }, [])

  const emit = useCallback((event, data) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit(event, data)
    }
  }, [isConnected])

  useEffect(() => {
    connect()
    
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    socket: socketRef.current,
    isConnected,
    connect,
    disconnect,
    on,
    off,
    emit
  }
}