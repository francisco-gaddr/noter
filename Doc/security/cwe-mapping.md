# Noter — CWE-mappning

_Senast uppdaterat: 2026-06-19 · Komplement till `threat-model.md`_

Den här filen kopplar Noters STRIDE-hot till MITRE CWE-id så vi kan leverera
audit-rapporter till CISO / kund-säkerhetsteam i ett standardformat.

| STRIDE-ID | Hot | Primär CWE | Sekundär | Status |
|-----------|-----|------------|----------|--------|
| T1 | Prompt-injection → MCP exfil | CWE-915 (improperly controlled modification of dynamically determined object attributes) | CWE-1390 | mitigerad: deny-by-default + intent-check |
| T2 | MCP-paket läser env-secrets | CWE-526 (cleartext storage of sensitive info in env vars) | CWE-829 | mitigerad: `createScopedEnv` + sandbox-exec/bubblewrap |
| T3 | Refresh-token replay | CWE-294 (authentication bypass by capture-replay) | CWE-613 | mitigerad: `useCount` + family-revoke + securityFlag |
| T4 | XSS i AI-chat-output | CWE-79 (XSS) | CWE-116 | mitigerad: nonce-CSP + text-only render |
| T5 | Path traversal mot modelPath | CWE-22 (path traversal) | — | mitigerad: realpath + allowlist-base |
| T6 | MITM mot backend | CWE-295 (improper certificate validation) | CWE-300 | mitigerad: cert-pinning via `NOTER_PINNED_CERT_FINGERPRINTS` |
| T7 | GraphQL DoS | CWE-770 (resource exhaustion) | CWE-1284 | mitigerad: depth+complexity+trusted-docs |
| T8 | Auth-burst DoS | CWE-307 (improper restriction of excessive auth) | — | mitigerad: sliding rate-limit |
| T9 | Plaintext fallback | CWE-321 (use of hard-coded crypto key) | CWE-256 | mitigerad: DEFAULT_KEY borttagen |
| T10 | DB-corruption via proto-pollution | CWE-915 / CWE-1321 | — | mitigerad: mongoSanitize + blockSuspiciousRequestPatterns |
| T11 | Repudiation av tool-call | CWE-778 (insufficient logging) | — | mitigerad: AEAD audit + intent log |
| T12 | Insider DB-read | CWE-311 (missing encryption at rest) | CWE-359 | mitigerad: E2E-enc + optional KMS wrap |
| T13 | Förlorad enhet → token-stöld | CWE-922 (insecure storage of sensitive info) | — | mitigerad: SecureStore + biometric gate |
| T14 | GGUF-fil-stöld | n/a (public assets) | — | accepterad risk |
| T15 | Renderer-XSS → main escape | CWE-79 + CWE-829 | — | mitigerad: contextIsolation + sandbox + IPC allowlist |
| T16 | LFI/SSRF via http-bridge | CWE-918 (SSRF) | CWE-22 | mitigerad: host-allowlist + manual redirect + size cap |
| T17 | CSRF mot cookies | CWE-352 (CSRF) | — | mitigerad: Origin/Referer + sameSite=strict refresh |
| T18 | Loggar läcker secrets | CWE-532 (insertion of sensitive info into log) | — | mitigerad: `sanitizeLogInfo` redaction |
| T19 | IDOR: läs/skriv/radera annan users note/task via gissat id | CWE-639 (authorization bypass through user-controlled key) | CWE-862 (missing authorization) | mitigerad: alla `/:id`-handlers scopar på `userId` (se nedan) |
| T20 | Låst anteckning/projekt läcker till extern publicering, index eller export — även en mapp användaren tillfälligt låst upp i UI:t | CWE-200 (exposure of sensitive information to an unauthorized actor) | CWE-359 (privacy violation) | mitigerad: tom upplåsnings­mängd till alla automat-läsare + mekanisk läck-grind (se nedan) |

## T19 — IDOR i `/:id`-handlers (åtgärdad 2026-06-13)

