# Polish Pass — Round 6 (resilience, supply-chain, native UX)

[← Index](./index.md)

This round closes gaps around request lifecycles (readiness, idempotency,
preflight cache), CSP violation visibility, theme cold-start flash, and
gives the Electron app proper desktop-citizen behaviour
(notifications, power events, dock/jumplist).

## Backend

### Readiness gate (`src/middleware/readiness.ts`)

Returns `503` with `Retry-After: 1` until `mongoose.connection.readyState === 1`.
Health-check paths (`/api/health`, `/api/health/deep`, root, perf-snapshot)
always pass through so a k8s `readinessProbe` loop can make progress.

When `MONGO_URI` is unset (offline dev, in-memory tests) the gate is bypassed —
local iteration doesn't get confused by 503s.

### Idempotency-Key middleware (`src/middleware/idempotency.ts`)

RFC 9457 / `draft-ietf-httpapi-idempotency-key`. Header pattern enforced:
`/^[A-Za-z0-9._-]{8,128}$/`. On match-with-existing:

- Same body → cached response replayed with `Idempotency-Replayed: true` header.
- Different body → `409 IDEMPOTENCY_KEY_REUSED` (prevents replay-of-wrong-thing).

Cache: in-memory LRU, 1000 entries × 24h TTL, keyed by `userId|key`. Single-pod
today; swap the `Map` for Redis when multi-pod arrives — the surface is the same.

Only POST/PUT/PATCH are gated. GET/HEAD/DELETE are already idempotent.

### CORS preflight cache (`src/index.ts`)

- `Access-Control-Max-Age: 3600` — browsers skip preflight for 1h per origin/method.
- Tightened `allowedHeaders` (Content-Type, Authorization, Idempotency-Key,
  X-Request-ID, X-Correlation-ID, If-None-Match) instead of the default `*`.
- `exposedHeaders` now surfaces ETag, X-Request-ID, X-RateLimit-*, Retry-After,
  Server-Timing, X-Trace-Id, Idempotency-Replayed — these were silently dropped
  before because CORS hides them by default.

### CSP report endpoint (`src/routes/cspReport.ts`)

`POST /api/csp-report` accepts both legacy `application/csp-report` and
Reporting API `application/reports+json`. Violations are logged at warn level
with `directive`/`blockedURI`/`sourceFile`/`documentURI`. In-memory dedupe per
(ip, directive, blockedURI, sourceFile) for 5 min prevents a misbehaving page
from flooding our logs.

The helmet config emits `report-uri /api/csp-report` so browsers find it.

### Configurable trust-proxy (`src/utils/trustProxy.ts`)

`TRUST_PROXY_HOPS` env (default `1`) accepts:
- integer `0`–`10` (hop count)
- `false` / `0` (no proxies trusted)
- `true` (trust every hop — for testing only)
- `loopback` / `linklocal` / `uniquelocal` (named subnets)
- CIDR list (`10.0.0.0/8, 192.168.1.0/24`)

Unrecognised values warn and default to `1` rather than failing boot.

## Mobile

### KeyboardSafeView (`components/KeyboardSafeView.tsx`)

Drop-in wrapper for any screen with a form input. Platform-aware `behavior`
(padding on iOS, undefined on Android — fights less with WindowSoftInputMode),
optional ScrollView with `keyboardDismissMode: 'interactive'` for the iOS
swipe-to-dismiss gesture. `keyboardShouldPersistTaps: 'handled'` by default
so taps on inner buttons don't dismiss the keyboard.

### Theme persistence pre-splash (`context/ThemeContext.tsx`)

Added module-level `preloadTheme()` that returns a memoised promise reading
SecureStore. The boot path in `_layout.tsx` `await`s this in parallel with
`runKvMigrationIfNeeded()` before hiding the splash, so the first paint shows
the user's saved theme — no light→dark flash.

`ready` boolean exposed on the context value for callers that need to defer
work until theme is settled.

### Network-policy hook (`hooks/useNetworkPolicy.ts`)

`useNetworkPolicy()` returns:

```ts
{ policy, syncIntervalMs, preferDeferLargeUploads, isOnline }
```

Presets:

| Policy | syncIntervalMs | preferDeferLargeUploads |
|---|---|---|
| `wifi` / `ethernet` | 30s | false |
| `cellular` | 5min | true |
| `metered` (Low Data / Data Saver) | 15min | true |
| `unknown` | 5min | true |
| `offline` | ∞ | true |

`isConnectionExpensive` from NetInfo trumps connection type — a metered
hotspot reports as `metered` even when type=wifi.

## Electron

### Native notifications

`noterDesktop.notify({ title, body, deeplink, silent })`. Click handler
focuses the main window and sends `note:open` with the deeplink so the
renderer can route to the target. Title/body clamped (80/200 chars) before
being passed to the OS to avoid notification daemons silently truncating
in inconsistent ways.

### Power monitor

`powerMonitor.on('suspend' | 'resume' | 'lock-screen' | 'unlock-screen')`
events broadcast to the renderer as `power:suspend|resume|lock|unlock`.
Renderer subscribes via `noterDesktop.onPowerEvent(handler)`. Use cases:

- `suspend` → flush pending state (renderer-driven)
- `resume` → kick a resync
- `lock` → blank sensitive views (note titles etc.)
- `unlock` → restore

### Recent-notes dock-menu / Windows JumpList (`src/recentNotes.js`)

`pushRecent(list, entry)` — pure function, dedupes by id, caps at 5, sanitises
title (strips control chars, clamps to 64 chars). `buildRecentMenuTemplate`
emits a Menu template ready for `app.dock.setMenu()` (macOS) or
`app.setUserTasks()` (Windows). `noterDesktop.recordRecentNote(id, title)`
is the renderer-facing entry.

Stored in `settings.json` so the list survives restarts.

## Tests added in round 6

| Suite | File | Count |
|---|---|---|
| Readiness gate | `__tests__/middleware/readiness.test.ts` | 6 |
| Idempotency cache + conflict + LRU + scope | `__tests__/middleware/idempotency.test.ts` | 7 |
| TrustProxy resolver | `__tests__/utils/trustProxy.test.ts` | 7 |
| Network policy resolver | `__tests__/hooks/useNetworkPolicy.test.ts` | 9 |
| Recent-notes list helpers | `tests/recentNotes.test.js` | 13 |

All passing. **42 new tests in round 6.**

## Risk summary

| Change | Risk | Reversibility |
|---|---|---|
| Readiness gate | Low — bypassed in dev, only blocks during warm-up | Trivial |
| Idempotency | Low — opt-in via header; absent header = no behaviour change | Trivial |
| CORS preflight cache | Low — `vary: Origin` keeps per-origin invalidation correct | Tunable maxAge |
| CSP report endpoint | Low — write-only sink, no client-readable data | Trivial |
| Trust-proxy config | Medium — wrong value breaks IP attribution | Env override |
| KeyboardSafeView | None — opt-in wrapper | Trivial |
| Theme preload | Low — 4s hard cap prevents stuck splash | Trivial |
| Network policy | None — read-only | Trivial |
| Native notifications | None — opt-in via IPC | Trivial |
| Power monitor | None — broadcast-only | Trivial |
| Recent-notes menu | None — additive | Trivial |
