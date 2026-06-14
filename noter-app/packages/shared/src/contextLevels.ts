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
