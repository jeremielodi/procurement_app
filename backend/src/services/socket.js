// src/services/socket.js
import io from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_WS_URL || 'http://localhost:5000';

let socket = null;

export const connectSocket = (userId) => {
  socket = io(SOCKET_URL, {
    transports: ['websocket'],
    autoConnect: true
  });
  
  socket.on('connect', () => {
    console.log('Socket connected');
    // Rejoindre la room de l'utilisateur
    socket.emit('join', userId);
  });
  
  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });
  
  socket.on('notification', (data) => {
    console.log('New notification:', data);
    // Déclencher un événement personnalisé
    window.dispatchEvent(new CustomEvent('new-notification', { detail: data }));
  });
  
  socket.on('requisition-update', (data) => {
    console.log('Requisition update:', data);
    window.dispatchEvent(new CustomEvent('requisition-update', { detail: data }));
  });
  
  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};