# Polish Pass — Round 5 (UX, bandwidth, a11y)

[← Index](./index.md)

This round shores up the user-facing edges: bandwidth-saving with ETags +
brotli already in place, smoother pull-to-refresh, a11y on the touch surfaces,
right-click menus, find-in-page, and per-route body limits.

## Backend

### Body-size limits per route (`src/index.ts`)

The default `express.json({ limit: '1mb' })` is fine for note/task payloads
but too generous for `/api/auth` (creds fit in <10kb) and too tight for
`/api/ai/sync` (batches of encrypted notes can exceed 1MB). Per-route
overrides:

```ts
const authBodyLimit = express.json({ limit: '10kb' });
const aiSyncBodyLimit = express.json({ limit: '2mb' });
```

This prevents an attacker from wedging a megabyte-sized JSON blob through
`/login` and burning a rate-limit slot just on parsing.

### Slow-query logger (`src/utils/slowQueryLogger.ts`)

Schema-level mongoose plugin: on every common query op (find / findOne /
update / aggregate / etc.) we record start time on `pre` and check elapsed
on `post`. If duration exceeds `SLOW_QUERY_MS_THRESHOLD` (default 100ms),
we emit a `mongoose.slow-query` warn-level log with redacted filter,
collection, op, duration, threshold.

Reuses the same sensitive-key allow-list as the mongoose-debug redactor
so PII never appears in slow-query alerts either.

### ETag + Cache-Control (`src/middleware/etag.ts`)

`conditionalGet()` middleware adds weak ETag (SHA-1 of serialised JSON) to
GET/HEAD responses. Conditional GETs from clients with `If-None-Match`
matching get back `304 Not Modified` (empty body) — saves bandwidth on
note-list polling without sacrificing freshness (any write produces new
content → new ETag → 200).

Mounted only on `/api/notes` and `/api/tasks` because mutations and
GraphQL don't benefit (and the hash cost is wasted on them).

Default `Cache-Control: private, max-age=0, must-revalidate` — clients
always revalidate, never blind-cache. Per-route override possible via
`conditionalGet({ cacheControl: 'public, max-age=60' })`.

### Structured request-completion log (`src/middleware/requestLog.ts`)

Single line per request:

```json
{
  "method": "POST",
  "url": "/api/notes",
  "status": 201,
  "duration_ms": 23,
  "bytes_in": 312,
  "bytes_out": 1024,
  "requestId": "ab12cd34ef567890",
  "userId": "u_…",
  "level": "info"
}
```

URL is sanitised — query strings stripped, and routes under
`/api/auth/reset-password`, `/api/auth/verify`, `/api/auth/refresh` have
their token segments replaced with `<redacted>` so password-reset tokens
never appear in logs.

## Mobile

### Network retry with jitter + Retry-After (`services/retry.ts`)

Extracted from `services/api.ts` into a testable pure module:

- **Full jitter** exponential backoff (AWS Architecture Blog
  recommendation) instead of deterministic `base * 2^attempt` — prevents
  thundering-herd recovery patterns.
- **Retry-After** header honoured (both numeric seconds and HTTP-date
  forms per RFC 9110 §10.2.3). Caps at `maxDelayMs` so a server saying
  "wait an hour" doesn't actually stall the app.
- `isRetryableStatus(status)` returns true for 5xx + 429 only — 4xx
  other than 429 are caller errors that won't fix themselves.

Wired into the existing `fetchWithAuth` retry loop.

### AppState foreground sync (`hooks/useAppForegroundSync.ts`)

`useAppForegroundSync(callback, { debounceMs, cooldownMs })`:

- **Debounce** (5s default) — rapid background→active flicker (user
  glances at a notification) doesn't fire multiple syncs.
- **Cooldown** (60s default) — even legitimate foreground events can't
  fire more than 1/min. Prevents accidental quadratic load.
- **Offline guard** — NetInfo.fetch() before each fire, skip if offline.
- **Clean unmount** — sub.remove() and clear pending timer.

Hooked in `RootLayoutNav` so notes + tasks resync whenever the user
comes back to the app.

### Accessibility audit

