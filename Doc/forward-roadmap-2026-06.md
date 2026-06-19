# Forward roadmap — vad vi ska uppdatera framöver

_Skapad 2026-06-19 · Målgrupp: AI-agenter, utvecklare, reviewers · Status: levande backlog_

Den här filen är den **prioriterade förbättringsbackloggen** efter natt-sessionens
resiliens-/säkerhets-/stabilitetsarbete. Den kompletterar den korta liggaren i
[`improvements.md`](./improvements.md) och §4 i [`index.md`](./index.md) med en **fullständig,
grundad kartläggning** av vad som återstår.

## Hur listan togs fram (proveniens)

Kartlagd med en **17-agents adversariell mappnings-workflow** (read-only `Explore`-finnare,
en per domän → verifieringspass som öppnade de citerade filerna och slängde ogrundade poster
→ completeness-kritiker för korsande luckor). 8 domäner, 73 verifierade poster + 9
kritiker-tillägg. Därefter har jag (agenten) **gått igenom varje post med egen omdöme**:
omklassat felmärkta prioriteringar, slagit ihop dubbletter, och markerat det som redan är
fixat eller verifierat som icke-reellt. Varje post citerar en faktisk fil/rad.

> **Läs invarianterna först:** [`index.md` §3](./index.md). Inget på den här listan får
> brytas mot dem. Poster märkta **🔒 INV** rör en invariant (E2E/klartext, låst innehåll,
> krypto-bara-via-shared, IDOR, deploy-grön) — granska extra noga. Kör alltid
> `node noter-app/scripts/validate-critical.mjs` grönt före commit.

Taggar: **E** = effort (S/M/L), **R** = risk i själva ändringen (low/med/high).

---

## ✅ Redan levererat i den här cykeln (för kontext)

Resiliens + säkerhet + stabilitet, allt i `dev` med tester och gröna grindar:

- **Nätverksresiliens:** `@repo/shared/httpRetry` (per-försök-timeout + begränsad transient
  retry) inkopplad i AI-providers (web+mobil), HF-modellsök, embeddings-klient, WebDAV/
  Nextcloud, web CRUD `api.ts`, login/register.
- **Chatt-historik-budget:** `boundChatHistory` (`packages/shared/contextLevels.ts`) — behåller
  system + senaste turerna inom en teckenbudget. Inkopplad i **alla tre** inferensvägar:
  API-providers (web+mobil) **och** lokal `llama.rn` (budget härledd ur residenta `n_ctx`).
- **Låsta-mappar-läckaudit (3 ronder):** 9 läckor fixade + självtestande grind
  `check-index-unlock-leak.mjs`; Neo4j/kalender/markdown-share/CRDT-Live/widget/GraphQL alla
  grindade på `isReadableForAI` (tom upplåsningsmängd). Krypto-gränsgrind
  `check-crypto-boundary.mjs`.
- **GraphQL lås-lösenord:** output-fältet `password` borttaget (det server-dekrypterbara
  låslösenordet exponerades mot autentiserade GraphQL-klienter; ej live-läcka pga lås-grindarna,
  men defense-in-depth). _(fixat 2026-06-19, surfaced av just den här kartläggningen)_
- **Notifikations-idempotens** + **web krasch/race-fixar** (socket-connect-merge, `note:updated`
  rAF lost-write → testad `notesMerge.applyNoteUpdate`).
- **React Compiler** (web) + CI `web-build`-jobb. **Auto-omlåsning** av skyddade mappar vid
  background/idle (båda apparna).
- **Lås brute-force-härdning** _(2026-06-19, research-grundad)_: per-(user,note) account-lockout
  efter 5 fel med 15 min auto-öppning + audit-loggning av misslyckade/blockerade försök
  (`createLockoutLimiter` i `rateLimit.ts`, inkopplad i `verify-lock`), och bcrypt cost 10→12 för
  nya låslösenord. Promotad till blockerande `validate-critical`-grind. Se Research-sektionen.
- **Dark mode: kalenderhändelser läsbara** _(2026-06-19, P0)_ — vit händelse-text istället för
  hårdkodad svart.
- **Folder-key absolut TTL** _(2026-06-19, 🔒 INV)_ — in-memory folder-nycklar (ADR-0012) får en
  absolut livslängd (default 30 min) med lazy eviction, så en nyckel aldrig överlever sin session
  även om en UI-livscykel-hook inte triggar.

---

## P0 — gör snart (användarsynlig trasighet eller hög risk)

- ✅ **[KLAR 2026-06-19] Dark mode gör kalenderhändelser oläsliga** · `apps/web/app/globals.css:24-27` ·
  Hårdkodad svart händelse-text bytt till vit (delas av båda teman, matchar aktiv toolbar-knapp).

