/**
 * Lock-safe note/task search for the AI AGENT's `search_notes` tool.
 *
 * Until now the agent could only `list_*`/`get_*` — it had no way to SEARCH, so it had to pull
 * whole lists and filter in-prompt (slow, token-heavy, and it misses semantic-ish lexical matches).
 * The 2026 agentic-RAG standard is "retrieval is a tool call" — give the agent a search tool.
 *
 * This reuses, rather than re-implements, two existing pieces:
 *   - the SAME lock guard the embeddings index uses (`buildIndexableEntities` with the EMPTY unlock
 *     set) — so a locked note/task can never surface to the agent, even one the user has open in
 *     the UI; and
 *   - the SAME two-stage retrieval the chat uses (`retrieveContext`: lexical recall + query-aware
 *     rerank). No embedding call is made (useVector:false), so the agent's search works offline, on
 *     every model, with zero extra cost or network — a robust default. (A future deep-level variant
 *     could pass a query vector for hybrid search.)
 */
import type { Note, Task } from './types';
import { buildIndexableEntities } from './vectorStore';
import { retrieveContext } from './retrieval';
import { AI_INDEX_NO_UNLOCK } from './locks';

export interface AgentSearchHit {
  id: string;
  kind: string;
  title: string;
  snippet: string;
}

/**
 * Search the user's readable notes + tasks for the agent. Pass the RAW store notes/tasks — this
 * function does the lock-filtering itself (empty unlock set), so a caller can't accidentally widen
 * what the agent sees. Returns up to `limit` hits, ranked best-first.
 */
export const agentSearchNotes = (
  notes: Note[],
  tasks: Task[],
  query: string,
  limit = 8,
): AgentSearchHit[] => {
  const q = (query || '').trim();
  if (!q) return [];
  const entities = buildIndexableEntities(notes || [], tasks || [], AI_INDEX_NO_UNLOCK as Set<string>);
  const candidates = entities.map((e) => ({ id: e.id, kind: e.kind, title: e.title, text: e.body }));
  const items = retrieveContext({
    query: q,
    candidates,
    options: {
      limit: Math.min(20, Math.max(1, Math.floor(limit) || 8)),
      useVector: false, // lexical + rerank only — no embedding call needed for the agent's search
      useGraphExpansion: false,
      useRerank: true,
    },
  });
  return items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, snippet: (i.text || '').slice(0, 160) }));
};
