# AI-sök, indexering, semantisk sökning & agentens sökförmåga (översikt + status)

_Senast uppdaterat: 2026-06-19 · Gäller mobil + Electron/web (paritet) · Målgrupp: utvecklare, reviewers_

Det här är **master-dokumentet** för hur Noters AI hittar och använder användarens innehåll:
chattens RAG-hämtning, agentens sökverktyg, embeddings-indexeringen och den semantiska
sökningens matematik — **vad som är implementerat, hur man väljer källa och metod, och hur det
testas/grindas**. Pipeline-detaljerna (leverantörsgrenar, två-stegs-RAG steg för steg) bor i
[`ai-retrieval-rag.md`](./ai-retrieval-rag.md); det här dokumentet är helheten + statusen.

> **Kort svar på "är det implementerat och fungerar val av källa + metod?"** Ja. Semantisk hybrid-
> sökning (lexikal + vektor → RRF → rerank, + valfri GraphRAG) är fullt implementerad i båda
> apparna. **Källa** (embeddings: lokal Ollama / Hermes-Pi / OpenAI-kompatibelt API + modell) väljs i
> inställningarna och är inkopplat. **Metod** styrs av kontextnivå (minimal/lätt/standard/djup) +
> per-meddelande-växlar (semantik / GraphRAG / rerank) i chatten. Allt är lås-säkert: låst innehåll
> når aldrig en hämtning, ett index eller agenten.

---

## 1. De fyra ytorna (och deras status)

| Yta | Vad den gör | Metod | Status |
|-----|-------------|-------|--------|
| **AI-chatt: RAG-injektion** | Hämtar relevant kontext per meddelande och injicerar som system-block | två-stegs hybrid (lexikal+vektor→RRF→rerank, +GraphRAG) | ✅ implementerad, per-meddelande-växlar |
| **AI-chatt: verktyg** | Modellen kan kalla `search_notes` + `list_*`/`get_*`/`create_*`… | `search_notes` = lexikal+rerank; övriga = lista/hämta | ✅ |
| **AI-agent (schemalagda uppgifter)** | Autonom agent med verktyg | `search_notes` (lås-säker) + list/get/CRUD + MCP | ✅ (search_notes tillagt 2026-06-19) |
| **Grafvy / fristående semantisk sök** | `semanticSearch()` rankar index med cosine | ren vektor | ✅ |

---

## 2. Indexering (embeddings) — flöde, källa och lagring

**Kod:** `apps/{web,mobile}/services/ai/embeddingsService.ts` (`indexEntities`),
`packages/shared/src/{embeddings,embeddingsClient,vectorStore}.ts`.

```
notes + tasks
   → buildIndexableEntities(notes, tasks, unlockedIds)   ← LÅS-GRIND (låst innehåll bort)
   → diffIndex(entities, storedIndex, model, provider)   ← re-embed bara nytt/ändrat/modell-ändrat/leverantörs-ändrat
   → embedTexts() i batchar om 32 mot <källa>/v1/embeddings (OpenAI-kompatibelt; 30s timeout, 1 retry)
   → buildVectorIndex(model, provider, [...keep, ...fresh], maxItems)   ← stämplar provider+dims, size-cap
   → krypterat i localStorage (web) / AsyncStorage (mobil)
```

### Val av KÄLLA (provider) + modell — inkopplat

`EmbeddingsConfig` (`packages/shared/src/embeddings.ts`) + UI:t
`apps/{web,mobile}/components/EmbeddingsSettings.tsx`:

| Källa (`source`) | Användning | Endpoint |
|------------------|------------|----------|
| `local` | Ollama på samma enhet | `localhost:11434` (default) |
| `hermes` | Egen server på LAN (t.ex. Pi) | egen bas-URL |
| `api` | OpenAI-kompatibelt fjärr-API | egen bas-URL + nyckel |

Modell väljs som fritext (förslag: `nomic-embed-text` (768-dim, default), `mxbai-embed-large`,
`all-minilm`, `text-embedding-3-small`). API-nyckeln lagras krypterat (mobil: `expo-secure-store`).
**Privacy/local-first:** default-vägen är en självhostad modell — noternas innehåll lämnar aldrig
enheten. (Matchar 2025–26 års on-device-RAG-rekommendation, se §8.)

### Index-metadata + modell-/leverantörsbyte (2026-06-19)

