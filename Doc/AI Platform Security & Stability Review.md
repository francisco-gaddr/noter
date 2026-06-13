# AI Platform Security & Stability Review

_Senast uppdaterat: 2026-04-23 · Målgrupp: backend-, web-, mobil- och säkerhetsansvariga_

Det här dokumentet sammanfattar säkerhets- och stabilitetsläget för Noters AI-plattform efter den senaste härdningsfasen. Fokus ligger på AI-routes, modellproxyer, Electron-bridge och MCP-runtime.

## Genomförda förstärkningar

### Klientkryptering och AI-dataflöden

- Den delade krypteringsmodellen använder inte längre en publik `DEFAULT_KEY`.
- Web och mobil bootstrappar nu klientens `dataKey` från backendens wrapped-key-metadata i stället för att generera tysta engångsnycklar per enhet.
- GraphQL-flöden för AI-tool use materialiseras lokalt via delad klientadapter i stället för serverside-dekryptering.

### Web AI-route och modellproxyer

- `apps/web/app/api/ai/route.ts` kräver nu auth innan model loading eller inferens kan startas.
- `modelPath` måste resolve:as under definierad modellkatalog och kontrolleras med `realpath`.
- Modellproxyer under `apps/web/app/api/ai/models/*` kräver auth och använder kontrollerad header-forwarding.
- Modellnedladdning begränsas till HTTPS och en explicit allowlist av hosts.

### Electron

- Electron-renderern kör med `contextIsolation`, `sandbox` och globalt satt CSP.
- `http:request`-bridge är nu allowlist-baserad, metodbegränsad och rensar känsliga headers för externa värdar.
- Externa bridge-anrop använder inte renderer-cookies implicit.
- Electron-settings krypteras med `safeStorage` när möjligt och annars med lokal AES-256-GCM-fallback.

### MCP-runtime

- Auditpersistens är krypterad och scope:ad.
- Runtime har allowlists, payloadgränser, sessionsbegränsningar och explicit blockering av otillåtna verktyg.
- `intentText` loggas nu i centrala `call_tool`, `call_tool_blocked` och `error`-event.
- Publik health-data maskar `configHash` när djupare audit inte uttryckligen begärs.

### Logg- och driftshygien

- Backendloggar skrivs till `logs/` i stället för lösa filer i approten.
- `apps/backend/.gitignore` blockerar loggar från att oavsiktligt hamna i versionshantering.
- `AIMessageSync` har retention via TTL-index på `createdAt`, med standard `180` dagar och env-override via `AI_SYNC_RETENTION_DAYS`.

## Kvarvarande risker

### Hög prioritet

- AI-sync använder nu AES-GCM-baserat `v3`-format som pilotyta, men notes/tasks och större delen av övriga applikationspayloads använder fortfarande äldre CryptoJS-format och har ännu inte migrerats fullt till autentiserad AES-GCM-modell.
- Key-wrap-steget använder fortfarande `pbkdf2-sha256` i stället för starkare målbild.
- MCP-intentdetektion är fortfarande heuristisk och inte en riktig klassificerare.
- AI-harnessen är fortfarande delvis duplicerad mellan klienter, vilket ökar risken för divergerande säkerhets- och stopplogik.

### Medium prioritet

- Electron saknar fortfarande komplett nyckelrotationsflöde för lokal fallbacklagring.
- Modellkonverterings- och pollingflöden behöver robustare background-/resilienshantering, särskilt på mobil.
- GraphQL har nu basgränser för depth och weighted complexity, men saknar fortfarande mer komplett cost-modell och DataLoader-baserad avlastning.

### Låg prioritet

- Mer finmaskig telemetri för tool-loopars stop reasons och parserfel bör tillkomma.
- Dashboard- och auditexport för incidentutredning kan förbättras.

## Rekommenderade nästa steg

1. Migrera appkrypteringen till autentiserat payloadformat och planera dataomskrivning.
2. Byt key-wrap-KDF enligt målbilden när kompatibilitets- och migreringsplan är verifierad.
3. Konsolidera AI harness, prompts och parser helt i `packages/ai`.
4. Lägg till bredare release- och readiness-verifiering efter större AI- eller säkerhetsändringar.
5. Utöka MCP- och AI-telemetrin med tydliga stop reasons, parserfailures och block-/allow-rate.

## Acceptanskriterier för fortsatta AI-ändringar

- Nya AI-routes och proxyer kräver auth, inputvalidering och tydlig host/path-begränsning.
- Ny känslig persistering ska vara krypterad at rest och beskriven i dokumentationen.
- Alla nya AI- eller MCP-endpoints ska ha användarscope, rimliga payloadgränser och verifierade felvägar.
- Backend, web, mobil och Electron ska ha minst den minsta verifieringsmatris som bevisar att förändringen fungerar konsekvent över berörda ytor.