Hard-review av REST-rutterna hittade fyra handlers som slog upp objektet med
`findById(req.params.id)` **utan** `userId`-scope. En autentiserad användare kunde
därmed nå en annan användares data genom att gissa/iterera ObjectId:t:

| Rutt | Fil | Påverkan före fix |
|------|-----|-------------------|
| `GET /api/notes/:id` | `routes/notes.ts` | Läste annan users note-innehåll **och** `+password` bcrypt-hash |
| `PUT /api/notes/:id` | `routes/notes.ts` | Skrev över annan users note |
| `PUT /api/tasks/:id` | `routes/tasks.ts` | Skrev över annan users task |
| `DELETE /api/tasks/:id` | `routes/tasks.ts` | Raderade annan users task |

`DELETE /api/notes/:id` och `verify-lock` var redan korrekt scopade
(`findOne({ _id, userId })`) — inkonsekvensen gjorde buggen lätt att missa.

**Fix:** alla fyra slår nu upp via `findOne({ _id: req.params.id, userId })`, så en
icke-ägare får `404` (medvetet — avslöjar inte att id:t existerar). Datat ligger
fortfarande E2E-krypterat, men auktorisationslagret läckte metadata, kunde radera
poster och exponerade lösenords-hashen — därav allvarlighetsgrad hög.

**Regression:** `__tests__/routes/ownership-isolation.test.ts` kör två användare
(Alice/Bob) genom hela CRUD-round-trippen och bevisar att Bob får `404` på läs/
skriv/radera av Alices note och task, samt att posten är orörd på disk efteråt.
Ingår i den blockerande `validate-critical.mjs`-matrisen.

## T20 — Låst innehåll till extern publicering / index / export (åtgärdad 2026-06-19)

**Invariant:** inget som ligger i en **låst** anteckning eller **låst projektmapp** (transitivt
upp hela `parentId`-kedjan) får nå en yta som lämnar enheten eller överlever sessionen — inte ens
en mapp användaren *just nu* har låst upp i UI:t. En UI-upplåsning är en **vy-lokal** rättighet
och får aldrig förlängas till en automat-läsare (AI, index, publicerings-feed, widget, CRDT-relä).

Den fullständiga, auktoritativa modellen (vad "låst" betyder, auto-omlåsning vid byte av mapp,
maskning vid dekryptering, hotmodell) bor i
[`../../noter-app/docs/LOCKED_FOLDER_SECURITY.md`](../../noter-app/docs/LOCKED_FOLDER_SECURITY.md).
Den smalare AI-läs-invarianten bor i [`ai-locked-notes.md`](./ai-locked-notes.md). Den här posten
är **liggar-raden** för läck-klassen och de ytor som tätades 2026-06-19.

**Den kanoniska kontrollen** (`@repo/shared/src/locks.ts`, enda källan): automat-läsare passerar
den **frusna tomma** upplåsnings­mängden `AI_INDEX_NO_UNLOCK` (eller hjälparna
`isReadableForAI` / `filterReadableForAI`), aldrig storens `unlockedProtectedNoteIds`. Då är en
lås-signalerad nod osynlig oavsett vad användaren har öppet.

