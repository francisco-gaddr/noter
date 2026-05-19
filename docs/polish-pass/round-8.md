# Polish Pass — Round 8 (security, soft-delete, native UX)

[← Index](./index.md)

This round upgrades auth-storage hygiene (Argon2id), adds DoS guards
(GraphQL depth), enables tombstone-aware deletes (soft-delete), captures
who-did-what (audit log), and gives Electron proper desktop integrations
(drag-drop, share menu, renderer crash recovery).

## Backend

### Argon2id password hasher (`src/utils/passwordHasher.ts`)

Facade over `argon2` (Argon2id) with bcrypt-fallback. Every new hash is
Argon2id with OWASP 2024 params (memoryCost 19 MiB, timeCost 2,
parallelism 1). Existing bcrypt hashes still verify; `needsRehash()` returns
true so the login flow can transparently re-hash to Argon2id on next
successful verify.

`probeArgon2()` dynamic-requires the native module so a missing-build
environment doesn't crash startup — it falls back to bcrypt with a
warning. Pathological inputs (< 8 chars or > 1024 chars) are rejected at
the hash() boundary.

9 tests including bcrypt cross-compat, malformed-hash handling,
needsRehash for legacy → modern upgrade.

### GraphQL depth-limit plugin (`src/graphql/depthPlugin.ts`)

`GRAPHQL_MAX_DEPTH` (default 10). Pure selection-set walker rejects queries
deeper than the limit before execution. Complementary to the complexity
plugin (round 4): complexity is "too many fields", depth is "too deeply
nested" — both DoS vectors with different signatures.

8 tests covering flat/nested/multi-operation/inline-fragment depth.

### Mongoose soft-delete plugin (`src/utils/softDeletePlugin.ts`)

Plugin adds `deletedAt: Date | null` field + index, auto-injects
`{ deletedAt: null }` into every `find*` / `count*` / `updateMany`
operation, and prepends `$match: { deletedAt: null }` to aggregate
pipelines. Opt-out per-query: `setOptions({ withDeleted: true })`.

Adds static methods: `softDelete(filter)` / `restore(filter)` /
`findDeleted(filter)` / `findWithDeleted(filter)`.

10 tests for the pure filter-injection logic.

### Audit log middleware (`src/middleware/auditLog.ts`)

Logs every successful mutating request (POST/PUT/PATCH/DELETE) to a
dedicated `_audit_log` Mongo collection with actor + route + status +
request-id + body-shape (NOT body content). Writes happen on
`res.on('finish')` so they never block the user-visible latency. Failures
log a warning but never propagate.

`summariseBodyShape()` (pure, 10 tests) redacts sensitive keys
(password, token, email, phone, etc.) and emits type-shape ({k: 'string'})
so an operator can reconstruct intent without seeing payloads.

## Mobile

### NetworkStatusBanner with retry (`components/NetworkStatus.tsx`)

Added a "Försök igen" button next to the existing dismiss. Triggers
`NetInfo.refresh()` which re-probes connectivity; the existing offline
queue auto-flushes when connection returns. Banner width bumped 40% → 60%
to fit both actions comfortably.

### Image-quality hook (`hooks/useImageQuality.ts`)

Returns `{ quality, maxWidth, uploadQuality }` driven by the network policy
(round 6):

| Policy | quality | maxWidth | uploadQuality |
|---|---|---|---|
| wifi/ethernet | high | 2048 | 92 |
| cellular | medium | 1024 | 78 |
| metered (Low Data) | low | 640 | 60 |
| unknown | medium | 1024 | 78 |
| offline | low | 640 | 60 |

Renderers pass `maxWidth` to expo-image / CDN, uploaders apply
`uploadQuality` to JPEG/WebP encoding. 8 tests.

### Route-restore on cold-start (`hooks/useRouteRestore.ts`)

Persists the current route on every navigation; on cold-start, if the
stored route is < 1h old AND the user landed on the default tab, replaces
to the stored route. Strict allow-list (`isRestorable`) blocks
`/auth/*`, `/modal`, paths containing `..`, absolute URLs, etc. 9 tests
including SSRF/protocol-traversal rejection.