> Den enda äkta P0:n från kartläggningen. Finnaren märkte även "cascade-replace-grind" och
> "GraphQL password" som P0 — den förra är egentligen en P2-härdning (lägg `--selftest`, se nedan),
> den senare är **redan fixad** ikväll.

---

## P1 — viktigt (dataförlust, datasäkerhet, kostnad, drift, stabilitet)

### Sync — risk för tyst dataförlust

- ✅ **[KLAR 2026-06-19] WebDAV push: optimistic-concurrency mot tysta överskrivningar** 🔒 INV ·
  `apps/web/services/nextcloud.ts`, `packages/shared/src/fileIngest.ts` · Tvåvägs-pushen jämför nu
  varje fils senast-synkade ETag mot den nyss enumererade fjärr-ETaggen (`remoteChangedSinceSync`,
  ren+testad — If-Match/412-semantik utan extra request). Vid konflikt **hoppas både pushen OCH den
  inkommande överskrivningen över** → varken lokal eller fjärr-ändring förstörs tyst; `conflicts`-
  räknare + loggning. 5 tester. **Kvar (P2):** conflict-copy/merge-UX (i dag lämnas båda för manuell
  lösning). Web/Electron (mobilen saknar tvåvägs-WebDAV-push).
- ✅ **[KLAR 2026-06-19] Mutations-ACK idempotent (inga dubbletter vid reconnect)** ·
  `packages/shared/src/mutationLedger.ts`, `apps/backend/src/utils/pendingMutations.ts`, alla 4
  drains (web+mobil × kalender+markdown) · Delad `createAppliedLedger` + `applyMutationsOnce`: en
  återlevererad mutation re-ackas men **app­liceras inte igen**. Backend-ACK returnerar **faktiskt**
  borttaget antal (+ `requested`). 9 tester (7 ledger + 2 route). Grundat i idempotency-key-standard.
- **Misslyckad pull efter lyckad push lämnar pull oåterställd** · `apps/web/services/nextcloud.ts:310-402` ·
  **E:M R:med** · `enumerateAll`-fel efter push-success överges; nästa sync hoppar push (hash matchar)
  men återupptar aldrig pull → nya fjärr-filer upptäcks inte. Separera push/pull med egen
  fel-recovery + retry-flagga.

### AI / agent

- **Web agent-executor saknar run-budget-guard + await på persist** ·
  `apps/web/services/ai/agentExecutor.ts:175-202` · **E:S R:med** · Ingen `isOverRunBudget`-check
  före första persist (mobil har den, rad 257); `persist()` är inte awaitad → en task med
  `maxRuns=N` kan överskrida budgeten med 1. Lägg guarden + `await` båda persist-anropen; logga
  run-log även på fel-returvägen.
- **Tool-result-trunkering äter hela feltexten** · `packages/ai/src/agentRunner.ts:105-109,205` ·
  **E:S R:med** · `clampJson` klipper till 4000 tecken utan att skilja på fel vs data; en lång
  stacktrace blir `'…[truncated]'` och agenten kan inte återhämta. Lägg `isError`-flagga som
  bevarar (eller höjer taket för) feltext.

### RAG / indexering

- ✅ **[KLAR 2026-06-19] `autoIndex`-inställningen är nu funktionell** ·
  `packages/shared/src/debounce.ts`, `apps/{web,mobile}/services/ai/autoIndex.ts` · Ny delad
  `createDebounced` + en enda store-prenumeration per app som debouncar (8s) och re-indexerar vid
  note/task-ändring **när flaggan är på** (default av), overlap-skyddad + best-effort. Inkopplad en
  gång vid bootstrap (web `providers.tsx`, mobil `_layout.tsx`, auth-gated). 4 debounce-tester.
- ✅ **[KLAR 2026-06-19] Embeddings count-mismatch hoppar tyst över noter** ·
  `packages/shared/src/embeddingsClient.ts` · `embedTexts` kastar nu vid count-mismatch eller tom
  vektor; `indexEntities` fångar det och returnerar `ok:false` utan att spara ett partiellt index →
  batchen retries istället för att halv-skrivas. Pure `parseEmbeddingsResponse` förblir lenient.
  2 nya tester.
- **Index-korruption tyst vid krypto-fel** · `apps/{web,mobile}/services/ai/embeddingsService.ts` ·
  **E:S R:high** · `readEncryptedJson`/`writeEncryptedJson` sväljer alla fel och returnerar
  fallback → ett krypto-fel kan tyst spara skräp eller radera hela vektor-indexet utan att
  användaren märker det. Logga strukturerat, validera schema, ytan ett fel-tillstånd till UI:t.

### Säkerhet / krypto

