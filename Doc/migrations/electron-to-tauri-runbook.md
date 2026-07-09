# Electron → Tauri v2 migration runbook (Noter desktop)

Status: **In progress — Phase 0 scaffold landed** · drafted 2026-06-14 · owner: Francisco
Companion decision record: [ADR-0007](../adr/0007-electron-vs-tauri.md).

## Progress log

- **2026-06-24 — Phase 0 scaffold (`tauri-noter/`, compiles: `cargo check` green).** `electron-noter/`
  untouched (golden rule). Landed:
  - Tauri v2 project: `src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json}`,
    `main.rs`/`lib.rs`. Window built in `setup()` so the preload bridge is injected before load.
  - **Secure store (§4) — the sharpest edge — DONE in Rust** (`secure_store.rs`) using the `keyring`
    crate: OS keychain for the auth token + v3 `dataKey` only (never note content). Self-contained
    key index so `secure_clear` can enumerate. `secure_status/get/set/delete/clear` commands.
  - **Settings (`settings:get/set` parity) — DONE** (`settings.rs`): JSON KV in the app-config dir,
    Mutex-cached, non-secret only.
  - **Preload bridge** (`bridge/preload-bridge.js`): re-creates `window.mlc` + `window.noterDesktop`
    on Tauri `invoke`/`listen`. Ported channels call Rust; the rest return SAFE defaults with clear
    "being ported" messages (UI never crashes) — each tagged `// TODO(tauri): port` for grepability.
  - **Frontend reuse:** `scripts/build-frontend.mjs` reuses the proven Electron static-export build
    100% and syncs it into `dist/` (the exported UI is runtime-agnostic).
  - Next phases (in order): mlc subprocess bridge (AI), updater, dialogs/notifications/tray,
    deep-link/file-assoc, find-in-page, print, multi-window — then the spike gates (§1) + security
    gate (§9) on all three webviews.

- **2026-07-09 — Phase 1a: native OS surfaces via official plugins (`cargo check` green).** Added the
  three plugins that each have a real consumer in the UI (no speculative deps):
  - **Notifications — DONE** (`tauri-plugin-notification`). `noterDesktop.notify(payload)` requests
    permission on first use, then `sendNotification`. Best-effort (never throws into the UI).
  - **Native dialogs — DONE** (`tauri-plugin-dialog`). `showOpenDialog`/`showSaveDialog` adapt the
    Electron opts (`properties`, `filters`) to Tauri's shape and adapt the result back to Electron's
    `{ canceled, filePaths|filePath }`, so import/export UI code is unchanged.
  - **Single-instance — DONE** (`tauri-plugin-single-instance`, registered first). A second launch
    focuses/unminimizes the running window instead of opening a duplicate (Electron-lock parity).
  - Permissions granted explicitly in `capabilities/default.json` (`notification:default`,
    `dialog:default`) — Tauri v2 locked-down default preserved. Dropped a speculative `os` plugin that
    had no consumer (keep deps lean). Runtime verification of the two JS plugin APIs is deferred to the
    spike gate (§1), since a GUI run is required.


This runbook is written so the migration does **not start from zero**. It maps every
native surface of the current Electron app (`electron-noter/`) to its Tauri v2
equivalent, with a security-first plan that **preserves end-to-end encryption** and the
no-plaintext-leak guarantees. Work top-to-bottom; each phase has an exit gate.

> **Golden rule (non-negotiable):** at no point may the migration weaken encryption or
> leak plaintext. The auth token and the v3 data-encryption key live ONLY in the OS
> keychain-backed secure store. Note/task content stays E2E-encrypted (`@repo/shared`
> v3 AES-256-GCM). The calendar ICS feed remains the *only* opt-in plaintext path and is
> lock-aware. Every phase ends with the **Security gate** (§9) re-verified.

---

## 0. Why / scope / decision

See [ADR-0007](../adr/0007-electron-vs-tauri.md). Decision: migrate, but **spike first**.
Wins: ~10–30× smaller installer, ~½ RAM, our Next.js static UI carries over. Costs land
on three risk surfaces, addressed head-on here: **(1) at-rest crypto** (§4), **(2)
auto-update continuity** (§6), **(3) three-webview rendering** (§7).

What carries over unchanged:
- The entire Next.js 15 / React 19 **static export UI** (`noter-app/apps/web`, `output:
  'export'`, `basePath: '/app'`). This is shared with the web app — keep it shared.
