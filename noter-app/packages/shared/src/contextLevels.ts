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
