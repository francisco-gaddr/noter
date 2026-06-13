# MCP Security Dashboard

## Syfte

Denna funktion ger en säker och användarscope:ad dashboard för MCP-spårning.

- All spårning persisteras krypterat i backend (at rest).
- All åtkomst till dashboard-data kräver autentisering och är begränsad till aktuell användare.
- Dashboard visas endast i en specifik vy i AI-inställningar: **MCP Säkerhetsdashboard**.

## Översikt

### Datakälla

- Runtime-events skapas i `apps/backend/src/services/mcp/runtime.ts`.
- Event skrivs till både:
- in-memory ringbuffer för runtimestatus och dashboardkontext
- krypterad persistent lagring via `apps/backend/src/services/mcp/auditStore.ts`

### Kryptering at rest

- Persistens sker i modellen `apps/backend/src/models/McpAuditLog.ts`.
- Fältet `payloadEnc` innehåller krypterad JSON.
- Krypteringsmetod: AES-256-GCM med unik IV per event.
- Nyckelkälla: key ring via `MCP_AUDIT_MASTER_KEYS` och aktivt key-id via `MCP_AUDIT_ACTIVE_KEY_ID`.
- Fallback: `MCP_AUDIT_MASTER_KEY`. I utveckling/test genereras en temporär processnyckel om ingen audit-nyckel är satt.
- Payloadformat är versionsmarkerat för att möjliggöra key rotation och bakåtkompatibel dekryptering.

### Kryptering in transit

- Klienterna skickar MCP-settings med både:
- `mcpUiSettings` (objekt för robust servervalidering)
- `mcpUiSettingsEnc` (krypterad payload)
- Web och mobil blockerar osäkra MCP-anrop över HTTP utanför localhost.

## API och åtkomst

### MCP runtime API

- `POST /api/mcp/tools`
- `POST /api/mcp/call`
- `GET /api/mcp/health`
- `GET /api/mcp/dashboard?limit=80`
- `GET /api/mcp/dashboard/system?range=30d&group=day&sort=desc&logLimit=180`
- `GET /api/mcp/dashboard/system?range=30d&group=day&sort=desc&service=notion&action=call_tool&role=user&from=2026-03-01T00:00:00.000Z&to=2026-03-12T23:59:59.000Z&logLimit=180`

### Åtkomstmodell

- Samtliga endpoints kräver auth middleware.
- `GET /api/mcp/dashboard` returnerar endast data för `req.user.userId`.
- `GET /api/mcp/dashboard/system` returnerar endast data för `req.user.userId`.
- Inga andra användares loggar exponeras.
- `GET /api/mcp/health` är metadataorienterad och exponerar inte dashboardhistorik.

## Dashboard-vy

### Placering

- `apps/web/components/AISidebar.tsx`
- Sektion: `data-testid="mcp-dashboard-section"`
- Dedikerad modalvy: `data-testid="system-dashboard-section"` (egen dashboardyta med flikar, grafer, loggar och lagring)
- Huvudåtkomst via huvudinställningar: `apps/web/components/SettingsModal.tsx` knapp `data-testid="settings-open-dashboard"`
- `apps/mobile/app/(tabs)/ai.tsx`
- Sektion: `testID="mcp-dashboard-section-mobile"`

### Funktion

- Visa/dölj dashboard via `mcp-dashboard-toggle`.
- Hämta data via `GET /api/mcp/dashboard`.
- Lista rader med:
- tid
- tjänst
- action
- tool
- status (ok/inte ok)
- Systemdashboard i Electron/web visar även:
- admin-inställningar för dashboard-scope
- användningsstatistik (tecken, ord, uppgifter, AI-aktivitet)
- tidsserier med filter/sortering per tidsintervall
- heatmap och populära användningstider
- användarscope:ad logglista för MCP och AI-användning
- översikt över lokal lagring för inloggad användare (store/local db + backendöversikt)
- flikbaserad UI-struktur: Översikt, Användning, Loggar, Lagring, Inställningar
- export av loggar i JSON/CSV från dashboard-vyn
- anslutningsstatus med endpoint-diagnostik, retry/backoff och fallback till senast giltiga cachedata
- lokal rådata visas i sanerat format med redigering av känsliga nycklar och storleksbegränsning
- lagringsfliken har JSON-navigering med sektionsfilter + textsökning samt knappar för kopiera/exportera all lagringsdata
- lagringsfliken visar trädvy för JSON med expandera/fäll alla för snabb navigering i stora datamängder
- textsökning i lagringsvyn markerar träffar visuellt i både nycklar och värden
- dashboard-modal stängs via Stäng-knapp eller klick utanför panelen

## Säkerhetsregler i runtime

- Tool policy-allowlist per integration.
- Matchning mot aktuell `tools/list` innan `tools/call`.
- Rate limiting per användare+tjänst.
- Maxgränser för sessioner och payloadstorlek.
- Rekursiv arguments-sanitization (djup, storlek, förbjudna nycklar).
- Explicit tjänsteintention krävs för externa tjänster.

## Retention och drift

- `McpAuditLog` har TTL-index på `createdAt` (45 dagar).
- Runtime health visar endast metadata och aldrig credentials.
- Rekommenderat i produktion:
- sätt `MCP_AUDIT_MASTER_KEYS` med minst två nycklar under rotation
- sätt `MCP_AUDIT_ACTIVE_KEY_ID` till nuvarande skrivnyckel
- övervaka fel/blockeringar per integration
- använd HTTPS för all extern trafik

## Testning

### Backend

- `__tests__/mcp-audit-store.test.ts` verifierar krypterad persistens + dekryptering per user.
- `__tests__/mcp-routes.test.ts` verifierar dashboard-route och användarscope.
- `__tests__/mcp-runtime*.test.ts` verifierar runtime-säkerhet och stdio-flöde.

### Web E2E

- `apps/web/cypress/e2e/app.cy.ts` innehåller test för dashboard-sektion och datahämtning.
