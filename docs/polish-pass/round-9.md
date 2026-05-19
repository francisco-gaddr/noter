# Polish Pass — Round 9 (inter-service, distributed coordination, native polish)

[← Index](./index.md)

This round adds production-grade primitives for service-to-service trust
(HMAC webhook signing), cross-pod coordination (distributed lock,
migration runner), Socket.IO payload safety, and rounds out the desktop
client with Touch Bar / print / resource monitoring.

## Backend

### Socket.IO message-schema validator (`src/socket/messageSchemas.ts`)

Zod schemas for every event the server accepts FROM clients. `validateSocketEvent(event, payload)` returns `{ ok, data, issues? }`.
Unknown events are rejected by default; known events validate against
strict patterns (`^[A-Za-z0-9_-]+$`, max 128 chars) so a malicious client
can't inject NoSQL operators or path-traversal payloads.

Added events: `note:join`, `note:leave`, `note:cursor`, `task:join`.

7 tests covering unknown-event rejection, path-traversal blocking,
NoSQL-operator blocking, passthrough of `user` extras, missing-field
issues.

### HMAC webhook signing (`src/utils/webhookSign.ts`)

Stripe/Slack-style `t=<unix-ts>,v1=<hex-hmac>` header. `signPayload(secret, body)` produces the header; `verifyWebhookSignature` returns one of:
- `{ ok: true, timestamp }`
- `{ ok: false, reason: 'missing' | 'malformed' | 'unsupported-version' | 'stale' | 'invalid-signature' }`

5-minute default replay tolerance; `timingSafeEqual` comparison; v1 version
tag allows future algorithm rotation without breaking existing
integrations.

13 tests including stale-timestamp rejection, body-tamper detection,
secret-mismatch, array-form header handling.

### Distributed lock (`src/services/distributedLock.ts`)

Single-key mutex backed by Redis `SET NX EX`. Random fence token written
on acquire; `release()` is conditional on the token still being present
(prevents a stale owner whose TTL expired from releasing a new owner's
lock).

In-memory fallback when `REDIS_URL` isn't configured, so dev/test paths
work without a Redis container.

API: `acquireLock(key, { ttlSeconds })` → handle-or-null;
`withLock(key, fn, opts)` → throws `LockUnavailableError` if busy.

10 tests covering acquire/release/expire/owner-only-release/throw-safety.

### Versioned migration runner (`src/services/migrationRunner.ts`)

Each migration declares `{ id, up(db) }`. Applied migrations recorded in
`_migrations` collection (unique index on `id`). The whole run is wrapped
in `withLock('migration-runner')` so two backends starting simultaneously
can't race.

Dry-run mode prints what would apply without touching state. Stable id
pattern `[a-zA-Z0-9_-][a-zA-Z0-9_.-]{1,127}` rejected at validation so
typos surface before they're persisted as a half-applied state.

7 tests covering id validation, duplicate detection, missing up().

## Mobile

### useImagePrefetch (`hooks/useImagePrefetch.ts`)

Pre-warms `expo-image`'s cache for a list of URIs. Strict allow-list
(`https://…` or `data:image/…` only); blocks http/file/ftp/javascript:.
Skips when offline OR when `preferDeferLargeUploads` is true (network
policy from round 6). Module-level session cache dedupes per-session.

7 tests for the URI validator covering https/data accepts, downgrade
attack, non-image data-URLs, length caps.

### VoiceInputButton (`components/VoiceInputButton.tsx`)

Push-to-talk pattern: long-press begins listening (medium haptic +
optional `expo-speech` confirmation), release ends and calls
`onTranscript`. Reduce-motion gates the haptic. Host injects the actual
STT engine via `onStart`.

a11y: role/label/hint/state per WCAG 2.1 4.1.2; busy state reflects
listening status for screen readers.

### useMemoryWarning (`hooks/useMemoryWarning.ts`)

