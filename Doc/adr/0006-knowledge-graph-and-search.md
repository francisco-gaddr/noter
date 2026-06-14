# ADR 0006 — Knowledge graph + layered search (RRF / GraphRAG roadmap)

Status: Accepted (foundation) · Date: 2026-06-14

## Context

We want notes, project folders, task-lists and tasks shown as a clickable **graph
of nodes with statistics**, with the relations configurable in plain JSON ("own
graph database"), and **everything searchable** — fulltext + vector + graph — so
the AI can route from cheap fast lookups up to deep GraphRAG. It must be
encrypted, optimised, run on a configurable device, and drive productivity stats
for the user and the AI agents, from mobile and Electron.

This is a large, multi-phase capability. This ADR records the **foundation that
is built now** and the **phased plan** for the heavier layers, so the work lands
incrementally without churn.

## Decision

### Phase 1 — shared graph data layer + fast search (DONE)

`@repo/shared/graphModel`:
- `buildGraph(notes, tasks, config?)` derives `GraphData` (nodes + edges) from the
  EXISTING parent links — `note.parentId → project/list`, `task.parentNoteId →
  list`, `task.parentId → subtask` — with per-node stats (children, open/completed
  task counts). `GraphConfig` (plain JSON: `{ include, relations }`) is the "own
  graph database" knob — choose which entity kinds + relations appear.
- `fulltextSearch(notes, tasks, query, limit)` — the cheapest search rung
  ("blixtsnabb fritextsök"): pure, synchronous, weighted token scoring (title >
  body). This is what context-level `fast` uses. Decrypt content before passing
  in — search runs on plaintext in memory, never on the server.

Pure + unit-tested; reused identically by mobile + Electron. The platform graph
VIEW renders `buildGraph` output and opens the entity on node click.

### Phase 2 — interactive graph view (next)

Render `GraphData` with a maintained OSS library. Chosen direction (June 2026,
verified against the projects' own docs/licences):
- **Web/Electron**: `cytoscape.js` (MIT) — mature, performant, rich layouts,
  click/zoom; or `react-force-graph` (MIT) for a force layout. Both are local, no
  service.
- **Mobile (RN)**: render the same `GraphData` in a WebView-hosted cytoscape (one
  shared HTML renderer) to avoid a second graph engine and keep parity, OR
  `react-native-skia` for a native force layout if WebView feels heavy. Decision
  gated on a perf spike so we don't slow the app.

Nodes carry `stats`, so the view shows counts inline. Click → existing deep-link
to the entity screen (the deep-link router already exists on both platforms).

### Phase 3 — vector + GraphRAG search, fused with RRF (next)

- **Embeddings**: text-embeddings via a free/open model. Where it runs is a
  setting (orchestration): on-device (the local MLC/llama runtime we already
  ship), on the Pi backend (its Ollama can embed), or a chosen API. Vectors are
  stored encrypted (the same v3 envelope) next to each entity.
- **Hybrid retrieval**: dense (vector) + sparse (BM25/fulltext) + graph expansion
  (walk edges from top hits = GraphRAG), then **Reciprocal Rank Fusion (RRF)** to
  merge the ranked lists into one. RRF is parameter-light and robust — the right
  default for fusing heterogeneous rankers.
- **Routing**: the existing **context levels** already gate which rungs are
  allowed (minimal → none, fast → fulltext, standard → fulltext, deep → +vector +
  graph). The router always tries the cheapest rung first and escalates only when
  needed, honouring the user's level.
- **Where it runs**: a single orchestration setting picks the device for indexing
  + retrieval (on-device / Pi backend / API), mirroring the agent's `source`.
- **Storage**: for a server-side graph/vector store, evaluate `Neo4j` (graph) +
  its vector index, or a lighter embedded option (sqlite-vec / pgvector) to avoid
  a heavy new dependency on the Pi. Decision gated on a footprint spike (the Pi is
  resource-constrained — see the deploy memory).

### Phase 4 — productivity statistics & self-tuning (next)

Build on the existing `insights` + the graph stats: per-user and per-agent
dashboards (throughput, completion rate, where the agent spends steps), surfaced
from the shared insights module so mobile + Electron render the same numbers. The
agent can read these to self-tune (which model/level for which work).

## Consequences

- Phase 1 ships real value now (a correct, tested graph model + fast search) and
  is the contract every later phase builds on — no rework.
- The heavier layers (interactive view, embeddings, GraphRAG, Neo4j) are scoped as
  follow-on phases with explicit library choices + perf gates, so they land
  cleanly as the budget allows rather than as a risky big-bang.
- Everything stays encrypted and device-configurable, consistent with the agent
  architecture (ADR 0005) and the crypto model (ADR 0001).
