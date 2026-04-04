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
```

## Lokal utveckling

```bash
npm run dev
```

Om du kör renderer på en annan lokal adress anger du den i `ELECTRON_RENDERER_URL` i din lokala `.env`.

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
