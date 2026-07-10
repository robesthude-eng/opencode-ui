# ===== Stage 1: build the React frontend =====
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ===== Stage 2: runtime (full deps for self-improve sandbox rebuilds) =====
FROM node:22-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g opencode-ai@1.17.13

# Full install: self-improve sandbox needs tsc/vitest/biome/vite
COPY package*.json ./
RUN npm ci

COPY --from=build /app/dist ./dist

ARG DEPLOY_TS=unknown
COPY server.mjs ./
COPY server/ ./server/

COPY src ./workspace-src/src
COPY public ./workspace-src/public
COPY index.html ./workspace-src/index.html
COPY package.json ./workspace-src/package.json
COPY package-lock.json ./workspace-src/package-lock.json
COPY tsconfig.json ./workspace-src/tsconfig.json
COPY tsconfig.node.json ./workspace-src/tsconfig.node.json
COPY vite.config.ts ./workspace-src/vite.config.ts
COPY biome.json ./workspace-src/biome.json
COPY vitest.config.ts ./workspace-src/vitest.config.ts
COPY SELF_IMPROVE.md SELF_IMPROVE_GUIDE.md ./workspace-src/

RUN node --input-type=module -e "\
  import './server/db.mjs'; \
  import './server/auth.mjs'; \
  import './server/middleware.mjs'; \
  import './server/upload.mjs'; \
  import './server/self-improve.mjs'; \
  import './server/sandbox.mjs'; \
  import './server/logger.mjs'; \
  import './server/rate-limit.mjs'; \
  import './server/backup.mjs'; \
  import './server/sentry.mjs'; \
  console.log('All modules OK');"

COPY start.sh ./
RUN chmod +x start.sh

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

ENV OPENCODE_WORKDIR=/app/workspace
RUN mkdir -p /app/workspace /app/dist-versions

CMD ["sh", "start.sh"]
