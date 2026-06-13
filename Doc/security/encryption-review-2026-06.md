# Encryption & Security Review — June 2026

**Date:** 2026-06-13
**Scope:** Client-side & at-rest encryption across mobile, desktop, web, backend.
**Status:** Living document. Tracks what was found, what shipped this pass, and the
prioritised remediation plan.

---

## Local-at-rest guarantee (verified)

"Information ska aldrig lagras okrypterat på enheten":

- **Mobile (SQLite `noter.db`)** — every note/task field is written through `encrypt()`
  (per-field), so title/content/tags/dates/ids are ciphertext at rest, never plaintext.
  The offline `sync_queue` payload (action/entity/data) is likewise encrypted. Proven by
  `apps/mobile/tests/database-at-rest.test.ts`: a "no plaintext anywhere in the INSERT"
  scan across *all* params + a sync-queue test. Once the v3 dataKey is active these become
  authenticated AES-256-GCM envelopes (dispatch proven in `packages/shared/encrypt.test.ts`).
  *Note:* the SQLite **file structure** (table/column names, row existence) is visible;
  full-file encryption needs SQLCipher/op-sqlite (native, tracked as Stage 4).
- **Desktop** — secrets (auth token, v3 dataKey) belong in the `safeStorage` secure store
  (`electron-noter/src/secureStore.js`); `settings.json` holds only low-sensitivity prefs.