- ✅ **[KLAR 2026-06-19] Folder-key-session: absolut TTL-backstop i krypto-lagret** 🔒 INV ·
  `packages/shared/src/folderKeySession.ts` · Varje session-nyckel har nu en absolut TTL (default
  30 min, `configureFolderKeyTtl`); `getFolderKey`/`resolveSessionFolderKeyForNote` evictar lazily
  så en utgången nyckel aldrig returneras (säkerhetsgarantin håller utan app-wiring), +
  `sweepExpiredFolderKeys()` för en idle-tick. `clearAllFolderKeys()` är redan inkopplad på
  logout/projekt-byte. 5 tester. **Kvar (P2):** proaktivt `sweep`/`clearAllFolderKeys` även på
  app-background-event i båda apparna (lazy eviction täcker säkerheten; detta frigör minne tidigare).
- ✅ **[KLAR 2026-06-19] Låslösenord: bcrypt cost 10 → 12** · `apps/backend/src/routes/notes.ts` ·
  `LOCK_PASSWORD_BCRYPT_COST = 12` (OWASP 2025). Befintliga hashar verifierar fortfarande; en
  om-låsning uppgraderar dem. _(GraphQL-fältet `password` togs bort separat.)_ **Kvar (P2):**
  migrera helt till Argon2id (finns redan i beroendena) + re-hash-migration.
- ✅ **[KLAR 2026-06-19] `verify-lock`: per-(user,note) brute-force-lockout** ·
  `apps/backend/src/{routes/notes.ts,middleware/rateLimit.ts}` · `createLockoutLimiter` räknar
  konsekutiva fel per `userId:noteId`, blockerar efter 5 (429 + `Retry-After`), auto-öppnar efter
  15 min, nollställs vid rätt lösenord; misslyckade/blockerade försök audit-loggas. Blockerande
  test-grind. Grundat i OWASP A07:2025 (se Research). **Kvar (P2):** per-user lockout även på
  inloggning + CAPTCHA efter flera fel.

### Stabilitet / drift

- ✅ **[KLAR 2026-06-19] Backend cache (Redis) livscykel** · `apps/backend/src/services/cache.ts`,
  `apps/backend/src/index.ts` · `cache.close()` tillagd + registrerad i graceful shutdown (ingen
  zombie-klient). _Korrigering:_ deep-readiness **pingar redan** Redis (`healthDeep.ts` `checkRedis`),
  så synligheten fanns. **Kvar (P2):** lägg Redis i `readiness.ts`-grinden om man vill 503:a vid
  Redis-nere (i dag fail-open: rate-limit/lockout degraderar till per-pod-minne — observeras via
  /health/deep).
- **Mobil agent-task saknar timeout → kan hänga för evigt** · `apps/mobile/services/ai/agentExecutor.ts:244-319` ·
  **E:M R:high** · Backend-runnern har `TIMEOUT_MS=60_000`; mobilen har ingen. _Delvis mildrat:_
  varje modell-anrop är redan tidsgränsat (provider-timeouts + lokal inaktivitets-watchdog), men en
  hängd verktygs-exekvering eller patologisk loop saknar ett tak. `Promise.race` runt hela
  `runScheduledAgentTask` (riskfylld core-path — kräver mock-tester).
- ✅ **[KLAR 2026-06-19] Change-stream restart-loop med tak + läck-fix** ·
  `apps/backend/src/services/changeStreamInvalidator.ts` · Hård gräns 10 omstarter
  (`planChangeStreamRestart`, ren+testad) → ERROR + `degraded`-flagga + stopp (ingen evig loop/spam);
  döda streams tas bort ur `streams[]` (ingen läcka); `changeStream.degraded` syns i /health/deep
  (utan att fälla overall-status). 4 tester.
- ✅ **[KLAR 2026-06-19] Cron-scheduler: timeout per handler** · `apps/backend/src/services/cronScheduler.ts` ·
  Varje handler körs nu via `_withHandlerTimeout` (4 min, under lås-TTL:n 5 min) så en hängd handler
  släpper det distribuerade låset och svälter inte nästa körning. _Not:_ jobben körs redan via
  `void runOnce` (blockerar inte loopen) + `withLock` (ingen overlap), så detta är defense-in-depth.
  3 tester.

### Drift / CI / ops

- ✅ **[KLAR 2026-06-19] Container HEALTHCHECK + deploy health-gate + rollback** 🔒 INV ·
  `apps/{backend,web}/Dockerfile`, `deploy_pi.py` · HEALTHCHECK-direktiv (node-baserade, ingen
  curl-dependency) på backend (/api/health) + web (/); `deploy_pi.py` sparar git-SHA före pull,
  pollar `/api/health` på Pi:n efter `compose up`, och **rullar tillbaka** (`git reset --hard` +
  rebuild) till föregående revision om bygget är trasigt — sajten kommer tillbaka i stället för att
  ligga nere. _(Infra — verifieras vid nästa riktiga deploy.)_ **Kvar:** hårdkodat SSH-lösenord i
  `deploy_pi.py` flaggat för rotation/secret-hantering (separat task).
