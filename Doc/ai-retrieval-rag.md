# AI-leverantörer + två-stegs RAG-hämtning (semantisk · GraphRAG · rerank)

_Senast uppdaterat: 2026-06-16 · Gäller mobil + Electron/web._

Det här dokumentet beskriver två saker som levererades ihop 2026-06-16:

1. **Tre nya AI-API-leverantörer** — OpenAI, Anthropic och xAI Grok — vid sidan av de
   befintliga (OpenRouter, Groq, Gemini, Hermes/Ollama + egna).
2. **Äkta två-stegs RAG-hämtning** (2026 års standard): bred recall (lexikal + vektor →
   RRF) → valfri **GraphRAG**-expansion → **rerank**, kopplad in i AI-chatten med
   per-steg-inställningar.

Båda finns i mobil **och** Electron/web (paritetsdirektivet). Allt är lås-medvetet:
låst innehåll når aldrig vare sig en leverantör eller en hämtning.

---

## Del 1 — AI-API-leverantörer

### Registret (en källa till sanning)

`apps/{mobile,web}/services/ai/apiProviders.ts` har ett `API_PROVIDERS`-register. Varje
post: `id`, `label`, `endpoint`, `apiKeyUrl`, `defaultModels` och ett **`format`-fält**.

`format` (`'openai' | 'gemini' | 'anthropic'`) styr en **format-FÖRST**-gren. Tidigare
härleddes formatet ur `endpoint` (`endpoint ? openai : gemini`) — det var fel så fort
Anthropic kom in, eftersom Anthropic *har* en endpoint men ett annat API. Nu väljer
`providerFormat(meta)` gren på `format`, inte på endpoint.

| Leverantör | `format` | Endpoint | Auth |
|------------|----------|----------|------|
| OpenRouter | openai | `openrouter.ai/api/v1/chat/completions` | Bearer |
| Groq | openai | `api.groq.com/openai/v1/chat/completions` | Bearer |
| **OpenAI** | openai | `api.openai.com/v1/chat/completions` | Bearer |
| **xAI Grok** | openai | `api.x.ai/v1/chat/completions` | Bearer |
| Gemini | gemini | `…/v1beta/models/…:generateContent` | nyckel i URL |
| **Anthropic** | anthropic | `api.anthropic.com/v1/messages` | `x-api-key` |
| Hermes (Ollama/llama.cpp/LM Studio/vLLM) | openai | egen bas-URL → `/v1/chat/completions` | valfri |

OpenAI + Grok **återbrukar OpenAI-vägen** rakt av (samma body, Bearer, samma SSE-delta).
Bara Gemini och Anthropic har egna grenar.

### Anthropic-grenen (det enda genuint nya API:t)

Anthropic Messages API skiljer sig från OpenAI på flera punkter, alla hanterade i
`apiProviders.ts`:

- **Headers:** `x-api-key`, `anthropic-version: 2023-06-01`, och
  `anthropic-dangerous-direct-browser-access` (krävs för direkta anrop från en webbläsare).
- **`system` är ett toppnivåfält**, inte ett meddelande — `toAnthropicMessages` lyfter ut
  alla system-meddelanden och skickar resten som `messages`.
- **`max_tokens` är obligatoriskt** (`ANTHROPIC_MAX_TOKENS = 4096`).
- **Innehållsblock:** text blir `{ type: 'text', text }`; bilder blir
  `{ type: 'image', source: { type: 'base64', media_type, data } }`.
- **SSE:** `anthropicDelta` läser `content_block_delta` → `text_delta`; `anthropicUsage`
  läser `input_tokens` ur `message_start` och `output_tokens` ur `message_delta`
  (`sseParser.ts`).

### Persistens, nycklar, gränser

- **Nycklar/modeller** sparas krypterat lokalt per användare. Nya `settingsScope`-nycklar:
  säkra `ai_{openai,anthropic,grok}_key`, samt `ai_{openai,anthropic,grok}_model` och
  `ai_retrieval_settings` (se Del 2). Web speglar via `setStoredValue`/`encrypt`.
- **Usage/limits:** `usageTracker.PROVIDER_LIMITS` **måste** ha en post per leverantör
  (betalda → `{ callsPerDay: null, tokensPerDay: null }`) annars failar tsc på den
  `Record`-typade tabellen.
