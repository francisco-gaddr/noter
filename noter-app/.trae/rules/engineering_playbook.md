# Engineering Playbook — Quality Gates för Mobil och Electron

Detta dokument operationaliserar reglerna i `project_rules.md` till konkreta verifieringssteg, så att varje leverans kan kvalitetssäkras konsekvent.

## 1. Baslinje före merge

- Kör alltid från repo-roten:
- `npm run check-types`
- `npm run lint`
- `npm run validate:prepush`
- Om någon gate fallerar får ändringen inte levereras.

## 2. Gate-matris per ändringstyp

| Ändringstyp | Obligatoriska gates | Exempelkommando |
|---|---|---|
| Backend security/auth/MCP | backend unit/integration + typecheck + lint | `cd apps/backend && npm test -- __tests__/mcp-runtime.test.ts __tests__/mcp-routes.test.ts` |
| Web/Electron AI-inställningar | web unit + web e2e + typecheck + lint | `cd apps/web && npm test -- __tests__/mcp-settings.test.ts` + `npx cypress run --spec "cypress/e2e/app.cy.ts"` |
| Mobile AI-inställningar/API | mobile unit + typecheck + lint | `cd apps/mobile && npm test -- tests/mcp-settings.test.ts tests/api-url-security.test.ts` |
| Kryptering/key-rotation | crypto-specifika tester + scope-test + docs update | `cd apps/backend && npm test -- __tests__/mcp-audit-store.test.ts` |
| Dashboard-förändring | route-test + UI-test (web eller mobile) + e2e där tillämpligt | `cd apps/backend && npm test -- __tests__/mcp-routes.test.ts` |
| Notes/Tasks E2E-kryptering | backend validering + web at-rest + mobile at-rest + sync transporttest | `cd apps/backend && npm test -- __tests__/encryption-validation.test.ts __tests__/ai-sync.test.ts` + `cd apps/web && npm test -- services/db.security.test.ts __tests__/ai-sync-service.test.ts` + `cd apps/mobile && npm test -- tests/database-at-rest.test.ts tests/ai-sync-service.test.ts` |
| Mobil/Electron-paritet (Tasks/AI) | mobile kontraktstest + mobile UI-strukturtest + web paritytest | `cd apps/mobile && npm test -- tests/task-editor-contract.test.ts tests/ai-settings-structure.test.tsx` + `cd apps/web && npm test -- components/NoteEditor.test.tsx` |
| API/DB attackhärdning | middleware-unit + api-integration för injektion/content-type + typecheck/lint | `cd apps/backend && npm test -- __tests__/request-security.test.ts __tests__/api-hardening.test.ts` |

## 3. Verifiering per regelklass

### Säkerhet och Kryptering

- Bekräfta att känsliga värden inte skrivs till okrypterad lagring.
- Bekräfta att loggar/felmeddelanden inte innehåller tokens/credentials.
- Bekräfta server-side user-scope på dashboard/endpoints.
- Bekräfta att krypterad data inte lagras i klartext.
- Vid key-rotation: verifiera både nytt format och legacy-dekryptering.
- Bekräfta att injektionsmönster (`$where`, prototype keys, SQL-liknande payloads) blockeras före databaslager.
- Bekräfta att write-endpoints avvisar fel content-type med 415.

### Mobilapp

- Bekräfta SecureStore för secrets och fallback-beteende vid saknad token.
- Bekräfta API-transportpolicy i runtime (HTTPS utanför localhost/dev).
- Bekräfta app-resume/cold-start för AI-inställningar.
- Bekräfta att dashboard-sektion är nåbar via AI-inställningar och visar robust felstatus.
- Bekräfta att task-editor stödjer single-tap med öppet tangentbord och auto-default för påminnelse vid förfallodatum.
- Bekräfta att AI-inställningar i mobil visar både `Modeller` och `AI Instruktioner`.

### Electron/Web

- Bekräfta att känsliga settings inte dupliceras i localStorage när bridge finns.
- Bekräfta att dashboard-sektion är nåbar i AI-inställningar.
- Bekräfta att e2e täcker dashboard-åtkomst och rendering av auditmetadata.
- Bekräfta att osäker transport blockeras för MCP/dashboard-anrop.

## 4. Definition of Done för AI/MCP

- Kodändring genomförd med säker default och validerade gränsvärden.
- Minst ett normalfallstest + ett kant/felfallstest tillagt eller uppdaterat.
- Relevanta gates i matrisen körda och gröna.
- Dokumentation uppdaterad i samma leverans.
- Dashboard-nåbarhet verifierad i berörda klienter.

## 5. CI-förslag för pipeline

- Steg 1: `npm run check-types`
- Steg 2: `npm run lint`
- Steg 3: `cd apps/backend && npm test -- __tests__/mcp-audit-store.test.ts __tests__/mcp-runtime.test.ts __tests__/mcp-routes.test.ts`
- Steg 4: `cd apps/web && npm test -- __tests__/mcp-settings.test.ts __tests__/ai-sync-service.test.ts`
- Steg 5: `cd apps/mobile && npm test -- tests/mcp-settings.test.ts tests/api-url-security.test.ts tests/ai-sync-service.test.ts`
- Steg 6: `cd apps/web && npx cypress run --spec "cypress/e2e/app.cy.ts"`

## 6. Leveransbevis som alltid ska bifogas

- Lista över körda kommandon och resultat.
- Bekräftelse att `npm run validate:prepush` körts och passerat före push.
- Vilka regler i `project_rules.md` som berördes.
- Vilka filer som uppdaterades för dokumentation.
- Eventuella kvarvarande risker och planerade nästa steg.
- Branch- och sync-bevis: aktiv branch, target branch, commit SHA och bekräftelse att `origin/dev` och `origin/main` pekar på avsedd releasecommit.

## 7. Build Readiness — Electron och EAS APK

- **Electron readiness**:
- `cd ../../electron-noter && npm ci`
- `npm run verify:build-ready`
- `npm test`
- `npm run build:web`
- `npm run build:ready`

- **Mobile EAS readiness**:
- `cd apps/mobile`
- `npm run verify:build-ready`
- `npm run build:apk:ready`
- `npm run build:apk:preflight`
- `npm run build:apk`

- **Obligatorisk dokumentation**:
- Uppdatera `Doc/Electron & Mobile Build Readiness Runbook.md` när buildprofiler, scripts eller releaseflöden ändras.

## 8. GitHub Synk-gate

- Kör `git fetch --all --prune` före release-merge.
- Bekräfta att releasebranch innehåller alla avsedda commits med `git log --oneline --decorate -n 20`.
- Efter merge/push: verifiera `git ls-remote --heads origin main dev` och dokumentera SHA-matchning.
- Om lokala `dev`/`main` är divergerade ska de rebasas eller återskapas från `origin/*` innan ny releasehantering.
