# Polish Pass — Round 7 (data hygiene, offline, desktop integration)

[← Index](./index.md)

This round adds typed errors, cursor-pagination, offline mutation queue,
locale-aware formatting, schema-healed settings, and proper desktop-app
integration (single-instance lock, deeplinks, dock badge).

## Backend

### Typed HTTP error hierarchy (`src/utils/httpErrors.ts`)

`HttpError` base + `BadRequestError`/`UnauthorizedError`/`ForbiddenError`/
`NotFoundError`/`ConflictError`/`UnprocessableEntityError`/`TooManyRequestsError`/
`ServiceUnavailableError`. Every error carries `{ status, code, expose, details? }`.

The error middleware (`errorMiddleware.ts`) now branches:
- `isHttpError(err)` → serialises via `toClientJSON()` (5xx auto-masks message)
- Joi error → 400 with all issues in details
- Anything else → 500 with safe generic message

12 unit tests covering instanceof relations, expose defaults, message masking,
custom codes, cause chaining.

### Cursor-based pagination (`src/utils/pagination.ts`)

Opaque base64url-encoded `{ k: createdAt, i: _id }` cursor. Decoder rejects
malformed input. `buildCursorFilter()` produces a Mongo `$or` filter that
handles tied `createdAt` values via `_id` tiebreaker. `buildPage(items, limit)`
returns `{ items, nextCursor, hasMore }` from `limit+1` fetched items.

Why cursor over offset: page 3 of a list that grew between calls would show
duplicates with offset; cursor pins the exact position.

15 tests including round-trip encode/decode, BadRequestError on bad cursor,
filter shape for asc/desc.

### Centralised Joi validation (`src/middleware/validate.ts`)

`validate(schema)` (backward compat) + `validateBody/Query/Params` triplet.
`abortEarly: false` so the client sees every field error in one pass; details
emitted as `{ source, issues: [{ path, message, type }] }`. Shared
`schemas.objectId` / `cursor` / `limit` building blocks.

8 tests including source-routing (body/query/params), stripUnknown vs
allowUnknown, ObjectId acceptance.

### Instance heartbeat (`src/services/instanceHeartbeat.ts`)

Each running backend writes `{ instanceId, hostname, pid, version, bootedAt,
lastSeen }` to `_instances` collection every 15s. At boot we scan for live
peers (lastSeen < 60s ago) and log a warning if any are foreign.

Catches the common dev mistake of two backends pointing at the same Mongo
(silent duplicate writes). Tag instances with `INSTANCE_TAG` env to
distinguish blue-green / canary deliberately.

Disable with `DISABLE_INSTANCE_HEARTBEAT=true`. Wired into the shutdown
extras so the heartbeat is removed cleanly on SIGTERM.

## Mobile

### Offline mutation queue (`services/offlineQueue.ts`)

Failed mutations are enqueued, persisted via the KV abstraction, and replayed
when NetInfo reports a reconnection. Dedupe by `(resource, id, op)` — re-
enqueuing the same key replaces the prior payload (latest intent wins).
A delete after an update collapses to just the delete.

Max-attempts gate: items that fail 5 times are dropped rather than
blocking the queue forever. 500-item hard cap.

The executor (the function that actually replays a mutation) is injected
by the caller — queue mechanics here, network there.

8 tests covering enqueue/dedupe/collapse/flush ordering/failure-stop/
max-attempts/no-executor.

### Tab-bar haptic (`app/(tabs)/_layout.tsx`)

`screenListeners: { tabPress: () => Haptics.selectionAsync() }` — gated on
`useReduceMotion`. Subtle tactile feedback that the tab changed.

### Locale-aware date formatters (`utils/dateFormat.ts`)

`formatDate / formatTime / formatDateTime / formatRelative` built on
`Intl.DateTimeFormat` + `Intl.RelativeTimeFormat`. Device locale resolved
via `expo-localization.getLocales()`, override-able for tests via `setLocale()`.
Falls back to ISO strings if Intl fails (defensive).

`formatRelative` uses `numeric: 'auto'` so it produces "yesterday"/"tomorrow"
at the unit-1 boundary instead of "1 day ago"/"in 1 day".

7 tests including unrecognised input, far-past fallback, locale override.

### Zod settings schema (`services/storage/settingsSchema.ts`)

Single source of truth for what we persist. `parseSettings(raw)` and
`parseSettingsJson(str)` NEVER throw — they walk fields individually,
keep valid ones, substitute defaults for invalid ones, return
`{ settings, healed }`. Callers can write the healed copy back to storage
to fix corrupt blobs on next save.

Adding a setting = extend the schema with `.default(...)`. Old persisted
blobs automatically pick up the new default.

10 tests covering corrupt JSON, wrong types, missing fields, prompt-length cap.

## Electron

### Single-instance lock + deeplinks (`src/deeplink.js`)

`app.requestSingleInstanceLock()` runs BEFORE `app.whenReady`. The second
launch immediately quits, while the first instance receives a
`'second-instance'` event with the new argv — we focus the existing window
and apply any `noter://` deeplink carried in argv.

`app.setAsDefaultProtocolClient('noter')` registers our protocol with the
OS. The `parseDeeplink()` pure function handles:

- `noter://note/<id>` → `{ type: 'note', id, route: '/note/<id>' }`
- `noter://task/<id>` → same shape
- `noter://open?route=/foo` → arbitrary internal route

Strict allow-list pattern `/^[A-Za-z0-9._:-]{1,128}$/` on ids; route
must not start with `//` or contain a protocol. URL normalisation eats
`..` path traversal attempts before our parser ever sees them.

14 tests including SSRF rejection, path-traversal handling, mixed argv.

### Dock badge

`noterDesktop.setBadge(count)` → IPC → `app.setBadgeCount()`. macOS shows on
dock icon, Linux Unity on launcher icon, Windows is a no-op (so renderer
can dispatch unconditionally without platform-checking). Cleared
automatically when the user focuses the window — convention from
native apps.

## Tests added in round 7

| Suite | File | Count |
|---|---|---|
| HttpError hierarchy | `__tests__/utils/httpErrors.test.ts` | 12 |
| Pagination cursor + filter + page | `__tests__/utils/pagination.test.ts` | 15 |
| Validate middleware | `__tests__/middleware/validate.test.ts` | 8 |
| Date formatters | `__tests__/utils/dateFormat.test.ts` | 7 |
| Settings schema heal | `__tests__/services/storage/settingsSchema.test.ts` | 10 |
| Offline queue | `__tests__/services/offlineQueue.test.ts` | 8 |
| Deeplink parser | `tests/deeplink.test.js` | 14 |

**74 new tests in round 7.**

## Risk summary

| Change | Risk | Reversibility |
|---|---|---|
| HttpError hierarchy | None — additive | Trivial |
| Pagination helper | None — opt-in per route | Trivial |
| Validate middleware | Low — strip-unknown is the default; opt out per route | Trivial |
| Instance heartbeat | Low — writes to dedicated collection, disable via env | Trivial |
| Offline queue | Low — dropped after 5 attempts, max 500 items, executor injected | Per-feature wiring |
| Tab haptic | None — opt-out via reduce-motion | Trivial |
| Date formatters | None — pure functions | Trivial |
| Settings schema | None — heal preserves what's valid | Trivial |
| Single-instance lock | Low — second instance quits cleanly | Trivial |
| Dock badge | None — no-op on Windows | Trivial |
| Custom protocol | Low — strict allow-list on every deeplink | Trivial |
