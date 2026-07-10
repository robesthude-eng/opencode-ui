# ===== Stage 1: build the React frontend =====
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ===== Stage 2: runtime with opencode + proxy =====
FROM node:22-slim AS runtime
WORKDIR /app

# Install opencode CLI
RUN npm install -g opencode-ai@1.17.13

# Copy package.json + install ALL deps (including dev) for rebuilds
# better-sqlite3 needs build tools for native module
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci

# Copy built frontend
COPY --from=build /app/dist ./dist

# Copy server modules — DEPLOY_TS forces cache bust on every deploy
ARG DEPLOY_TS=unknown
COPY server.mjs ./
COPY server/ ./server/

# Verify all server modules load correctly (fails build if any missing).
# ESM modules can't be require()'d, so import them with --input-type=module.
RUN node --input-type=module -e "\
  import './server/db.mjs'; \
  import './server/auth.mjs'; \
  import './server/middleware.mjs'; \
  import './server/upload.mjs'; \
  import './server/self-improve.mjs'; \
  import './server/sandbox.mjs'; \
  import './server/ast-modifier.mjs'; \
  console.log('All modules OK');"

COPY start.sh ./
RUN chmod +x start.sh

# Copy SOURCE CODE into workspace so the agent can edit & improve the UI
COPY src ./workspace-src/src
COPY index.html ./workspace-src/index.html
COPY package.json ./workspace-src/package.json
COPY tsconfig.json ./workspace-src/tsconfig.json
COPY tsconfig.node.json ./workspace-src/tsconfig.node.json
COPY vite.config.ts ./workspace-src/vite.config.ts

# Railway injects PORT; our proxy listens on it.
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

# The opencode workspace (mount a Railway Volume here for persistence)
ENV OPENCODE_WORKDIR=/app/workspace
RUN mkdir -p /app/workspace

CMD ["sh", "start.sh"]
