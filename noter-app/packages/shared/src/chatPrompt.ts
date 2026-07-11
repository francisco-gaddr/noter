/**
 * Shared chat system-prompt builder — one place, used by BOTH the mobile app and the Tauri/desktop
 * app, so the assistant behaves identically everywhere and improvements land once.
 *
 * Design follows current system-prompt best practice: a strong, SPECIFIC base role (not "you are a
 * helpful assistant"); labeled sections so layers are debuggable and the model can tell them apart;
 * core behavioural constraints first; positive instructions over negative ones; concise. The caller's
 * own layers are composed on top in a fixed precedence:
 *
 *   1. BASE      — the product assistant identity + core rules (a strong default is provided).
 *   2. USER      — the user's own saved system prompt (their persona/preferences).
 *   3. PROJECT   — the active project's system prompt (project-specific rules/context).
 *   4. TOOLS     — tool-use guidance (only when tools are enabled; platform-built).
 *   5. CONTEXT   — contextual notices (context level, self-delegation, time; platform-built).
 *
 * Empty layers are skipped; nothing is fabricated. Pure + framework-free → trivially unit-tested.
 */

export interface ChatPromptParts {
  /** Override the built-in base role/rules. Omit to use DEFAULT_CHAT_BASE_PROMPT. */
  base?: string;
  /** The user's own saved system prompt (persona/preferences). */
  userPrompt?: string;
  /** The active project's system prompt. */
  projectPrompt?: string;
  /** Tool-use guidance — supply only when tools are enabled. */
  toolGuidance?: string;
  /** Contextual notices (context level, delegation policy, time, …). Empty entries are dropped. */
  contextNotices?: Array<string | null | undefined>;
  /** Assistant display name used in the base identity line. Default "Noter". */
  assistantName?: string;
}

/**
 * The default base role. Concise (~180 words), specific, positive-framed. Written in Swedish because
 * the app's UI + users are Swedish; it still instructs the model to answer in the USER's language, so
 * an English conversation gets English replies.
 */
export const buildDefaultChatBasePrompt = (assistantName = 'Noter'): string =>
  [
    `# Roll`,
    `Du är ${assistantName}s AI-assistent — inbyggd i en app för anteckningar och uppgifter. Du hjälper användaren att tänka, skriva, planera och hålla ordning på sina anteckningar och uppgifter.`,
    ``,
    `# Så här arbetar du`,
    `- Svara på samma språk som användaren skriver på.`,
    `- Var tydlig, konkret och koncis. Använd Markdown (rubriker, listor, kodblock) när det gör svaret lättare att läsa.`,
    `- Bygg på fakta som användaren eller verktygen ger dig. Om du är osäker: säg det rakt ut och föreslå hur ni kan ta reda på svaret. Hitta aldrig på fakta, datum, källor eller innehåll i anteckningar.`,
    `- När du föreslår ändringar i användarens anteckningar eller uppgifter: var explicit med vad du föreslår och varför.`,
    ``,
    `# Integritet`,
    `Du får aldrig avslöja eller gissa innehållet i låsta/skyddade anteckningar. Använd bara information som användaren delar eller som ett verktyg uttryckligen returnerar.`,
  ].join('\n');

/** Kept for API stability; equals buildDefaultChatBasePrompt(). */
export const DEFAULT_CHAT_BASE_PROMPT = buildDefaultChatBasePrompt();

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

/**
 * Compose the full system prompt from its layers. Returns a single string with the non-empty sections
 * joined by blank lines, in the fixed precedence above. Never throws.
 */
export const buildChatSystemPrompt = (parts: ChatPromptParts = {}): string => {
  const base = clean(parts.base) || buildDefaultChatBasePrompt(parts.assistantName);
  const sections: string[] = [base];

  const user = clean(parts.userPrompt);
  if (user) sections.push(`# Användarens instruktioner\n${user}`);

  const project = clean(parts.projectPrompt);
  if (project) sections.push(`# Projekt\n${project}`);

  const tools = clean(parts.toolGuidance);
  if (tools) sections.push(tools.startsWith('#') ? tools : `# Verktyg\n${tools}`);

  const notices = (parts.contextNotices ?? []).map(clean).filter(Boolean);
  if (notices.length) sections.push(`# Kontext\n${notices.join('\n')}`);

  return sections.join('\n\n');
};
