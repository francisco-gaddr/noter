# Improvements & Todo List

## High Priority (Critical)

- [x] **Web React-DnD Fix**: Refactor `SidebarTree.tsx` to use `TreeNode.tsx` and proper types (`DropTargetMonitor`).
  - *Note*: Addressed recurring HMR/module factory error. If error persists, a full server restart is recommended.
- [x] **Mobile Syntax Error**: Fix JSX syntax error in `task/[id].tsx` (missing closing tag).
- [x] **Mobile Monorepo Config**: Fixed `@repo/shared` resolution error by adding `babel-plugin-module-resolver` and updating `metro.config.js`.
- [x] **Startup Stability**: Fixed "Cannot find module 'bson'" error by ensuring dependencies are correctly installed.
- [x] **Web Socket Stability**: Added network event listeners in `useStore.ts` to handle connection errors gracefully.
- [x] **Mobile Startup Time**: Optimized startup by deferring socket connection and network listeners using `InteractionManager`.
- [x] **Web Error Boundary**: Added `SidebarErrorBoundary` to prevent sidebar crashes from breaking the whole app.
- [x] **Mobile Settings Crash**: Fix `SettingsScreen` width reference error.
- [x] **Session Expiry UX**: On 401, clear token and redirect to login.
- [x] **User-Scoped Realtime**: Scope Socket.IO events per user room.
- [x] **Mobile Task UX**: Autofocus title + quick date presets (Idag/Imorgon/Slutet av veckan).

## Performance & Optimization

- [x] **Mobile Animations**: Migrate to `react-native-reanimated` for smoother transitions (implemented in `NoteTree.tsx`).
- [x] **Bundle Size**: Analyzed mobile bundle size (~6.53 MB Hermes bytecode).
  - *Action*: Optimized imports (e.g., `lodash`).
  - *Status*: Reasonable size for current feature set.
- [x] **React Compiler**: Enabled React Compiler (experimental) in `next.config.js` and installed babel plugin.

## Code Quality & Maintenance

- [x] **Types**: Eliminate `any` usage in TypeScript files (search for `as any` and replace with proper types).
  - *Status*: Fixed `SidebarTree.tsx`, `useStore.ts`, and `api.ts`.
  - *Pending*: Remaining usages in non-critical components.
- [x] **Web Unit Tests**: Add unit tests for critical components (e.g., `SidebarTree`, `NoteEditor`).
  - *Status*: Added tests for `SidebarTree` and `SidebarErrorBoundary`.
- [ ] **Integration Tests**: Add integration tests for key flows.
- [ ] **Auth Regression Tests**: Add tests for session expiry redirect and logout.

## Security & Accessibility

- [x] **Web Accessibility**: Added skip link, main content ID, and ARIA labels.
- [x] **CSRF Protection**: Verified token-based authentication (Bearer token) usage, which mitigates CSRF. Ensure strict `SameSite` cookie policies if cookies are used in future.

## New Suggestions

- [ ] **E2E Testing**: Implement Maestro or Detox for mobile end-to-end testing.
- [ ] **CI/CD Pipeline**: Set up GitHub Actions for automated linting, testing, and building.
- [ ] **Lockfile Gate**: Add CI step running `npm ci` to validate lockfile sync.
- [ ] **Error Tracking**: Integrate Sentry for real-time error monitoring in production.
- [ ] **Internationalization**: Complete translation coverage for all strings (currently partial).
- [ ] **Theme Consistency**: Audit dark mode colors across mobile and web for consistency.
- [ ] **Offline Sync Conflict Resolution**: Implement more robust conflict resolution strategies (e.g., last-write-wins with user prompt).
- [ ] **Performance Monitoring**: Add Lighthouse CI to web pipeline.
- [ ] **Documentation**: Generate API documentation (Swagger/OpenAPI).
- [ ] **Backup System**: Implement automated backups for MongoDB.
- [ ] **Push Notifications**: Add push notifications for task reminders (Firebase/Expo Push).

## Night session 2026-06-19 — AI provider & network resilience (done)

