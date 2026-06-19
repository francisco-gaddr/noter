FROM node:20-alpine AS builder
WORKDIR /app

# Copy only package files first for better caching
COPY package.json package-lock.json turbo.json ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/ ./packages/

# Install dependencies with cache
RUN npm ci --include=dev

# Build shared packages first
RUN npx turbo run build --filter=@repo/shared

# Copy source code
COPY apps/backend/ ./apps/backend/
COPY packages/ ./packages/

# Build backend
RUN npx turbo run build --filter=backend

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/package.json .
COPY --from=builder /app/package-lock.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend ./apps/backend
COPY --from=builder /app/packages ./packages

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Container health: probe the auth-free /api/health (200 = up). Uses node (always present) so it
# needs no curl/wget in the image. start-period covers Mongo connect + migrations on boot. Lets
# `docker ps`/compose mark the container unhealthy and the Pi deploy gate detect a broken build.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/backend/dist/index.js"]
