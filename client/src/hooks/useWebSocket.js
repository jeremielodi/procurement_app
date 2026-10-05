// src/hooks/useWebSocket.js — accès au socket partagé (services/realtime.js), sans en ouvrir un nouveau
import { useEffect, useState } from 'react'
import { getSocket, subscribeRealtime } from '../services/realtime'

const snapshot = () => {
  const socket = getSocket()
  return { socket, isConnected: !!socket?.connected }
}

export const useWebSocket = () => {
  const [state, setState] = useState(snapshot)

  useEffect(() => {
    setState(snapshot())
    return subscribeRealtime(() => setState(snapshot()))
  }, [])

  return state
}
