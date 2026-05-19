# Polish Pass — Backend

[← Index](./index.md)

## 1. Apollo Server v5 (replaces graphql-http)

**Files:** `src/index.ts`, `package.json`

We migrated from `graphql-http` to `@apollo/server@^5` + `@as-integrations/express4`.
Apollo v4 was end-of-life on 2026-01-26; v5 is the supported line and gives us:

- Plugin lifecycle hooks per phase (parse / validate / execute) → fed straight
  into our Server-Timing header.
- Native Automatic Persisted Queries (APQ) cache with 60-minute TTL.
- `formatError` that masks internal errors in production but preserves
  `BAD_USER_INPUT` / `UNAUTHENTICATED` semantics for clients.

**APQ:** clients can POST `{ extensions: { persistedQuery: { sha256Hash, version: 1 } } }`
instead of the full query body. First request seeds the cache; subsequent
requests hit the cache and bypass parse/validate cost.

**Verify:**
```bash
# After server is up
curl -X POST http://localhost:3001/api/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __typename }"}'
# Should return Server-Timing header with gql_parse, gql_validate, gql_execute segments.
```

## 2. mongoose autoIndex disabled in production + reconcile script

**Files:** `src/index.ts`, `src/scripts/reconcileIndexes.ts`

`mongoose.set('autoIndex', false)` + `mongoose.set('autoCreate', false)` in
production stops the app from re-creating dropped indexes on boot and from
stalling startup on multi-million-document collections.

The reconcile script (`pnpm run db:reconcile-indexes`) diffs schema-defined
indexes against database state and applies the delta explicitly. Use
`--dry-run` in CI to gate on drift (exits 2 if drift detected). Use
`--drop-extra` to remove indexes that exist in the DB but not in code.

**Verify:** see [testing.md](./testing.md#backend-integration-tests).

## 3. Change-stream cache invalidator

**File:** `src/services/changeStreamInvalidator.ts`

Wraps `Note.watch()` and `Task.watch()` and broadcasts a `cache:invalidate`
event on the user's Socket.IO room when documents change. This is how
multi-pod deployments stay in sync — instance A writes, instance B's
connected clients are told to refetch.

Failure modes are explicit:
- Non-replica-set Mongo → log + skip (single-node dev still works).
- `DISABLE_CHANGE_STREAMS=true` → never start.
- Stream error → exponential backoff (1s → 30s cap) before restart.

The `userId` extraction relies on `fullDocument: 'updateLookup'`, so the
post-update document is included in every change event.

## 4. Server-Timing headers + OTel trace-id

**Files:** `src/middleware/serverTiming.ts`, hooks into `src/middleware/perfHistogram.ts`

Every response carries `Server-Timing` with:
- `gql_<operationName>` for GraphQL ops
- Custom segments per resolver phase
- `total;dur=<ms>` always last
- `trace;desc="<W3C-trace-id>"` when an OTel span is active

The OTel hook reads `trace.getSpan(otelContext.active())` so any incoming
HTTP request that's already wrapped by `@opentelemetry/auto-instrumentations-node`
gets its trace ID echoed back. Frontends can deeplink to Jaeger/Tempo/Honeycomb
by reading the `X-Trace-Id` header.

## 5. @noterRest directive → OpenAPI 3.1 auto-gen

**Files:** `src/graphql/noterRest.ts`, `src/scripts/generateOpenApi.ts`

Our GraphQL schema is built programmatically (not from SDL), so a real
`@noterRest(method:"GET",path:"/notes")` directive isn't available. Instead,
`NOTER_REST_BINDINGS` is the equivalent at the JS layer: a typed list that
maps `Query.notes` / `Mutation.createNote` etc. to REST paths.

The generator walks both the schema (for component schemas) and the bindings
(for paths), and emits a 682-line OpenAPI 3.1 document at `docs/openapi.json`.
Run:

```bash
pnpm run docs:openapi
```

Output is checked into git; CI can diff it against HEAD to catch
inadvertent breaking changes to the public surface.

## 6. JWT tenant claim propagation

**File:** `src/middleware/authMiddleware.ts`

`extractTenantClaims(decoded)` reads `orgId` / `tenantId` / `roles` / `scopes` /
`plan` from the JWT and attaches them to `req.tenant`. The GraphQL context
re-extracts them as a safety net for the demo-token path and resolver-side
code can scope queries via `context.tenant.orgId` without re-parsing the JWT.

The normalisation handles three input shapes:
- `roles: ["admin", "user"]` (array)
- `scopes: "read:notes write:notes"` (space-delimited string)
- `scopes: "read:notes,write:notes"` (comma-delimited string)

## 7. Redis-backed rate limit

**File:** `src/middleware/rateLimit.ts`

`rate-limiter-flexible` with `RateLimiterRedis` when `REDIS_URL` is set,
`RateLimiterMemory` otherwise. Crucially: a Redis outage during a request
falls back to the in-memory limiter for that request instead of returning
503/5xx. This means a Redis flap can never take the API down.

Three limiters replace the previous `express-rate-limit`:
- `global` — 100/15min (everything)
- `auth` — 20/15min, 15min block on exhaust
- `sensitive` — 40/10min (MCP, GraphQL)

`X-RateLimit-{Limit,Remaining,Reset}` and `Retry-After` headers are emitted
per the IETF RateLimit-Headers draft.

## 8. Explicit Content-Security-Policy

**File:** `src/index.ts`

Replaced `helmet({ referrerPolicy: ... })` (which uses helmet's defaults) with
a fully explicit CSP:

- `default-src 'self'` — nothing loads cross-origin by default
- `frame-ancestors 'none'` — no click-jacking via iframe
- `object-src 'none'` — no Flash/Java applet
- `upgrade-insecure-requests` — auto-upgrade http→https subresources
- `style-src 'self' 'unsafe-inline'` — pragmatic: many UI libs ship runtime
  styles; revisit when SSR + strict CSP is in place

Also: HSTS 1y + preload, COOP `same-origin`, CORP `same-site`,
`x-powered-by` already disabled.

## 9. perf_hooks Histogram

**File:** `src/middleware/perfHistogram.ts`

Node 14+ `createHistogram()` records every route's duration in nanoseconds.
`GET /internal/perf-snapshot` (loopback-only OR `PERF_SNAPSHOT_TOKEN`-gated)
returns `{ count, p50, p95, p99, max, errors }` per route. Eliminates the
need for an external Prometheus scrape for p99 alerts.

## 10. Mongoose query redactor

**File:** `src/utils/mongooseDebug.ts`

`mongoose.set('debug', fn)` with a PII-redacting formatter, gated to
`NODE_ENV=staging|preview|qa` OR `MONGOOSE_DEBUG=true`. Strips:

- `password`, `token`, `refresh`, `secret`, `apikey`, `authorization`
- Encrypted columns by name: `title`, `content`, `tags`, `iv`, `ciphertext`
- Long string values truncated to 60 chars

Output goes through `winston` (`logger.debug`), so log shipping handles it
along with everything else.

## Verification

See [testing.md → backend](./testing.md#backend) for the matching test files.
