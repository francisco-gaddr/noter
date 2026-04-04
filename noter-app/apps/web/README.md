## Build Info

- Version: 1.0.1
- Build: 5/6

# Noter Web Application

Webbappen är en Next.js-klient för anteckningar, tasks, offline-sync och AI/MCP-flöden. Den open source-förberedda versionen innehåller inga commitade backend-URL:er, inga publika integrationshemligheter och ingen hårdkodad deploydomän.

## Funktioner

- Offline-first lagring i IndexedDB
- Klientkryptering för notes, tasks och känsliga fält
- Optimistiska uppdateringar och bakgrundssync
- PWA-stöd
- Lokal API-konfiguration via login-skärmen och Settings-modal
- Electron-kompatibel renderer med lokal secure settings-bridge

## Lokal konfiguration

Kopiera `.env.example` till `.env.local` om du vill förifylla lokal runtime-konfiguration.

```env
API_URL=http://localhost:3001/api
NEXT_PUBLIC_API_URL=http://localhost:3001/api
WEB_BASE_PATH=
NEXT_PUBLIC_WEB_BASE_PATH=
```

### Viktigt om API-URL

- Den lokala API-URL:en kan anges via kugghjulet på login-skärmen eller i appens settings
- Electron skriver samma värde till krypterad lokal settings-lagring
- AI/MCP-hemligheter läses inte från `NEXT_PUBLIC_*` längre
- Vid publik publicering ska inga riktiga URLs eller hemligheter checkas in

## Kom igång

### Förutsättningar

- Node.js 20+
- npm 11+
- En körande Noter-backend

### Starta lokalt

```bash
npm run dev --workspace=apps/web
```

### Test och kvalitet

```bash
npm run check-types --workspace=apps/web
npm test --workspace=apps/web
```

## Open source-checklista

- Checka aldrig in `.env.local`
- Använd endast lokala settings eller lokala env-filer för backend-URL
- Lagra aldrig integrationshemligheter i publika klientvariabler
- Sätt `WEB_BASE_PATH` lokalt om du bygger för en subpath-deploy
