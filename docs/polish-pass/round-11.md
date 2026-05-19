# Polish Pass — Round 11 (quotas, encryption-at-rest, file-association)

[← Index](./index.md)

This round adds tenant-level quotas, server-side at-rest encryption for
internal fields, API-key auth for service-to-service callers, a
background job queue, plus mobile sync-conflict UI and Electron
file-association + print preview.

## Backend

### Per-user quota tracker (`src/services/quotaTracker.ts`)

`checkAndIncrement(userId, key, { hourLimit, dayLimit, monthLimit })`
counts every action atomically in `_quota_usage` collection. Bucket-id
shape is `<key>:<period>` where period is UTC-anchored (e.g.,
`ai:2026-05-19`). The same call can enforce multiple periods
simultaneously — fail on the most restrictive.

`enforceQuota(...)` throws `TooManyRequestsError` (from round 7's typed
hierarchy) so the error middleware emits a clean 429 with
`extensions.code = 'QUOTA_EXCEEDED'`.

7 tests covering UTC anchoring, hour/day/month period emission, bucket
key composition.

### Field-level encryption-at-rest (`src/utils/fieldEncryption.ts`)

AES-256-GCM with envelope `version|iv|tag|ciphertext` (base64url-encoded).
Master key from `FIELD_ENCRYPTION_KEY` (32-byte base64url). Per-collection
sub-key derived as `SHA-256(master || scope)` so a leak of one collection's
ciphertext can't decrypt another.

GCM auth-tag protects against tampering: flipping any byte in the envelope
makes `decryptField` throw. `tryDecryptField` returns null on any failure
— useful in migrations where some rows are plaintext.

10 tests covering round-trip, IV uniqueness, scope separation, tamper
detection, missing-key fallback.

### API-key authentication (`src/middleware/apiKeyAuth.ts`)

`nk_<kid>_<secret>` format. Storage in `_api_keys`:
`{ kid, hash, ownerUserId, scopes, lastSeenAt, revokedAt }`. Hash is
SHA-256(secret); `timingSafeEqual` comparison.

Header support: `Authorization: ApiKey <token>` OR `X-Api-Key: <token>`.
Scope check via `apiKeyAuth(['read:notes', 'write:notes'])`. `lastSeenAt`
is touched async + throttled (1/min/key) so the auth check stays fast.

10 tests covering token-parse strict pattern, hash determinism, length
caps.

### In-process job queue (`src/services/jobQueue.ts`)

`register(name, handler)` + `enqueue(name, payload, { maxAttempts, delayMs })`.
FIFO with max concurrency 4. Full-jitter exponential backoff between
retries. `drain()` resolves when queue empties; `close()` for graceful
shutdown.

8 tests covering FIFO ordering, retry-then-success, retry-exhaustion-drop,
delayMs, name-validation, drain-resolves-immediately-on-empty.

## Mobile

### useDragReorder (`hooks/useDragReorder.ts`)

Wraps DraggableFlatList with `applyLocally → commitRemote → restore-on-error`
plus selectionAsync haptic (reduce-motion-gated). Exposes `inFlight`
+ `lastError` so the UI can disable interactions during commit.

### useBiometricLock (`hooks/useBiometricLock.ts`)

`expo-local-authentication` wrapper with capability probe + retry counter
(5 attempts) + 30s lockout. Returns typed result
`{ ok: true } | { ok: false, reason: 'cancelled' | 'failed' | 'unavailable' | 'locked-out' }`.
Per-mount lockout window — global lockout would need a shared store.

### Markdown sanitizer (`utils/markdownSanitize.ts`)

`tokeniseMarkdown(string) → BlockToken[]`. Recognises:
- Headings (1-6), paragraphs, blockquotes
- Ordered + unordered lists
- Code blocks (with optional language tag)
- Thematic breaks
- Inline: bold, italic, code, links (http/https/mailto/relative only),
  images (with data:image/ URLs explicitly allowed)

`javascript:`, `file:`, `data:` (non-image), and protocol-relative URLs
are stripped to plain text — defence-in-depth against malicious note
content. 50KB input cap.

20 tests covering block parsing, inline parsing, URL safety, length
truncation.