`VectorIndex` lagrar nu `{ model, provider, dims, items }` (tidigare bara `model`).
- **`diffIndex(…, model, provider)`** re-embeddar HELA indexet när modellen *eller* leverantören
  ändras — ett **samma modellnamn på en annan provider är ett annat vektorrum**, så de gamla
  vektorerna skulle ge skräp-score. (Branschpraxis: lagra provider+modell+dimension som metadata.)
- **`vectorIndexNeedsRebuild(index, model, provider)`** låter UI:t visa "omindexering rekommenderas"
  utan att embedda för att ta reda på det.
- **`buildVectorIndex(…, maxItems)`** sätter en storleksgräns (default `DEFAULT_MAX_INDEX_ITEMS =
  4000` rader ≈ 12 MB): vid överskridande behålls de **senast embeddade** raderna (äldst evakueras
  — de har fortfarande lexikal sökning). Skyddar mot att det krypterade indexet spränger
  localStorage/AsyncStorage-kvoten och **förlorar hela indexet**.

### Auto-indexering (opt-in, default av)

`apps/{web,mobile}/services/ai/autoIndex.ts`: en enda store-prenumeration som **debouncar (8s)** och
re-indexerar vid note/task-ändring när `config.autoIndex` är på. Overlap-skyddad, best-effort,
lås-säker (tom upplåsningsmängd). Använder delad [`createDebounced`](../noter-app/packages/shared/src/debounce.ts).

---

## 3. Semantisk / vektor / graf-sök — matematiken

**Kod:** `packages/shared/src/{vectorSearch,graphModel,retrieval}.ts`.

- **`cosineSimilarity(a, b)`** — ren cosine; **0 vid dimensions-mismatch** (inte trunkering till
  `min(len)`) så ett inaktuellt index aldrig ger skräp-score, söket faller rent tillbaka till lexikalt
  tills ombyggnad.
- **`reciprocalRankFusion(lists, k=60)`** — `score(id) = Σ 1/(k+rank)`. RRF k=60 är branschstandarden
  (OpenSearch/Azure AI Search/Chroma-default) eftersom den fuserar på **rang, inte score** och
  undviker score-inkompatibilitet mellan dense och sparse.
- **`hybridSearch(fulltext, vector)`** — fuserar de två rungorna via RRF, flaggar `inFulltext`/
  `inVector`, degraderar graciöst om en rung saknas.
- **`fulltextSearch(notes, tasks, query)`** — lexikal (titel 3×, body 1×), tokeniserar med åäö-stöd.
- **GraphRAG** (`graphModel.ts` `buildGraph`/`neighborsOf`) — expanderar topp-träffar via grafgrannar,
  centralitets-rankade; begränsad till den lås-filtrerade kandidatmängden.

### Två-stegs-pipelinen (`retrieval.ts` `retrieveContext`)

1. **Stage 1 — bred recall:** lexikal rung + (om query-vektor) vektor-rung + (om på) GraphRAG-
   expansion → **RRF-fusion (k=60)**.
2. **Stage 2 — precis rerank:** query-medvetna features (coverage 2.5× + titel-coverage 1.5× +
   exakt fras 1.0× + densitet 0.5×) → topp `limit`, med proveniens (`via: fulltext|vector|graph`).

`renderRetrievedContext()` formaterar till ett `<relevant_kontext>`-block (max 4000 tecken).

---

## 4. Val av METOD — kontextnivåer + per-meddelande-växlar

**Kod:** `packages/shared/src/contextLevels.ts` + chattens UI `AISidebar.tsx` / mobil `ai.tsx`.

| Nivå | Fritextsök | Vektor/graf | Mappar i prompt | Max items | Not |
|------|-----------|-------------|-----------------|-----------|-----|
| minimal | ❌ | ❌ | ❌ | 0 | bara svara |
| lätt | ✅ | ❌ | ❌ | 10 | snabbt |
| **standard** (default) | ✅ | ❌ | ✅ | 50 | rekommenderat |
| djup | ✅ | ✅ | ✅ | 200 | full RAG |

Plus tre per-meddelande-växlar i chatten: **semantik** (kör RAG), **GraphRAG** (graf-expansion),
**rerank** (omordning). Vektor/graf-sök låses upp på **djup**.

> **Webbsök:** `allowWebSearch` är RESERVERAD, **inte implementerad** — det finns inget webbsök-verktyg.
> Vi annonserar det därför inte längre (att påstå en förmåga modellen inte har försämrar svaren, och
> en tredjeparts-webbsök krockar med local-first/privacy). Re-aktivering är en enrad den dag ett
> riktigt verktyg byggs. (Fixat 2026-06-19.)

---

