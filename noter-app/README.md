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
- API-URL kan också anges lokalt via login/settings i web, mobil och Electron

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
- `test:repo:open-source` verifierar att spårade filer inte innehåller incheckade `.env`-filer, publika client-hemligheter, gamla produktionsdomäner eller lokala AI-/IDE-filer

## Community

- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [SECURITY.md](../SECURITY.md)
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)
- [SUPPORT.md](../SUPPORT.md)

## License

[MIT](../LICENSE)