- The `@repo/shared` crypto (v3 AES-GCM + Argon2id), IndexedDB data layer, WSS sync.
- The `mlc_llm` subprocess model manager (Rust can spawn the same CLI; logic unchanged).

What must be rewritten in Rust (the work): the Electron **main process** (`main.js`,
1,547 LOC) + `preload.js` (167 LOC) + 26 `src/*.js` modules → Tauri commands/plugins.

---

## 1. Pre-flight spike (1–2 weeks, do this BEFORE committing)

Goal: de-risk the three hard parts on *our actual UI*, not a toy.

- [ ] Scaffold a Tauri v2 app in a new dir `tauri-noter/` (do NOT touch `electron-noter/`).
      Use the official Tauri v2 + Next.js 15 static-export starter as the base.
- [ ] Point the Tauri frontend at our existing web export (`noter-app/apps/web` built
      with `ELECTRON_EXPORT`-equivalent static export). Confirm it loads via Tauri's
      asset protocol with `basePath: '/app'`.
- [ ] **Render the real Noter UI in all three webviews** and screenshot-compare:
      - macOS **WKWebView**, Windows **WebView2**, Linux **WebKitGTK**.
      - Exercise: rich-text editor, graph SVG + gestures, AI chat, settings, dialogs.
      - WebKitGTK is the weak link — if it fights us badly, that changes the timeline.
- [ ] **Prototype the secure store** (§4) with the keyring plugin: store + read back the
      v3 dataKey on macOS Keychain, Windows Credential Manager, Linux libsecret. Verify
      the fallback path when the OS service is unavailable.
- [ ] Smoke-test **IndexedDB persistence** + **WSS** in each webview (quota differences,
      WKWebView storage dir, WebView2 user-data-folder).
- [ ] Time a clean Rust build in CI (minutes) to set expectations.

**Spike exit gate:** UI renders acceptably on all three webviews AND the dataKey
round-trips through the keyring on all three AND IndexedDB+WSS work. If any fails, stop
and reassess (staying on Electron is a valid outcome — see ADR-0007).

---

## 2. Architecture mapping (Electron → Tauri v2)

| Electron | Tauri v2 |
|---|---|
| `main.js` (Node) | `src-tauri/src/main.rs` + modules (Rust) |
| `preload.js` `contextBridge` | `#[tauri::command]` + `@tauri-apps/api` `invoke()` / `listen()` |
| `ipcMain.handle('x', …)` | `#[tauri::command] async fn x(...)` registered in `invoke_handler!` |
| `webContents.send('evt', p)` | `app.emit("evt", p)` / `window.emit(...)` → JS `listen("evt")` |
| `safeStorage` | `tauri-plugin-keyring` (OS keychain) — see §4 |
| `app://` `protocol.handle` | Tauri **asset protocol** (bundled frontend) |
| `electron-updater` | `tauri-plugin-updater` (minisign) — see §6 |
| `Tray` | `tauri-plugin-tray` / built-in tray API |
| `Notification` | `tauri-plugin-notification` |
| `setAsDefaultProtocolClient('noter')` | `tauri-plugin-deep-link` |
| `fileAssociations` (builder) | `tauri.conf.json` `bundle` + deep-link/file-open events |
| `BrowserWindow` (multi-window) | Tauri multi-window (window **labels**) |
| `powerMonitor` | OS shell (macOS `ioreg`/IOKit, Win WMI, Linux dbus) or a small plugin |
| `nativeTheme` | Tauri theme events / `window.theme()` |
| `Menu` / `dock` / JumpList | Tauri menu API; dock/JumpList via OS calls |
| `TouchBar`, vibrancy, acrylic | macOS AppKit via `objc2` crate; Win acrylic via `window-vibrancy` crate |
| `crashReporter` | custom minidump handler (e.g. `minidumper`/`crashpad`) → self-hosted URL |
| `electron-builder` | `tauri build` (`tauri.conf.json` bundle targets) |

Recommended `src-tauri/src/` module split (mirror the Electron `src/`):
`secure_store.rs`, `settings.rs`, `mlc.rs`, `updater.rs`, `windows.rs`, `deeplink.rs`,
`file_assoc.rs`, `print.rs`, `notify.rs`, `tray.rs`, `power.rs`, `dialog.rs`,
`spellcheck.rs`, `platform_macos.rs`, `platform_windows.rs`, `helpers.rs`.

