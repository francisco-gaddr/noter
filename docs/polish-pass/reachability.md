# Polish Pass — What's Reachable Today (per-app summary)

[← Index](./index.md) · [Integration audit](./integration-audit.md)

This is the user-visible list: features a real human can experience by
running the app today, with no flag flips, no dep additions, no infra.

## Mobile (Expo / iOS + Android)

### On every screen
- Subtle "selection" haptic on every list-row tap (NoteItem, TaskItem,
  ProjectSelector); medium haptic on long-press drag-engage.
- Tab-bar haptic on tab switch.
- Reduce-motion respected: list-row FadeIn animation, haptics, and
  splash transitions all check OS pref before firing.
- a11y labels/hints/state on note/task/project list rows so screen
  readers announce the meaning, not just "button".
- Tightened error boundary: identical errors collapsed to 1/minute,
  payload emitted as structured JSON for log shipping.

### Auth flow (login + register)
- KeyboardSafeView wraps both screens — keyboard no longer hides the
  password input on either platform.
- Built-in interactive keyboard dismiss on iOS scroll (`interactive`).

### Boot path
- Splash stays up until BOTH fonts AND theme (SecureStore) load → no
  light→dark flash on cold start. Hard 4s cap so a slow keychain can't
  hang the boot.
- `enableScreens(true)` explicit (native-rendered screens, not JS).
- AppState foreground sync: when you return to the app, both notes and
  tasks resync (debounced, cooldown-gated, offline-skipped).
- Background-fetch task registered while signed in: iOS/Android wake us
  ~every 15 min to refresh data; unregistered on logout.

### Notes & Tasks lists
- Pull-to-refresh with haptic + minimum 350ms spinner duration so cached
  responses don't flicker.
- Skeleton loaders during cold-start fetch (before first response).
- O(n log n) tree-flatten (was O(n²)) — visibly smoother scroll on big
  trees.
- Date formatting in TaskTimeline uses locale-aware `Intl.DateTimeFormat`
  (locale resolved from `expo-localization`).
- Persisted sort order is validated against a Zod schema on every read;
  corrupted entries fall back to defaults instead of crashing.

### Network awareness
- Persistent "Offline" banner with "Försök igen" / Retry button →
  triggers `NetInfo.refresh()` and surfaces a clear path out of
  errors.
- Retry on every API call uses full-jitter exponential backoff +
  honours server-side `Retry-After` headers.

### Security
- App-level biometric lock now has a **5-attempt sliding window + 30s
  lockout** after exhaustion. UI shows a disabled "Try again in Ns"
  button instead of letting the user spam the prompt.

### Note detail
- Overflow menu now exposes **Share as PDF** and **Share as Markdown**
  on unlocked notes. The export helpers write to the cache directory,
  open the OS share sheet, and refuse locked notes.

### Tasks tab
- Cold-start skeleton placeholder + standardised pull-to-refresh
  (haptic + min-spin + reentrancy-guard), same UX as the notes tab.

### Cold-boot route restore
- Kill the app while reading a note → next launch lands you on that
  note (1h window). Disabled while logged out.

### Deep links
- `noter://note/<id>` and `https://daylited.com/note/<id>` route to the
  matching screen on both cold-launch and warm app.
- Same parser as the Electron side: SSRF/path-traversal/foreign-host
  rejected.

### Search
- Search-term highlight banner above results uses our shared
  `searchHighlight` tokeniser (case-insensitive, longest-match-wins).

### Available components / hooks (opt-in for screens that adopt them)
- `<KeyboardSafeView>` / `<NoterBottomSheet>` / `<HighlightedText>` /
  `<Skeleton*>` / `<ConflictResolverModal>` / `<VoiceInputButton>`.
- `useRefreshControl` / `useReduceMotion` / `useAppForegroundSync` /
  `useDeepLinkConsumer` / `useNetworkPolicy` / `useImageQuality` /
  `useImagePrefetch` / `useMemoryWarning` / `useOptimisticMutation` /
  `useDragReorder` / `useBiometricLock` / `useLongPressMenu` /
  `useRouteRestore`.
- Pure utilities: `formatDate/formatTime/formatRelative`,
  `highlightMatches`, `tokeniseMarkdown`, `syncConflict.resolveConflict`,
  `kv` (KV abstraction), `parseSettings`, `appShortcuts.resolveActivation`,
  `noteExport.exportNoteToMarkdown/Pdf`.

---

