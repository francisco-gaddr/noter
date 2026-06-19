/**
 * Context levels — how much of the user's data + which searches a model is allowed
 * to use for a given chat or AI task.
 *
 * The point: don't overload a model (and the user's time/cost) for a simple
 * question. Stepwise levels go from "just answer" to "full system search", and the
 * system ALWAYS prefers the cheapest level unless the user picks higher. One shared
 * source of truth so chat, the agent runner and orchestration all behave the same.
 */
export type ContextLevel = 'minimal' | 'fast' | 'standard' | 'deep';

export const CONTEXT_LEVELS: ContextLevel[] = ['minimal', 'fast', 'standard', 'deep'];
export const DEFAULT_CONTEXT_LEVEL: ContextLevel = 'standard';

export interface ContextLevelConfig {
  level: ContextLevel;
  /** Short label for the UI. */
  label: string;
  /** One-line description of what this level does. */
  description: string;
  /** Inject the list of project folders + task-lists into the system prompt. */
  includeContainers: boolean;
  /** Allow read tools (list and get) so the model can pull data on demand. */
  allowReadTools: boolean;
  /** Allow write/mutation tools (create, update, complete). */
  allowWriteTools: boolean;
  /** Allow fast local fulltext search over the user's content. */
  allowFulltextSearch: boolean;
  /** Allow a web search step. */
  allowWebSearch: boolean;
  /** Allow the heavier vector + graph (GraphRAG) search. */
  allowVectorSearch: boolean;
  /** Cap on injected/returned context items to keep prompts cheap. */
  maxContextItems: number;
}

const CONFIGS: Record<ContextLevel, ContextLevelConfig> = {
  minimal: {
    level: 'minimal', label: 'Snabbt svar', description: 'Bara svara — ingen databasinsyn eller sökning.',
    includeContainers: false, allowReadTools: false, allowWriteTools: false,
    allowFulltextSearch: false, allowWebSearch: false, allowVectorSearch: false, maxContextItems: 0,
  },
  fast: {
    level: 'fast', label: 'Lätt', description: 'Snabb fritextsökning + verktyg vid behov, ingen tung sökning.',
    includeContainers: false, allowReadTools: true, allowWriteTools: true,
    allowFulltextSearch: true, allowWebSearch: false, allowVectorSearch: false, maxContextItems: 10,
  },
  standard: {
    level: 'standard', label: 'Standard', description: 'Mappar/listor i kontext + verktyg + fritextsök (rekommenderat).',
    includeContainers: true, allowReadTools: true, allowWriteTools: true,
    allowFulltextSearch: true, allowWebSearch: false, allowVectorSearch: false, maxContextItems: 50,
  },
  deep: {
    level: 'deep', label: 'Djup', description: 'Full systemkontext + webbsök + vektor/graf-sök (långsammare, dyrare).',
    includeContainers: true, allowReadTools: true, allowWriteTools: true,
    allowFulltextSearch: true, allowWebSearch: true, allowVectorSearch: true, maxContextItems: 200,
  },
};

/** Resolve a (possibly invalid) level string to its config; defaults to standard. */
export const contextLevelConfig = (level?: ContextLevel | string | null): ContextLevelConfig =>
  CONFIGS[(level as ContextLevel)] ?? CONFIGS[DEFAULT_CONTEXT_LEVEL];

/** Normalize an arbitrary value to a valid ContextLevel (default standard). */
export const normalizeContextLevel = (value?: unknown): ContextLevel =>
  CONTEXT_LEVELS.includes(value as ContextLevel) ? (value as ContextLevel) : DEFAULT_CONTEXT_LEVEL;

/** Ordinal rank of a level (minimal=0 … deep=3); unknown → standard's rank. */
export const contextLevelRank = (level?: unknown): number =>
  CONTEXT_LEVELS.indexOf(normalizeContextLevel(level));