---

## 3. The full IPC port checklist (45+ channels)

Every channel below is currently `ipcMain.handle` in `electron-noter/main.js` exposed via
`preload.js` (`window.mlc` / `window.noterDesktop`). **Keep the renderer's `window.*` API
shape identical** so the React code doesn't change — implement a tiny shim that maps the
old `window.noterDesktop.*` calls to `invoke()`/`listen()`. Port + tick each:

**Secure store (CRITICAL — §4):** `secure:status` `secure:get` `secure:set`
`secure:delete` `secure:clear`.
**Settings:** `settings:get` `settings:set` (+ reactions: openAtLogin, trayOnly,
spellCheckerCdn).
**Local LLM (mlc):** `mlc:get-models` `mlc:search-models` `mlc:get-model-files`
`mlc:download` (+`mlc:download-progress` event) `mlc:delete` `mlc:chat`
(+`mlc:chat-token` event) `mlc:cancel-chat`.
**Updater (§6):** `updater:check-now` `updater:install-now` `updater:get-state` (+ events
`available/not-available/progress/ready/error/rejected/state`).
**Find-in-page:** `find:start` `find:next` `find:stop` (+`find:result` event). *(Tauri:
webview find APIs differ per engine — verify; may need a JS-side find fallback.)*
**Notifications:** `notify:show` (+`note:open` click route).
**Badge:** `badge:set`.
**Recent notes / JumpList:** `recent:record` `recent:clear`.
**Drag-drop import:** `drop:validate` `drop:read`.
**Share (macOS):** `share:open`.
**Touch Bar (macOS):** `touchbar:set` (+`onTouchBarAction`).
**Printing:** `print:show` `print:to-pdf` `print:preview` (locked notes refuse — keep!).
**Multi-window:** `note:open-window`.
**Spell-check dictionary:** `dictionary:add` `dictionary:remove` `dictionary:list`.
**File dialogs:** `dialog:open` `dialog:save` (use `tauri-plugin-dialog`).
**Thumbnails:** `thumbnails:create` (path-allow-list to userData/downloads/pictures/docs).
**DOM isolated:** `dom:run-isolated` (only `highlight-search`) — likely replace with a
plain JS module in the renderer (no privileged world needed).
**Theme/power:** `onThemeChanged`, `onPowerEvent` (suspend/resume/lock/unlock).
**Deep-link/file-open:** `note:open`, `file:open`.
**Debug:** `metrics:app` (gated by debugOverlayEnabled).

> Port order: start with **secure store + settings + renderer load** (you need these to
> even log in), then **updater**, then the rest. Notifications/tray/print/etc. are
> additive and can land after first runnable build.

---

## 4. Secure store redesign (the security-critical part) — do this carefully

**Today (Electron):** `electron-noter/src/secureStore.js` writes
`{userData}/secure-store.bin` = a JSON map `{ key: base64(safeStorage.encryptString(value)) }`,
mode `0o600`. It holds the **auth token** and the **v3 dataKey**. `safeStorage` uses
macOS Keychain / Windows DPAPI / Linux libsecret.

**Tauri target — keep the exact security model, change only the backend:**

Two acceptable designs (pick A unless the spike shows a reason for B):

- **Design A — keyring stores a master key; we encrypt the blob ourselves (recommended).**
  - On first run, generate a 32-byte random **master key**; store it in the OS keyring
    (`tauri-plugin-keyring`, service `com.noter.desktop`, account `secure-store-master`).
  - Keep the same `secure-store.bin` file, but each value is now
    `AES-256-GCM(master_key, value)` (reuse `@repo/shared` v3 primitive *or* a Rust
    `aes-gcm` crate — must be the same algorithm/semantics). File mode `0o600`.
  - Rationale: the OS keyring is shaped for *small secrets*, not arbitrary blobs;
    storing one master key and encrypting our own blob mirrors `safeStorage` exactly and
    keeps the v3 dataKey handling unchanged.
- **Design B — store each secret directly in the keyring.** Simpler but the keyring is
  not meant for many/large entries; only viable because we store just 2–3 small secrets.
  Use if the spike shows Design A's file handling is more fragile than the keyring.

**Hard requirements (verify all in §9):**
- [ ] The **v3 dataKey never touches plaintext disk or localStorage** — keyring/encrypted
      blob only, exactly as today.