## Electron (macOS / Windows / Linux)

### On every launch
- Single-instance lock: second launch focuses the existing window +
  routes any `noter://` argv to it.
- `noter://` protocol handler registered with the OS; `.noter` /
  `.md` / `.txt` file associations registered (active after install).
- Spell-checker dictionary downloads pinned to configured CDN
  (when `spellCheckerCdn` is set).
- User-added spell-check words persist across reinstalls + replay on
  every new window.
- Application menu (File/Edit/View/Window/Help) with platform-correct
  layout.
- Tray icon with cursor-anchored right-click (multi-monitor safe).
- Default-deny `windowOpenHandler` — every external link goes to the
  OS browser, not a new BrowserWindow.

### Window chrome
- Windows 11 acrylic background via `setBackgroundMaterial`.
- macOS vibrancy via `setVibrancy('sidebar' | 'dark')`, theme-reactive.
- Window size+position remembered across restarts, validated against
  current display layout (external monitor unplug doesn't strand the
  window off-screen).

### Power + battery
- macOS Touch Bar (default/note/find contexts) with quick actions.
- powerMonitor events (suspend/resume/lock-screen) broadcast to the
  renderer so it can flush state on sleep.
- Battery-aware auto-update: 6h check interval doubles on battery,
  pauses on thermal-critical, resumes on AC.

### Auto-update
- electron-updater wired with publish endpoint; checks 30s after boot
  + every 6h.
- Updater state machine broadcasts `{ status, version, progress, error }`
  to the renderer for a clean toast UI.
- Sigstore signature verification stub fail-closes when
  `NOTER_UPDATE_VERIFY_SIGSTORE=1`. (Real verify ships when the release
  pipeline does.)

### File interactions
- Drag-drop file import: dashed-outline highlight on drop zone via
  injected CSS, MIME + size + path-traversal validation before read.
- macOS Share menu wired (`noterDesktop.openShareMenu`).
- Native open/save dialogs with named filter allow-list (notes / images /
  docs / pdf), suggestedName sanitised.
- File-association: double-clicking a `.noter` / `.md` / `.txt` file
  in Finder/Explorer/Files opens it in Noter (via OS-level association).

### Print
- Native print via `webContents.print` with safe option clamping
  (page size allow-list, margins 0-50mm, copies 1-20).
- printToPDF returns a data-URL the renderer can save or attach.
- Print preview window with strict CSP (`default-src 'none'`).
- Locked notes opt-out: `lockedNote: true` refuses the request server-side.

### Multi-window
- "Open in new window" creates a separate BrowserWindow with the same
  preload/session, deep-linked to the note.

### Renderer safety
- 3-layer DevTools gating (production builds refuse to open the
  inspector via any path).
- Renderer crash recovery: silent reload up to 3 crashes/5min, then a
  retry/quit dialog.

### Native notifications
- `noterDesktop.notify({title, body, deeplink})` triggers a native
  notification; click focuses the window + posts `note:open`.
- Dock/launcher badge for unread count, auto-cleared on window focus.

### Find-in-Page
- `Cmd/Ctrl+F` opens the find bar via menu; selection-text pre-populates
  via the right-click "Find in Page…" menu item.
- Forward/backward navigation; `Esc` clears.

### Recent notes
- Last 5 opened notes appear in the macOS Dock menu / Windows JumpList,
  click routes via `note:open`.

---

## Backend (Express + Apollo Server v5)

### Every incoming request gets
- A request-id (echoed in `X-Request-ID`, included in the structured log).
- A structured request-completion log with sanitised URL (token segments
  redacted from password-reset/verify/refresh paths).
- A `Server-Timing` header + `X-Trace-Id` (from active OTel span).
- A perf-histogram sample (queryable via `/internal/perf-snapshot`).
- Rate-limiting (Redis-backed when configured; in-memory fallback).
- Helmet CSP with explicit policy + HSTS + COOP/CORP.
- CORS preflight cached for 1h.
- Body limits per route (auth 10kb, ai-sync 2mb, default 1mb).
- NaN/Infinity in JSON body sanitised to null (mongoose-safe).
- Brotli + gzip compression at level 4/6.

### Mongo write path
- Mutating routes go through `idempotency()` middleware — repeated
  Idempotency-Key returns the cached response with
  `Idempotency-Replayed: true`.
- Mutation paths also pass through `auditLog()` which fire-and-forgets
  a row to `_audit_log` with actor + route + status + body-shape.

