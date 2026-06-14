/**
 * Human-readable, transparent descriptions of an AI tool step — the single source of
 * truth both chats (web AISidebar + mobile ai.tsx) use to render the tool-use cards.
 *
 * The cards used to show raw "Tool call: create_task {json}" (or looked empty), which
 * told the user nothing. This module turns a tool + its arguments/result into a short
 * Swedish phrase with a symbol category ("Sökte…", "Läste anteckning: X", "Skapade
 * uppgift: Y", "Anropade en annan AI-agent") for the collapsed one-liner, while the
 * full args/result stay available on expand. Pure + unit-tested; platforms only map
 * `category` → their own icon set (SVG on web, FontAwesome on mobile).
 */

export type ToolMsgKind = 'call' | 'result' | 'error' | 'tool';
export interface ParsedToolMessage {
  kind: ToolMsgKind;
  tool: string;
  /** Raw trailing text after "Tool call:/result:/error: <tool>". */
  details: string;
  /** Parsed JSON payload when the details were JSON, else null. */
  payload: any;
}

/** Parse a stored tool message ("Tool call: <tool> <json>") into its parts. */
export const parseToolMessage = (content: string): ParsedToolMessage => {
  const m = /^Tool (call|result|error):\s*([^\s]+)\s*([\s\S]*)$/.exec(content || '');
  if (!m) return { kind: 'tool', tool: 'tool', details: content || '', payload: null };
  const kind = (m[1] === 'call' ? 'call' : m[1] === 'result' ? 'result' : 'error') as ToolMsgKind;
  const details = (m[3] || '').trim();
  let payload: any = null;
  try { payload = details ? JSON.parse(details) : null; } catch { payload = null; }
  return { kind, tool: m[2], details, payload };
};

/** What kind of thing a tool touches — drives the card icon + colour. */
export type ToolCategory = 'note' | 'task' | 'list' | 'project' | 'search' | 'agent' | 'mcp' | 'file' | 'other';
export type ToolVerb = 'read' | 'create' | 'update' | 'delete' | 'search' | 'call';

export interface ToolGlance {
  category: ToolCategory;
  verb: ToolVerb;
  /** Short human phrase for the collapsed header, e.g. "Läste anteckning: Recept". */
  summary: string;
}

const CATEGORY_BY_TOOL: Record<string, ToolCategory> = {
  list_notes: 'note', get_note: 'note', create_note: 'note', update_note: 'note', delete_note: 'note',
  list_projects: 'project', create_project: 'project', update_project: 'project', delete_project: 'project',
  list_tasklists: 'list', create_tasklist: 'list', update_tasklist: 'list', delete_tasklist: 'list',
  list_tasks: 'task', get_task: 'task', create_task: 'task', update_task: 'task', delete_task: 'task',
  mcp_list_tools: 'mcp', mcp_call_tool: 'mcp',
};

const VERB_BY_PREFIX = (tool: string): ToolVerb => {
  if (tool.startsWith('create_')) return 'create';
  if (tool.startsWith('update_')) return 'update';
  if (tool.startsWith('delete_')) return 'delete';
  if (tool.startsWith('list_') || tool.startsWith('get_')) return 'read';
  if (tool.startsWith('mcp_')) return 'call';
  return 'call';
};

const NOUN: Record<ToolCategory, string> = {
  note: 'anteckning', project: 'projektmapp', list: 'uppgiftslista', task: 'uppgift',
  search: 'sökning', agent: 'AI-agent', mcp: 'verktyg', file: 'fil', other: 'data',
};

// Tolerantly dig a title/id out of the various stored shapes:
//  call payload  = { args: { title?, id?, … } }
//  some callers  = { title?, id? } directly
const dig = (payload: any, key: string): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const a = payload.args && typeof payload.args === 'object' ? payload.args : payload;
  const v = a?.[key] ?? payload?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/**
 * One-glance description of a tool action. `payload` is the parsed args (for a call)
 * or result (for a result message) — both are handled tolerantly.
 */
