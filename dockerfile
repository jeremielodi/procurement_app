# Stage 1: Build React client
FROM node:24-alpine AS client-builder

WORKDIR /app/client

COPY client/package*.json ./
RUN npm install

COPY client/ .
RUN npm run build


# Stage 2: Backend dependencies
FROM node:24-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm install --omit=dev


# Stage 3: Production
FROM node:24-alpine

WORKDIR /app

# Required packages
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    postgresql-client \
    curl

ENV NODE_ENV=production
ENV PORT=5000
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create user
RUN addgroup -S nodejs && \
    adduser -S nodejs -G nodejs

# Backend structure preserved
COPY --from=backend-builder /app/backend/node_modules /app/backend/node_modules
COPY backend /app/backend

# Client build exactly where server.js expects it
COPY --from=client-builder /app/client/dist /app/client/dist

# Uploads & logs
RUN mkdir -p /app/uploads /app/logs && \
    chown -R nodejs:nodejs /app

USER nodejs

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
 CMD curl -f http://localhost:5000/health || exit 1

EXPOSE 5000

WORKDIR /app/backend
COPY ./backend/.env .env
CMD ["node", "server.js"]