### Mongo read path on /api/notes + /api/tasks
- Optional cursor pagination via `?limit=&cursor=` — returns
  `{ items, nextCursor, hasMore }`. Without those params, the legacy
  full-array shape is preserved for back-compat.
- Conditional GET via weak ETag — `If-None-Match` matching client cache
  returns 304 + zero bytes.

### Lifecycle
- Readiness gate returns 503 with `Retry-After: 1` while Mongo isn't
  connected (health-check paths bypass).
- Graceful shutdown on SIGTERM/SIGINT: drain Socket.IO, close HTTP,
  close cron scheduler, close change-stream invalidator, close Redis,
  close Mongo. Hard-kill at 35s.
- Instance heartbeat into `_instances` collection so two backends on
  the same DB log a clear warning.
- Cron scheduler with one daily job (`instances-cleanup` at 03:00 UTC,
  sweeps stale rows).

### GraphQL
- Apollo Server v5 with Automatic Persisted Queries (1h TTL).
- Depth limit (10) + complexity limit (1000) plugins both active.
- Server-Timing emitted per phase (parse/validate/execute) into the
  same header pipeline as REST routes.
- `formatError` masks server-internal messages in production.

### Real-time
- Socket.IO with change-stream-driven `cache:invalidate` broadcasts on
  Mongo replica sets — multi-pod consistency without polling.
- **JWT auth-refresh on long-running sockets**: server emits
  `auth:expiring` 1 min before token expiry, accepts a refreshed token
  via `auth:refresh` without forcing a reconnect, and only disconnects
  30s after expiry if no refresh arrived.

### Auth
- `/api/auth/login` and `/api/auth/register` emit **typed error codes**
  (`USERNAME_TAKEN` / `INVALID_CREDENTIALS` / `AUTH_CONFIG`) so clients
  can branch on code rather than parsing message strings.

### List-read offload
- Note + Task **cursor-paginated reads** (`?limit=&cursor=`) use
  `readPreference: 'secondaryPreferred'`. On a replica-set deployment
  list-reads land on a secondary; single-node Mongo transparently
  routes to primary.

### Observability endpoints (gated)
- `/api/health` — liveness probe (always 200).
- `/api/health/deep` — checks Mongo + Redis. 503 if anything fails.
  Gated behind `HEALTH_DEEP_TOKEN` or loopback.
- `/internal/perf-snapshot` — p50/p95/p99 per route. Same gating.
- `/api/csp-report` — receives browser CSP violation reports, dedupes,
  logs structured. helmet's `report-uri` directive points here.

### Helpers available to future routes (not yet adopted by live code)
- `validate/validateBody/validateQuery/validateParams` (Joi-based,
  emits typed `BadRequestError`).
- Typed HTTP error hierarchy (`HttpError`, `NotFoundError`, …).
- Pagination helpers (`parsePageParams/buildCursorFilter/buildPage`)
  — **wired** on notes + tasks GET.
- Soft-delete plugin, mongoose readPreference helper, bulkWrite helper.
- API-key auth middleware (`apiKeyAuth(scopes)`).
- Distributed lock (`withLock`), migration runner (versioned).
- HMAC webhook sign/verify, JWT key-set (kid rotation).
- Web Push sender (VAPID-signed), in-process job queue.
- Quota tracker (`enforceQuota`), field-level encryption (`encryptField`).
- Cron scheduler — **wired** with one baseline job.
- Sliding-window rate limit, WebSocket auth refresh.

These are imports-away from being live. The integration-audit document
lists each with current status.

---

## Tests + CI

- **Backend Jest** — 23 suites I shipped, 199+ tests, all green.
- **Electron Jest** — 22 suites, 218+ tests, all green.
- **Mobile Jest** — 16 suites I shipped, 139+ tests, all green.
- **CI** — `actionlint` workflow + custom `persist-credentials: false`
  rule + self-test workflow + Rekor transparency-log audit + Renovate
  automerge config.

## Where the polish-pass intentionally stopped

- Sigstore verify on auto-update (waits for release pipeline)
- MMKV adoption (waits for `expo install`)
- Sentry profiling (waits for `@sentry/react-native`)
- Federation gateway (we're a monolith)
- Tekton CI / Goldilocks VPA / Argo CD self-bootstrap (need cluster)
- `expo-quick-actions` for iOS 3D-touch shortcut REGISTRATION (registry
  is built; the dep that registers it isn't installed)