- **DB-backup-automation + restore-test saknas helt** 🔒 INV · `docker-compose.yml`,
  `Doc/ops/disaster-recovery.md` · **E:M R:high** · Inga `mongodump`/backup i repo; runbook säger
  "testa alltid restore" men ger ingen automation. En migrations-bugg/ransomware är oåterställbar.
  Backup-sidecar (var 6:e h) + veckovis CI-restore-sanity + pre-deploy volym-snapshot.
- **npm audit-remediering: policy + CI-grind** · `package-lock.json`, `scripts/validate-critical.mjs` ·
  **E:M R:high** · 184 advisories (några kritiska transitiva: `@babel/core`, `@grpc/grpc-js`,
  `@opentelemetry/core`). Lägg `npm audit --audit-level=high` + `AUDIT_EXCEPTIONS.json` med
  motiverade undantag (t.ex. `xlsx` no-fix). _(Befintlig deferred-post — kräver granskad
  uppgraderingsrunda, ej `fix --force`.)_
- **E2E auth/session-flöden saknas** 🔒 INV · `apps/{web,mobile}` testsviter · **E:L R:med** ·
  Ingen e2e för login→logout→401-redirect eller token-refresh. Maestro (mobil) + Playwright/Cypress
  (web) för de 3 kritiska flödena. _(Matchar improvements.md rad 34/43.)_

### Cross-cutting (kritiker-tillägg)

- ✅ **[KLAR/KORRIGERAD 2026-06-19] AI-quota — kopplad in på den ENDA operatör-kostnadsvägen** ·
  `apps/backend/src/services/backendAgentRunner.ts` · **Korrigering av premissen:** ALLA betal-anrop
  (LLM + embeddings) använder användarens EGEN klient-nyckel — backend proxar dem aldrig, så de
  kostar inte operatören och behöver ingen server-quota. Den enda operatör-kostnaden är
  **server-körda agentuppgifter** (självhostad Ollama-compute + DB-skrivningar). `enforceQuota`
  inkopplad där (per-user `dayLimit=200`, env-överridbar; fail-open vid DB-blip). Återbrukar den
  byggda men oanvända `quotaTracker`. Mongo-backad test bevisar att den faktiskt blockerar. Klient-
  nyckel-vägarna är **medvetet INTE** quota'de (dokumenterat). **Kvar (P3):** UI för förbruknings-
  varning (client-local mätning finns i mobil `usageTracker`).
- **GDPR data-export + radera-konto saknas** · `apps/backend/src/routes/{auth,notes,tasks}.ts` ·
  **E:M R:high** · Ingen portabilitets-/raderingsendpoint (GDPR art. 20, CCPA). `POST /api/user/export`
  (krypterad bundle) + `DELETE /api/user/account` (soft-delete + 30 d grace). _(E2E gör export
  klurig — kräver klient-dekrypterings-handoff.)_
- **Audit-logg ej immutable/tamper-evident** 🔒 INV · `apps/backend/src/middleware/auditLog.ts`,
  `apps/backend/src/models/McpAuditLog.ts` · **E:M R:high** · Loggar ligger i samma Mongo som
  userdata; DB-admin kan ändra dem oupptäckt. Hash-kedja (SHA256 av föreg.+payload), separat
  read-only-sink, 90+ d retention.
- ✅ **[KLAR 2026-06-19] Env-validering vid startup** 🔒 INV · `apps/backend/src/utils/validateEnv.ts`,
  `apps/backend/src/index.ts` · Ren `validateBackendEnv` körs vid boot: fatal (endast prod) bara för
  "ingen JWT-signeringsnyckel alls" (annars bara runtime-fel vid första login); loud warning för
  svagt/placeholder `JWT_SECRET`, saknad `MONGO_URI`/`REDIS_URL` i prod (noterar rate-limit/lockout-
  degradering), och oparsbara numeriska vars. 8 tester, blockerande grind. **Kvar (P1/P2):** JWT-nyckel-
  rotation utan omstart (hot-swap) + CI-koll att `.env` inte committas (secret-scanning, se nedan).

---

## P2 — värdefullt (prestanda, UX, parity, härdning)

### Prestanda

- **React Compiler för mobil saknas** · `apps/mobile/babel.config.js` · **E:M** · Web har den; mobil
  inte (`babel-plugin-react-compiler` finns ej i deps). Om Expo inte bundlar den ännu: manuell
  `React.memo` + `useCallback` på list-objekt-komponenter.
