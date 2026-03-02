FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y git python3 build-essential cmake && rm -rf /var/lib/apt/lists/*

# Copy only package files first for better caching
COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/ ./packages/

# Install dependencies with cache
RUN npm ci

# Copy source code
COPY apps/web/ ./apps/web/
COPY packages/ ./packages/

# Build with environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npx turbo run build --filter=web

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/package.json .
COPY --from=builder /app/package-lock.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/packages ./packages

WORKDIR /app/apps/web
EXPOSE 3000

CMD ["npm", "start"]
