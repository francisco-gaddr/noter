FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci
ENV NEXT_TELEMETRY_DISABLED=1
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