`NoteItem`, `TaskItem`, `ProjectSelector` now declare:

- `accessibilityRole="button"` (was missing, default was unhelpful)
- `accessibilityLabel` synthesised from title + lock/folder/priority/completion state
- `accessibilityHint` describing the action (double-tap to open, swipe right
  to delete, long-press to reorder)
- `accessibilityState` for `expanded` (note tree chevron) and `selected`
  (project list current selection) and `checked` (task completion via
  outer ripple state)

Screen-reader users now hear the meaning, not just generic "button".

### useRefreshControl hook (`hooks/useRefreshControl.ts`)

`{ refreshing, onRefresh } = useRefreshControl(fn, { minSpinMs, haptic })`:

- **Haptic** (`selectionAsync`) on initiation — opt-out via `{ haptic: false }`.
- **Minimum spin duration** (350ms default) — a cached 10ms response no
  longer flickers the spinner. Just above perception threshold.
- **Re-entrancy guard** — spam-pulling can't queue multiple in-flight
  refreshes against the same backend.
- **Error swallowing** — refresh exceptions never leave the spinner
  stuck; caller is responsible for surfacing the error in a toast.

## Electron

### Centralised shortcut registry (`src/shortcuts.js`)

Single source of truth for keyboard accelerators. Each shortcut declares
`id` / `label` / `accelerator` / `scope` / `description`. Module-load
guard throws on duplicate accelerators so the build fails fast if two
features try to claim `Cmd+F`.

`acceleratorFor('noter.find')` is read from the app menu so accelerator
changes are one-line edits.

### Right-click context menu (`src/contextMenu.js`)

`buildContextMenuTemplate(params, ctx)` produces a context-aware menu:

- **Right-click a link** → "Open in Browser" + "Copy Link Address"
- **Right-click selected text** → Copy + Select All + "Find in Page…"
- **Right-click in editable field** → full edit-flag-aware Undo/Redo/Cut/
  Copy/Paste/Select All
- **Dev only**: "Inspect Element" with click coords

Production builds never expose "Inspect Element" — even if a user knows
the keyboard shortcut, the `webPreferences.devTools: false` from round 4
blocks the inspector entirely.

### Find-in-Page (`Cmd/Ctrl+F`)

IPC handlers (`find:start`, `find:next`, `find:stop`) + bridge methods
(`noterDesktop.findStart/findNext/findStop/onFindResult`). webContents
emits `found-in-page` events with match index + total which we forward
to the renderer so the search bar can show "match 3 of 12".

The context-menu "Find in Page…" item starts a search with the currently-
selected text already populated.

## Tests added in round 5

| Suite | File | Count |
|---|---|---|
| ETag middleware | `__tests__/middleware/etag.test.ts` | 11 |
| requestLog URL sanitiser | `__tests__/middleware/requestLog.test.ts` | 7 |
| Slow-query filter redactor | `__tests__/utils/slowQueryLogger.test.ts` | 6 |
| Retry delay + jitter + Retry-After | `__tests__/services/retry.test.ts` | 19 |
| useRefreshControl hook | `__tests__/hooks/useRefreshControl.test.tsx` | 6 |
| Shortcut registry conflict detection | `tests/shortcuts.test.js` | 10 |
| Context-menu template builder | `tests/contextMenu.test.js` | 7 |

All passing. Total round-5 tests: **66** new.

## Risk summary

| Change | Risk | Reversibility |
|---|---|---|
| Per-route body limits | Low — 10kb is well above credentials | Trivial |
| Slow-query logger | Low — observability-only, no behaviour change | Trivial |
| ETag middleware | Low — falls back gracefully on errors | Per-route mount |
| requestLog | None — additive | Trivial |
| Retry jitter | Low — random delay distribution | Constants tunable |
| AppState fg sync | Low — debounce + cooldown prevent abuse | Trivial |
| a11y audit | None — pure additive prop changes | Trivial |
| useRefreshControl | None — opt-in hook | Per-screen adoption |
| Shortcut registry | None — module-load throws on conflicts | Edit registry |
| Context menu | None — was absent before | Trivial |
| Find-in-Page | None — opt-in via Cmd+F | Trivial |
