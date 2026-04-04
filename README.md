# Noter

Noter är ett open source-monorepo för anteckningar, uppgifter, offline-first sync och lokalt skyddad data i webb, mobil, Electron och backend. Repot är sanerat för publik publicering: inga deployade domäner, inga commitade `.env`-filer och inga inbakade produktionshemligheter följer med källkoden.

## Innehåll

- `noter-app/apps/web` – Next.js-webbapp med PWA-stöd och lokal API-konfiguration via inställningar
- `noter-app/apps/mobile` – Expo/React Native-app med lokal backend-URL via inloggningsvy och inställningar
- `noter-app/apps/backend` – Express/MongoDB-backend med fail-closed säkerhetsinställningar
- `electron-noter` – Electron-shell för webbappen med krypterad lokal settings-lagring
- `noter-app/packages/*` – delade typer, krypteringshelpers och UI/AI-paket
- `Doc` – runbooks, säkerhetsdokument och tekniska genomgångar

## Snabbstart

### Förutsättningar

- Node.js 20 eller senare
- npm 11 eller senare
- MongoDB om du vill köra backenden med persistent lagring

### Installera

```bash
npm install
cd noter-app
npm install
cd ..
cd electron-noter
npm install
```

### Lokal konfiguration

- Backend: kopiera `noter-app/apps/backend/.env.example` till `noter-app/apps/backend/.env`
- Web: kopiera `noter-app/apps/web/.env.example` till `noter-app/apps/web/.env.local` om du vill sätta lokal API-bas eller base path vid build
- Mobil: kopiera `noter-app/apps/mobile/.env.example` till `noter-app/apps/mobile/.env` om du vill förifylla lokal backend-URL
- Electron: kopiera `electron-noter/.env.example` till `electron-noter/.env` om du vill styra renderer-URL lokalt

### Kör apparna

```bash
cd noter-app
npm run dev --workspace=apps/backend
```

```bash
cd noter-app
npm run dev --workspace=apps/web
```

```bash
cd noter-app
npm run start --workspace=apps/mobile
```

```bash
cd electron-noter
npm run dev
```

## Open source-säkerhet

- Inga riktiga tokens, API-nycklar eller commitade `.env`-filer ingår i repot
- Backend kräver lokal `JWT_SECRET` i produktion och genererar endast temporära processhemligheter i utveckling/test
- MCP- och AI-integrationshemligheter läses från lokal krypterad lagring i klienterna eller lokal env på serversidan
- Backend-URL för mobil, web och Electron kan sättas lokalt via inloggningsvyn eller inställningar utan att hårdkodas i koden
- Electron lagrar settings krypterat via operativsystemets säkra storage där det är tillgängligt

## Verifiering

```bash
cd noter-app
npm run validate:prepush
```

```bash
cd noter-app
npm run test:repo:open-source
```

- `validate:prepush` kör repo-scan, lint, kritiska integrationstester, säkerhetstester, web/mobile/backend-guardrails och mutationssvit
- `test:repo:open-source` söker efter incheckade `.env`-filer, publika secret-variabler, gamla produktionsdomäner samt lokala AI-/Trae-/IDE-filer i spårade filer
- GitHub Actions kör även `.github/workflows/monorepo-guardrails.yml`, `.github/workflows/web-e2e-smoke.yml`, `.github/workflows/dependency-review.yml` och `.github/workflows/codeql.yml` för att stärka publik repo-hygien

## Lokala AI-filer

- Trae-filer, skills, rules och lokala AI-agentfiler ignoreras via `.gitignore` och ska inte checkas in
- Filer som `AGENTS.md`, `agent.md`, `*.agent.md`, `INSTRUCTIONS.md`, `RULES_INDEX.md` och allt under `.trae/` ska hållas lokalt
- Lokala IDE-mappar som `.vscode/`, `.idea/`, `.cursor/`, `.windsurf/`, `.continue/`, `.cline/`, `.roo/`, `.zed/`, `.fleet/`, `.aider*`, `.direnv/`, `.envrc` och `*.code-workspace` ska också hållas utanför repot
- Repo-scannern stoppar publicering om sådana filer fortfarande är spårade av git

## Dokumentation

- [README.md](noter-app/README.md) – översikt över det aktiva monorepot
- [README.md](noter-app/apps/backend/README.md) – backend-setup och säkerhetskrav
- [README.md](noter-app/apps/web/README.md) – webbapp, lokal API-konfiguration och testning
- [README.md](noter-app/apps/mobile/README.md) – mobil setup, lokal backend-URL och build-flöden
- [README.md](electron-noter/README.md) – Electron-shell, secure settings och releasegates
- [Overview.md](Doc/Overview.md) – systemöversikt
- [Public Release Commit Checklist.md](Doc/Public%20Release%20Commit%20Checklist.md) – sista publik commit-kontroll före open source-publicering

## Community

- [CONTRIBUTING.md](CONTRIBUTING.md) – hur du bidrar och verifierar ändringar
- [SECURITY.md](SECURITY.md) – hur säkerhetsproblem rapporteras
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) – förväntat beteende i projektet
- [SUPPORT.md](SUPPORT.md) – var du börjar när du behöver hjälp

## Licens

Projektet distribueras under [MIT](LICENSE).
