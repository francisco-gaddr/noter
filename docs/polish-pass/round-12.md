# Polish Pass — Round 12 (push, scheduling, battery-aware)

[← Index](./index.md)

This round adds Web Push, an in-process cron scheduler, mongo bulkWrite
batching, numeric sanitiser, plus mobile app-shortcuts/skeleton/long-press/export
and Electron updater-state-machine + macOS vibrancy + battery-aware
background processing.

## Backend

### Web Push sender (`src/services/webPush.ts`)

Pure VAPID JWT signing (no `web-push` dep) + `sendPush(subscription)`
that POSTs to the browser's endpoint with the right headers. Configuration
via `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY_PEM` + `VAPID_SUBJECT`.

`generateVapidKeyPair()` ships for first-bootstrap + tests. Returns
typed `{ ok, status, reason, expired }` so callers can purge 404/410
subscriptions immediately. 11 tests.

### Cron scheduler (`src/services/cronScheduler.ts`)

`schedule(name, sched, handler)` registers a job; the runtime processes
jobs whose `nextRunAt` has passed, wrapping each in `withLock(`cron:${name}`)`
from round 9 so multi-pod doesn't double-fire.

Schedule DSL: `interval`/`hourly`/`daily`. `computeNextRun` is pure and
deterministic (the jitter case excluded). 11 tests covering interval,
hourly, daily, schedule validation, jitter bounds.

### bulkWrite helper (`src/utils/bulkWrite.ts`)

`bulkUpsert(model, docs, matchKey)` chunks at 500 ops/batch, retries
transient mongo errors with jittered exponential backoff. Pure `chunk`
+ `isRetryableError` + `computeBackoff` for testing.

11 tests covering chunk semantics, retryable-code detection, network-error
detection, backoff bounds.

### NaN/Infinity sanitiser (`src/middleware/sanitiseNumbers.ts`)

`sanitiseValue(input)` recursively replaces `NaN`/`Infinity`/`-Infinity`
with `null`, returning paths it touched for logging. Mounted after
`express.json` so route handlers never see non-finite numbers.

Why this matters: mongoose silently writes `NaN` to numeric fields,
producing a query that never matches anything (`{x: NaN}` is unequal to
itself). 10 tests covering arrays, nested objects, depth limits, top-level
primitives.

## Mobile

### App shortcuts (`services/appShortcuts.ts`)

Typed registry of 4 shortcuts (`newNote`, `search`, `lastNote`, `newTask`)
with `resolveShortcutActivation(rawId)` that strict-validates IDs from the
OS. Module-load duplicate detection catches typos.

12 tests covering ID validation, activation resolution, registry shape.

### Skeleton loaders (`components/Skeleton.tsx`)

`SkeletonBox` / `SkeletonRow` / `SkeletonCard` with Animated.View
opacity pulse. Reduce-motion holds the opacity at 0.5 instead of
animating. Uses `theme.colors.surfaceVariant` so light/dark themes
get the right tint.

### useLongPressMenu (`hooks/useLongPressMenu.ts`)

State machine: `onLongPress(item)` → opens menu + plays Medium haptic;
`choose(actionId)` → closes + invokes handler. Per-action `visible(item)`
filter so menus stay context-relevant. Reduce-motion-aware.

### Note export (`services/noteExport.ts`)

`exportNoteToMarkdown` and `exportNoteToPdf`. Both refuse locked notes via
`LockedNoteExportError`. Pure `buildMarkdownExport` + `buildHtmlExport`
helpers for testing. HTML output uses a minimal inline stylesheet so
`expo-print` renders consistently.

10 tests covering locked-note rejection, HTML escape, plain-text-vs-HTML
detection, filename sanitisation.

## Electron

### Updater state machine (`src/updaterStatus.js`)

`createUpdaterStateMachine()` aggregates the raw electron-updater events
into a single normalised view: `{ status, version, progress, error, updatedAt }`.
Reducer handles out-of-order events (progress after ready is ignored),
clamps percent, truncates error messages.

Renderer subscribes via `noterDesktop.onUpdaterState(handler)` for the
toast UI. 11 tests covering full lifecycle, out-of-order rejection,
error truncation, unknown-event no-op.

### macOS vibrancy (`src/vibrancy.js`)

`resolveVibrancyForTheme(theme, platform)` — `'sidebar'` for light,
`'dark'` for dark, `null` on non-darwin. `isValidVibrancyMaterial`
allow-list. Wired into createWindow + theme-update listener for live
theme switches.

6 tests covering theme/platform combos.

### Battery-aware background policy (`src/batteryPolicy.js`)

`resolveBackgroundPolicy({ onBattery, thermalState })` returns
`{ policy: 'normal' | 'reduced' | 'paused', reason }`. `intervalMultiplier`
scales auto-update checks (2× on battery, ∞ on thermal-critical).

The auto-updater now respects this: 6h base interval × 2 on battery,
skipped entirely when thermal is critical. 13 tests covering every
combination + multiplier semantics.

## Tests added in round 12

| Suite | File | Count |
|---|---|---|
| Web Push JWT signing | `__tests__/services/webPush.test.ts` | 11 |
| Cron scheduler | `__tests__/services/cronScheduler.test.ts` | 11 |
| Bulk-write helpers | `__tests__/utils/bulkWrite.test.ts` | 11 |
| Number sanitiser | `__tests__/middleware/sanitiseNumbers.test.ts` | 10 |
| App shortcuts registry | `__tests__/services/appShortcuts.test.ts` | 12 |
| Note export | `__tests__/services/noteExport.test.ts` | 10 |
| Updater state-machine | `tests/updaterStatus.test.js` | 11 |
| Vibrancy resolver | `tests/vibrancy.test.js` | 6 |
| Battery policy | `tests/batteryPolicy.test.js` | 13 |

**95 new tests in round 12.**

## Risk summary

| Change | Risk | Reversibility |
|---|---|---|
| Web Push | Low — opt-in send-only | Trivial |
| Cron scheduler | Low — distributed-lock-guarded, in-process | Trivial |
| bulkWrite | Low — retries only on transient codes | Trivial |
| Numeric sanitiser | Low — replaces with null, logs path | Trivial |
| App shortcuts registry | None — registration is deferred | Trivial |
| Skeleton loaders | None — opt-in components | Trivial |
| useLongPressMenu | None — opt-in hook | Trivial |
| Note export | Low — file written to cache dir, locked-note guard | Trivial |
| Updater state machine | None — additive | Trivial |
| Vibrancy | None — no-op on non-darwin | Trivial |
| Battery policy | Low — paused stops checks but they resume on power change | Trivial |