## 5. AI-chattens hämtning (RAG-injektion)

När `enableSemantic` är på: `retrieveForChat(query, notes, tasks, unlockedIds, opts)`
(`embeddingsService.ts`) kör hela pipelinen och returnerar ett system-block som injiceras
**före** historiken — påverkar varje svar utan att kosta tokens per tur. Per-källa-nivå-grindar
(`sourceMinLevels`) släpper in synkade källor först på rätt kontextnivå.

---

## 6. AI-agentens sökförmåga

**Kod:** `apps/{web,mobile}/services/ai/agentExecutor.ts` (agent), chattens executor i
`AISidebar.tsx` / `ai.tsx`, det delade `packages/shared/src/agentSearch.ts`.

- **`search_notes(query, limit?)`** (nytt 2026-06-19) — agentens (och chattens) sökverktyg.
  `agentSearchNotes()` **återbrukar** samma lås-grind som indexet (`buildIndexableEntities` med tom
  upplåsningsmängd) och samma två-stegs-hämtning som chatten (lexikal recall + rerank; **ingen
  embeddings-anrop** så det funkar offline / på varje modell / utan kostnad). Den är inkopplad i
  **alla fyra ytorna** (web+mobil × agent+chatt) + verktygsregistret + alla verktygs-prompter.
- Övriga verktyg: `list_notes/get_note/list_projects/list_tasklists/list_tasks/get_task` (lista/hämta)
  + `create/update/delete` + MCP (Google/Notion/GitHub …).
- **Val av källa/metod för agenten:** sätts av uppgiftens konfiguration (`source`/`provider`/`model`
  + `contextLevel`), inte av agenten själv — agenten arbetar inom de gränser uppgiften ger.

---

## 7. Säkerhet — låst innehåll är osynligt för AI:n (lufttät)

Varje AI-läsväg passerar lås-grinden med den **TOMMA** upplåsningsmängden (`AI_INDEX_NO_UNLOCK` /
`isReadableForAI`) — en mapp användaren har öppen i UI:t är ändå osynlig för chatt, agent, index och
hämtning:

- **Indexering:** `buildIndexableEntities` filtrerar bort låsta noter + deras ättlingar + uppgifter
  under låsta listor, INNAN embeddings lämnar enheten.
- **Hämtning:** kandidaterna är redan lås-filtrerade; GraphRAG-expansion begränsas till samma mängd.
- **Agent/chatt-verktyg:** `agentSearchNotes` hård-filtrerar; `get_note`/`get_task` nekar låsta.
- **Backend GraphQL** (agent/MCP-tool-yta): `Query.note/notes/task/tasks` grindade på
  `isReadableWithLocks` före dekryptering.
- Mekanisk grind: `scripts/check-index-unlock-leak.mjs` (+`--selftest`) i validate-critical + CI.

Full modell: [`../noter-app/docs/LOCKED_FOLDER_SECURITY.md`](../noter-app/docs/LOCKED_FOLDER_SECURITY.md).

---

## 8. Mot bransch-standard (online-research 2026)

