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

CMD ["node", "apps/backend/dist/index.js"]
