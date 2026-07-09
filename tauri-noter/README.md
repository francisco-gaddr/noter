# Noter desktop (Tauri v2)

The Tauri (Rust) replacement for the Electron desktop app (`../electron-noter`). It **reuses the shared
Next.js UI unchanged** and re-implements only the native surface in Rust. `electron-noter/` stays the
shipping app until this reaches parity; it is never modified by this migration (golden rule).

Full plan, phase log, and the security gate: [`../Doc/migrations/electron-to-tauri-runbook.md`](../Doc/migrations/electron-to-tauri-runbook.md).

## Layout

```
tauri-noter/
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs          # app builder: plugins, window, event wiring, command registry
│   │   ├── main.rs         # thin entrypoint
│   │   ├── secure_store.rs # OS-keychain secrets (auth token + v3 dataKey) via `keyring`
│   │   ├── settings.rs     # non-secret JSON prefs (theme, openAtLogin, trayOnly, …)
│   │   ├── deeplink.rs     # noter:// + .noter parser (security-critical) + cold-start queue
│   │   └── mlc.rs          # on-device model registry (index.json)
│   ├── bridge/preload-bridge.js  # re-creates window.mlc / window.noterDesktop over Tauri invoke/listen
│   ├── capabilities/default.json # Tauri v2 ACL — permissions opted into explicitly
│   └── tauri.conf.json     # CSP, deep-link scheme, file association, bundle
├── scripts/build-frontend.mjs    # reuses electron-noter's static export → dist/
└── tests/bridge.test.mjs         # node:test suite for the bridge seam
```

## How the reuse works

The shared UI talks to the desktop through two globals, `window.mlc` and `window.noterDesktop`. In
Electron they come from a preload script; here **`bridge/preload-bridge.js`** re-creates the exact same
API over Tauri's `invoke()` / `listen()` and is injected as the window's `initialization_script`, so it
runs before the app loads. The same static bundle therefore serves both runtimes with **no UI changes**.

Ported channels call Rust commands; channels not yet ported return a **safe default** (no-op, `[]`, or a
rejected promise with a clear "being ported" message) so the UI degrades gracefully. Every unported
channel is tagged `// TODO(tauri): port` for grepability.

## Security model (unchanged from Electron)

- **Secrets** (auth token + the v3 `dataKey`) live **only** in the OS keychain via `secure_store.rs`.
  Never note/task content, which stays E2E-encrypted by `@repo/shared` (v3 AES-256-GCM). Stronghold is
  deprecated and deliberately not used.
- **Deep-links** are validated in Rust (`deeplink.rs`) — the trust boundary the Electron main process
  used to be — so only a validated internal route ever reaches the webview (no path traversal / no
  external redirect).
- **Lock invariant:** a locked note is never printed (`printNote` refuses `lockedNote === true`).
- **Tauri v2 is locked-down by default:** every capability is opted into explicitly in
  `capabilities/default.json`; the CSP is set in `tauri.conf.json`.

## Develop

```bash
npm run build:frontend   # build + sync the shared Next.js export into dist/
npm run check            # cargo check (fast compile check)
npm test                 # node:test bridge suite + cargo test (Rust)
npm run dev              # cargo tauri dev  (needs a display)
npm run build            # cargo tauri build (needs a display + signing for release)
```

`dist/` and `src-tauri/target/` are build artifacts (git-ignored). `npm test` runs headless.

## Status

Ported + tested headlessly: secure store, settings, notifications, dialogs, single-instance, system
theme, mlc discovery + registry, `noter://` deep-link + `.noter` file-assoc (incl. cold-start), print
(lock-guarded). See the runbook's **status snapshot** for what remains and exactly what each gated item
needs (auto-updater = infra + signing key; mlc subprocess = `mlc_llm` runtime + GUI; tray = icon + GUI;
find-in-page / print-to-pdf / multi-window = native capability / GUI; spike + security gates = a GUI run).
