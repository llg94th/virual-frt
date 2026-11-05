# ============================================================================
# Multi-Stage Dockerfile for Virtual FRT Office 2D + Hardened Backend Proxy
# ============================================================================

# Stage 1: Build Frontend Static Bundle (`dist/`)
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Minimal Production Runtime (`server/proxyServer.mjs` + `dist/`)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787
ENV BIND_HOST=0.0.0.0

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/public/health || exit 1

CMD ["node", "server/proxyServer.mjs"]