export const describeTool = (tool: string, payload?: any): ToolGlance => {
  const category = CATEGORY_BY_TOOL[tool] ?? 'other';
  const verb = VERB_BY_PREFIX(tool);
  const noun = NOUN[category];
  const title = dig(payload, 'title');
  const titleSuffix = title ? `: ${title}` : '';

  // MCP = calling an external tool/service, or another AI agent.
  if (tool === 'mcp_call_tool') {
    const service = dig(payload, 'service');
    const toolName = dig(payload, 'toolName');
    return { category: 'mcp', verb: 'call', summary: `Anropade ${service || 'tjänst'}${toolName ? ` · ${toolName}` : ''}` };
  }
  if (tool === 'mcp_list_tools') {
    const service = dig(payload, 'service');
    return { category: 'mcp', verb: 'read', summary: `Listade verktyg${service ? ` i ${service}` : ''}` };
  }

  switch (verb) {
    case 'read':
      // get_* reads one entity; list_* lists many.
      if (tool.startsWith('get_')) return { category, verb, summary: `Läste ${noun}${titleSuffix}` };
      return { category, verb, summary: `Sökte/listade ${noun === 'uppgift' ? 'uppgifter' : noun === 'anteckning' ? 'anteckningar' : noun + 'ar'}` };
    case 'create': {
      const delegated = payload && (payload.delegateToAi || payload?.args?.delegateToAi);
      return { category, verb, summary: `Skapade ${noun}${titleSuffix}${delegated ? ' (delegerad till AI-agent)' : ''}` };
    }
    case 'update':
      return { category, verb, summary: `Uppdaterade ${noun}${titleSuffix}` };
    case 'delete':
      return { category, verb, summary: `Tog bort ${noun}${titleSuffix}` };
    default:
      return { category, verb: 'call', summary: `Använde verktyg: ${tool}` };
  }
};

/** Field → friendly Swedish label for the readable tool-card rows. */
const FIELD_LABELS: Record<string, string> = {
  title: 'Titel', content: 'Innehåll', description: 'Beskrivning', dueDate: 'Förfaller',
  priority: 'Prioritet', parentNoteId: 'Lista', parentId: 'Mapp', tags: 'Taggar',
  completed: 'Klar', type: 'Typ', id: 'Id', service: 'Tjänst', toolName: 'Verktyg',
  delegateToAi: 'Delegera till AI', aiInstructions: 'AI-instruktion', locked: 'Låst',
  reminderEnabled: 'Påminnelse', reminderOffsetMinutes: 'Påminn (min)',
  recurrenceType: 'Upprepning', recurrenceDays: 'Dagar', icon: 'Ikon', order: 'Ordning',
  args: 'Argument', toolArgs: 'Argument',
};

const PRIORITY_LABEL: Record<string, string> = { low: 'Låg', medium: 'Medel', high: 'Hög' };

const formatFieldValue = (key: string, v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nej';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  if (key === 'priority' && typeof v === 'string') return PRIORITY_LABEL[v] || v;
  if ((key === 'dueDate' || key === 'date') && typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      try { return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(d); } catch { /* fall through */ }
    }
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export interface ToolField { label: string; value: string; }

/**
 * Turn a stored tool message's arguments into readable "Label: value" rows so the
 * card shows WHAT was done and WHICH values were filled in — instead of raw JSON.
 * Unwraps an `args` level, maps known fields to Swedish labels, formats dates +
 * priorities + booleans. Returns [] when there's nothing structured to show (the
 * card then falls back to its raw body text).
 */
export const formatToolFields = (content: string): ToolField[] => {
  const parsed = parseToolMessage(content);
  const raw = parsed.payload;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const obj = (raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args)) ? raw.args : raw;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const rows: ToolField[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === 'args') continue;
    const value = formatFieldValue(k, v);
    if (!value) continue;
    rows.push({ label: FIELD_LABELS[k] || k, value: value.length > 240 ? `${value.slice(0, 240)}…` : value });
    if (rows.length >= 12) break;
  }
  return rows;
};

/** Short outcome line for a result message (e.g. how many entities were read). */
export const describeToolResult = (tool: string, payload?: any): string => {
  const read = payload && Array.isArray(payload.entitiesRead) ? payload.entitiesRead.length : 0;
  if (read > 0) return `Läste ${read} ${read === 1 ? 'post' : 'poster'}`;
  const glance = describeTool(tool, payload?.result ?? payload);
  return glance.summary;
};

/**
 * The collapsed-card one-liner for any stored tool message: a human phrase derived
 * from the parsed message. Never empty — falls back to the tool name.
 */
export const summarizeToolMessage = (content: string): { category: ToolCategory; kind: ToolMsgKind; summary: string } => {
  const parsed = parseToolMessage(content);
  if (parsed.kind === 'error') {
    return { category: describeTool(parsed.tool).category, kind: 'error', summary: `Fel i ${parsed.tool}${parsed.details ? `: ${parsed.details.slice(0, 80)}` : ''}` };
  }
  if (parsed.kind === 'result') {
    return { category: describeTool(parsed.tool).category, kind: 'result', summary: describeToolResult(parsed.tool, parsed.payload) };
  }
  const glance = describeTool(parsed.tool, parsed.payload);
  return { category: glance.category, kind: parsed.kind, summary: glance.summary };
};