- **Web** — the v3 dataKey lives in `sessionStorage` (server-can't-read); note bodies are
  never persisted in the browser in plaintext (no local note store today).

---

## TL;DR — the headline finding

**ADR-0001 ("E2E-kryptering med Argon2id + AES-GCM v3", marked *Accepted*) was never
implemented.** The code it describes does not exist:

- No `encryptV3` / `decryptV3`, no `kdf.ts`, `keyBootstrap.ts`, `cryptoMigration.ts`,
  `argon2Worker.ts`, or `kmsWrap.ts` anywhere in the tree.
- The only Argon2 usage is `apps/backend/src/utils/passwordHasher.ts` — server-side
  **password hashing**, unrelated to content encryption.

What actually runs today is exactly what ADR-0001's *Context* section says it replaced:

> `packages/shared/src/encrypt.ts` — CryptoJS `AES.encrypt(text, 'noter-default-key')`.

### Consequences of the gap

1. **The "E2E" encryption is not real E2E.** The key (`noter-default-key`) is a
   constant hard-coded in a repo that is slated to go open-source. Anyone with the
   source — or a copy of the server DB — can decrypt every note, task and AI message.
   The server *stores* ciphertext, but the key is public, so confidentiality from the
   server/an attacker is **zero**.
2. **No per-user key.** All users' data is encrypted under the same key.
3. **Weak KDF.** CryptoJS passphrase mode derives the AES key with OpenSSL
   `EVP_BytesToKey` (single-iteration MD5) — trivially brute-forceable if the key were
   ever per-password.
4. **No authentication.** AES-CBC without a MAC is malleable; a tampered ciphertext
   decrypts to garbage rather than being rejected.
5. **Silent decrypt-to-`''`** — see the bug below.

> Correction to a common misreading: the legacy scheme is **CBC with a random salt
> per call** (the `U2FsdGVkX1` / "Salted__" prefix), *not* ECB. It is randomised, just
> unauthenticated and weakly-derived.

---

## Bug fixed this pass: blank notes / tasks / folders in the mobile app

### Root cause

`decrypt()` returned `''` on **any** failure, and several call sites fed it values
that were never ciphertext in the first place (legacy/plaintext rows, already-decrypted
values, or genuinely-empty fields). The `''` then propagated:

- `processApiTask` (`useStore.ts`): `title: decrypt(task.title)` → a plaintext/legacy
  task title became `''` → **blank task**.
- `normalizeEncryptedNote` → `type: normalizeNoteType(decrypt(type))`: a plaintext
  `type: "project"` decrypted to `''`, and `normalizeNoteType('')` falls through to
  `"note"` → **a project folder rendered in the notes list** (the notes screen filters
  out `project`/`task_list`, so a mis-typed project leaks straight in).
- Note `title`/`content` had the same `decrypt(...) → ''` failure mode.

A single root cause produced three reported symptoms (blank notes, blank tasks,
folders-in-notes-list).

### Fix

Added two helpers to `packages/shared/src/encrypt.ts` and routed the fragile call sites
through them:

- `isLikelyEncrypted(value)` — true only when the string carries the CryptoJS salted
  marker (`U2FsdGVkX1…`). Reliable discriminator between our ciphertext and
  plaintext/legacy data.
- `safeDecrypt(value, fallback?)` — never silently blanks data:
  - non-string → `fallback ?? ''`
  - **not** salted ciphertext → returned unchanged (plaintext / legacy / already
    decrypted) — this is what stops the folder leak and blank legacy rows.
  - valid ciphertext → decrypted plaintext (may legitimately be `''`).
  - wrong key / corrupt (throws) → `fallback ?? original` — never `''`.

`decrypt()` keeps its legacy `''`-on-failure contract for back-compat; an internal
`decryptStrict()` is what lets `safeDecrypt` tell "decrypt failed" from
"decrypted to empty".

Call sites updated: `useStore.ts` (`tryDecryptString`, `processApiTask`,
`parseNoteDateValue`, note title/content/locked-title materialisation) and
`database.ts` (`decryptText` — the previous space/length heuristic is replaced by the
precise salt-prefix check).

Covered by `packages/shared/src/encrypt.test.ts` (11 tests) and the existing mobile
suites (34 tests) — all green.

---

## Other mobile fixes this pass

- **Auto-lock up to 12 h.** Added `6h` / `12h` options (`AppLock.tsx`, `settings.tsx`).
  Validation collapsed to one `isLockTiming()` guard + a `LOCK_TIMINGS` table.
- **Double biometric prompt.** The mount path (`checkBiometrics`) and the `isLocked`
  effect could both call `unlockApp()`. Added an `authInFlightRef` guard so only one
  OS prompt is ever in flight.
- **Folder-dialog bottom padding.** `ProjectSelector` list got
  `contentContainerStyle={{ paddingBottom: 16 }}` so the last folder isn't flush to
  the footer.

---

## Remediation plan — making E2E real (implements ADR-0001)

Staged so the live Raspberry-Pi data is never put at risk. **No step deletes or
re-keys server data until the prior step is verified on-device.**

### Stage 0 — foundation (DONE this pass)
- `isLikelyEncrypted` / `safeDecrypt` give migration code the ability to classify any
  field as *plaintext | legacy-v1 | vN* and decrypt-or-passthrough safely.

### Stage 1 — v3 primitive (DONE this pass — additive, no live data touched)
- `packages/shared/src/cryptoV3.ts` (built on `@noble/ciphers` + `@noble/hashes`, zero
  native deps, works in RN + web + Node):
  - `encryptV3(plaintext, dataKey)` → `v3:` + base64(`iv | ciphertext | tag`) using
    **AES-256-GCM** (authenticated). (XChaCha20-Poly1305 is a future option.)
  - `decryptV3(envelope, dataKey)` — rejects tampered input (auth tag verified).
  - `deriveRootKey(password, salt)` via **Argon2id** (19 MiB, t=2 — ~0.3 s warm;
    once per unlock) with a PBKDF2-SHA-256 (200k) fallback; reports which KDF ran.
  - `generateDataKey` / `wrapDataKey` / `unwrapDataKey` — per-user dataKey sealed
    under the password-derived rootKey. Server only ever sees the wrapped key.
  - Pure cross-runtime base64 codec (no `btoa`/`Buffer` assumptions).
  - 12 unit tests incl. full enrol → wrap → re-derive → unwrap → decrypt.

### Stage 1b — dispatch + key provider (DONE this pass)
- `encrypt.ts` now versioned: `setActiveDataKey()` installs the per-user key. While
  null, behaviour is byte-for-byte unchanged (legacy CryptoJS). Once a key is active,
  **writes emit `v3`** and **reads handle `v3` → legacy `v1` → plaintext**. Legacy
  reading is never removed, so existing server/device data stays readable throughout.
- 16 unit tests for the dispatch incl. "still reads legacy v1 while a v3 key is active"
  and "never blanks a v3 value when the key is absent (returns fallback)".

### Stage 2 — per-user key bootstrap (**DONE this pass — needs on-device validation**)
- Backend: `apps/backend/src/models/User.ts` gained an opaque `keyBundle`
  `{ wrappedDataKey, kdfSalt, kdf, keyVersion }`; `apps/backend/src/routes/keyBundle.ts`
  serves `GET/PUT /api/keys/bundle` (auth + rate-limited). Server can't read content
  with it. Backend `tsc` clean.
- Client: `apps/mobile/services/crypto/keyBootstrap.ts` (DI core, 6 unit tests through
  real crypto) + `services/crypto/index.ts` (wires `fetchWithAuth` + `expo-secure-store`).
  `enrollOrUnlock(password)` enrols (generate→wrap→**upload + Keychain backup before
  activating**) or unwraps on later logins/new devices; `restoreFromDevice()` re-activates
  from the Keychain backup with no password.
- App start: `restoreCryptoFromDevice()` runs in the `_layout.tsx` critical-path
  bootstrap **before notes load** (no-op + never throws if not enrolled).
- UI: explicit **"Förstärkt kryptering (E2E)"** toggle in Settings → Security prompts
  for the password and calls `enrollOrUnlockCrypto`. Nothing activates silently.
- **Owed before shipping a build:** real-device validation of (a) the Metro/EAS bundle
  with `@noble/*`, (b) login→enrol→relaunch→restore, (c) cross-device unwrap. The logic
  is unit-tested but the Keychain + live login path has not run on a device.
- Web client enrolment (**DONE this pass**): `apps/web/lib/crypto.ts` adapter reuses the
  shared keyBootstrap with browser `fetch` + `sessionStorage` for the dataKey (per-tab,
  cleared on close — server still can't read it). Boot restore in `app/page.tsx`; enrol
  toggle + recovery-code display in `SettingsModal`. The shared keyBootstrap now lives in
  `@repo/shared` so mobile + web share one tested implementation.

### Stage 3 — lazy migration
- On read: `safeDecrypt` already handles mixed v1/v3/plaintext. On write: always emit
  `v3` once active. Background job re-encrypts legacy rows to v3 per device. No
  server-side migration, nothing destructive.

### Stage 4 — device-at-rest hardening
- Mobile: move the wrapped key into `expo-secure-store` (Keychain/Keystore); evaluate
  SQLCipher for the SQLite file.
- Desktop (**secure store DONE this pass**): `electron-noter/src/secureStore.js` wraps
  Electron `safeStorage` (Keychain/DPAPI/libsecret). IPC `secure:get|set|delete|clear|
  status` + preload `noterDesktop.secureGet/secureSet/…`. Secrets persist as
  `{ key: base64(ciphertext) }` in `secure-store.bin` (mode 0600); refuses to write
  (no plaintext leak) when OS encryption is unavailable. 6 unit tests. **Renderer still
  needs wiring** to store the auth token + v3 dataKey here instead of localStorage.

### Stage 5 — recovery (**DONE this pass**)
- `generateRecoveryCode()` (Crockford base32, ~100 bits, grouped) in `cryptoV3.ts`.
- Enrolment wraps a **second copy of the dataKey** under a key derived from the recovery
  code and stores it in the bundle (`recoveryWrappedDataKey` + salt + kdf — opaque to the
  server). The code is shown to the user exactly once (Settings alert), never persisted
  in plaintext.
- `recoverWithCode(code)` unwraps the dataKey after a forgotten password and re-activates
  it. Backend `User.keyBundle` + `PUT/GET /api/keys/bundle` carry the optional recovery
  fields. Covered by shared + keyBootstrap tests.

---

## Other findings (tracked, not yet actioned)

| Area | Finding | Severity |
|------|---------|----------|
| shared | Hard-coded `DEFAULT_KEY` in source | **Critical** (until Stage 2) |
| shared | Legacy AES-CBC unauthenticated | High |
| mobile | SQLite (`noter.db`) not encrypted at rest | High |
| desktop | `settings.json` plaintext; no `safeStorage` | Medium |
| backend | `FIELD_ENCRYPTION_KEY` / AES-256-GCM util exists but only used for audit logs, not user data | Info |
| docs | ADR-0001 marked *Accepted* but unimplemented — **fix the ADR status or implement it** | Process |

### Known v3 tension: per-note password lock vs. E2E (verify-lock)
`POST /api/notes/:id/verify-lock` and the GET list determine "is this note locked?"
by `decrypt`-ing the stored `locked` field **server-side** (`parseEncryptedBoolean`).
That works for legacy v1 (the server has the hardcoded DEFAULT_KEY) but is impossible
for v3 — the per-user `dataKey` never reaches the server, so a v3-encrypted `locked`
field decrypts to '' and the note is treated as **unlocked**, bypassing the per-note
password barrier on the server. **No plaintext leak** (content stays E2E-encrypted; the
attacker still can't decrypt it), but the extra password gate degrades under v3.
Fix path for the v3 rollout: move per-note password verification client-side (derive a
per-note sub-key from the password and wrap the note key with it), or keep `locked` +
the password hash as server-readable metadata (not E2E). Decide before enabling v3 for
accounts that use per-note locks. Tracked here, not hacked.

### Immediate doc-integrity action
ADR-0001's status should be corrected to *Proposed* (or this review linked from it) so
the documentation stops claiming a control that does not exist.

---

## Verification (this pass)

- `packages/shared`: `npx jest` → **28/28 pass** (`encrypt.test.ts` 16 + `cryptoV3.test.ts` 12);
  `npx tsc` → clean.
- `apps/mobile`: `npx jest e2e-encryption task-encryption store database-at-rest` →
  34/34 pass; `npx tsc --noEmit` → clean.
- `@noble/ciphers` + `@noble/hashes` declared as direct deps of `@repo/shared`
  (lockfile synced) so EAS clean-installs don't drop them.

### Build validation still owed
- A full **Metro/EAS bundle** has not been run here — confirm `@noble/*` subpath
  exports (`@noble/ciphers/aes`, `@noble/hashes/argon2`) resolve in the RN bundler
  before shipping a build. Jest + tsc pass, which is a strong but not complete signal.