| Yta som tätades | Fil | Påverkan före fix | Commit |
|-----------------|-----|-------------------|--------|
| Kalender-/Markdown-publicering + embeddings-index | `apps/web/services/nextcloud.ts`, `EmbeddingsSettings.tsx` | UI-upplåsnings­mängden matades in i projektion/index → låst mapp som var öppen speglades till publicerad ICS/Markdown-share resp. vektor-index | `49cef6c` |
| GraphQL/AI-verktygsyta | `apps/backend/src/graphql/schema.ts` | `Query.note/notes/task/tasks` läckte låsta noder/tasks innan `content` avkrypterades | `c06bdd2` |
| Widget-snapshot + Nextcloud utgående push | `apps/mobile/services/widgets/snapshotWriter.ts`, `apps/web/services/nextcloud.ts` | Låsta tasks/listor skrevs till OS-delad widget-container; låst note kunde PUT:as till WebDAV | `846e53d` |
| CRDT Live-relä | `markdownLive`-bryggan (båda appar) | En låst note kunde live-synkas token-för-token över Yjs-rummet | `1864a20` |
| Extern Neo4j-graf-sync | `packages/shared/src/neo4jSync.ts` | `buildNeo4jSyncPlan` tar **inget** unlock-argument (hårdkodat tomt) — låst delträd mirroras aldrig | `49cef6c` |
| Enskild not-export/-delning (mobil) | `apps/mobile/app/note/[id].tsx`, `services/noteExport.ts` | Share-as-PDF/Markdown gatade bara på `note.locked`, inte hierarkiskt; en not i en låst **mapp** kunde exporteras | `36300c2`, `5ae594a` |
| Enskild not-export (web/Electron, defense-in-depth) | `apps/web/components/NoteEditor.tsx` | `handleExportPDF`/`handleExportMarkdown` läste live-DOM utan runtime-lås-spärr (förlitade sig enbart på att låsskärmen renderas) | `11c7f99` |

**Mekanisk grind (kan inte regrediera tyst):** `scripts/check-index-unlock-leak.mjs` failar om
`unlockedProtectedNoteIds` matas till någon känd publicerings-/index-byggare
(`buildSafeCalendarProjection`, `buildMarkdownVaultProjection`, `buildNeo4jSyncPlan`,
`indexEntities`). Grinden har ett eget **självtest** (`--selftest`, commit `dabbb62`) som bygger
syntetiska läck-/rena träd och bevisar att detektorn fångar läckan genom alla fyra byggare utan
falska positiva — så själva grinden inte kan ruttna till en no-op. Båda kör blockerande i
`validate-critical.mjs` och CI (`.github/workflows/ci.yml`).

**Regression:** `packages/shared/src/locks.test.ts` (hierarkisk läsbarhet, `isReadableForAI`/
`filterReadableForAI` släpper låst även när en UI-mängd skulle låsa upp, `relockFoldersOnLeave`);
`apps/backend __tests__/notes-lock-security.test.ts`; `apps/mobile __tests__/services/noteExport.test.ts`
(exportörerna skriver/delar **inget** när `locked:true`); `packages/shared neo4jSync`-sviten.

**Upplåsnings-sessionens livslängd (tilläggshärdning):** en UI-upplåst projektmapp re-låses nu även
(a) när appen **bakgrundas** / fliken döljs och (b) efter **förgrunds-inaktivitet** (30 s-poll +
`shouldRelockOnIdle`, default 5 min) — inte bara vid navigering bort eller hel app-lås. Den rena
beslutslogiken testas i `packages/shared locks.test.ts` (`shouldRelockOnIdle`), och
`relockProtectedFolders` (mask-effekten) i `apps/{web,mobile} __tests__/store.test.ts`. Se
[`../../noter-app/docs/LOCKED_FOLDER_SECURITY.md`](../../noter-app/docs/LOCKED_FOLDER_SECURITY.md) §2.

## Format för audit-export

`Doc/security/cwe-mapping.md` läses av `Doc/security/exportReport.mjs`
(scaffold — se nedan) som producerar en CSV med kolumnerna
`CWE-ID, Threat, Severity, Status, MitigationCommit` redo att lämnas till
extern säkerhetsgranskning.

```sh
node Doc/security/exportReport.mjs > audit-2026-Q2.csv
```

## CWE-id som behöver dokumenteras nästa

Saker som inte är i tabellen ännu men borde:

- CWE-330 (insufficient randomness) — verifiera att alla random-bytes
  använder `crypto.randomBytes` / `getRandomValues`, inte `Math.random`.
- CWE-209 (information exposure through error messages) — vi har en
  `errorHandler` men felmeddelanden behöver konsekvensgranskas.
- CWE-1004 (sensitive cookie without HttpOnly) — alla cookies har httpOnly,
  bekräfta i regression-test.
- CWE-345 (insufficient verification of data authenticity) — använd HMAC i
  webhook-leveranser (gjort), men kontrollera även intern outbox-dispatch.
