# Polish Pass — Round 10 (read-replicas, token rotation, multi-window)

[← Index](./index.md)

This round adds production scaling primitives (read-replica routing,
sliding-window rate limit, JWT rotation), the long-tail sync edges
(conflict resolver, deep-link consumer), and rounds out the Electron
desktop with multi-window + spell-check user dictionary + file dialogs.

## Backend

### mongoose read-preference (`src/utils/readPreference.ts`)

`runWithReadPreference(query, 'secondaryPreferred')` chainable helper +
`findManyForRead(model, filter)` shorthand. `MONGOOSE_READ_PREFERENCE` env
sets the default. `maxStalenessSeconds` honoured when ≥90 (the driver's
floor).

Single-node Mongo silently routes to primary, so the helper is safe to
adopt incrementally. 5 tests covering enum acceptance, unknown-value
fallback.

### WebSocket JWT-refresh (`src/socket/authRefresh.ts`)

`installAuthRefresh(socket, initialToken, userId)`:
- Tracks token `exp` and schedules `auth:expiring` event 60s before.
- Accepts new tokens via `auth:refresh` event (with ack callback).
- Rejects user-swaps mid-socket (security: stops a leaked refresh-token
  being upgraded into a different account's session).
- Hard-disconnects 30s after expiry if no refresh arrived.

Demo-token mode skips timer machinery — there's no real expiry.

### Sliding-window rate-limit (`src/middleware/slidingWindowRateLimit.ts`)

Timestamp-based limiter (vs the fixed-window from round 5). Closes the
"double-tap straddling window boundary" hole. Pure `checkSlidingWindow`
helper + express middleware wrapper. Per-key buffer hard-capped at 2×
points so a runaway producer can't unbounded-grow memory.

7 tests covering under-limit accept, over-limit reject, sliding
correctness, prefix isolation, snapshot exposure, retry-after non-negativity.

### JWT key-rotation (`src/utils/jwtKeySet.ts`)

Multi-key signer/verifier with `kid` header support. Configuration via
`JWT_KEYS` env (JSON array of `{ kid, secret, status }`); falls back to
legacy single-secret `JWT_SECRET` as `{ kid: 'legacy', status: 'current' }`.

`status`:
- `current` → signs new tokens
- `previous` → verifies but doesn't sign
- `revoked` → refuses both

Token verification reads `kid` from the JWT header for O(1) lookup, falls
back to trying every active key when `kid` is missing (legacy compat).

6 tests including rotation-in-progress acceptance, revoked-kid rejection,
unknown-kid rejection, no-kid fallback.

## Mobile

### Sync conflict resolver (`services/syncConflict.ts`)

`resolveConflict({ base, local, remote })` returns:
- `identical` — local == remote, nothing to do
- `local-only` / `remote-only` — one side changed, take that
- `auto-merge` — both sides changed disjoint fields; merged automatically
- `requires-prompt` — same field diverges; UI must ask user

`applyConflictChoices` then applies per-field choices (`'local'` /
`'remote'` / `{ kind: 'custom', value }`) defaulting to local (offline-first
bias).

10 tests covering identical, one-side-only, disjoint auto-merge,
same-field divergence, same-edit no-conflict, nested objects.

### Deep-link consumer (`hooks/useDeepLinkConsumer.ts`)

Same parser as the Electron-side `src/deeplink.js` so links work
identically on either platform. Accepts `noter://note/<id>`,
`noter://task/<id>`, `noter://open?route=/internal`, and the
`https://daylited.com/{note,task}/<id>` universal links.

Strict allow-list rejects protocol-relative routes (`//evil.com`),
foreign protocols, path-traversal, foreign hosts. Subscribes via
`expo-linking` and routes through expo-router.

13 tests covering every accept/reject branch.

### BottomSheet wrapper (`components/NoterBottomSheet.tsx`)

Standardised `@gorhom/bottom-sheet` wrapper:
- Snap-points default `['40%', '85%']`
- Backdrop with `pressBehavior: 'close'` and configurable opacity
- `accessibilityViewIsModal` + label baked in for screen-readers
- Reduce-motion-aware animation duration

### Search-highlight utility (`utils/searchHighlight.ts`)

`highlightMatches(text, terms)` → `[{ text, match }]` segments for
rendering. Case-insensitive, regex-safe (terms are escaped), overlap-safe
(longest match wins), capped at 16 terms × 50KB text. Pure function —
no React deps — usable from any rendering layer.

14 tests covering empty inputs, multi-match, overlap merging, regex
escape, dedup, length caps.

## Electron

### Multi-window note view (`src/noteWindow.js`)

`buildNoteWindowOptions(noteId, { isDev, preloadPath })` returns the
`BrowserWindow` constructor options + deeplink. Strict id pattern
validation refuses malformed ids before we'd construct a window. IPC
`note:open-window` creates the window, loads the renderer, and posts
the deeplink to it via the existing `note:open` channel — same pipeline
the macOS Dock and Windows JumpList already use.

6 tests covering invalid id, devTools gating, custom preload path,
contextIsolation/nodeIntegration locked safe.

### Spell-check user dictionary (`src/userDictionary.js`)

`addWord(list, word)` / `removeWord(list, word)` / `reconcileWords(list)`.
Word validation:
- Unicode letters/digits + hyphen + apostrophe only (no whitespace,
  punctuation other than `-`/`'`/`’`)
- 1–64 chars
- Case-preserving (so "iPhone" doesn't collapse to "iphone")

Persisted in `settings.json` under `userDictionary`. On every new window
the stored list is replayed into the session via
`reconcileSpellCheckerDictionary()` so the user's vocabulary survives
both reinstalls and per-window state.

14 tests covering sanitisation, dedup, removal, reconcile guards.

### Native file-dialog wrapper (`src/fileDialog.js`)

`validateOpenDialogOptions` / `validateSaveDialogOptions` clamp:
- Title length ≤ 200
- defaultPath max 4096 chars + null-byte rejection
- Properties limited to a safe allow-list (no `openDirectory` etc.)
- Filters limited to named entries (`notes`/`images`/`docs`/`pdf`)
- suggestedName strips OS-reserved chars (`<>:"/\|?*` + control chars)

IPC `dialog:open` and `dialog:save` return explicit `canceled` so the
renderer can distinguish "user backed out" from "dialog failed".

14 tests covering defaults, property allow-list, path traversal,
filter scoping, suggestedName sanitisation.

## Tests added in round 10

| Suite | File | Count |
|---|---|---|
| Read-preference | `__tests__/utils/readPreference.test.ts` | 5 |
| Sliding-window rate-limit | `__tests__/middleware/slidingWindowRateLimit.test.ts` | 7 |
| JWT key-set rotation | `__tests__/utils/jwtKeySet.test.ts` | 8 |
| Sync conflict resolver | `__tests__/services/syncConflict.test.ts` | 10 |
| Deep-link parser | `__tests__/hooks/useDeepLinkConsumer.test.ts` | 13 |
| Search highlight | `__tests__/utils/searchHighlight.test.ts` | 14 |
| Note-window options | `tests/noteWindow.test.js` | 6 |
| User dictionary | `tests/userDictionary.test.js` | 16 |
| File-dialog options | `tests/fileDialog.test.js` | 12 |

**91 new tests in round 10.**

## Risk summary

| Change | Risk | Reversibility |
|---|---|---|
| Read-preference | Low — falls back to primary on single-node | Per-query opt-in |
| WS auth-refresh | Medium — user-mismatch refusal could surprise integrators | Per-socket opt-out |
| Sliding-window limit | Low — additive; existing fixed-window still works | Per-route mount |
| JWT key-rotation | Medium — wrong rotation locks active users out | Legacy fallback ensures gradual migration |
| Sync resolver | None — pure helper | Trivial |
| Deep-link consumer | Low — strict allow-list blocks SSRF/path-traversal | Trivial |
| BottomSheet | None — opt-in component | Trivial |
| Search highlight | None — pure function | Trivial |
| Multi-window | Low — child window dies cleanly | Trivial |
| User dictionary | None — bounded list, sanitised | Trivial |
| File dialog | Low — strict validation prevents path traversal | Trivial |