- **Mobil är generisk** (`apiProviderBindings` + `activeBinding`), så menyn + nyckel/modell-
  fälten plockar upp nya leverantörer automatiskt. **Web `AISidebar.tsx`** hade explicita
  switch-grenar (`getActiveModel`, `resolveApiProviderConfig`) + ett generiskt
  nyckel/modell-block — alla tre tillagda där.

### CORS-varning (endast web)

Direkta webbläsaranrop till OpenAI/Anthropic kan blockeras av CORS. **Mobil och Electron
är opåverkade** (ingen webbläsar-origin). På web är de mest robusta källorna fortfarande
OpenRouter, Groq, Gemini eller en egen Hermes/Ollama-server.

### Lägga till ännu en leverantör

Lägg till i `ApiProviderType` + `API_PROVIDERS` (med rätt `format`), en
`PROVIDER_LIMITS`-post, och — om den inte passar i OpenAI/Gemini/Anthropic-formaten — en
ny gren i `generateApiProviderResponse`/`streamApiProviderResponse` + en `*Delta`-parser.
Mobil-UI:t följer med via bindings; web behöver en switch-gren. Tester:
`api-providers.test.ts` (båda apparna).

---

## Del 2 — Två-stegs RAG-hämtning

### Varför

2026 års standard för retrieval är **two-stage**: hämta brett (hög recall, billigt) och
**rerank** sedan toppen (hög precision). Reranking är den enskilt mest verkningsfulla
komponenten — den gör skillnaden mellan "ungefär rätt dokument" och "rätt dokument
överst". Innan detta hade vi vektor + RRF-hybridsök (semantisk sök), men ingen rerank och
ingen graf-expansion i chatten.

### Den delade pipelinen (`packages/shared/src/retrieval.ts`)

Ren, ES5-säker (INGEN `u`-flagga / `\p{}` — det bryter den delade tsc-bygget), helt
enhetstestad (`retrieval.test.ts`, 9 tester). Beror inte på de tunga `Note`/`Task`-typerna
— den arbetar på enkla `RetrievalCandidate` + en injicerbar `getNeighbors`, vilket gör
hela kedjan (inkl. lås-säkerheten) testbar.

```ts
retrieveContext({ query, queryVector, candidates, getNeighbors, options }): RetrievedItem[]
renderRetrievedContext(items, maxChars = 4000): string
```

`RetrievalCandidate { id, kind, title, text, vector? }` ·
`RetrievedItem { id, kind, title, text, score, via[] }` (`via` = provenans:
`'fulltext' | 'vector' | 'graph'`).

**Steg 1 — bred recall.**
- *Lexikal* (`lexicalScore`, BM25-aktig): titel-träff väger 3×, body 1×, med
  längd-normalisering så långa noter inte dominerar.
- *Dense* (cosine mot `queryVector`) — bara om kandidaterna har vektorer.
- De två rangordnade listorna slås ihop med **Reciprocal Rank Fusion** (`rrfK = 60`,
  branschstandard). Degraderar elegant när en rung saknas.

**Steg 1.5 — GraphRAG (valfri).** Ta topp-fröna, samla deras grafgrannar via
`getNeighbors` (wire:a till `neighborsOf(buildGraph(...))`), och slå in dem som en tredje
RRF-lista. **Säkerhetsgräns:** en granne tas bara med om den redan finns bland
kandidaterna (`byId.has(nid)`) — en granne som inte är en kandidat (t.ex. en låst not)
ytförs aldrig. Detta är testat.

**Steg 2 — rerank (valfri, på som default).** `rerankScore` är en beroendefri,
fråge-medveten precision-omvärdering över hela texten:

```
coverage*2.5 + titleCoverage*1.5 + exactPhrase*1.0 + min(density,1)*0.5
```

- `coverage` — andel *distinkta* frågetermer som finns (starkaste signalen)
- `titleCoverage` — distinkta frågetermer i titeln
- `exactPhrase` — exakt frågefras förekommer (för frågor ≥ 3 tecken)
- `density` — termträffar per 100 tokens (koncentration)