- [ ] The renderer reaches secrets ONLY through `window.noterDesktop.secureGet/Set/...`
      (now `invoke`), never directly — same boundary as the Electron preload.
- [ ] Graceful failure when the OS service is unavailable (esp. Linux libsecret not
      running): report "unavailable" and refuse to silently fall back to plaintext.
- [ ] **One-time migration:** on first Tauri launch, if `secure-store.bin` is in the old
      `safeStorage` format, the app cannot decrypt it (different backend). Plan: have the
      *last Electron release* export the token+dataKey via the existing secure channel, OR
      require the user to re-enter their E2E password once (the dataKey re-wraps from the
      password via Argon2id — `@repo/shared` keyBootstrap already supports this). **Prefer
      "re-enter E2E password once"** — it's the safest, needs no plaintext bridge.
- [ ] Wipe-on-logout (`secure:clear`) still deletes the keyring entry + the blob.

---

## 5. Renderer / asset serving

- Bundle the same Next.js static export. Configure Tauri to serve it via the asset
  protocol (frontend dist). Keep `basePath: '/app'` (or drop it if Tauri serves from
  root — decide in the spike and keep web + desktop consistent).
- Recreate the SPA fallback (unknown route → `index.html`).
- Define an **explicit CSP** (Electron relied on sandbox; Tauri should be explicit):
  `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'
  'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'
  https://* wss://*;` — tighten `connect-src` to the real backend host(s).
- Keep `contextIsolation`-equivalent posture: no Node integration in the webview; all
  privileged ops go through commands.
- Verify the service worker (`renderer/sw.js`) registers and caches under each webview.

---

## 6. Auto-update bridge (the #1 real-world gotcha — plan for existing users)

**Today:** `electron-updater`, generic provider
`https://updates.noter.app/releases/${os}/${arch}`, channel `stable`, 6h checks,
battery-aware, signature verification stubbed behind `NOTER_UPDATE_VERIFY_SIGSTORE=1`.

**Tauri:** `tauri-plugin-updater` uses **minisign** signatures and a different manifest —
**not compatible** with the electron-updater feed. Therefore:

- [ ] Ship a **final Electron release** whose primary job is to notify users that the app
      has moved to a new updater and prompt a one-time manual download of the first Tauri
      build (mirrors the Fluxzy migration; expect a long tail of users on the old version).
- [ ] Stand up the Tauri update feed (minisign keypair; keep the private key offline).
      On **Windows**, the binary needs Authenticode signing AND the minisign signature
      (two-pass) or updates fail silently.
- [ ] Re-implement the battery/thermal-aware check cadence (6h on AC, slower on battery)
      and the normalized state machine (`idle/checking/available/downloading/ready/error`)
      so the renderer's existing updater UI keeps working unchanged.