Subscribes to iOS `UIApplicationDidReceiveMemoryWarningNotification` and
Android `onTrimMemory` (both bridged as `memoryWarning` event in RN).
Throttle window default 5s prevents cascade-cleanup-causing-jank in
low-RAM device sessions.

4 tests covering the throttle gate, first-event special case.

### useOptimisticMutation (`hooks/useOptimisticMutation.ts`)

Generic helper: `applyLocally` → `commitRemote` → on failure `rollback`
to a snapshot. `shouldRollback` callback lets callers skip rollback when
they want to enqueue to the offline queue instead (integrates with
round 7's offlineQueue).

State exposes `{ inFlight, error }` and `reset()`. 4 tests covering
happy-path, server-failure rollback, opt-out of rollback,
reset.

## Electron

### Touch Bar (`src/touchBar.js`)

Pure `buildTouchBarTemplate(context, ctx)` returns descriptor array for
contexts `default | note | find`. IPC `touchbar:set` constructs Electron's
`TouchBar*` items and applies to the focused window. Renderer hosts can
swap contexts via `noterDesktop.setTouchBar('find')` when the find bar
opens.

7 tests covering layout per context, handler wiring, unknown-context
fallback.

### Native print + printToPDF (`src/printOptions.js`)

`validatePrintOptions(raw, { kind: 'print' | 'pdf' })` clamps:
- pageSize to allow-list (A0–A6, Legal/Letter/Tabloid) or custom microns
  in safe range
- margins to 0–50mm
- copies to 1–20
- scale (pdf) to (0.1, 5]
- deviceName length ≤ 256

`print:show` IPC refuses to print if `lockedNote: true` is set —
encrypted notes shouldn't accidentally generate paper copies.
`print:to-pdf` returns a data-URL the renderer can save or attach.

13 tests covering defaults, copy clamping, page-size allow-list, custom
microns range, scale validation, pdf-vs-print field filtering.

### Resource monitor (`metrics:app` IPC)

Exposes `app.getAppMetrics()` (per-process CPU + memory) plus
`app.getSystemVersion()`. Gated behind `debugOverlayEnabled` setting so
the metric isn't a fingerprinting oracle for anonymous users.

## Tests added in round 9

| Suite | File | Count |
|---|---|---|
| Socket message-schema | `__tests__/socket/messageSchemas.test.ts` | 7 |
| Webhook sign/verify | `__tests__/utils/webhookSign.test.ts` | 13 |
| Distributed lock | `__tests__/services/distributedLock.test.ts` | 11 |
| Migration validator | `__tests__/services/migrationRunner.test.ts` | 7 |
| Image-prefetch URI guard | `__tests__/hooks/useImagePrefetch.test.ts` | 7 |
| Memory-warning throttle | `__tests__/hooks/useMemoryWarning.test.ts` | 4 |
| Optimistic-mutation lifecycle | `__tests__/hooks/useOptimisticMutation.test.ts` | 4 |
| Touch Bar template | `tests/touchBar.test.js` | 8 |
| Print-options validator | `tests/printOptions.test.js` | 12 |

**73 new tests in round 9.**

## Risk summary

| Change | Risk | Reversibility |
|---|---|---|
| Socket schemas | Low — strict, but only on new event names | Per-event opt-out by removing schema entry |
| Webhook signing | Low — caller chooses to use | Trivial |
| Distributed lock | Low — memory fallback, TTL hard cap at 1h | Trivial |
| Migration runner | Medium — wrong migration applied → manual repair | Dry-run mode + per-id rollback by deleting record |
| Image prefetch | None — opt-in hook | Trivial |
| Voice input | None — opt-in component | Trivial |
| Memory warning | None — read-only event subscription | Trivial |
| Optimistic mutation | None — opt-in helper | Trivial |
| Touch Bar | None — macOS-only, no-op elsewhere | Trivial |
| Print | Low — locked-note guard prevents accidental disclosure | Trivial |
| Resource monitor | None — gated behind setting | Trivial |