En riktig cross-encoder kan ersätta den **bakom samma gränssnitt** utan att röra anroparna.

**Per-steg-toggles** (`RetrievalOptions`): `useFulltext` / `useVector` /
`useGraphExpansion` / `useRerank` / `limit` (default 8) / `candidatePool` (default 50) /
`rrfK`.

`renderRetrievedContext` → ett avgränsat, taggat promptblock (begränsat till `maxChars`).

### Inkoppling i chatten (`embeddingsService.ts`, båda apparna)

`retrieveForChat(query, notes, tasks, unlockedIds, opts, signal): Promise<string>`:

1. Bygger kandidater via **`buildIndexableEntities`** (den enda lås-grinden — endast
   läsbara noter/uppgifter; låsta noter och låsta-projekt-ättlingar filtreras bort innan
   någon text lämnar enheten).
2. Hämtar frågevektorn + per-id-vektorer ur det krypterade indexet (om semantisk sök är
   aktiverad); annars körs lexikal-only.
3. Wire:ar `neighborsOf` för GraphRAG när det är på.
4. Returnerar det renderade lås-säkra blocket — eller `''` om inget är relevant. Kastar
   aldrig.

Chatten **prepend:ar** blocket som ett system-meddelande före generering, så modellen får
relevant egen-kontext utan att något läcker.

### Inställningar i AI-chatten

En sektion **"Semantisk kontext (RAG)"** i båda apparna med tre växlar, persisterade
krypterat (`ai_retrieval_settings` mobil / `aiRetrievalSettings` web):

| Växel | Effekt |
|-------|--------|
| **Aktivera** (`enableSemantic`) | Slår på hämtning över huvud taget (av → ingen RAG) |
| **GraphRAG** (`enableGraphRAG`) | Expanderar topp-träffar med grafgrannar |
| **Rerank** (`enableRerank`, på som default) | Steg-2-omvärdering av toppen |

Semantisk vektor-rung kräver att embeddings-indexet är konfigurerat (se
[`graph-explorer.md`](./graph-explorer.md) → semantisk sök). Utan index körs RAG ändå
lexikalt + (om vald) graf.

### Säkerhet — sammanfattning

- Kandidater = endast läsbar mängd (`buildIndexableEntities`). Ingen rung — lexikal,
  vektor eller grafgranne — kan ytföra en låst not.
- Hämtning körs på **avkrypterad data i minnet på enheten**; inget skickas till servern
  för att hämta. (Embeddings-källan rekommenderas vara on-device/Pi-Ollama så även
  indexering håller innehållet borta från tredje part.)
- Det renderade blocket går bara in i modellens prompt-historik — det lagras aldrig.

Detta speglar samma princip som skyddar grafvyn och AI-agenterna
([`security/ai-locked-notes.md`](./security/ai-locked-notes.md)).

---

## Var koden bor

| Del | Plats |
|-----|-------|
| Leverantörsregister + format-grenar | `apps/{mobile,web}/services/ai/apiProviders.ts` |
| SSE-parsers (inkl. `anthropicDelta`/`anthropicUsage`) | `apps/{mobile,web}/services/ai/sseParser.ts` |
| Usage-gränser | `apps/{mobile,web}/services/ai/usageTracker.ts` |
| Två-stegs RAG-pipeline (ren) | `packages/shared/src/retrieval.ts` (+ `retrieval.test.ts`) |
| Chat-hämtning (IO + lås-grind) | `apps/{mobile,web}/services/ai/embeddingsService.ts` |
| Mobil-UI (leverantörer + RAG-växlar) | `apps/mobile/app/(tabs)/ai.tsx` |
| Web-UI (leverantörer + RAG-växlar) | `apps/web/components/AISidebar.tsx` |
| Settings-scope-nycklar | `apps/mobile/services/ai/settingsScope.ts` |

Beslut: [`adr/0010-two-stage-rag-retrieval.md`](./adr/0010-two-stage-rag-retrieval.md)
(fullföljer ADR 0006 Fas 3). Relaterat: [`graph-explorer.md`](./graph-explorer.md)
(graf + semantisk sök), [`security/ai-locked-notes.md`](./security/ai-locked-notes.md).
