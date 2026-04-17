# Electron Noter

## Build Info

- Desktop shell: Electron
- Renderer source: `../noter-app/apps/web`
- Packaging: `electron-builder`

## Översikt

Electron-appen paketerar webbappen som desktop-klient och använder krypterad lokal settings-lagring via Electron main/preload. Repot innehåller inte längre någon hårdkodad extern produktionsdomän som fallback för renderern.

## Installera

```bash
npm ci
```

## Lokal konfiguration

Kopiera `.env.example` till `.env` om du vill styra renderer-URL eller user-data-katalog lokalt.

```env
ELECTRON_RENDERER_URL=http://localhost:3001/
ELECTRON_RENDERER_FALLBACK_URL=
ELECTRON_USER_DATA_DIR=
APPLE_ID=
APPLE_APP_SPECIFIC_PASSWORD=
APPLE_TEAM_ID=
```

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` och `APPLE_TEAM_ID` ar endast for macOS-notarization och behover inte sattas for lokal utveckling eller lokal build.

## Lokal utveckling

```bash
npm run dev
```

Electron dev-shellen väntar på renderer-rooten, normalt `http://localhost:3001/`, och återanvänder en redan körande lokal webserver i stället för att starta en andra instans.

Om du kör renderer på en annan lokal adress anger du den i `ELECTRON_RENDERER_URL` i din lokala `.env`.

## macOS-miljö

Den aktuella Mac-miljon ar hardad for Apple Silicon och bygger pa foljande delar:

- `arm64`-targets via `electron-builder` for `dmg` och `zip`
- standalone-renderer fran `../noter-app/apps/web/.next/standalone`
- krypterad lokal settings/session-lagring via `safeStorage`, med lokal `aes-256-gcm`-fallback om `safeStorage` inte ar tillgangligt
- macOS-fonster med `titleBarStyle: hiddenInset`, `vibrancy: sidebar`, `visualEffectState: active`, synliga traffic lights och `setBackgroundMaterial('sidebar')`
- renderklasser for `electron-shell`, `platform-mac` och `apple-silicon` for mer Mac-lik typografi och translucent ytor

## macOS-build och installation

Readiness-gate for Apple Silicon:

```bash
npm run build:ready:mac
```

Ren produktionsbuild for arm64:

```bash
npm run build:mac:arm64
```

Installerbara filer skapas i output-katalogen:

- `dist-electron-ready-mac-arm64/Noter-1.0.0-mac-arm64.dmg`
- `dist-electron-ready-mac-arm64/Noter-1.0.0-mac-arm64.zip`

Om du bara kor `build:mac:arm64` hamnar de i `dist-electron-mac-arm64/`.

## Notarization

- Om `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` och `APPLE_TEAM_ID` ar satta kor `src/notarize.js` automatisk notarization efter signering
- Om variablerna saknas hoppas notarization over, men `.dmg` och `.zip` byggs fortfarande for lokal installation och test
- For distribution till andra Mac-anvandare ar notarization fortfarande rekommenderad

## Readiness före release

```bash
npm run verify:build-ready
npm test
npm run build:web
npm run build:ready
```

`build:ready` kör verifiering, tester, renderer-build och packaging-simulering via `electron-builder --dir` till `dist-electron-ready`.

## Full desktop build

```bash
npm run build
```

## Viktiga säkerhetskrav

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Extern navigering öppnas via systembrowser och blockeras i appfönstret.
- Lokala settings skrivs via preload/main i stället för att vara beroende av repo-bundlade URL:er.