- [ ] Keep signature verification **on** from day one (don't ship the stub).

---

## 7. Cross-platform webview QA (recurring cost — budget for it)

Electron bundles one Chromium → zero variance. Tauri inherits three engines. Test matrix
EVERY release:

| Surface | macOS WKWebView | Windows WebView2 | Linux WebKitGTK |
|---|---|---|---|
| Rich-text editor | ☐ | ☐ | ☐ |
| Graph SVG + pinch/pan/rotate | ☐ | ☐ | ☐ |
| AI chat streaming + tool cards | ☐ | ☐ | ☐ |
| IndexedDB persistence + quota | ☐ | ☐ | ☐ |
| WSS realtime sync | ☐ | ☐ | ☐ |
| Service worker / offline | ☐ | ☐ | ☐ |
| Fonts / CSS prefixes | ☐ | ☐ | ☐ (weakest) |
| Print / PDF | ☐ | ☐ | ☐ |

WebKitGTK known pain: prefixes, fonts, Wayland, hardware-accel quirks (Fluxzy disabled HW
accel + set GTK env vars). If Linux is low priority, you can de-risk by deprioritising
WebKitGTK — but never claim Electron-level rendering parity.

---

## 8. Build / signing / release

- `tauri.conf.json` bundle targets: macOS `.dmg` + `.app` (+ notarization), Windows NSIS
  (+ Authenticode), Linux AppImage/deb (new — Electron didn't build Linux).
- Recreate macOS entitlements equivalents (JIT / unsigned-exec-memory / library
  validation) in the Tauri macOS config — V8/WASM in the webview needs them.
- App id `com.noter.desktop` (Electron used `com.noter.electron` — decide whether to keep
  or migrate the id; changing it affects keychain/identity continuity — see §4 migration).
- Icons from `electron-noter/build/icon.png` (regenerate the Tauri icon set via
  `tauri icon`).
- Protocols/file-assoc: register `noter://` scheme + `.noter`/`.md` associations in
  `tauri.conf.json`.

---

## 9. Security gate (run at the end of EVERY phase, and before release)

- [ ] **No plaintext secrets at rest.** Grep the on-disk app data: the auth token and v3
      dataKey appear ONLY as keyring entries / AES-GCM blobs — never in `settings.json`,
      localStorage, IndexedDB, or logs.
- [ ] **E2E intact.** Notes/tasks are still encrypted with the v3 dataKey before leaving
      the device; the backend still stores ciphertext; decryption happens only in-app.
- [ ] **Locked-notes invariant.** AI never reads locked notes/projects; the calendar
      projection still excludes locked-container tasks (`buildSafeCalendarProjection`).
- [ ] **Calendar = only opt-in plaintext path.** Nothing else is sent unencrypted; the
      ICS feed only updates when the user has subscribed; revoke deletes it.
- [ ] **Renderer boundary.** The webview cannot touch the filesystem or secrets except
      through the allow-listed commands (mirror the Electron preload allow-list).
- [ ] **Transport.** All WebSocket/API to public hosts is WSS/HTTPS (the shared
      `enforceSecureSocketUrl` still applies in the renderer).
- [ ] **Updater.** Signature verification is ON; Windows two-pass signing in place.
- [ ] **CSP** present and tight (§5).

---

## 10. Phased plan + exit gates

1. **Spike (§1)** → gate: 3-webview render OK + keyring round-trips dataKey.
2. **Skeleton:** Tauri shell loads the static UI; secure store + settings ported; user can
   log in and unlock E2E. → gate: §9 passes; create/read an encrypted note end-to-end.
3. **Core parity:** updater, multi-window, notifications, deep-link/file-assoc, tray,
   dialogs, printing (locked-note refusal preserved), mlc subprocess. → gate: feature
   parity checklist + §9.
4. **Platform polish:** Touch Bar, vibrancy/acrylic, power events, badge, JumpList/dock,
   spell-check CDN, crash reporter. → gate: §7 matrix green on target platforms.
5. **Release bridge:** ship final Electron "please update" build; cut first Tauri release
   with signing + minisign feed. → gate: a real upgrade from Electron→Tauri on a test
   machine preserves the user's encrypted data (or cleanly re-enrolls via E2E password).
6. **Decommission** Electron after the upgrade tail shrinks.

**Effort:** spike 1–2 wk; full migration ~6–10 person-weeks (IPC rewrite 2–3, secure-store
1–2, updater+signing 1–2, plugins 1, 3-webview QA 1–2). Add 1–2 wk if no Rust on the team.

---

## 11. Rollback

`electron-noter/` stays intact and shippable throughout. If a phase fails its gate, keep
releasing Electron; the Tauri work lives in `tauri-noter/` and ships only when §9 + §7
pass. No user is moved to Tauri until the release bridge (phase 5) is verified.

---

## 12. Source map (where the Electron behaviour lives today)

- Main process: `electron-noter/main.js` (1,547 LOC) — IPC handlers, `app://` scheme
  (L55–112), single-instance lock (L27–53), deep-link/file-assoc (L114–154), updater
  (L776–862), tray (L228–343), notifications (L871–891), windows/state (L451–503).
- Preload: `electron-noter/preload.js` (`window.mlc`, `window.noterDesktop`).
- Secure store: `electron-noter/src/secureStore.js` (`{userData}/secure-store.bin`).
- 26 `src/*.js` helpers (appMenu, contextMenu, deeplink, fileAssociation, dragDrop,
  windowState, noteWindow, touchBar, vibrancy, batteryPolicy, crashRecovery, shortcuts,
  mlc, updaterStatus, secureStore, recentNotes, userDictionary, fileDialog, printOptions,
  printPreview, dragFeedback, sharePayload, helpers).
- Build: `electron-noter/package.json` (electron-builder; mac dmg+zip, win nsis; generic
  update feed; `.noter`/`.md` assoc; `noter://` scheme); macOS entitlements at
  `build/entitlements.mac.plist`.
- Renderer source: `noter-app/apps/web` (Next.js static export, `basePath: '/app'`).
