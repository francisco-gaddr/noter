# Polish Pass — Electron

[← Index](./index.md)

All changes live in `electron-noter/main.js` (rewrite) and `electron-noter/preload.js`
(extended `noterDesktop` bridge). Files compile via `node --check` and syntax-pass on
every commit; behaviour is covered by `electron-noter/tests/main-helpers.test.js`
(Jest unit tests for the pure helpers).

## 1. Spell-checker dictionary CDN pinning

**API:** `webContents.session.setSpellCheckerDictionaryDownloadURL(url)`

Electron pulls Hunspell dictionaries from Google's CDN by default. We pin to
our own HTTPS CDN when configured so the supply chain is auditable.

**Activation:** set `spellCheckerCdn` in `settings.json` *or*
`SPELLCHECK_DICT_CDN` env var to a `https://…/` URL. URL is validated (protocol
check + trailing-slash normalisation); invalid URLs are warned and ignored.

## 2. Login-at-startup (opt-in)

**API:** `app.setLoginItemSettings({ openAtLogin })`

`openAtLogin` is ONLY flipped on when the user explicitly toggles it through
the tray menu or `noterDesktop.setOpenAtLogin(true)`. The OS state is
reconciled against the stored preference on every boot so a manual change
outside the app gets corrected.

`openAsHidden: true` is paired with `openAtLogin: true` so the app starts
minimized to tray on login.

## 3. Thumbnail generation for instant search

**API:** `nativeImage.createThumbnailFromPath(path, size)`

IPC `thumbnails:create` accepts `{ path, size: { width, height } }` and
returns a data URL. Path traversal guard restricts reads to:

- `app.getPath('userData')`
- `app.getPath('downloads')`
- `app.getPath('pictures')`
- `app.getPath('documents')`

Size is clamped to `[16, 512]` per axis. Falls back to `createFromPath() + resize()`
if the platform doesn't support thumbnail generation for the file type.

## 4. Windows 11 acrylic

**API:** `BrowserWindow.setBackgroundMaterial('acrylic')`

Applied when `os.release()` reports 10.0.22000+. No-op on Windows 10, macOS,
Linux. Wrapped in a defensive try/catch because older Electron didn't have
the API at all.

## 5. macOS accessory policy (tray-only mode)

**API:** `app.setActivationPolicy('accessory')`

When the user enables "Tray-only (hide Dock)" in the tray menu, the Dock icon
disappears entirely. Toggling it back to `'regular'` restores it. Setting is
persisted in `settings.json` and reconciled at boot.

## 6. Reduced-motion CSS injection

**API:** `webContents.insertCSS(css)`

Injected on `did-finish-load` for every renderer. The injected block uses
`@media (prefers-reduced-motion: reduce)` so the OS preference drives whether
animations are suppressed — we don't override the user's choice.

## 7. Cursor-anchored tray context menu

**API:** `Tray.popUpContextMenu(menu, { x, y })` + `screen.getCursorScreenPoint()`

On multi-monitor setups Electron's default tray-menu positioning can land
on the wrong display. We override the right-click handler to read the cursor
position from `screen.getCursorScreenPoint()` and pass it explicitly so the
menu always opens where the user clicked.

## 8. Isolated-world DOM helpers

**API:** `webContents.executeJavaScriptInIsolatedWorld(worldId, scripts)`

Renderer can call `noterDesktop.runIsolatedScript(key, arg)` to execute
allow-listed scripts in isolated world 999. The script can't be observed
by page-world JS, and is CSP-safe because the page's CSP doesn't apply
to isolated worlds.

Today's allow-list: `highlight-search`. Add new scripts to
`ALLOWED_ISOLATED_SCRIPTS` in `main.js` — unknown keys throw.

## 9. User-Agent pinning

**API:** `webContents.session.setUserAgent(ua)`

Appends ` NoterDesktop/<version> (<platform>)` to the Chromium UA so backend
telemetry can identify desktop traffic. Append (not replace) so UA-CH headers
keep flowing.

## 10. CORS edge-case escape hatch

**API:** `app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')`

Gated behind `NOTER_DISABLE_OUT_OF_BLINK_CORS=1` env var (default off). Lets
us bypass an occasional Chromium CORS edge case without weakening security
posture by default.

## 11. crashReporter (pinned, opt-in)

**API:** `crashReporter.start({ submitURL, ... })`

Off by default. Activates only when BOTH `crashReportsEnabled: true` AND
`crashSubmitUrl: "https://…"` are set in `settings.json`. submitURL is
protocol-validated; only https accepted. Minidumps are tagged with
`app_version`, `os`, `channel` so server-side correlation works.

We deliberately ship no Sentry DSN here — crash binaries never leave
infrastructure we control.

## 12. electron-updater scaffold (Sigstore-ready)

**Files:** `main.js`, `electron-noter/package.json`

`electron-updater@^6.6.3` installed as a dependency. autoCheck happens 30s
after boot and every 6h while running. On `update-downloaded`:

1. `verifyUpdateSignatureStub(filePath)` runs.
2. If `NOTER_UPDATE_VERIFY_SIGSTORE=1` and we don't have a real implementation,
   the update is REJECTED (fail-closed).
3. Otherwise the renderer is notified via `updater:ready` and can decide
   when to apply via `noterDesktop.installUpdateNow()`.

The stub is the integration point for `cosign verify-blob` against the
release signature. Wire it once the release pipeline emits cosign `.sig`/`.crt`
artifacts alongside the binary.

`build.publish` config in package.json targets `https://updates.noter.app/releases/${os}/${arch}`
with channel `stable`.

## Bridge surface (preload)

`window.noterDesktop` exposes (new):

| Method | IPC channel | Purpose |
|---|---|---|
| `createThumbnail(path, size)` | `thumbnails:create` | Instant-search thumbs |
| `runIsolatedScript(key, arg)` | `dom:run-isolated` | CSP-safe DOM injection |
| `onThemeChanged(handler)` | `theme:updated` | System theme signal |
| `setOpenAtLogin(bool)` | `settings:set` | Login-item toggle |
| `setTrayOnly(bool)` | `settings:set` | Hide Dock on macOS |
| `setSpellCheckerCdn(url)` | `settings:set` | Pin dictionary CDN |
| `checkForUpdate()` | `updater:check-now` | Manual update check |
| `installUpdateNow()` | `updater:install-now` | Apply downloaded update |
| `onUpdaterEvent(handler)` | `updater:*` | Update lifecycle events |

## Verification

See [testing.md → electron](./testing.md#electron).
