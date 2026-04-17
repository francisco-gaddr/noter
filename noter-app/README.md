# Noter

Det aktiva Noter-monorepot innehåller webbapp, mobilapp, backend, docs-app och delade paket. Open source-publiceringen är förberedd för lokal konfiguration: inga riktiga hemligheter, deployade backend-URL:er eller commitade `.env`-filer krävs för att läsa eller bygga koden.

## Appar och paket

- `apps/web` – Next.js-webbapp med offline-first lagring, kryptering och lokal API-URL via inställningar
- `apps/mobile` – Expo-app med samma kärnflöden och lokal backend-konfiguration i inloggningsvyn och inställningar
- `apps/backend` – Express/MongoDB-backend för auth, sync, notes, tasks och AI/MCP-relaterade endpoints
- `apps/docs` – separat docs-app för dokumentation och demos
- `packages/shared` – delade typer, krypteringshelpers, MCP-inställningar och changelog-data
- `packages/ui` – delade UI-exporter
- `packages/ai` – delad AI-logik och modellhelpers

## Kom igång

### Förutsättningar

- Node.js 20+
- npm 11+
- MongoDB om du vill köra backenden med datalagring
- Expo Go eller emulator om du vill köra mobilappen

### Installation

```bash
npm install
```

### Lokal konfiguration

- Kopiera `apps/backend/.env.example` till `apps/backend/.env`
- Kopiera `apps/web/.env.example` till `apps/web/.env.local` om du vill förifylla lokal API-URL eller base path
- Kopiera `apps/mobile/.env.example` till `apps/mobile/.env` om du vill förifylla mobilens lokala backend-URL
- Kopiera `../electron-noter/.env.example` till `../electron-noter/.env` om du vill förifylla Electron-renderer, lokal `userData` eller Apple-notarization-variabler för macOS-release
- API-URL kan också anges lokalt via login/settings i web, mobil och Electron

### Electron-miljö för macOS

Electron-shellen använder en standalone-byggd Next-renderer, krypterad settings/session-lagring via main/preload och paketeras för macOS Apple Silicon (`arm64`) som `dmg` och `zip`.

Valfria lokala variabler i `electron-noter/.env`:

```env
ELECTRON_RENDERER_URL=http://localhost:3001/
ELECTRON_RENDERER_FALLBACK_URL=
ELECTRON_USER_DATA_DIR=
APPLE_ID=
APPLE_APP_SPECIFIC_PASSWORD=
APPLE_TEAM_ID=
```

- `ELECTRON_RENDERER_URL` används i lokal utveckling om du kör renderern på annan adress
- `ELECTRON_RENDERER_FALLBACK_URL` ger extra lokal fallback om primär renderer inte svarar
- `ELECTRON_USER_DATA_DIR` låter dig isolera Electron-data per lokal miljö eller test
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` och `APPLE_TEAM_ID` krävs bara om du vill att mac-builden ska notariseras automatiskt

### Electron för Mac

Bygg och readiness för Apple Silicon:

```bash
cd ../electron-noter
npm run build:ready:mac
```

Snabbare ren arm64-build:

```bash
cd ../electron-noter
npm run build:mac:arm64
```

- Installationsbar macOS-artifakt skapas som `.dmg` i `electron-noter/dist-electron-ready-mac-arm64` eller motsvarande output-katalog
- Om Apple-notarization-variabler saknas byggs appen fortfarande och signeras ad-hoc, men Gatekeeper/notarization blir inte fullständigt klar för distribution utanför lokal användning

### Köra apparna

**Backend**
```bash
npm run dev --workspace=apps/backend
```

**Web**
```bash
npm run dev --workspace=apps/web
```

**Mobil**
```bash
npm run start --workspace=apps/mobile
```

**Docs**
```bash
npm run dev --workspace=apps/docs
```

## Säkerhet och open source

- Backend använder inga commitade fallback-hemligheter i produktion
- Web och mobil läser inte längre MCP-hemligheter från publika klient-env-variabler
- Repot innehåller endast säkra `.env.example`-filer med lokala placeholders
- Delade konfigurationsflöden för AI/MCP prioriterar lokal krypterad settings-lagring framför repo-konfiguration

## Kvalitetsgates

```bash
npm run check-types
npm run lint
npm run validate:prepush
```

```bash
npm run test:repo:open-source
```

- `validate:prepush` kör workspace-lint, kritiska verifieringar, säkerhetstester, web/mobile/backend-guardrails och mutationssvit
- `audit:high` kör en separat supply-chain-gate för high/critical `npm audit`-träffar
- `test:repo:open-source` verifierar att spårade filer inte innehåller incheckade `.env`-filer, publika client-hemligheter, gamla produktionsdomäner eller lokala AI-/IDE-filer

## Community

- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [SECURITY.md](../SECURITY.md)
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)
- [SUPPORT.md](../SUPPORT.md)

## License

[MIT](../LICENSE)
