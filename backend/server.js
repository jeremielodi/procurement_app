// backend/server.js
require('./env');
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const routes = require('./src/routes');
const db = require('./src/config/database');
const { startWorkers } = require('./src/workers');
const { startTaskListener } = require('./src/workers/task_listner')
const databaseInitializer = require('./src/utils/initDatabase');
const storage = require('./src/services/StorageService');

// MinIO peut démarrer après l'application : quelques tentatives avant d'abandonner
async function initStorage(attempts = 10) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await storage.init();
      console.log(`✅ Stockage des fichiers : ${storage.driver}${storage.driver === 'minio' ? ` (bucket ${storage.bucket})` : ''}`);
      return;
    } catch (error) {
      console.error(`⚠️ Stockage indisponible (tentative ${i}/${attempts}) : ${error.message}`);
      if (i === attempts) throw error;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}
const path = require('path');
const helmet = require('helmet');
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
// HTTPS uniquement si l'application est publiée en https (APP_URL). En HTTP (ex. http://domaine:5000),
// « upgrade-insecure-requests » ferait charger JS/CSS/images en https → ERR_SSL_PROTOCOL_ERROR, page blanche.
const HTTPS_ENABLED = /^https:/i.test(process.env.APP_URL || '');

app.use(
  helmet({
    // En-têtes qui n'ont de sens qu'en HTTPS (sinon simples avertissements du navigateur)
    crossOriginOpenerPolicy: HTTPS_ENABLED,
    originAgentCluster: HTTPS_ENABLED,
    strictTransportSecurity: HTTPS_ENABLED,
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'upgrade-insecure-requests': HTTPS_ENABLED ? [] : null,
        // Allows the browser to load blob URLs inside iframes
        "frame-src": ["'self'", "blob:"], 
        // Aperçu local des images avant upload (logo fournisseur)
        "img-src": ["'self'", "data:", "blob:"],
        // Optional: Add to worker-src if you are also using web workers
        "worker-src": ["'self'", "blob:"], 
      },
    },
  })
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Langue de la requête (?lang= / Accept-Language) lisible par les modèles (référentiels traduits)
app.use(require('./src/utils/requestLang').requestLanguage);

// Passer io aux routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api', routes);

// Les fichiers uploadés ne sont PAS servis en statique : uniquement via l'API (authentifiée,
// cloisonnée par entreprise) depuis le stockage (MinIO ou disque) — voir services/StorageService.js
app.use(express.static( path.resolve(__dirname, '../client/dist')));
// Health check
app.get('/health', async (req, res) => {
  try {
    await db.select('SELECT 1 as test', []);
    res.json({ status: 'OK', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', database: 'disconnected', error: error.message });
  }
});

// 3. The Catch-All Route: Redirects everything else back to React
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});
// Socket.IO connection handling
// Authentification du WebSocket : token JWT du handshake (auth.token), sinon connexion refusée
io.use((socket, next) => {
  try {
    const { id } = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
    socket.data.userId = id;
    next();
  } catch {
    next(new Error('Non authentifié'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  // Room personnelle rejointe côté serveur : un client ne peut écouter que ses propres notifications
  socket.join(`user-${userId}`);
  console.log(`🟢 New client connected: ${socket.id} (user ${userId})`);

  // Compatibilité anciens clients : seule sa propre room est acceptée
  socket.on('join', (requestedUserId) => {
    if (requestedUserId && String(requestedUserId) !== String(userId)) {
      console.warn(`⛔ Socket ${socket.id} : room user-${requestedUserId} refusée (user ${userId})`);
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

    // Stockage des fichiers (bucket MinIO privé et versionné, ou dossier local)
    await initStorage();
    
    // Démarrer les workers Camunda
    startWorkers();
    
    // task Listner
    startTaskListener(io);

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