/**
 * Does `current` meet a per-source minimum level? An undefined/empty `min` always passes.
 * Gates whether a synced source's notes are eligible for retrieval at the chat's current
 * context level (e.g. a heavy archive only included on 'deep').
 */
export const meetsMinContextLevel = (current?: unknown, min?: unknown): boolean => {
  if (min === undefined || min === null || min === '') return true;
  if (min === '__never__') return false; // source explicitly excluded from chat context
  return contextLevelRank(current) >= contextLevelRank(min);
};

/**
 * Short, human list of which capabilities a level grants — so the UI can show, in
 * plain terms, how "simple" vs "complex" a given context level makes the agent (the
 * single knob that scales the agent from a one-line answer to full system search).
 * `toolUse=false` (the per-task master switch) hard-disables read/write tools
 * regardless of level, which this reflects.
 */
export const summarizeToolPolicy = (
  level?: ContextLevel | string | null,
  toolUse = true,
): string[] => {
  const c = contextLevelConfig(level);
  const caps: string[] = [];
  if (c.allowReadTools && toolUse) caps.push('Läsa anteckningar/uppgifter');
  if (c.allowWriteTools && toolUse) caps.push('Skapa/ändra uppgifter');
  if (c.allowFulltextSearch) caps.push('Fritextsök');
  if (c.allowWebSearch) caps.push('Webbsök');
  if (c.allowVectorSearch) caps.push('Vektor/graf-sök');
  if (c.includeContainers) caps.push('Mappar/listor i kontext');
  if (caps.length === 0) caps.push('Endast svara (inga verktyg)');
  return caps;
};

export interface BoundHistoryOptions {
  /** Char budget for the WHOLE history (a cheap, model-agnostic token proxy ≈ 4 chars/token).
   *  Default 48000 chars ≈ 12k tokens — comfortably inside every supported provider's window. */
  maxChars?: number;
  /** Always keep at least this many of the most recent turns, even if over budget, so the
   *  immediate conversational context is never dropped. Default 6. */
  minRecentTurns?: number;
}

/**
 * Bound a chat history before it is sent to an API provider. A long thread otherwise resends
 * EVERY turn each request → it eventually exceeds the model's context window (a hard error) and
 * cost grows linearly with the conversation length. This keeps ALL leading system messages (the
 * persona + injected RAG/containers context) plus the most recent turns within a character budget
 * (a provider-agnostic token proxy), dropping only the OLDEST conversational turns. Short/normal
 * conversations are returned unchanged. To stay valid for providers that require the first
 * non-system turn to be `user` (Anthropic), any leading assistant/tool turn left after trimming
 * is dropped.
 */
export const boundChatHistory = <T extends { role: string; content?: string | null }>(
  messages: T[],
  opts: BoundHistoryOptions = {},
): T[] => {
  const maxChars = Math.max(1000, opts.maxChars ?? 48000);
  const minRecent = Math.max(1, opts.minRecentTurns ?? 6);
  const msgs = Array.isArray(messages) ? messages : [];
  // Leading system messages (persona/policy/context) are always preserved.
  let i = 0;
  while (i < msgs.length && msgs[i]?.role === 'system') i += 1;
  const systemPrefix = msgs.slice(0, i);
  const rest = msgs.slice(i);
  const charsOf = (m: T): number => (typeof m?.content === 'string' ? m.content.length : 0);
  let used = systemPrefix.reduce((s, m) => s + charsOf(m), 0);
  // Walk the conversational turns from newest to oldest, keeping within budget but never
  // fewer than minRecent turns.
  const kept: T[] = [];
  for (let j = rest.length - 1; j >= 0; j -= 1) {
    const within = used + charsOf(rest[j]) <= maxChars;
    if (within || kept.length < minRecent) { kept.push(rest[j]); used += charsOf(rest[j]); }
    else break;
  }
  kept.reverse();
  // Keep the history valid for first-must-be-user providers.
  while (kept.length > 1 && kept[0]?.role !== 'user') kept.shift();
  return [...systemPrefix, ...kept];
};