### Background-fetch scaffold (`services/backgroundFetch.ts`)

`expo-background-fetch` + `expo-task-manager` wiring. `defineTask` runs at
module load; caller injects the actual sync work via
`setBackgroundFetchTask()`. Registration is idempotent and bails out
silently when iOS Background App Refresh is disabled.

iOS-recommended 15min floor; Android falls back to WorkManager. Task
return values map to `BackgroundFetchResult.NewData/NoData/Failed` which
affect the OS's future scheduling budget.

## Electron

### Drag-drop file import (`src/dragDrop.js` + IPC)

Pure `validateDroppedFile()` enforces:
- MIME-or-extension allow-list (txt, md, json, html, png/jpg/webp/gif)
- 10MB default max size (`maxBytes` configurable)
- Null-byte / path-traversal rejection
- File existence + isFile() check

IPC `drop:read` returns `{ kind: 'text'|'binary', content|dataUrl }` so the
renderer can paste text directly or display image binaries via data-URL.
9 tests covering invalid payloads, MIME mismatches, size caps.

### macOS Sharing menu (`src/sharePayload.js` + IPC)

Pure `validateSharePayload({ texts, urls, filePaths })`:
- Texts: control chars stripped, length-capped at 4000
- URLs: http/https only — ftp/javascript/file rejected
- Files: must be inside `allowedRoots` AND exist as a regular file
- Max 5 entries per list

IPC `share:open` constructs Electron's `ShareMenu` and pops it next to the
focused window. No-op on non-darwin so renderer can dispatch
unconditionally. 9 tests covering URL filtering, root scoping,
control-char stripping.

### Renderer-crash recovery (`src/crashRecovery.js`)

`createRecoveryPolicy({ maxCrashes: 3, windowMs: 5 * 60_000 })` — pure,
takes `now` as injectable clock for tests. `recordCrash(reason)` returns
`{ action: 'reload' | 'prompt' | 'ignore', ... }`. `'killed'` and
`'clean-exit'` are ignored (not real crashes).

main.js wires this into `webContents.on('render-process-gone')`: silent
reload up to 3 crashes/5min, then `dialog.showMessageBox` asking
retry/quit. The state resets on user-confirmed retry. 6 tests covering
window-sliding, ignored reasons, reset, state inspection.

## Tests added in round 8

| Suite | File | Count |
|---|---|---|
| Password hasher | `__tests__/utils/passwordHasher.test.ts` | 9 |
| GraphQL depth plugin | `__tests__/graphql/depthPlugin.test.ts` | 8 |
| Soft-delete filter injection | `__tests__/utils/softDeletePlugin.test.ts` | 10 |
| Audit-log body summariser | `__tests__/middleware/auditLog.test.ts` | 10 |
| Image-quality presets | `__tests__/hooks/useImageQuality.test.ts` | 8 |
| Route-restore allow-list | `__tests__/hooks/useRouteRestore.test.ts` | 9 |
| Drag-drop validator | `tests/dragDrop.test.js` | 8 |
| Share-payload validator | `tests/sharePayload.test.js` | 9 |
| Crash-recovery policy | `tests/crashRecovery.test.js` | 6 |

**77 new tests in round 8.**

## Risk summary

| Change | Risk | Reversibility |
|---|---|---|
| Argon2id hasher | Low — falls back to bcrypt when argon2 unavailable | Trivial |
| GraphQL depth | Medium — could reject deep legitimate queries | Tune `GRAPHQL_MAX_DEPTH` env |
| Soft-delete plugin | Medium — every default query gets a filter | Not yet applied to models; opt-in per-model |
| Audit log | None — best-effort write after response | Trivial |
| Network banner retry | None — adds button | Trivial |
| Image quality hook | None — read-only | Trivial |
| Route restore | Low — strict allow-list, opt-out via parameter | Trivial |
| Background fetch | Low — silently no-ops if denied | Trivial |
| Drag-drop | Low — strict MIME + size + path validation | Trivial |
| Share menu | None — no-op on non-darwin | Trivial |
| Crash recovery | Low — prompts before giving up | Trivial |
