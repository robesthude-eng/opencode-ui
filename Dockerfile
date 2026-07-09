# ===== Stage 1: build the React frontend =====
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ===== Stage 2: runtime with opencode + proxy =====
FROM node:20-slim AS runtime
WORKDIR /app

# Install opencode CLI
RUN npm install -g opencode-ai@1.17.13

# Copy package.json + install ALL deps (including dev) for rebuilds
COPY package*.json ./
RUN npm ci

# Copy built frontend
COPY --from=build /app/dist ./dist

# Copy server modules — DEPLOY_TS forces cache bust on every deploy
ARG DEPLOY_TS=unknown
COPY server.cjs ./
COPY server/db.cjs ./server/db.cjs
COPY server/auth.cjs ./server/auth.cjs
COPY server/middleware.cjs ./server/middleware.cjs
COPY server/upload.cjs ./server/upload.cjs
COPY server/self-improve.cjs ./server/self-improve.cjs
COPY server/index.cjs ./server/index.cjs
COPY start.sh ./
RUN chmod +x start.sh

# Verify all server modules load correctly (fails build if any missing)
RUN node -e "require('./server/db.cjs'); require('./server/auth.cjs'); require('./server/middleware.cjs'); require('./server/upload.cjs'); require('./server/self-improve.cjs'); console.log('All modules OK')"

# Copy SOURCE CODE into workspace so the agent can edit & improve the UI
COPY src ./workspace-src/src
COPY index.html ./workspace-src/index.html
COPY package.json ./workspace-src/package.json
COPY tsconfig.json ./workspace-src/tsconfig.json
COPY tsconfig.node.json ./workspace-src/tsconfig.node.json
COPY vite.config.ts ./workspace-src/vite.config.ts

# Railway injects PORT; our proxy listens on it.
ENV PORT=3000
EXPOSE 3000

# The opencode workspace (mount a Railway Volume here for persistence)
ENV OPENCODE_WORKDIR=/app/workspace
RUN mkdir -p /app/workspace

CMD ["sh", "start.sh"]
