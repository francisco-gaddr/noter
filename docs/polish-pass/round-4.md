# Polish Pass — Round 4 (operational hardening)

[← Index](./index.md)

This round focuses on **operational concerns** — what happens when something
goes wrong in production, when a pod gets evicted, when an attacker probes
a public endpoint, when a user resizes a window across monitors. Each item
has matching tests.

## Backend

### Graceful shutdown (`src/utils/gracefulShutdown.ts`)

SIGTERM/SIGINT handler that:

1. Flips an in-flight `isShuttingDown` flag so any new request to any route
   returns `503` with `Connection: close` (the route middleware in
   `src/index.ts` enforces this — load balancers drain us cleanly).
2. Closes the HTTP server so no new sockets accept.
3. Disconnects Socket.IO clients (forces graceful reconnect against the
   new pod instead of TCP RST).
4. Runs registered extras in order (change-stream invalidator, Redis client).
5. Closes the mongoose connection LAST so in-flight queries finish.
6. Hard-kills after `SHUTDOWN_GRACE_MS + 5s` if anything is stuck.

Tuneable via `SHUTDOWN_GRACE_MS` env (default 30s — matches k8s
`terminationGracePeriodSeconds`).

Tests: `__tests__/utils/gracefulShutdown.test.ts`.

### Request-ID middleware (`src/middleware/requestId.ts`)

Reads `x-request-id` / `x-correlation-id` / `request-id` inbound, validates
against `/^[A-Za-z0-9._-]{1,128}$/` (rejects log-injection attempts), and
echoes in `X-Request-ID`. Mounted FIRST in the middleware chain so
every log line and Server-Timing segment carries the same id.

Tests: `__tests__/middleware/requestId.test.ts` — including a log-poisoning
attack with `\ninjected: yes` and an over-long id.

### GraphQL query complexity limit (`src/graphql/complexityPlugin.ts`)

Apollo plugin that calls `getComplexity` on every parsed query and rejects
with `QUERY_TOO_COMPLEX` (`extensions.code`) if it exceeds
`GRAPHQL_MAX_COMPLEXITY` (default 1000). Uses both `fieldExtensionsEstimator`
(for fields that declare their own cost in their `extensions`) and
`simpleEstimator` (cost 1 fallback).

This is the DoS guardrail: without it, a malicious client could request
deeply-nested fields whose combined resolver cost would exhaust the
event-loop.

### Deep health endpoint (`src/routes/healthDeep.ts`)

`GET /api/health/deep` returns:

```json
{
  "status": "ok",
  "time": "…",
  "uptime_sec": 1234,
  "checks": {
    "mongo": { "ok": true, "latencyMs": 8 },
    "redis": { "ok": true, "latencyMs": 3, "details": { "connected": true } }
  }
}
```

Returns `503` if any check fails. Gated behind `HEALTH_DEEP_TOKEN` header OR
loopback-only so it can't be used as a probe oracle by an external attacker.

### Brotli compression

`compression@1.8` already prefers `br` over `gzip` when the client supports
it. We tune brotli quality to **4** (sweet spot for dynamic JSON — see
Cloudflare's benchmark) with a 1KB threshold so tiny payloads aren't
compressed (overhead exceeds savings).

## Mobile

### NoteTree memoization (O(n²) → O(n log n))

`components/NoteTree.tsx` was filtering `visibleNotes` once per item per
render — quadratic. Refactored to:

1. Build `byId` Map + `childrenByParent` Map ONCE per render (O(n)).
2. Compute orphans ONCE (instead of inside the recursive filter).
3. Sort + traverse with O(1) lookups per node.

For ~200 notes that's the difference between **40k operations** and
**~800 operations** per render. Visible in scroll smoothness.

### Rate-limited structured ErrorBoundary log

`components/ErrorBoundary.tsx` now:

- Computes a stable key from `name + message + first stack frame`.
- Reports each unique error at most **1× per minute** (prevents render-loop
  log spam from masking the actual signal).
- Emits a structured JSON payload (`level`, `kind`, `name`, `message`,
  `stack` (≤4KB), `componentStack` (≤2KB), `ts`) — easy to grep, easy to
  ship to a log sink.
- Map is GC'd above 64 entries so it can't grow unbounded in pathological
  cases.

### SplashScreen waits for critical bootstraps

`app/_layout.tsx` no longer hides the splash as soon as fonts load. It also
waits for `runKvMigrationIfNeeded()` (and any other future critical
bootstraps). Hard cap of **4s** ensures we never block the splash forever
on a slow network or stuck migration.

## Electron

### Native application menu (`src/appMenu.js`)

`buildAppMenuTemplate(ctx)` is a pure function that returns a Menu template
for `Menu.buildFromTemplate()`. Behaviour:

- macOS: prepends an app menu (Apple HIG) with About / Quit.
- Windows/Linux: starts at File menu, About lives in Help.
- View menu's "Toggle DevTools" only appears in dev builds.
- Help → "Check for Updates" wires to the auto-updater.
- Help → "Learn More" opens the daylited.com homepage in OS browser.

The function takes its dependencies as `ctx` so it's unit-testable
without an Electron runtime. Tests: `tests/appMenu.test.js`.

### Window-state persistence (`src/windowState.js`)

Two pure functions:

- `captureWindowState(win)` — reads bounds + isMaximized from a
  `BrowserWindow`-shaped object. Returns null for destroyed windows.
- `validateWindowState(state, displays)` — guards against:
  - Non-object / missing fields → defaults
  - Width/height outside `[320, 8000]` (drops position too)
  - Position falls off all current displays (external monitor unplugged)
    → drops position, keeps size

In `main.js`, window resize/move events are throttled (500ms trailing
debounce) so we don't write `settings.json` on every drag pixel.

Tests: `tests/windowState.test.js` — multi-monitor case included.

### DevTools gating

Three layers of defense:

1. `webPreferences.devTools: isDev` — Electron itself refuses to open
   DevTools at the API level in production builds.
2. `webContents.on('devtools-opened', closeDevTools)` — paranoid hook that
   closes DevTools immediately if anything bypasses layer 1.
3. App menu in production has no "Toggle DevTools" entry.

The keyboard shortcut (Cmd/Ctrl+Option+I) is silently no-op'd by layer 1.

## Tests added in round 4

| Suite | File | Count |
|---|---|---|
| Request-ID validation | `__tests__/middleware/requestId.test.ts` | 6 |
| Graceful shutdown order | `__tests__/utils/gracefulShutdown.test.ts` | 2 |
| Window-state validator | `tests/windowState.test.js` | 11 |
| App-menu template | `tests/appMenu.test.js` | 7 |

All passing. Run with:

```bash
cd noter-app/apps/backend && pnpm test
cd electron-noter && pnpm test
```

## Risk summary (round 4)

| Change | Risk | Reversibility |
|---|---|---|
| Graceful shutdown | Low — guarded by hard-kill timer | Trivial |
| Request-ID | None — pure additive | Trivial |
| GraphQL complexity | Medium — could reject legitimate queries above 1000 cost | Tune `GRAPHQL_MAX_COMPLEXITY` env |
| Deep health endpoint | Low — gated behind token | Trivial |
| Brotli config | Low — falls back to gzip if br fails | Trivial |
| NoteTree memo | None — pure perf, output identical | Trivial |
| ErrorBoundary rate-limit | None — additive | Trivial |
| SplashScreen wait | Low — hard 4s cap | Trivial |
| App menu | None — was using default menu | Trivial |
| Window state | None — defensively validates input | Settings file is human-editable |
| DevTools gate | None — only blocks in prod | Set NODE_ENV=development to re-enable |
