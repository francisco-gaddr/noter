# Noter — dokumentationsindex (börja här)

_Senast uppdaterat: 2026-06-19 · Målgrupp: AI-agenter, utvecklare, reviewers_

Det här är **master-ingången** till all dokumentation. Syftet är att en ny AI-agent
eller utvecklare ska kunna ta vid **utan att gissa** — du ska alltid veta vilken fil du
ska öppna för en given fråga. Läs det här först, sedan den specifika filen.

> **Två andra ingångar att känna till:**
> - [`../README.md`](../README.md) — projektöversikt, stack, kom-igång, valideringskommando.
> - `~/.claude/.../memory/MEMORY.md` — persistent agent-minne (drift-hemligheter, Pi-deploy,
>   krypto-arkitektur, IDOR-regeln). Läses in automatiskt per session.

---

## 1. Vägvisare — "jag vill …" → öppna denna fil

| Jag vill … | Öppna |
|------------|-------|
| **Lägga till en förbättring säkert (kom-igång + checklista)** | [`contributing.md`](./contributing.md) ⭐ |
| Förstå systemet på hög nivå | [`Overview.md`](./Overview.md) |
| Se backend-API:t (rutter, auth, rate limits) | [`api-reference.md`](./api-reference.md) |
| **Förbättra säkerhet/kryptering** | [`security/security-upgrade-playbook.md`](./security/security-upgrade-playbook.md) ⭐ |
| Förstå hotmodellen | [`security/threat-model.md`](./security/threat-model.md) |
| Se STRIDE→CWE-liggaren (audit) | [`security/cwe-mapping.md`](./security/cwe-mapping.md) |
| Förstå nuvarande krypto-läge & spänningar | [`security/encryption-review-2026-06.md`](./security/encryption-review-2026-06.md) |
| **Hur AI-agenten krypterar/skapar data (E2E) + vad servern ser** 🔒 | [`security/ai-agent-data-handling.md`](./security/ai-agent-data-handling.md) + [`adr/0009-e2e-for-ai-created-content.md`](./adr/0009-e2e-for-ai-created-content.md) |
| AI får aldrig läsa låsta anteckningar/projekt | [`security/ai-locked-notes.md`](./security/ai-locked-notes.md) 🔒 |
| **Hela låsta-mappar-säkerhetsmodellen (UI, AI, index, publicering, export, widget, CRDT, GraphQL) + auto-omlåsning** 🔒 | [`../noter-app/docs/LOCKED_FOLDER_SECURITY.md`](../noter-app/docs/LOCKED_FOLDER_SECURITY.md) ⭐ + liggar-rad [`security/cwe-mapping.md`](./security/cwe-mapping.md) (T20) |
| Veta varför ett arkitekturbeslut togs | [`adr/`](./adr/) (ADR-register) |
| **Migrera desktop Electron → Tauri (körguide + beslut)** | [`migrations/electron-to-tauri-runbook.md`](./migrations/electron-to-tauri-runbook.md) ⭐ + [`adr/0007-electron-vs-tauri.md`](./adr/0007-electron-vs-tauri.md) |
| Driftsätta / härda servern | [`ops/server-hardening.md`](./ops/server-hardening.md), [`ops/disaster-recovery.md`](./ops/disaster-recovery.md) |
| Förstå CI/kvalitet & död-kod-grinden | [`ops/ci-quality.md`](./ops/ci-quality.md) |
| Förstå AI-runtime (web/mobil/Electron) | [`App AI.md`](./App%20AI.md), [`AI impl.md`](./AI%20impl.md) |
| **AI-leverantörer (OpenAI/Anthropic/Grok m.fl.) + RAG-hämtning (semantisk/GraphRAG/rerank)** ⭐ | [`ai-retrieval-rag.md`](./ai-retrieval-rag.md) + [`adr/0010-two-stage-rag-retrieval.md`](./adr/0010-two-stage-rag-retrieval.md) |
| **Hur Nextcloud-synken funkar (steg för steg, stabilitet, säkerhet, valda mappar)** ⭐🔒 | [`nextcloud-sync.md`](./nextcloud-sync.md) |
| Synka in utvalda Nextcloud-mappar — design/beslut + selektiv Neo4j | [`nextcloud-ingestion.md`](./nextcloud-ingestion.md) + [`adr/0011-external-source-ingestion.md`](./adr/0011-external-source-ingestion.md) |
| **Köra AI lokalt på mobilen (llama.rn, GGUF direkt)** | [`on-device-ai-llama.md`](./on-device-ai-llama.md) ⭐ (ersätter [`MLC AI.md`](./MLC%20AI.md)) |
| Förstå AI tool-use + GraphQL-kontrakt | [`Tool Calls.md`](./Tool%20Calls.md) |
| **Förstå admin, AI-orkestrering, inställningar + mätbarhet** | [`admin-orchestration-and-settings.md`](./admin-orchestration-and-settings.md) ⭐ |
| Förstå grafvyn (noder/kanter/flödesriktning) + semantisk sök | [`graph-explorer.md`](./graph-explorer.md) |
| **Kalenderprenumeration (ICS) till Google/Apple-kalender** | [`calendar-subscription.md`](./calendar-subscription.md) ⭐ |
| **CalDAV-brygga (tvåvägs uppgifter ↔ Påminnelser/Tasks.org)** | [`caldav-bridge.md`](./caldav-bridge.md) ⭐ |
| **Servera valda anteckningar/mappar som Markdown utåt (Obsidian/macOS/Android/widgets), säkert + 2-vägs realtid** ⭐ *(implementerad: WebDAV + CRDT Live; per-anteckning via 3-prickar, projektmappar via modal + inställningar)* | [`external-markdown-sync.md`](./external-markdown-sync.md) + [`adr/0008-external-markdown-sync.md`](./adr/0008-external-markdown-sync.md) |
| **Vad exponeras utåt? Egress-kontroll + kill-switchar (kalender/uppgifter)** | [`security/calendar-exposure.md`](./security/calendar-exposure.md) 🔒 |
| Förstå widgets | [`widgets-architecture.md`](./widgets-architecture.md) |
| Se vad som återstår / nästa steg | [`improvements.md`](./improvements.md) + §4 nedan |
| Skriva en incident-postmortem | [`incidents/TEMPLATE.md`](./incidents/TEMPLATE.md) |

