/**
 * Robust tool-call extraction shared by mobile + web/electron.
 *
 * Models are inconsistent about how they emit a tool call: some use ```json fences,
 * some a bare ``` fence, some ~~~ , some no fence at all (just a raw JSON object), and
 * some wrap the args one level too deep. If the parser only accepts ```json (as the
 * old one did), a model that does any of the above is read as plain chat and the tool
 * is silently never run — the "AI just chats instead of using tools" bug.
 *
 * This parser therefore: (1) scans every fenced block regardless of language tag, and
 * (2) falls back to scanning the raw text for balanced JSON objects/arrays that carry a
 * recognised "tool" field. Only JSON whose `tool` is in the allow-list is treated as a
 * call (and removed from the visible text); everything else is left as chat.
 */
export type ToolCall = {
  tool: string;
  arguments: Record<string, unknown>;
};

export const DEFAULT_TOOL_NAMES: readonly string[] = [
  'search_notes',
  'list_notes', 'get_note', 'create_note', 'update_note', 'delete_note',
  'list_projects', 'create_project', 'update_project', 'delete_project',
  'list_tasklists', 'create_tasklist', 'update_tasklist', 'delete_tasklist',
  'list_tasks', 'get_task', 'create_task', 'update_task', 'delete_task',
  'mcp_list_tools', 'mcp_call_tool',
];

const MAX_CALLS = 8;
const MAX_ARG_JSON = 8000;

/** Some models wrap the real args under args/input/parameters — unwrap one level. */
const unwrapArgs = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 1 && ['args', 'input', 'parameters', 'arguments'].includes(keys[0])) {
    const inner = obj[keys[0]];
    if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) return inner as Record<string, unknown>;
  }
  return obj;
};

/** Scan for balanced top-level {...} / [...] substrings (string-aware). */
const scanJsonCandidates = (text: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) { out.push(text.slice(i, j + 1)); i = j; break; }
      }
    }
  }
  return out;
};

export const extractToolCalls = (
  text: string,
  allowed: Iterable<string> = DEFAULT_TOOL_NAMES,
): { calls: ToolCall[]; cleaned: string } => {
  const allowSet = allowed instanceof Set ? allowed : new Set(allowed);
  const calls: ToolCall[] = [];
  let cleaned = text || '';

  const pushFromParsed = (parsed: unknown): boolean => {
    const list = Array.isArray(parsed) ? parsed : [parsed];
    let added = false;
    for (const item of list) {
      const tool = (item as any)?.tool;
      if (!tool || typeof tool !== 'string' || !allowSet.has(tool)) continue;
      if (calls.length >= MAX_CALLS) break;
      const args = unwrapArgs((item as any).arguments ?? (item as any).args ?? {});
      if (JSON.stringify(args).length > MAX_ARG_JSON) continue;
      calls.push({ tool, arguments: args });
      added = true;
    }
    return added;
  };

  // 1) Fenced blocks — any language tag (```json, ```, ```tool, ~~~ …).
  const fenceRegex = /(`{3,}|~{3,})[^\n`~]*\n([\s\S]*?)\1/g;
  let fence: RegExpExecArray | null;
  while ((fence = fenceRegex.exec(text)) !== null) {
    const body = (fence[2] || '').trim();
    try {
      if (pushFromParsed(JSON.parse(body))) cleaned = cleaned.replace(fence[0], '').trim();
    } catch { /* not JSON — leave the fence in place */ }
  }

  // 2) Raw (un-fenced) JSON anywhere in the text, if we still found nothing.
  if (calls.length === 0) {
    for (const candidate of scanJsonCandidates(cleaned)) {
      if (!candidate.includes('"tool"')) continue;
      try {
        if (pushFromParsed(JSON.parse(candidate))) cleaned = cleaned.replace(candidate, '').trim();
      } catch { /* not valid JSON — skip */ }
      if (calls.length >= MAX_CALLS) break;
    }
  }

  return { calls, cleaned };
};