### ConflictResolverModal (`components/ConflictResolverModal.tsx`)

UI for the `requires-prompt` outcome of `resolveConflict` (round 10).
Renders each conflicting field with local + remote previews (200-char
truncated) and a radio-group. Defaults to local choice (offline-first
bias). On apply, calls `applyConflictChoices` and emits the merged
record.

a11y modal-role + accessibilityViewIsModal baked in.

## Electron

### .noter file-association (`src/fileAssociation.js`)

Pure helpers:
- `validateNoterFilePath(path)` — extension allow-list (`.noter` /
  `.md` / `.txt`), fs.statSync isFile() check, null-byte rejection.
- `extractOpenFilePathFromArgv(argv)` — first valid `.noter`-shaped
  entry in argv, skipping flags + deeplinks.

main.js wires `app.on('open-file', …)` (macOS) and argv extraction
(Windows/Linux). A `pendingOpenFilePath` is stashed if launched before
window exists and delivered on `did-finish-load`.

`fileAssociations` + `protocols` entries added to `electron-builder` config
so installers register the OS associations.

12 tests covering extension allow-list, traversal/null-byte rejection,
argv filtering.

### Drag-drop visual feedback (`src/dragFeedback.js`)

CSS payload injected via `webContents.insertCSS` after `did-finish-load`.
Adds `.noter-drag-target` class with dashed outline + tint, scoped via
`color-mix()` so theme switches automatically. `prefers-reduced-motion`
suppresses the transition.

Renderer is expected to toggle the class on `dragenter`/`dragleave` on
its drop-zone element.

### Print preview (`src/printPreview.js`)

`buildPreviewHtml({ dataUrl, title, bytes })` — pure helper that emits
the preview HTML with strict CSP (`default-src 'none'`, no remote
scripts). HTML-escapes the title (XSS guard).

`previewWindowOptions({ parentBounds })` — sandboxed BrowserWindow
config with `sandbox: true` and no preload (the preview is a passive
viewer).

main.js wires the IPC: `print:preview` does `webContents.printToPDF`,
builds preview HTML, opens the preview window, polls a `__noter_action`
flag injected via `executeJavaScript` for the button clicks (since the
sandbox precludes preload IPC).

10 tests covering HTML escape, CSP shape, size cap, parent-bound
positioning, safe webPreferences.

## Tests added in round 11

| Suite | File | Count |
|---|---|---|
| Quota period helpers | `__tests__/services/quotaTracker.test.ts` | 7 |
| Field encryption round-trip | `__tests__/utils/fieldEncryption.test.ts` | 10 |
| API-key parse + hash | `__tests__/middleware/apiKeyAuth.test.ts` | 10 |
| Job queue lifecycle | `__tests__/services/jobQueue.test.ts` | 8 |
| Markdown sanitizer | `__tests__/utils/markdownSanitize.test.ts` | 22 |
| File-association validator | `tests/fileAssociation.test.js` | 12 |
| Print-preview HTML + window opts | `tests/printPreview.test.js` | 10 |

**79 new tests in round 11.** (Plus 32 hook/component tests for which
the React/Native runtime requirement makes Jest-mockable coverage
limited — those are exercised by the existing Detox e2e suite under
`apps/mobile/e2e/`.)

## Risk summary

| Change | Risk | Reversibility |
|---|---|---|
| Quota tracker | Low — failure to write quota = silently allow request | Per-call opt-in |
| Field encryption | Medium — wrong scope = unrecoverable data | Scope spec stable, dev/test mode skips encryption |
| API-key auth | Low — strict format, sha256-hashed storage | Per-route opt-in |
| Job queue | Low — in-memory; failed jobs drop after retries | Per-job-name opt-in |
| Drag-reorder hook | None — opt-in | Trivial |
| Biometric lock | Low — falls back to passcode; lockout is per-mount | Trivial |
| Markdown sanitizer | Low — pure function, drops dangerous URLs | Trivial |
| ConflictResolverModal | None — opt-in component | Trivial |
| File-association | Low — extension allow-list + path validation | Trivial |
| Drag feedback | None — purely visual CSS | Trivial |
| Print preview | Low — sandboxed transient window | Trivial |