- **`TaskItem` (web) ej memoiserad** · `apps/web/components/TaskList.tsx:36-200` · **E:S** ·
  `React.memo` + `useCallback` på handler-props (Compiler auto-memoiserar men explicit är robustare
  vid bail-out).
- **Virtuell scroll för stora listor** · `apps/web/components/{TaskList,SidebarTree}.tsx` · **E:M** ·
  `react-window` finns oanvänt; `TaskList` renderar alla items. Prioritera TaskList (FixedSizeList).
- **Klienter använder inte pagination** · `apps/web/services/api.ts:279`, `apps/web/stores/useStore.ts:1122` ·
  **E:M** · Backend stödjer cursor (`?limit`/`?cursor`) men klienterna hämtar hela listan → långsam
  start vid 5000+ items. Implementera cursor-pagination (notes först).
- **Saknat DB-index `{ userId, createdAt: -1 }` på Task** · `apps/backend/src/models/Task.ts:50-51` ·
  **E:S** · `tasks.ts` sorterar alltid på `createdAt` men index saknas → full scan. Lägg indexet.

### AI / RAG

- **Anthropic API-version hårdkodad `2023-06-01`** · `apps/mobile/services/ai/apiProviders.ts:36` ·
  **E:S** · Uppdatera + datum-kommentar; överväg per-modell-version i `API_PROVIDERS`.
- **Loop-detektor saknar semantisk arg-normalisering** · `packages/ai/src/agentRunner.ts:168-176` ·
  **E:M** · Sortera objektnycklar + strip null före signatur-hash så semantiskt lika tool-anrop
  fångas.
- **Streaming idle-timeout ej token-rate-medveten** · `apps/mobile/services/ai/apiProviders.ts:43-45,427` ·
  **E:M** · 90 s idle kan döda en långsam-men-progresserande reasoning-modell. Mät rate, eller
  per-modell-override.
- **Lokal modell: räkna in system-prompt exakt i `n_ctx`-budget** · `apps/mobile/services/ai/llama.ts` ·
  **E:S** · _Delvis redan mildrat:_ `boundChatHistory` räknar system-meddelandenas tecken i budgeten,
  men `localPromptBudgetChars` modellerar inte chat-template-overhead exakt. Lägg en liten extra
  marginal eller skicka system-prompt-längden in. _(Låg risk — nuvarande budget under-fyller redan.)_
- **Custom-provider URL-validering (Hermes)** · `apps/mobile/services/ai/apiProviders.ts:145-152` ·
  **E:S** · Validera schema+host; valfri test-connection vid sparande.
- ✅ **[KLAR 2026-06-19] Vector dimension-mismatch vid modellbyte** · `packages/shared/src/vectorSearch.ts` ·
  `cosineSimilarity` returnerar nu **0** vid dimensions-mismatch (i stället för att trunkera till
  `min(len)` → garbage), så inkompatibla vektorer exkluderas och söket faller rent tillbaka till
  lexikalt tills indexet byggts om. 2 tester. **Kvar (P2):** lagra `dims`/`provider` i index-metadata
  + auto-trigga ombyggnad vid modellbyte (i dag re-embeddas allt vid nästa index-körning).
- ✅ **[KLAR 2026-06-19] Index size-cap + eviction** · `packages/shared/src/vectorStore.ts` ·
  `buildVectorIndex(…, maxItems)` (default 4000) evakuerar äldst-embeddade rader (de behåller lexikal
  sök) så det krypterade indexet inte spränger localStorage/AsyncStorage-kvoten. **Kvar (P2):**
  vektor-DB/HNSW för O(log n)-sök vid 10k+ noter.
- ✅ **[KLAR 2026-06-19] Index-metadata (provider+dims) + ombyggnad vid leverantörsbyte** ·
  `vectorStore.ts` · `VectorIndex` lagrar provider+dims; `diffIndex(…, provider)` re-embeddar vid
  modell- ELLER leverantörsbyte (samma modellnamn på annan provider = annat vektorrum).
- ✅ **[KLAR 2026-06-19] Agent + chatt sökverktyg `search_notes`** · `packages/shared/src/agentSearch.ts` ·
  Lås-säker lexikal+rerank, inkopplad i alla 4 ytorna. **Kvar (P2):** hybrid (query-vektor) för agenten på djup nivå.
- ✅ **[KLAR 2026-06-19] Webbsök ej längre annonserad (ärlighet)** · `contextLevels.ts` · reserverad
  tills ett riktigt verktyg byggs. **Kvar:** ev. implementera webbsök (kräver privacy-beslut).
