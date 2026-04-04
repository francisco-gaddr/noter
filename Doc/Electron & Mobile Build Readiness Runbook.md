# Electron & Mobile Build Readiness Runbook

## Mål

Säkerställa att:

- Electron-appen är redo för desktop-build på Windows.
- Mobilappen är redo för EAS APK-build.
- Båda leveransspåren verifieras med reproducerbara steg och kvalitet gates.

## Del 1 — Electron (desktop)

### 1. Förutsättningar

- Node.js 18+ installerat.
- npm installerat.
- Repo klonat med både `electron-noter` och `noter-app`.

### 2. Installation

```bash
cd electron-noter
npm ci
```

### 3. Readiness-validering

```bash
npm run verify:build-ready
```

Valideringen kontrollerar bland annat:

- build-script och packaging-konfig i `electron-noter/package.json`
- koppling till webappen (`noter-app/apps/web`)
- säker BrowserWindow-baseline (`contextIsolation`, `nodeIntegration`, `sandbox`)
- närvaro av kritiska filer (`main.js`, `preload.js`, `src/build-web.js`)

### 4. Kvalitets- och buildgate

```bash
npm test
npm run build:web
npm run build:ready
```

- `build:ready` kör verifiering, tester, web-export och `electron-builder --dir`.
- `build:ready` skriver output till `dist-electron-ready` för att undvika låsning i befintliga dist-mappar.
- Full installer-build:

```bash
npm run build
```

## Del 2 — Mobile (EAS APK)

### 1. Förutsättningar

- Node.js 18+ installerat.
- EAS-konto med inloggning via `eas login`.
- Expo/EAS CLI körs via `npx` i scripts.

### 2. Installation (monorepo)

```bash
cd noter-app
npm ci
```

### 3. Readiness-validering

```bash
cd apps/mobile
npm run verify:build-ready
```

Valideringen kontrollerar bland annat:

- `app.json` (android package och ios bundle identifier, utan incheckat EAS projectId)
- `eas.json` (apk/preview-profiler med `buildType: apk`)
- kritiska dependencies för Expo/React Native
- närvaro av `.easignore`-regler för mindre build-context

### 4. Preflight före APK-build

```bash
npm run build:apk:ready
npm run build:apk:preflight
```

`build:apk:ready` kör:

- lokal readiness-script
- `expo-doctor`
- `expo install --check`
- `eas-cli config --platform android`

`build:apk:preflight` kör:

- typecheck
- centrala mobile-tester
- `expo export:embed --eager --platform android --dev false`

### 5. EAS APK-build

```bash
npm run build:apk
```

Alternativ med explicit profil:

```bash
eas build -p android --profile apk
```

## Del 3 — Gemensam release-kontroll

Kör från `noter-app`:

```bash
npm run check-types
npm run lint
```

Kör dessutom backend/web/mobile testpaket enligt ändringsyta.

## Del 4 — Leveransbevis

Bifoga alltid:

- körda kommandon och resultat
- versionsinfo (Node, npm, Expo SDK, Electron)
- artifacts (Electron output-mapp, EAS build-länk)
- eventuella kvarvarande risker och mitigeringar