## 2. Hur koden är organiserad (var saker bor)

| Område | Plats | Notis |
|--------|-------|-------|
| **All kryptering** | `noter-app/packages/shared/src/` | `encrypt.ts` (läs/skriv-dispatch: `materializeFolderField` + `sealNoteFieldForWrite`), `cryptoV3.ts` (AES-GCM/Argon2id), `keyBootstrap.ts`, och per-mapp-modulen (ADR-0012): `folderKey.ts` (`v3f:`-krypto + bundle), `folderKeySession.ts` (in-memory FK-session + `resolveSessionFolderKeyForNote`), `folderEnrolment.ts` (enrol/unlock/lösenordsbyte + `folderCryptoStatus`-query). **Importera bara härifrån.** |
| **Lås-logik (låsta mappar/noter)** | `noter-app/packages/shared/src/locks.ts` | Enda källan: `hasLockSignal`, `findBlockingLockedAncestor`, `isReadableWithLocks`, `relockFoldersOnLeave`, samt **`AI_INDEX_NO_UNLOCK`/`isReadableForAI`/`filterReadableForAI`** för automat-läsare. Mekanisk läck-grind: `scripts/check-index-unlock-leak.mjs` (+`--selftest`). Full modell: [`../noter-app/docs/LOCKED_FOLDER_SECURITY.md`](../noter-app/docs/LOCKED_FOLDER_SECURITY.md). |
| Backend-rutter | `noter-app/apps/backend/src/routes/` | Varje `/:id`-rutt **måste** scopa på `userId` (se IDOR-regeln, §3). |
| Backend write-guard | `…/src/utils/encryption.ts` | `isEncryptedPayload` accepterar v1+v3-envelopes. |
| Mobil-state/sync | `noter-app/apps/mobile/stores/useStore.ts` | Offline-först, chunked dekryptering. |
| AI-leverantörer (alla plattformar) | `apps/{mobile,web}/services/ai/apiProviders.ts` | Registry med `format`-fält (openai/gemini/anthropic); OpenAI/Grok återbrukar OpenAI-vägen, Anthropic egen gren. Lägg till leverantör här (+ binding i mobil `ai.tsx`, switch-gren i web `AISidebar.tsx`). Se [`ai-retrieval-rag.md`](./ai-retrieval-rag.md). |
| RAG-hämtning till AI-chatten (två-stegs) | `packages/shared/src/retrieval.ts` | Ren pipeline: lexikal+vektor→RRF → GraphRAG → rerank. Lås-säker via `buildIndexableEntities`; kopplas in med `retrieveForChat` i `embeddingsService.ts`. |
| Web-API-klient | `noter-app/apps/web/services/api.ts` | `decryptNoteFromApi`/`decryptTaskFromApi`. |
| Graf + layout | `packages/shared/src/{graphModel,graphLayout}.ts` | `buildGraph`/`layoutGraph`/`edgeGeometry` (riktade kanter + pilar); renderas i `apps/web/components/GraphExplorer.tsx` + `apps/mobile/app/graph.tsx`. |
| Semantisk sök (vektor + RRF) | `packages/shared/src/{vectorSearch,embeddings,embeddingsClient,vectorStore}.ts` | Krypterat index på enheten; tjänst i `apps/{web,mobile}/services/ai/embeddingsService.ts`; inställningar `EmbeddingsSettings`. Låsta noter indexeras aldrig. |
| Produktivitet/admin-statistik | `packages/shared/src/insights.ts` | `computeProductivityStats`/`computeAgentStats`; visas i `AdminDashboard` (web + mobil, hopfällbara sektioner). |
| Realtid (WSS) | `apps/{web,mobile}/stores/useStore.ts` | Lyssnar `note:created`/`task:created` + `cache:invalidate`-fallback (debouncad refetch). Backend emittar i GraphQL-resolvers, REST-rutter och Pi-agent-runnern. |
| Versionshantering | `packages/shared/src/whatsNew.ts` | `WHATS_NEW_ENTRIES` + `SecurityClass` per release. |
| Hälsa/observability | `…/backend/src/routes/healthDeep.ts` | `GET /api/health/deep` → `version` + `securityLevel`. |

