# Dockerfile.multistage
# Stage 1: Build du client React
FROM node:24-alpine AS client-builder

WORKDIR /app/client

# Copier les fichiers du client
COPY client/package*.json ./

# Installer les dépendances du client
RUN npm Install

# Copier le code source du client
COPY client/ .

# Build du client
RUN npm run build

# Stage 2: Build du backend
FROM node:24-alpine AS backend-builder

WORKDIR /app/backend

# Copier les fichiers du backend
COPY backend/package*.json ./

# Installer les dépendances du backend
RUN npm install --only=production

# Stage 3: Production
FROM node:24-alpine

WORKDIR /app

# Installer les dépendances système
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client \
    curl

# Créer l'utilisateur non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copier les dépendances backend
COPY --from=backend-builder --chown=nodejs:nodejs /app/backend/node_modules ./node_modules

# Copier le code source backend
COPY --chown=nodejs:nodejs backend/ .

# Copier le client build
COPY --from=client-builder --chown=nodejs:nodejs /app/client/dist ./client/dist

# Créer le répertoire pour les uploads
RUN mkdir -p /app/uploads && chown -R nodejs:nodejs /app/uploads

# Créer le répertoire pour les logs
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

# Variables d'environnement
ENV NODE_ENV=production
ENV PORT=5000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Exposer le port
EXPOSE 5000

# Changer vers l'utilisateur non-root
USER nodejs

# Démarrer l'application
CMD ["node", "server.js"]