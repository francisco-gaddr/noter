# Polish Pass — Integration Audit (honest accounting)

[← Index](./index.md)

Over 12 rounds and 150 task items I built a lot of infrastructure. Not
every item is reachable by users today — some are wired into the live
request/render flow, some are pure helpers waiting for adoption, and a
few need infra outside this repo to actually fire. This document is the
honest map.

**Status legend:**

- 🟢 **Wired** — runs on every request / mount / startup automatically
- 🟡 **Available** — pure helper or component, callers must opt in
- 🔵 **Opt-in scaffold** — needs a one-line flag flip OR a missing dep
  install to activate (e.g., MMKV adapter, Sigstore verify)
- 🔴 **Needs external infra** — code is ready, but a release pipeline,
  CDN, or KMS has to ship first

---

## Backend (`noter-app/apps/backend/`)

### 🟢 Wired into the live request flow

These run on every single request (or startup) without any per-route work:

| Item | Wiring point | Round |
|---|---|---|
| mongoose debug redactor | `installMongooseDebug()` before `app` constructor | 1 |
| autoIndex/autoCreate disabled in prod | top of `index.ts` | 2 |
| Slow-query mongoose plugin | `installSlowQueryLogger()` at boot | 5 |
| Trust-proxy resolver | `installTrustProxy(app)` before middlewares | 6 |
| Instance heartbeat | started after `mongoose.connect` succeeds | 7 |
| Request-ID middleware | mounted first | 4 |
| Request-completion log | mounted after request-id | 5 |
| Readiness gate | mounted after request log | 6 |
| Helmet CSP (explicit policy) | global `app.use(helmet(...))` | 2 |
| CORS with preflight cache + exposed headers | global | 6 |
| Brotli compression (level 4) | global | 4 |
| Sanitise NaN/Infinity | after `express.json` | 12 |
| perf_hooks Histogram middleware | global | 1 |
| Server-Timing + OTel trace-id | global | 1, 4 |
| Per-route body-size limits (auth 10kb / ai-sync 2mb) | route-mount | 5 |
| 503-during-shutdown drain middleware | global | 4 |
| Apollo Server v5 + persistedQueries + depth + complexity plugins | mounted at `/api/graphql` | 2, 4, 8 |
| Redis-backed rate limit (3 limiters) | `global`/`auth`/`apiSensitive` | 2 |
| Idempotency-Key on note + task POST/PUT/PATCH | mounted on those routes | 6 |
| ETag + Cache-Control on note + task GETs | mounted on those routes | 5 |
| Audit log on note + task mutations | mounted on those routes | 8 |
| Change-stream invalidator → Socket.IO room broadcast | starts when Mongo connects on a replica set | 1 |
| Graceful shutdown (SIGTERM/SIGINT) | installed when `startServer` completes | 4 |
| `/api/health` + `/api/health/deep` | dedicated route module | 4 |
| `/internal/perf-snapshot` | dedicated route, loopback-or-token gated | 1 |
| `/api/csp-report` | dedicated route module, helmet emits `report-uri` to it | 6 |
| `report-uri /api/csp-report` in CSP | helmet config | 6 |

### 🟡 Available helpers (callers must opt in)

These are pure utilities or factory functions — they only run when a
route or service explicitly imports and calls them. They don't yet have
a production caller, but each has unit tests and clear API surface.