- [x] **AI provider timeouts + retries**: New `@repo/shared/httpRetry` (`fetchWithRetry`) — per-attempt timeout (AbortController) + bounded transient retry (honour `Retry-After`, else exp-backoff w/ jitter; never retries non-transient 4xx). Wired into web + mobile non-streaming provider calls (60s) and the streaming connect/idle-stall guards. Streaming now keeps the partial answer on a mid-stream break instead of re-running the prompt (no duplicate text / re-billed tokens). 12 shared unit tests + 3 web streaming regression tests. Blocking CI gate "AI provider resilience".
- [x] **Model search + embeddings can't hang**: `@repo/ai` `HuggingFaceService` (server-side proxy) bounded with a 15s timeout; mobile `huggingface.fetchJson` routed through `fetchWithRetry` (20s + retries, keeps Swedish error copy + a timeout message). `embedTexts` bounded (30s + 1 retry). Tests added in `hf.test.ts` + `embeddingsClient.test.ts`.
- [x] **Stale provider defaults**: Anthropic default model list dropped the retired `claude-3-7-sonnet`/`claude-3-5-haiku` (404 since 2026-02-19) and now lists `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` (mobile + web).
- [x] **CI/CD**: Added the `AI provider resilience` blocking gate to `.github/workflows/ci.yml`; `validate-critical.mjs` now gates the web streaming test and skips the Electron step gracefully when the sibling repo isn't checked out (CI).
- [ ] **Dependency audit**: `npm audit` shows 138 advisories, almost all transitive (`ws` via socket.io/engine.io/metro/RN; `xlsx` no-fix; `yaml`). Surfaced non-blocking in CI; not auto-`fix --force`d (would rewrite the lockfile broadly and risk the Pi deploy). Needs a deliberate, reviewed upgrade pass.
- [x] **Auth-path timeouts**: `login`/`register` (mobile + web) used a bare fetch with no timeout → a stalled backend froze the auth screen. Both now use a 15s `fetchWithTimeout`.
- [x] **SECURITY — locked content leaked into external publish/index (6 sites)**: the UI unlock set (`unlockedProtectedNoteIds`) was being fed into projections that leave the device, so a locked folder *open in the UI* could be mirrored out:
  - Neo4j graph sync — web + mobile `nextcloud.ts` (`buildNeo4jSyncPlan` now takes NO unlock arg — hard-wired empty; the mobile one was only found because removing the param broke its typecheck).
  - Published ICS/CalDAV feed — web + mobile `calendarSubscription.ts` (`buildSafeCalendarProjection` now gets `[]`).
  - Published markdown WebDAV share — web + mobile `markdownShare.ts` (now `isReadableForAI`, empty set).
  - Embeddings/vector index — mobile `nextcloud.ts` reindex (`indexEntities(... new Set())`).
  - New blocking guard `scripts/check-index-unlock-leak.mjs` (wired into validate-critical + CI) fails if any of these builders is ever passed the UI unlock set again — it found the embeddings leak the manual audit missed. Neo4j regression test added. `docs/LOCKED_FOLDER_SECURITY.md` updated with the Neo4j row.
- [x] **SECURITY — audit round 2 (adversarial multi-agent audit found 3 more leak classes)**:
  - **Backend GraphQL / AI tool surface** (`apps/backend/src/graphql/schema.ts`): `Query.note/notes/task/tasks` server-decrypted and returned locked notes/tasks with NO lock guard — the AI agent's tool (and any OpenAPI tool caller) could read locked content. Now gated with `isReadableWithLocks` (empty set) via a `loadNoteSecurityMap`, mirroring `backendAgentRunner`. Regression test added.
  - **Home-screen widget snapshot** (mobile `snapshotWriter.ts`): locked-list task titles + list names flowed unfiltered into the OS-shared-container snapshot. Now `writeWidgetSnapshot` filters tasks + lists with `isReadableForAI`. Regression test added. (Native module still pending, so no live exfil yet — fixed before it ships.)
  - **Nextcloud outbound push** (web `nextcloud.ts` `pushLocalEditsForConnection`): a UI-unlocked locked note's plaintext was PUT to the remote WebDAV server. Now skips any non-`isReadableForAI` note.
  - The CRDT-Live relay, single-note PDF/MD export, and the GraphQL notes/task/tasks list variants were adversarially examined; the resolver family is fixed together, the others were judged not-real or lower-priority (logged for a follow-up review).