## 3. Invarianter som ALDRIG får brytas (läs innan du ändrar kod)

1. **Inget i klartext** lagras/skickas — DB, serverdisk eller enhet. Skriv via `encrypt`,
   läs via `safeDecrypt` (aldrig blank-out).
2. **Varje `/:id`-rutt scopar på `userId`** (eller tenant). Ogjort → IDOR. Grep-check:
   `findById(` i `routes/`. Regression: `__tests__/routes/ownership-isolation.test.ts`.
3. **Läsning är bakåtkompatibel** — gammal data (v1) måste alltid gå att läsa när nytt
   krypto-lager läggs till. Lägg till, ersätt inte, i läs-dispatchen.
4. **Krypto importeras bara från `@repo/shared`** — ingen app har egen implementation.
5. **Logga aldrig secrets** (`sanitizeLogInfo`; CWE-532). Runtime-loggar är gitignorerade.
6. **Låst innehåll läcker aldrig** till en automat-läsare eller en yta som lämnar enheten
   (AI, index, publicering, widget, CRDT, GraphQL, export). Automat-läsare passerar **alltid**
   den tomma upplåsnings­mängden (`AI_INDEX_NO_UNLOCK` / `isReadableForAI`), aldrig UI:ts
   `unlockedProtectedNoteIds`. Mekanisk grind: `scripts/check-index-unlock-leak.mjs`
   (CWE-200/T20). Full modell: [`../noter-app/docs/LOCKED_FOLDER_SECURITY.md`](../noter-app/docs/LOCKED_FOLDER_SECURITY.md).
7. **Kör `node noter-app/scripts/validate-critical.mjs` grönt** innan commit.

## 4. Nästa steg / förbättringsbacklog (konkret, prioriterad)

Status 2026-06-13. Uppdatera den här listan när poster blir klara.

**✅ Levererat initiativ — Extern Markdown-sync (valda anteckningar/mappar utåt):**
- [x] Servera **utvalda** anteckningar/projektmappar som en **Markdown-vault** som kan nås
      från **Obsidian, macOS, Android och widgets** — **2-vägs, realtid, per-objekt opt-in,
      omedelbar revoke** från inställningarna, med **bevarad E2E** (bara det utvalda
      projiceras som klartext; låsta noter aldrig). **Båda transporterna levererade
      2026-06-16:** Fas 1 **WebDAV-vault** (`/api/md`, per-share Basic-Auth, mutationskö) +
      Fas 2 **CRDT Live** (Yjs-rum reläade över befintlig JWT-socket.io). Per-share val av
      transport (WebDAV och/eller Live) + riktning (utgående/inkommande) i inställningarna
      (mobil + Electron/web). Plan + utvärdering i
      [`external-markdown-sync.md`](external-markdown-sync.md), beslut (Accepted) i
      [`adr/0008-external-markdown-sync.md`](adr/0008-external-markdown-sync.md). Bygger på
      CalDAV-bryggans mönster ([`caldav-bridge.md`](caldav-bridge.md)) → ~80 % infra-återbruk.
      Tester i CI (`scripts/validate-critical.mjs`: backend `markdav` + shared
      `markdownVault`/`markdownLive`); egress-grind i
      [`security/calendar-exposure.md`](security/calendar-exposure.md). Kvar: Fas 3
      (signerad read-only widget-endpoint).

