FROM node:20-alpine AS builder
WORKDIR /app

# Install git and other build dependencies required for node-llama-cpp
RUN apk add --no-cache git python3 make g++ cmake linux-headers

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

FROM node:20-alpine AS runner
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