- ✅ **[KLAR 2026-06-19] Dokumentation + CI-grind** · `Doc/ai-search-indexing-and-agent.md` (länkad i
  index.md + README) + namngiven blockerande CI-grind "AI search & semantic retrieval — RAG correctness"
  (8 sviter / 84 tester).
- ✅ **[KLAR 2026-06-19] Query-embedding-cache** · `packages/shared/src/lruCache.ts` (delad generisk
  LRU) + `embedQuery` i embeddings-tjänsten (web+mobil) · En upprepad sökning/chatt-tur betalar inte
  om embedding-anropet (nyckel: provider|model|hash). Konsoliderade 2 dubblerade embed-query-sajter
  per app till en cachad väg. 4 tester. Research-grundat (RAG query-cache-praxis).
- **[UPPSKJUTET, research-grundat] Cross-encoder-rerank (on-device ONNX)** · +5–15 NDCG enligt
  research, MEN kräver reranker-modell + `onnxruntime` (web+RN) + tokenizer — tung dependency som
  inte kan CI-valideras, kostsam på mobil. Medvetet ej spekulativt inlagd; den regel-baserade
  reranken är ett solitt mellansteg. Kräver produktbeslut om modell/minnesbudget.
- **[UPPSKJUTET] Hybrid för agenten + vektor-DB/HNSW** · agent-hybrid är inkrementellt + kopplar
  executor↔tjänst; HNSW är för tidigt (<5k noter → O(n) är ms). Se `ai-search-indexing-and-agent.md` §10.
- **Partial-batch-atomicitet i indexering** · `apps/{web,mobile}/services/ai/embeddingsService.ts` ·
  **E:M** · Committa vektorer först efter att hela batch-loopen lyckats, eller spåra `lastSuccessBatch`.

### UX / parity / a11y

- **Modal-a11y: focus trap + role/aria** · `apps/web/components/{ConfirmationModal,PasswordModal,TaskDetailModal}.tsx` ·
  **E:M** · Saknar `role="alertdialog"`, `aria-modal`, focus-trap, restore-on-close. Delad
  `AccessibleModal`-wrapper.
- **Web i18n: hårdkodade svenska strängar** · `apps/web/components/AISidebar.tsx:60,94-96` · **E:S** ·
  `Ingen modell`/`Förbrukning idag`/`Anrop`/`Tokens` saknar nycklar (mobil har dem). Lägg
  `ai.*`-nycklar.
- **Web komponent-testtäckning** · `apps/web/__tests__` (25 filer / 29 komponenter; mobil har 71) ·
  **E:M** · Modaler, `Auth.tsx`, Navbar-genvägar saknar tester.
- **next-themes i Electron static export** · `apps/web/next.config.js`, `apps/web/components/Navbar.tsx` ·
  **E:M** · Verifiera att temat hydreras i static-export + E2E (light↔dark).
- **Electron `window.mlc`-bridge: typ-deklaration + smoke-test** · `apps/web/components/AISidebar.tsx:106` ·
  **E:S** · `(window as any).mlc` kringgår typ-säkerhet; `electron-bridge.d.ts` + post-build-koll.

### Stabilitet / ops

- **Felspårning (Sentry)** · backend `errorMiddleware` + web/mobil · **E:M** · Ingen aggregering/larm;
  börja med backend (högst ROI).
- **Coverage-gates i jest** · `apps/{backend,web,mobile}/jest.config.*` · **E:M** · Inga
  `coverageThreshold` → en otestad route passerar CI. Börja rapporterande, höj sedan.
- **Mobil socket token-refresh vid auth-expiry** · `apps/mobile/services/socket.ts:46-107` · **E:M** ·
  `reconnectionAttempts: Infinity` med stale token → evig loop. 401→refresh→`socket.auth`→reconnect.
- **DB write-contention integration-test under last** · `apps/mobile/services/database.ts:36-48` · **E:L** ·
  SQLITE_BUSY-retry (6 försök) ej testad under realistisk samtidig last (chat-save + sync + offline).
- **Audit-logg fångar inte misslyckade verify-lock (4xx)** · `apps/backend/src/middleware/auditLog.ts:96-124` ·
  **E:M** · Brute-force via rate-limit-kringgång blir osynlig. Logga alla verify-lock-försök
  oavsett status.
- **cascade-replace-grind: lägg `--selftest`** · `scripts/check-sql-cascade-replace.mjs` · **E:S** ·
  _(Omklassad från finnar-P0.)_ Grinden är gated men ej självtestad som `check-index-unlock-leak.mjs`.
  Lägg `--selftest` som bevisar att den fångar den kända "AI-tråden tom"-bug-klassen.
