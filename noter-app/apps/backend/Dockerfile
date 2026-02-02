FROM node:20-alpine AS builder
WORKDIR /app
# Copy the entire monorepo to ensure shared packages are available
COPY . .
RUN npm ci
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
