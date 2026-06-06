// backend/server.js
require('./env');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const socketIo = require('socket.io');
const routes = require('./src/routes');
const db = require('./src/config/database');
const { startWorkers } = require('./src/workers');
const databaseInitializer = require('./src/utils/initDatabase');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Passer io aux routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api', routes);

// Health check
app.get('/health', async (req, res) => {
  try {
    await db.select('SELECT 1 as test', []);
    res.json({ status: 'OK', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', database: 'disconnected', error: error.message });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🟢 New client connected: ${socket.id}`);
  
  // Rejoindre une room spécifique à un utilisateur
  socket.on('join', (userId) => {
    if (userId) {
      socket.join(`user-${userId}`);
      console.log(`📌 User ${userId} joined room user-${userId}`);
    }
  });
  
  // Rejoindre une room spécifique à une réquisition
  socket.on('join-requisition', (requisitionId) => {
    if (requisitionId) {
      socket.join(`requisition-${requisitionId}`);
      console.log(`📌 Joined requisition room: requisition-${requisitionId}`);
    }
  });
  
  // Rejoindre une room spécifique à une commande
  socket.on('join-purchase-order', (poId) => {
    if (poId) {
      socket.join(`po-${poId}`);
      console.log(`📌 Joined PO room: po-${poId}`);
    }
  });
  
  // Rejoindre une room spécifique à un workflow
  socket.on('join-workflow', (processInstanceId) => {
    if (processInstanceId) {
      socket.join(`workflow-${processInstanceId}`);
      console.log(`📌 Joined workflow room: workflow-${processInstanceId}`);
    }
  });
  
  // Quitter une room
  socket.on('leave', (room) => {
    if (room) {
      socket.leave(room);
      console.log(`📌 Left room: ${room}`);
    }
  });
  
  // Écouter les événements personnalisés
  socket.on('notification-read', (notificationId) => {
    console.log(`📖 Notification read: ${notificationId}`);
    // Émettre à l'utilisateur spécifique
    io.emit(`notification-${notificationId}-read`, { notificationId });
  });
  
  // Déconnexion
  socket.on('disconnect', () => {
    console.log(`🔴 Client disconnected: ${socket.id}`);
  });
});

// Émettre des notifications en temps réel
const emitNotification = (userId, notification) => {
  io.to(`user-${userId}`).emit('new-notification', notification);
  console.log(`🔔 Notification sent to user ${userId}:`, notification.title);
};

// Émettre une mise à jour de réquisition
const emitRequisitionUpdate = (requisitionId, data) => {
  io.to(`requisition-${requisitionId}`).emit('requisition-update', data);
  console.log(`📝 Requisition update for ${requisitionId}`);
};

// Émettre une mise à jour de commande
const emitPurchaseOrderUpdate = (poId, data) => {
  io.to(`po-${poId}`).emit('po-update', data);
  console.log(`📦 PO update for ${poId}`);
};

// Émettre une mise à jour de workflow
const emitWorkflowUpdate = (processInstanceId, data) => {
  io.to(`workflow-${processInstanceId}`).emit('workflow-update', data);
  console.log(`🔄 Workflow update for ${processInstanceId}`);
};

// Rendre les fonctions disponibles globalement
app.set('io', io);
app.set('emitNotification', emitNotification);
app.set('emitRequisitionUpdate', emitRequisitionUpdate);
app.set('emitPurchaseOrderUpdate', emitPurchaseOrderUpdate);
app.set('emitWorkflowUpdate', emitWorkflowUpdate);

// Fonction pour initialiser la base de données et démarrer le serveur
async function startServer() {
  try {
    // Initialiser la base de données (créer les profils, permissions, superuser)
    await databaseInitializer.init();
    
    // Démarrer les workers Camunda
    startWorkers();
    
    // Démarrer le serveur
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`✅ API available at http://localhost:${PORT}/api`);
      console.log(`✅ WebSocket available at ws://localhost:${PORT}`);
      console.log(`✅ Camunda workers started`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Démarrer le serveur
startServer();

// Gestion de l'arrêt propre
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  io.close(() => {
    console.log('WebSocket server closed');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down gracefully...');
  io.close(() => {
    console.log('WebSocket server closed');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
});

module.exports = { app, server, io };