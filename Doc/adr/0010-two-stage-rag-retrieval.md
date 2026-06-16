# ADR 0010 — Två-stegs RAG-hämtning (rerank) + leverantörs-format-diskriminator

Status: Accepted · Date: 2026-06-16 · Fullföljer: [ADR 0006](0006-knowledge-graph-and-search.md) Fas 3

## Context

ADR 0006 ritade upp en faserad sök-roadmap: fritext (Fas 1, klar), vektor + RRF (levererad
som semantisk sök 2026-06-14), och **GraphRAG + fusion** som mål. Det som saknades för att
nå 2026 års retrieval-standard var två saker:

1. **Rerank.** Branschpraxis i juni 2026 är *two-stage retrieval*: hämta brett (hög recall,
   billigt) och **rerank** sedan topp-N (hög precision). Reranking är den enskilt mest
   verkningsfulla komponenten i en RAG-kedja. Vi hade recall (vektor+RRF) men ingen rerank.
2. **GraphRAG i själva chatten.** Vi hade en graf och vi hade vektorsök, men chatten
   injicerade inte hämtad, graf-expanderad kontext i prompten — och absolut inte
   lås-säkert.

Samtidigt lade vi till tre AI-API-leverantörer (OpenAI, Anthropic, xAI Grok). Anthropics
Messages API tvingade fram ett arkitekturval i leverantörslagret (se Beslut 2).

## Decision

### 1. En delad, ren två-stegs pipeline (`packages/shared/src/retrieval.ts`)

`retrieveContext({ query, queryVector, candidates, getNeighbors, options })`:

- **Steg 1 (recall):** lexikal (BM25-aktig, titel 3×) + dense (cosine), sammanslaget med
  **Reciprocal Rank Fusion** (`k = 60`). Degraderar när en rung saknas.
- **Steg 1.5 (GraphRAG, valfri):** expandera topp-frön med grafgrannar via injicerad
  `getNeighbors`, fusionerad som en tredje RRF-lista.
- **Steg 2 (rerank, default på):** beroendefri, fråge-medveten precision-omvärdering
  (`coverage*2.5 + titleCoverage*1.5 + exactPhrase*1.0 + min(density,1)*0.5`).

Designval:

- **Beroendefri rerank nu, cross-encoder sen.** Vi väljer en feature-baserad reranker
  framför att dra in en tung cross-encoder/ONNX-modell. Den är snabb, körs på alla enheter,
  och ligger **bakom samma gränssnitt** — en riktig cross-encoder kan ersätta `rerankScore`
  utan att röra någon anropare. Detta är medvetet en Fas-3-leverans, inte slutstation.
- **Frikopplad från Note/Task.** Pipelinen tar `RetrievalCandidate` + en injicerbar
  `getNeighbors`, inte de tunga domäntyperna. Det gör hela kedjan — inklusive
  lås-säkerhetsgränsen — enhetstestbar (`retrieval.test.ts`, 9 tester).
- **ES5-säker.** Ingen regex `u`-flagga / `\p{}`; det skulle bryta den delade tsc-bygget.
  Tokenizern listar svenska + vanliga accenttecken explicit.

### 2. Leverantörs-format-diskriminator (`format`-fält)

Leverantörsregistret får ett `format`-fält (`'openai' | 'gemini' | 'anthropic'`) som styr
en **format-FÖRST**-gren. Den tidigare härledningen (`endpoint ? openai : gemini`) var
felaktig så fort Anthropic kom in: Anthropic *har* en endpoint men ett helt annat kontrakt
(`/v1/messages`, `x-api-key` + `anthropic-version`, `system` som toppnivåfält, obligatoriskt
`max_tokens`, content-block-streaming). OpenAI + xAI Grok är OpenAI-kompatibla och
återbrukar OpenAI-vägen oförändrat.

### 3. Lås-säker inkoppling i chatten

`retrieveForChat` i varje apps `embeddingsService.ts` bygger kandidater **enbart** ur
`buildIndexableEntities` (den befintliga lås-grinden), hämtar lås-säker kontext och
renderar ett avgränsat block som chatten prepend:ar som system-meddelande. Per-steg-växlar
("Semantisk kontext (RAG)": aktivera / GraphRAG / rerank) persisteras krypterat.

## Consequences

- **Vi når 2026-standarden** (two-stage med rerank + GraphRAG-fusion) utan en tung ny
  ML-beroende — och med en ren uppgraderingsväg till en cross-encoder bakom samma
  gränssnitt.
- **Säkerheten är bevisad, inte påstådd.** Eftersom hämtningen bara ser caller-filtrerade
  kandidater kan ingen rung ytföra en låst not; ett dedikerat test verifierar att en låst
  granne aldrig dyker upp. Konsekvent med ADR 0001 (krypto) och `ai-locked-notes`.
- **Leverantörslagret är nu format-drivet**, vilket gör framtida API:er (med egna kontrakt)
  till en ny gren snarare än en endpoint-gissning.
- **Web har en CORS-begränsning** för direkta OpenAI/Anthropic-anrop; mobil + Electron är
  opåverkade. Dokumenterat i [`../ai-retrieval-rag.md`](../ai-retrieval-rag.md).
- Kvar (medvetet): cross-encoder-rerank, server-side embeddings (i dag on-device per E2E),
  och auto-index-trigger (manuell "Indexera nu" finns).

Plan + detaljer: [`../ai-retrieval-rag.md`](../ai-retrieval-rag.md).