| Item | API entrypoint | Wired wiring runda 13? |
|---|---|---|
| HttpError hierarchy (`BadRequestError` etc.) | `from '../utils/httpErrors'` | Used by `errorMiddleware`, `validate`, `pagination`. Anywhere else still throws plain `Error`. |
| Pagination helpers (`parsePageParams`, `buildCursorFilter`) | `from '../utils/pagination'` | **WIRED** in round 13 on `/api/notes` and `/api/tasks` (see below) |
| Joi validate middleware (`validateBody/Query/Params`) | `from '../middleware/validate'` | Not yet adopted by existing routes |
| Soft-delete plugin | `Schema.plugin(softDeletePlugin)` | Not applied to any model — opting in requires migrating delete callsites |
| Field encryption (`encryptField/decryptField`) | env `FIELD_ENCRYPTION_KEY` + caller | No callsite; recommended for new internal fields |
| Custom error → typed responses (`errorMiddleware.ts`) | Global | **Wired**; routes that throw plain errors still work via the fallback |
| Tenant claims in JWT/GraphQL context | extracted in `authMiddleware` + Apollo `context` | **Wired**; resolvers can read `context.tenant.orgId` |
| Read-preference helper | `findManyForRead(model, filter)` | Not yet adopted by any route |
| bulkWrite helper | `bulkUpsert(model, docs, key)` | Not yet adopted |
| Distributed lock | `withLock('key', fn)` | Used by migration runner |
| Migration runner | `runMigrations([...])` | Not invoked yet (no migrations defined) |
| JWT key set (`signJwt/verifyJwt`) | env `JWT_KEYS` | Legacy `JWT_SECRET` still in use by auth routes |
| API-key auth (`apiKeyAuth(scopes)`) | mount on a route | No route uses it; `_api_keys` collection is empty |
| Quota tracker (`enforceQuota`) | call from a route | No callsite yet |
| Job queue (`register/enqueue`) | register + enqueue | No jobs registered |
| Web Push sender (`sendPush(sub)`) | requires VAPID env + subscription store | No callsite |
| HMAC webhook sign (`signPayload/verifyWebhookSignature`) | requires a webhook flow | No callsite |
| Sliding-window rate limit | `slidingWindowRateLimit({...})` middleware | Not mounted; existing fixed-window still in use |
| WebSocket JWT auth refresh | `installAuthRefresh(socket, ...)` | Not yet wired into `io.on('connection')` — tokens are validated once on handshake |
| Cron scheduler | `schedule(name, sched, handler)` | **WIRED** in round 13 with one heartbeat job (see below) |

### 🟡 Schema available, opt-in by call

- `@noterRest` directive + `docs:openapi` script — bindings exist, run
  `pnpm run docs:openapi` to regenerate `docs/openapi.json`. The
  resulting OpenAPI is checked into git; no route auto-serves it yet.
- `db:reconcile-indexes` script — run manually before deploys; not
  invoked by anything automatically.

---

## Mobile (`noter-app/apps/mobile/`)

### 🟢 Wired into the live render flow

| Item | Where | Round |
|---|---|---|
| Haptics `selectionAsync()` on list-row press | NoteItem / TaskItem / ProjectSelector / NoteTree | 1 |
| Reanimated FadeIn on NoteItem mount | NoteItem render | 1 |
| `enableScreens(true)` | top of `_layout.tsx` | 4 |
| Tab-bar haptic on switch | `(tabs)/_layout.tsx` `screenListeners` | 7 |
| `useReduceMotion` hook → animation gating | NoteItem | 1 |
| AppState foreground sync (`useAppForegroundSync`) | RootLayoutNav | 5 |
| `preloadTheme()` before splash hide | RootLayoutNav bootstrap | 6 |
| KV migration call (no-op today, MMKV-ready) | RootLayoutNav bootstrap | 1 |
| Structured + rate-limited ErrorBoundary log | CustomErrorBoundary, mounted by `_layout` | 4 |
| Network retry with full-jitter + Retry-After | `fetchWithAuth` in `services/api.ts` | 5 |
| NoteTree O(n²)→O(n log n) refactor | NoteTree render | 4 |
| Reduced-motion-aware splash gate (4s cap) | RootLayoutNav | 4 |
| NetworkStatusBanner with retry button | mounted by `_layout` | 8 |
| a11y labels/hints/state | NoteItem / TaskItem / ProjectSelector | 5 |
| **Deep-link consumer** | RootLayoutNav | **Wired round 13** |
| **Skeleton loaders during initial fetch** | Notes/Tasks lists | **Wired round 13** |
| **KeyboardSafeView in auth forms** | login + register screens | **Wired round 13** |
| **Locale-aware date formatters in list rows** | NoteItem/TaskItem timestamps | **Wired round 13** |
| **useRefreshControl on Notes/Tasks lists** | replaces ad-hoc onRefresh | **Wired round 13** |

### 🟡 Available helpers (callers must opt in)

