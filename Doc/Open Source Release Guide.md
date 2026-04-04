# Open Source Release Guide

## Syfte

Detta dokument beskriver hur Noter-monorepot hålls säkert att publicera publikt utan att funktionalitet förstörs i web, mobil, Electron eller backend.

Se även [Public Release Commit Checklist.md](Public%20Release%20Commit%20Checklist.md) för en praktisk sista commit-check före publicering.

## Regler

- Checka aldrig in riktiga `.env`-filer
- Checka endast in `.env.example` med lokala placeholders
- Lagra inte AI- eller MCP-hemligheter i publika klientvariabler
- Hårdkoda inte deploydomäner eller kundspecifika backend-URL:er i repo-kod
- Behåll backend-URL som lokal konfiguration via settings, lokal env eller driftsmiljö
- Checka inte in lokala Trae-filer, skills, rules eller AI-agentinstruktioner som `AGENTS.md`, `agent.md`, `*.agent.md`, `INSTRUCTIONS.md` eller `RULES_INDEX.md`
- Checka inte heller in lokala IDE-/assistentmappar som `.vscode`, `.idea`, `.cursor`, `.windsurf`, `.continue`, `.cline`, `.roo`, `.zed`, `.fleet`, `.aider*`, `.direnv`, `.envrc` eller `*.code-workspace`

## Lokal setup

- Backend använder `apps/backend/.env`
- Web använder `apps/web/.env.local` vid behov
- Mobil använder `apps/mobile/.env` vid behov
- Electron använder `electron-noter/.env` vid behov

## Verifiering före publicering

- Kör `npm run check-types` i `noter-app`
- Kör `npm run lint` i `noter-app`
- Kör `npm run validate:prepush` i `noter-app`
- Kör `npm run test:repo:open-source` i `noter-app`
- Kör `npm run verify:build-ready`, `npm test` och `npm run build:web` i `electron-noter`
- Kör mobilens `verify:build-ready` och APK preflight om release-readiness ingår
- Säkerställ att GitHub Actions-workflows för Electron, monorepo-guardrails, web-e2e-smoke, dependency-review och codeql är gröna

## Open source-notering

- Publica användare måste sätta sin egen backend-URL lokalt
- Publica användare måste sätta sina egna JWT-, audit- och integrationshemligheter lokalt
- EAS-projekt-ID och andra kontokopplade publiceringsvärden ska hållas utanför repot
- Mobilappen döljer nu recoverable timeout/abort-fel när lokal cache finns, men lokal API-URL måste fortfarande vara korrekt satt för första synken
- Lokala AI-agentfiler ska finnas kvar lokalt men vara otrackade i git
- Lokala IDE-inställningar ska också vara otrackade i git för att undvika läckage av personliga eller maskinspecifika arbetsflöden