- **CRDT Live: rum-TTL/cleanup när `persistTimer` dangling** · `apps/backend/src/markdav/live.ts:25-65` ·
  **E:M** · Rum utan uppdateringar efter join läcker (timer rensas aldrig, `members=0`-cleanup körs ej).
  Absolut 5-min-TTL per rum + max-rooms-tak.
- **Markdown share-projektion: stabil sortering** · `packages/shared/src/calendar.ts:51-84` · **E:S** ·
  Osorterad iterationsordning → icke-deterministisk ICS-hash → falska sync-triggers. Sortera på
  `_id`/`createdAt`.
- **Feature-flags / config hot-reload** · `apps/backend/src/index.ts` · **E:M** · Ingen emergency-disable
  utan rebuild (5–10 min). Redis-/fil-baserade flaggor (`AI_PROVIDER_DISABLED` m.fl.).
- **`console.log` → winston i backend** · `apps/backend/src/index.ts` (28 anrop) · **E:S** · Splittad
  loggning; pre-commit-hook som blockerar `console.log` i `src/`.
- **Mongoose connection pooling + reconnect-handlers** · `apps/backend/src/index.ts:600-615` · **E:M** ·
  `maxPoolSize` + `disconnected`/`reconnect`/`error`-handlers.
- **Migration-runner: `down()`/rollback + dry-run** · `apps/backend/src/services/migrationRunner.ts:81-146` ·
  **E:M** · Startup fortsätter trots misslyckad migration → inkonsekvent state. Kasta vid fail +
  rollback i omvänd ordning + `--validate-migrations` mot temp-DB.
- **Data-retention/purge** · `apps/backend/src/services/cronScheduler.ts`, `softDeletePlugin.ts` · **E:M** ·
  Soft-deletes ligger kvar för evigt. `DATA_RETENTION_DAYS` + daglig purge-job + dokumentera policy.
- **Secret-scanning i CI** · `scripts/validate-critical.mjs`, `.gitignore` · **E:M** · Ingen
  truffleHog/secretlint. Lägg scan + `.env.example` + pre-commit-hook.

---

## P3 — nice-to-have

- **`estimateTokens` 4→3.5 tecken/token** · `packages/ai/src/agentRunner.ts:56-57` · täta system-prompts.
- **Instance-heartbeat cleanup WARN-logg + TTL-index** · `apps/backend/src/services/instanceHeartbeat.ts:106-118`.
- **keep-awake release-verifiering + watchdog** · `apps/mobile/services/ai/agentScheduler.ts:44-66` ·
  släpps lås även om handler kastar; 30-min watchdog.
- **Task `{ userId, completed, parentNoteId }`-index** · `apps/backend/src/models/Task.ts:51` ·
  framtidssäkring om filter flyttas server-side.
- **Bild/bilaga-upload: designa först** · `apps/web/components/NoteEditor.tsx:1095-1107`,
  `apps/backend/src/services/quotaTracker.ts:10` · UI finns men ingen upload-endpoint; designa
  storleksgränser/lazy-load/resize/quota innan implementation.

---

## 🔎 Research-insikter (online-trender, uppdateras löpande)

Externa best-practice-/trend-källor som styr besluten ovan. Uppdatera när ny research kommer in.

### Säkerhet (2026-06-19)

- **Lösenords-hashning (OWASP Password Storage Cheat Sheet, 2025):** bcrypt-arbetsfaktor
  **≥ 12** (cost 12 ≈ 250 ms/hash), Argon2id som förstaval (`m=19456 KiB, t=2, p=1`). → Vi
  höjde låslösenord till cost 12; full Argon2id-migration ligger kvar som P2.
- **Brute-force/lockout (OWASP A07:2025 Authentication Failures + Auth Cheat Sheet):** lås konto
  efter **3–5 konsekutiva fel**, auto-öppna efter **~20 min**; per-IP-limit ensam räcker inte
  (NAT/spoofing) — nyckla även på user/resurs; **logga misslyckade försök med IP + tidsstämpel**;
  MFA/CAPTCHA som komplement. → Vi byggde per-(user,note)-lockout (5 fel / 15 min) + audit-logg.
  Kvar: lockout även på inloggning, ev. CAPTCHA, MFA.