| Item | API | Status |
|---|---|---|
| KV abstraction (`kv.getString/setString`) | `from '@/services/storage'` | Migration plumbed, but no existing AsyncStorage callsite has been migrated yet (intentional: AsyncStorage is still the source of truth until MMKV ships) |
| Sync conflict resolver + ConflictResolverModal | `from '@/services/syncConflict'` + the modal | No sync code calls it yet (sync currently does last-write-wins) |
| useDragReorder hook | `from '@/hooks/useDragReorder'` | Existing NoteTree/TaskList still use their inline reorder logic; migration is per-component |
| useBiometricLock | `from '@/hooks/useBiometricLock'` | AppLock screen still uses the simpler ad-hoc lock |
| useImagePrefetch | `from '@/hooks/useImagePrefetch'` | Mobile has no `<Image>` callsites yet; ready for note-attachments feature |
| useImageQuality | `from '@/hooks/useImageQuality'` | Same as above |
| useNetworkPolicy | `from '@/hooks/useNetworkPolicy'` | Available; no consumer yet |
| useRouteRestore | `from '@/hooks/useRouteRestore'` | Available, not wired into `_layout` (would slightly change boot semantics; opt-in feature) |
| useMemoryWarning | `from '@/hooks/useMemoryWarning'` | Available |
| useOptimisticMutation | `from '@/hooks/useOptimisticMutation'` | Available |
| useLongPressMenu | `from '@/hooks/useLongPressMenu'` | Available |
| Offline mutation queue | `from '@/services/offlineQueue'` | No producer enqueues; no executor registered |
| Background-fetch scaffold | `from '@/services/backgroundFetch'` | **Wired round 13** with a sync task |
| Markdown sanitizer | `from '@/utils/markdownSanitize'` | Note preview still uses Tiptap-rendered HTML |
| Search highlight | `from '@/utils/searchHighlight'` | **Wired round 13** in search results |
| Note export (PDF/MD) | `from '@/services/noteExport'` | Available; UI surface (a "Share as PDF" menu item) TBD |
| NoterBottomSheet wrapper | `from '@/components/NoterBottomSheet'` | Available |
| Skeleton components | `from '@/components/Skeleton'` | **Wired round 13** |
| VoiceInputButton | `from '@/components/VoiceInputButton'` | Available — host must wire an STT engine |
| App shortcuts registry | `from '@/services/appShortcuts'` | Registry available; OS-side registration needs `expo-quick-actions` dep |
| Settings Zod schema | `from '@/services/storage'` | **Wired round 13** in store init |

### 🔵 Opt-in scaffold (one flip away)

- **MMKV adapter**: `services/storage/kv.ts` has `USE_MMKV_WHEN_AVAILABLE = false`. Install `react-native-mmkv` and flip to `true`; migration runs automatically on next boot.
- **Sentry per-screen profiling**: dep not installed; helper code from round 1 documents the intended call shape.

---

## Electron (`electron-noter/`)

Electron-side wiring is more complete because main.js owns the lifecycle
directly — almost every feature is "active" once installed.

### 🟢 Wired (active when the app runs)

| Item | Wiring point | Round |
|---|---|---|
| Spell-checker CDN pinning | session config at window create | 1 |
| Login-at-startup (opt-in) | reconciled at boot + tray toggle | 1 |
| Tray with cursor-anchored menu | created at app.whenReady | 1 |
| Acrylic on Win11 | per-window in createWindow | 1 |
| macOS vibrancy (theme-reactive) | per-window + nativeTheme listener | 12 |
| Accessory policy (tray-only mode) | settings-driven | 1 |
| Reduced-motion CSS injection | did-finish-load | 1 |
| Isolated-world DOM helpers | IPC `dom:run-isolated` | 1 |
| User-Agent suffix | session.setUserAgent at window create | 4 |
| crashReporter | opt-in via setting | 4 |
| electron-updater + battery-aware schedule | starts after window | 4, 12 |
| Updater state-machine broadcast | every updater event | 12 |
| App menu (with Find/CheckForUpdates/etc.) | Menu.setApplicationMenu at boot | 4 |
| Window-state persistence | resize/move debounce, restored at next start | 4 |
| DevTools gating (3 layers) | webPreferences + close-on-open + menu omit | 4 |
| Single-instance lock + deeplink propagation | before whenReady | 7 |
| `noter://` custom protocol | setAsDefaultProtocolClient at boot | 7 |
| Dock/Launcher badge with auto-clear on focus | win.on('focus') + IPC | 7 |
| Native notifications with deeplink-on-click | IPC `notify:show` | 6 |
| powerMonitor broadcast (suspend/resume/lock) | at app.whenReady | 6 |
| Recent-notes dock menu / Windows JumpList | settings-driven, refreshed on update | 6 |
| Context menu (right-click) | webContents `context-menu` | 5 |
| Find-in-page IPC + result events | IPC + webContents events | 5 |
| Drag-drop file import validation | IPC `drop:read` | 8 |
| Drag-drop feedback CSS | injected at did-finish-load | 11 |
| macOS Sharing menu | IPC `share:open` | 8 |
| Renderer-crash recovery policy | webContents `render-process-gone` | 8 |
| Multi-window note view | IPC `note:open-window` | 10 |
| Spell-check user dictionary (persisted) | IPC + reconcile on every window | 10 |
| Native file dialog (open/save) wrappers | IPC `dialog:open/save` | 10 |
| Touch Bar with context (default/note/find) | IPC `touchbar:set` | 9 |
| Native print + printToPDF (locked-note opt-out) | IPC `print:show` / `print:to-pdf` | 9 |
| Print preview window with strict CSP | IPC `print:preview` | 11 |
| Resource monitor (debug-gated) | IPC `metrics:app` | 9 |
| .noter file-association at OS level | `app.on('open-file')` + argv extraction + did-finish-load drain | 11 |
| Thumbnail IPC (path-traversal-guarded) | IPC `thumbnails:create` | 1 |
| CORS edge-case switch (env-gated) | command line append-switch | 4 |

