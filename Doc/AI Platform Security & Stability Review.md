# AI Platform Security & Stability Review

## Mål

Detta dokument sammanfattar säkerhets- och stabilitetsutvärdering för mobilappen, web/electron och backend med fokus på AI-funktionalitet, AI-inställningar och MCP.

## Genomförda förstärkningar

### Backend (MCP)

- Krypterad auditpersistens med AEAD och user-scope:ad åtkomst via dashboard-endpoint.
- Runtime-härdning med allowlist, rate-limit, payloadgränser, args-sanitization och sessionsgränser.
- Dashboard-separering: känslig spårning synlig i dedikerad dashboard, inte i generell health-översikt.
- Nyckelrotation för auditkryptering via key ring + aktiv key-id med versionsmarkerat payloadformat.

### Web/Electron (AI-inställningar)

- Känsliga settings loggas inte.
- Känsliga nycklar i Electron-läge undviker lokal duplicering i localStorage när bridge-lagring används.
- MCP- och dashboard-anrop blockeras vid osäker transport utanför localhost.

### Mobil (AI/API)

- Runtime-validering av API URL före auth-anrop och request-flöden.
- Osäker extern HTTP blockeras i normalisering och runtime-kontroll.
- MCP-inställningar fortsätter lagras krypterat i SecureStore.
- MCP Säkerhetsdashboard är nåbar i AI-inställningar för att visualisera auditmetadata.

## Kvarvarande risker och rekommenderade nästa steg

### Hög prioritet

- Lägg till signing/nonce-policy för extra replay-skydd på säkerhetskritiska dashboardanrop.
- Lägg till central alerting för spikes i `call_tool_blocked`, timeout och 429.

### Medium prioritet

- Lägg till paginering/cursor på `GET /api/mcp/dashboard` för större historikmängder.
- Lägg till operativ vy för retention-status och indexhälsa i backend.
- Lägg till explicit sekretessklassning per AI-inställningsfält i UI-schema.

### Låg prioritet

- Exportfunktion för audit på metadata-nivå för incidentutredning.
- Dashboardfilter per tjänst/action/tidsintervall.

## Acceptanskriterier för framtida förändringar

- Alla nya AI/MCP-säkerhetsflöden har unit + integration + minst ett E2E-scenario där UI berörs.
- All ny känslig persistering är krypterad at rest och dokumenterad.
- Alla nya endpoints med användardata har server-side scope-kontroll och query-bounds.
- Typecheck och lint är gröna innan leverans.