- **Källor:** [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) ·
  [OWASP A07:2025 Authentication Failures](https://owasp.org/Top10/2025/A07_2025-Authentication_Failures/) ·
  [OWASP Blocking Brute Force Attacks](https://owasp.org/www-community/controls/Blocking_Brute_Force_Attacks).

### Sync / offline-first (2026-06-19)

- **Idempotens / exactly-once (Morling, Stripe, AWS):** varje mutation bär en unik idempotency-key;
  konsumenten spårar redan-bearbetade keys och ignorerar dubbletter; ACK-beslutet ska kunna verifieras
  (faktisk durabilitet, inte "antal begärda"); keys behålls över hela replay-horisonten. → Vi byggde
  `createAppliedLedger`/`applyMutationsOnce` + ACK med faktiskt borttaget antal.
- **Optimistic concurrency för HTTP/WebDAV (If-Match/ETag, RFC 7232):** klienten skickar `If-Match`
  med senast-kända ETag; servern svarar **412 Precondition Failed** om resursen ändrats → förhindrar
  "lost update". → Vi tillämpar samma semantik med redan-enumererade ETags (`remoteChangedSinceSync`)
  och hoppar icke-destruktivt över båda riktningarna vid konflikt.
- **Källor:** [On Idempotency Keys (Morling)](https://www.morling.dev/blog/on-idempotency-keys/) ·
  [Optimistic Concurrency with ETags](https://fideloper.com/etags-and-optimistic-concurrency-control) ·
  [If-Match (http.dev)](https://http.dev/if-match).

### RAG / vektor-index (2026-06-19)

- **Embeddings-modellbyte (vektor-DB-praxis):** lagra provider + modellnamn + **dimension** som
  metadata bredvid indexet; upptäck mismatch och **jämför aldrig inkompatibla vektorer** (olika
  modell/dim = garbage similarity, inte ett truncate). → Vi gör `cosineSimilarity` dimensions-säker
  (0 vid mismatch). Kvar (P2): persistera dims/provider + auto-ombyggnad.
- **Källor:** [Vector dimension mismatch (Pappas/Qdrant)](https://medium.com/@epappas/dealing-with-vector-dimension-mismatch-my-experience-with-openai-embeddings-and-qdrant-vector-20a6e13b6d9f) ·
  [auto-detect embedding model change](https://github.com/volcengine/OpenViking/issues/1066).

### Produktivitet (2026-06-19)

- **Trender i note-taking/PKM 2026:** (1) inbyggd **AI-summering** korrelerar med ~2× daglig
  användning; (2) **E2E-kryptering** är en marknadsdifferentiator (≈28 % av nya lanseringar,
  Standard Notes/Joplin); (3) **local-first** (Obsidian/Joplin, AES-256 härledd ur master-lösen);
  (4) **bidirektionella länkar + nätverkat tänkande** (Obsidian/Roam/Logseq); (5) **automatisk
  PKM** utan manuell struktur (Mem AI). → Noter har redan E2E, local-first, graf/bidirektionella
  länkar och RAG. **Kandidater att plocka in:** AI-summering/auto-titel av anteckningar, automatiska
  backlink-/relaterat-förslag (bygger på befintlig vektor/GraphRAG), och en "daglig genomgång"-vy.
  Förslag för en kommande produktivitets-iteration (ej i P0–P3 ännu — kräver produktbeslut).
- **Källor:** [Best note-taking apps 2026 (axis-intelligence)](https://axis-intelligence.com/best-note-taking-apps-2026-47-ai-tools/) ·
  [Best PKM apps 2026 (toolfinder)](https://toolfinder.com/best/pkm-apps).

## ✋ Verifierat icke-reellt / avprioriterat (ärlighet)

Finnar-poster som verifieringen eller jag **avfärdade** — så ingen jagar dem i onödan:

- **Web socket-lyssnare dubbel-registrering** — VERIFIERAT säkert: `socket.off()` före varje
  `socket.on()` ersätter, staplar inte (`useStore.ts:714-929`). Ingen åtgärd.
- **`materializeNotesFromEncrypted` O(n) per uppdatering** — React Compiler coalescar renders; **mät
  med Profiler innan** ev. memoisering. Inte en blind optimering.
- **"GitHub Actions CI saknas helt"** — FELAKTIGT: `Noter/.github/workflows/ci.yml` (repo-root) kör
  validate-critical-grindarna + `web-build` för `noter-app`. _Korrekt restpunkt:_ branch-protection
  + en deploy-grind kan stärkas (se P1 health-gate).
- **"GraphQL exponerar bcrypt-hash"** — delvis fel rationale (GraphQL-vägen server-_krypterar_,
  bcrypt är REST-vägen) — men output-fältet är ändå **borttaget** (P1-sektionen / levererat).

---

## Hur du tar vid

1. Läs [`contributing.md`](./contributing.md) (kom-igång + checklista) och invarianterna i
   [`index.md` §3](./index.md).
2. Välj en post; respektera **🔒 INV**-flaggan.
3. Lägg tester för allt du ändrar; kör `node noter-app/scripts/validate-critical.mjs` grönt.
4. Små väl avgränsade commits → `dev` (Pi auto-deployar). Uppdatera den här filen + §4 i index.

_Sanning över ambition: den här listan ska spegla faktisk kod. Bocka av/ta bort poster när de
levereras._