### 🔵 Opt-in scaffold

- **Sigstore signature verification on auto-update**: `verifyUpdateSignatureStub` is fail-closed when `NOTER_UPDATE_VERIFY_SIGSTORE=1`. Wire the cosign verify-blob call when the release pipeline emits signatures.
- **electron-builder fileAssociations**: registered in `package.json` build config; OS registration happens at install time (not in dev).

---

## CI / Cross-cutting (`.github/`)

### 🟢 Active workflows

| Workflow | Trigger | Round |
|---|---|---|
| `.github/workflows/actionlint.yml` | PR/push touching workflows | 3 |
| `.github/workflows/actionlint-rule-selftest.yml` | PR touching the rule | 4 |
| `.github/workflows/rekor-audit.yml` | cron every 6h | 3 |
| `renovate.json` | Renovate bot schedule | 3 |
| Custom `check-checkout-credentials.sh` rule | invoked by actionlint workflow | 3 |

### 🔴 External-infra-dependent

- Rekor-audit requires `SIGSTORE_ALLOWED_IDENTITIES` and `REKOR_AUDIT_SUBJECTS` repo vars; the workflow ships but produces no signal until those are set.
- Renovate automerge requires the bot to be installed on the repo.

---

## How this changed in round 13

The "🟢 Wired" mobile list grew by 6 items (deep-link consumer, skeletons,
KeyboardSafeView in auth, locale dates, useRefreshControl, settings
schema validation) and the backend grew by 2 (pagination on note/task
GETs, cron scheduler with the daily heartbeat sweep).

## How this changed in round 14 (today)

Eight more items moved from 🟡 to 🟢:

**Mobile:**
- **AppLock now has a 5-attempt / 30s lockout window.** The existing
  `useBiometrics` flow is augmented with a sliding-window failure
  counter + lockout UI inside `AppLock.tsx`. Visible to users: the
  unlock button is disabled with a "Try again in Ns" message after 5
  failed prompts.
- **Note detail screen has Share-as-PDF + Share-as-Markdown menu
  items** via `exportNoteToPdf`/`exportNoteToMarkdown`. Locked notes
  hide both entries; the helpers also refuse via `LockedNoteExportError`.
- **Tasks list now has Skeleton placeholder + standardised
  `useRefreshControl`** matching the notes list (haptic + min-spin +
  reentrancy-guard).
- **`useRouteRestore` activated in `RootLayoutNav`** (gated on `token`).
  Kill the app while reading a note → next launch lands you back on
  it (1h window).

**Backend:**
- **WebSocket auth-refresh installed in `io.on('connection')`**.
  Sockets warn the client 1 min before JWT expiry via `auth:expiring`,
  accept refreshed tokens via `auth:refresh`, and only disconnect 30s
  after expiry if no refresh arrived. Long-running collaboration
  sessions don't break when an access token rotates.
- **auth routes (`/api/auth/register`, `/api/auth/login`) throw typed
  HttpError** — `USERNAME_TAKEN` / `INVALID_CREDENTIALS` / `AUTH_CONFIG`
  codes. Mobile + web clients can branch on `code` rather than
  pattern-matching the message string.
- **Note + Task pagination reads use `readPreference: 'secondaryPreferred'`**
  via `runWithReadPreference()`. When the cluster has a secondary,
  list-reads offload from primary. Single-node Mongo silently routes
  to primary (safe default).

**Mobile note: `tokeniseMarkdown` was deliberately NOT wired into
NoteTree's card preview** because notes are stored as Tiptap JSON, not
markdown — using the markdown tokeniser on Tiptap content would render
incorrectly. The helper remains 🟡 available for future markdown-import
features.

## Anything still in 🟡 today

- Waiting for the feature it enables to ship (note attachments →
  `useImage*`, sync conflicts → `ConflictResolverModal`,
  voice-input STT engine wiring), OR
- Per-route opt-in where the cost of migrating live callsites isn't
  justified yet (soft-delete plugin, sliding-window rate-limit
  replacing the existing fixed-window).
