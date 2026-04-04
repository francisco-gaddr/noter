# Noter Backend

Backenden hanterar auth, notes, tasks, sync, sockets och AI/MCP-relaterade serverflöden för Noter. Den är nu förberedd för open source-publicering utan commitade hemligheter eller hårdkodade produktionsdomäner.

## Funktioner

- REST API för anteckningar, uppgifter, auth, sync och AI/MCP-flöden
- Socket.io för realtidshändelser per användarscope
- MongoDB-modeller med idempotenta klient-ID:n för offline/sync-fall
- Fail-closed säkerhetsinställningar för JWT, CORS, audit-nycklar och request-härdning
- Opt-in Redis-cache när `REDIS_URL` sätts lokalt

## Teknisk stack

- Node.js
- Express
- TypeScript
- MongoDB/Mongoose
- Socket.io

## Viktiga mappar

- `src/index.ts` – serverstart, middleware, sockets och route-registrering
- `src/routes` – API-endpoints
- `src/models` – Mongoose-modeller
- `src/services` – cache, AI, audit och integrationslogik
- `__tests__` – enhets- och integrationstester

## Kom igång

### Förutsättningar

- Node.js 20+
- MongoDB

### Lokal konfiguration

Kopiera `.env.example` till `.env` i `apps/backend`.

```env
PORT=3001
MONGO_URI=mongodb://localhost:27017/noter
JWT_SECRET=replace-with-a-local-secret
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:8081
REDIS_URL=
ALLOW_DEMO_TOKEN=false
MCP_AUDIT_MASTER_KEY=replace-with-a-local-audit-key
```

### Säkerhetsregler för env

- `JWT_SECRET` krävs i produktion
- `MCP_AUDIT_MASTER_KEY` eller `MCP_AUDIT_MASTER_KEYS` krävs i produktion
- `CORS_ORIGINS` måste sättas explicit i produktion
- `ALLOW_DEMO_TOKEN` är avstängd som standard
- `REDIS_URL` är valfri och aktiverar cache endast när den sätts

### Starta lokalt

```bash
npm run dev --workspace=apps/backend
```

### Bygg och testa

```bash
npm run check-types --workspace=apps/backend
npm test --workspace=apps/backend
```

## Open source-notering

- Lägg aldrig riktiga `.env`-filer i versionskontroll
- Lägg aldrig riktiga origins eller deploydomäner i koden
- Publicera endast `.env.example` med lokala placeholders
- Sätt produktionens hemligheter via din egen driftmiljö eller secret manager