**⭐ Stort planerat initiativ — Desktop Electron → Tauri v2:**
- [ ] Migrera desktop-appen till Tauri v2. **Allt är redan kartlagt** så det inte startar
      från noll: beslut i [`adr/0007-electron-vs-tauri.md`](adr/0007-electron-vs-tauri.md),
      exekveringsklar körguide i
      [`migrations/electron-to-tauri-runbook.md`](migrations/electron-to-tauri-runbook.md)
      (komplett IPC-karta, secure-store-omdesign med **bevarad E2E**, auto-update-brygga,
      3-webview QA, §9 säkerhetsgrind per fas). Börja med spike (§1) → fasplan (§10).
      Krav: all funktionalitet + säkerhet kvarstår. Se även [`improvements.md`](improvements.md).

**AI-chatt (mobil):**
- [x] Filbilagor i chatten: textfiler (md/txt/json/kod) läses in i prompten via
      `@repo/shared` `aiAttachments`; PDF bifogas som referens-placeholder.
      Inställning + chips + `expo-document-picker`.
- [x] Vision-väg: bilder skickas som OpenAI content-parts (`image_url`) resp. Gemini
      `inlineData` till vision-modeller (`imageDataUrls`/`parseDataUrl` i shared).
      PDF-textextraktion kräver parser-lib — kvar som nästa steg.
- [x] Per-tråd: header-växel synkad E2E ↔ lokal-only (lokala trådar pushas aldrig;
      sync-filtret testat i `tests/ai-sync-service.test.ts`).
- [ ] Enhetsvalidering av lokal modell: nedladdning → konvertering → inläsning → chatt.

**Admin/observability:**
- [x] Admin-dashboard (web): `GET /api/admin/overview` (JWT, userId-scopad) ger
      serverhälsa + version + `securityLevel` + konto-counts; `AdminDashboard.tsx`
      visar dem + uppgifts-/anteckningsinsikter via shared `insights`. 3 backend-tester.
- [ ] Mät AI-förbrukning server-side (i dag client-local i mobil `usageTracker`).
- [ ] Sync-kö-mätning i admin-vyn (mobil-lokal kö i dag).

**Säkerhet/krypto:**
- [~] SQLCipher full-fil-kryptering (mobil/Electron SQLite) — Stage-4. Komplett
      körbart runbook finns: [`ops/sqlcipher-stage4.md`](./ops/sqlcipher-stage4.md).
      Aktivering kräver dev-client-build + enhetsvalidering (kan ej göras headless).
      OBS: känsligt innehåll är redan fält-krypterat i SQLite i dag; detta är defense
      in depth för metadata/struktur.
- [x] UI-flöde för lösenordsbyte → re-wrap av `dataKey` (mobil + web, 7 tester).
- [x] Mekanisk IDOR-grind: `scripts/check-route-scoping.mjs` (i `validate-critical`).

**Hard-review:**
- [x] ai/sync push/pull + mcp-rutter granskade — korrekt userId-scopade (ingen IDOR).
      Regression: `__tests__/routes/ai-sync-isolation.test.ts` (två användare).

**Validerat & klart:** IDOR-fix + mekanisk grind, ai/sync+mcp-review, v3-krypto,
Hermes-källa, chunked perf, version 1.1.0 + säkerhetsklassificering, health-version,
API-referens, säkerhetsplaybook, README + index.md.

## 5. Konventioner för dokumentationen

- **Sanning över ambition:** dokument ska spegla *faktisk kod*, inte planerad målbild.
  Markera tydligt om något är "föreslaget/ej implementerat" (jfr ADR-status).
- **En källa till sanning:** krypto-fakta bor i playbooken; API-fakta i `api-reference.md`.
  Länka dit istället för att duplicera.
- **Säkerhetsändringar** loggas i `cwe-mapping.md` (liggare) + `WHATS_NEW_ENTRIES.security`.
- **Incidenter** → `incidents/` (mall finns). **Beslut** → `adr/` (mall finns).
- Äldre filer (`Mobile implementation.md`, `AI mobile.md`, m.fl.) är **referens** om de inte
  uppdaterats i samma ändringspaket — verifiera mot koden innan du litar på dem.

---

_Den här filen är navigeringen. [`README.md`](../README.md) är översikten._
_Håll §4 (nästa steg) och §2 (var saker bor) aktuella när du levererar._
