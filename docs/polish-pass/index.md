# Polish Pass — May 2026

Self-contained reference for the 35 changes shipped on the `agent/polish-pass`
branch. Each item below is implemented, type-checked, and (where unit-testable)
covered by Jest. Items that depend on infrastructure not present in this repo
(release pipeline, MMKV native module, federation gateway) are documented with
their activation path.

## Index

- [Backend](./backend.md) — Apollo Server v5, change streams, persisted queries,
  Redis-backed rate-limit, explicit CSP, OTel trace-id, auto-derived OpenAPI 3.1,
  mongoose debug redactor, perf_hooks histogram, JWT tenant propagation,
  autoIndex disable + reconcile script.
- [Electron](./electron.md) — spell-checker CDN pinning, login-item opt-in,
  thumbnail IPC, Windows 11 acrylic, accessory policy, reduced-motion CSS,
  cursor-anchored tray menu, isolated-world DOM, UA pinning, crashReporter,
  electron-updater with Sigstore-ready hook.
- [Mobile](./mobile.md) — haptics selectionAsync, KV abstraction with MMKV
  adapter, explicit enableScreens, reduce-motion hook, reanimated FadeIn
  on list rows.
- [CI / Cross](./ci.md) — actionlint custom rule, Renovate automerge,
  Rekor transparency-log audit.
- [Testing](./testing.md) — what's covered, how to run, what depends on infra.
- [Round 4 — operational hardening](./round-4.md) — graceful shutdown,
  request-id, GraphQL complexity limit, deep health, brotli, NoteTree
  O(n²)→O(n log n), rate-limited ErrorBoundary, splash sync, app menu,
  window-state-keeper, DevTools gate.
- [Round 5 — UX, bandwidth, a11y](./round-5.md) — per-route body limits,
  slow-query logger, ETag + Cache-Control, structured request log,
  jittered retry + Retry-After, AppState foreground sync, a11y on
  list rows, useRefreshControl, shortcut registry, context-menu,
  find-in-page.
- [Round 6 — resilience, supply-chain, native UX](./round-6.md) — readiness
  gate, Idempotency-Key, CORS preflight cache, CSP report endpoint,
  configurable trust-proxy, KeyboardSafeView, theme preload, network-policy
  hook, native notifications, power monitor, recent-notes dock-menu.
- [Round 7 — data hygiene, offline, desktop integration](./round-7.md) — typed
  HttpError hierarchy, cursor-pagination, centralised Joi validate, instance
  heartbeat, offline mutation queue, tab haptics, locale-aware date
  formatters, Zod-healed settings, single-instance lock + deeplinks, dock badge.
- [Round 8 — security, soft-delete, native UX](./round-8.md) — Argon2id
  password hasher, GraphQL depth limit, soft-delete plugin, audit log,
  network-status retry, image-quality hook, route-restore, background-fetch,
  drag-drop import, macOS share menu, renderer-crash recovery.
- [Round 9 — inter-service trust, distributed coordination, native polish](./round-9.md) —
  Socket.IO schema validator, HMAC webhook signing, distributed lock,
  migration runner, image-prefetch, voice-input button, memory-warning,
  optimistic-mutation helper, Touch Bar, native print, resource monitor.
- [Round 10 — read-replicas, token rotation, multi-window](./round-10.md) —
  mongoose readPreference, WS auth-refresh, sliding-window rate-limit,
  JWT key rotation (kid), sync-conflict resolver, deep-link consumer,
  bottom-sheet wrapper, search-highlight, note-window, user dictionary,
  file-dialog validator.
- [Round 11 — quotas, encryption-at-rest, file-association](./round-11.md) —
  per-user quota tracker, AES-GCM field encryption, API-key auth,
  in-process job queue, drag-reorder hook, biometric lock, markdown
  sanitizer, conflict-resolver modal, .noter file-association, drag-drop
  feedback CSS, print preview.
- [Round 12 — push, scheduling, battery-aware](./round-12.md) — Web Push
  VAPID sender, cron scheduler, bulkWrite helper, NaN/Infinity sanitiser,
  app shortcuts, skeleton loaders, useLongPressMenu, note export
  (markdown/PDF), updater state-machine, macOS vibrancy, battery-aware
  background policy.

## Reading order

For a one-stop view of **what's reachable to users today** vs. what's
sitting as opt-in scaffolding, start with these two:

- **[Reachability — what users actually get](./reachability.md)** — per-app
  list of features a human can experience today, no flag flips needed.
- **[Integration audit](./integration-audit.md)** — honest mapping of every
  one of the 150 items: 🟢 wired, 🟡 available helper, 🔵 opt-in scaffold,
  🔴 needs external infra.

## How to verify the whole pass locally

```bash
# Backend type-check
cd noter-app/apps/backend && pnpm run check-types

# Backend tests (unit + integration)
cd noter-app/apps/backend && pnpm test

# Mobile type-check
cd noter-app/apps/mobile && pnpm run check-types

# Mobile tests
cd noter-app/apps/mobile && pnpm test

# Electron syntax + jest unit tests
cd electron-noter && node --check main.js && node --check preload.js && pnpm test

# Custom actionlint rule self-test
./.github/scripts/check-checkout-credentials.sh

# OpenAPI 3.1 generator
cd noter-app/apps/backend && pnpm run docs:openapi

# Index reconciliation (read-only)
cd noter-app/apps/backend && pnpm run db:reconcile-indexes:dry-run
```

## Recovery of pre-existing E2E-encryption WIP

The 285-file WIP that was open when this branch was started is preserved in
`stash@{0}` on `agent/e2e-encryption-clean`. To bring it back:

```bash
git checkout agent/e2e-encryption-clean
git stash pop
```

The polish-pass changes are intentionally isolated from that WIP so each
branch can be reviewed independently and merged in the order that makes
sense for your release plan.

## Risk summary

| Change | Blast radius | Reversibility | Notes |
|---|---|---|---|
| Apollo Server v5 swap | High — every GraphQL caller | Easy (revert one commit) | Persisted queries default on; introspection gated |
| Redis rate-limit | Medium — graceful fallback to memory if Redis fails | Trivial | No prod outage path |
| helmet CSP explicit | Medium — might surface inline-style usage | One config flip | Web app may need style-src adjustments |
| mongoose autoIndex=false in prod | Low — drift surfaces in CI gate | Trivial | Reconcile script ships dry-run mode |
| Change-stream invalidator | Low — no-op without replica set | Trivial | Failure mode degrades, not crashes |
| Electron tray + acrylic + UA | Low — additive | Trivial | All gated behind settings |
| Mobile haptics swap | Trivial | Trivial | Pure UX nuance |
| MMKV scaffolding | None today | N/A | Activates only when dep is installed |
| electron-updater scaffold | None until publish endpoint exists | Trivial | `verifyUpdateSignatureStub` fail-closed |