| Standard | Källa | Noter |
|----------|-------|-------|
| Hybrid (sparse BM25-ish + dense) som RAG-baslinje | [AppScale](https://appscale.blog/en/blog/hybrid-search-and-reranking-production-rag-bm25-dense-cross-encoder-2026), [Superlinked](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking) | ✅ lexikal+vektor |
| RRF för fusion (rang, inte score) | samma | ✅ k=60 |
| Rerank-steg ovanpå fusion | samma | ✅ regel-baserad (query-medveten); **kvar:** cross-encoder |
| Lagra provider+modell+dimension, re-embed vid byte | [Qdrant/Pappas](https://medium.com/@epappas/dealing-with-vector-dimension-mismatch-my-experience-with-openai-embeddings-and-qdrant-vector-20a6e13b6d9f) | ✅ (2026-06-19) |
| On-device/lokala embeddings för privacy | [EmbeddingGemma](https://developers.googleblog.com/en/introducing-embeddinggemma/) | ✅ local/hermes default |
| Query-embedding-cache (skär latens+kostnad) | [Redis/RAG-caching](https://redis.io/blog/10-techniques-to-improve-rag-accuracy/) | ✅ LRU per provider\|model\|hash (2026-06-19) |
| "Retrieval är ett verktygsanrop" (agentic RAG) | [arXiv 2501.09136](https://arxiv.org/abs/2501.09136) | ✅ `search_notes` (2026-06-19) |
| Stoppvillkor/budget för agent-loopar | samma | ✅ maxSteps + tokenBudget + run-budget |

**Avvikelser (medvetna, för en local-first klient):** ingen vektor-DB (cosine är O(n) i minnet —
bra för <5k noter); regel-baserad rerank (inte cross-encoder); ingen webbsök (privacy). Se §10.

---

## 9. Tester & CI-grindar

**Blockerande CI-grind** `AI search & semantic retrieval — RAG correctness` (root `.github/workflows/ci.yml`)
kör 8 sviter / 84 tester: `vectorSearch` (cosine + dimensions-säkerhet, RRF k=60, hybrid),
`retrieval` (två-stegs recall+rerank+GraphRAG + **security**: lås-filtrering), `vectorStore`
(diff, modell-/**leverantörs-byte**, metadata/dims, **size-cap**, lås-grind), `embeddings`/
`embeddingsClient` (config, embeddingText, URL-normalisering, count-mismatch-throw), `graphModel`
(graf + fulltext), **`agentSearch`** (rankning + **3 lås-säkerhetstester**), `contextLevels`
(metod-grindar + webbsök-ej-annonserad). Samma sviter blockerar lokalt i
`scripts/validate-critical.mjs` ("Shared package tests").

---

## 10. Kända luckor / framtid (prioriterat)

- ✅ **Query-embedding-cache (KLAR 2026-06-19)** — `embedQuery` + delad `createLruCache`; en upprepad
  sökning/chatt-tur betalar inte om embedding-anropet.
- **Cross-encoder rerank** (on-device ONNX) i stället för regel-baserad — research (2026) pekar på
  +5–15 NDCG, MEN kräver en reranker-modell (MiniLM/BGE) + `onnxruntime` på web + RN + tokenizer.
  **Medvetet uppskjutet:** tung ny dependency som inte kan valideras i CI, kostsam på mobil, och
  passar inte "skriv inte onödig kod" att lägga in spekulativt. Den nuvarande regel-baserade
  reranken (coverage/titel/exakt fras/densitet) är ett solitt mellansteg. Beslut krävs om
  modell-nedladdning + minnesbudget innan det byggs.
- **Hybrid för agenten** — `search_notes` är lexikal+rerank (offline, gratis); en djup-nivå-variant
  kunde skicka en query-vektor (via cachen ovan) för full hybrid. Inkrementellt; kopplar agent-
  executor till embeddings-tjänsten — uppskjutet tills värdet motiverar kopplingen.
- **Vektor-DB / HNSW för skala** — cosine är O(n) i minnet; bra för <5k noter (ett par ms). Vid
  10k+ vill man ha HNSW/en vektor-DB för O(log n). Uppskjutet (för tidigt för målgruppen; undvik
  onödig kod).
- **Webbsök** — reserverad; kräver en sökleverantör + medvetet privacy-beslut.

Spårat i [`forward-roadmap-2026-06.md`](./forward-roadmap-2026-06.md) (RAG-sektionen).

---

## 11. Var koden bor (citat)

| Komponent | Fil |
|-----------|-----|
| Två-stegs-hämtning | `packages/shared/src/retrieval.ts` (`retrieveContext`, `rerankScore`) |
| Vektor + RRF + hybrid | `packages/shared/src/vectorSearch.ts` |
| Graf + fulltext | `packages/shared/src/graphModel.ts` |
| Index-bokföring (diff, metadata, size-cap) | `packages/shared/src/vectorStore.ts` |
| Embeddings-config + text | `packages/shared/src/embeddings.ts` |
| Embeddings HTTP-klient | `packages/shared/src/embeddingsClient.ts` |
| Agentens sökverktyg | `packages/shared/src/agentSearch.ts` |
| Kontextnivåer (metod-grindar) | `packages/shared/src/contextLevels.ts` |
| Indexering + chat-hämtning (tjänst) | `apps/{web,mobile}/services/ai/embeddingsService.ts` |
| Auto-index | `apps/{web,mobile}/services/ai/autoIndex.ts` |
| Embeddings-inställningar (källa/modell-UI) | `apps/{web,mobile}/components/EmbeddingsSettings.tsx` |
| Agent-executor (verktyg) | `apps/{web,mobile}/services/ai/agentExecutor.ts` |
| Chatt + RAG-kontroller | `apps/web/components/AISidebar.tsx`, `apps/mobile/app/(tabs)/ai.tsx` |
| Leverantörsregister + pipeline-detaljer | [`ai-retrieval-rag.md`](./ai-retrieval-rag.md) |
