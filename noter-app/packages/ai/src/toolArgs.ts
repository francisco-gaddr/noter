/**
 * Normalise the arguments of an AI tool call before they are turned into GraphQL
 * input.
 *
 * Some models (especially smaller/local ones) double-wrap the real fields under a
 * redundant key, e.g. for `create_task` they emit
 *   { "args": { "title": "...", "dueDate": "..." }, "parentNoteId": "..." }
 * instead of the flat
 *   { "title": "...", "dueDate": "...", "parentNoteId": "..." }.
 * Passed straight through, GraphQL rejects it ("Field \"args\" is not defined by
 * type TaskInput"). This flattens such a stray wrapper so the fields land at the
 * top level, matching TaskInput / NoteInput exactly.
 *
 * `mcp_call_tool` is exempt because `args` is a *real* parameter there (the
 * arguments forwarded to the downstream MCP tool).
 */

// Keys a model might wrap the real payload in. `updates` is intentionally NOT
// here — it is a genuine nested object for the update_* tools.
const WRAPPER_KEYS = ['args', 'arguments', 'input', 'parameters', 'params', 'payload', 'data', 'fields', 'body'];

// Tools where a wrapper-looking key is actually a real argument — never unwrap.
const NO_UNWRAP_TOOLS = new Set(['mcp_call_tool']);

export const normalizeToolArguments = (tool: string, raw: unknown): Record<string, any> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  let args: Record<string, any> = { ...(raw as Record<string, any>) };
  if (NO_UNWRAP_TOOLS.has(tool)) return args;

  // Unwrap up to a few levels of a single stray wrapper object. Inner (the real
  // payload) wins over the wrapper's siblings, but siblings the inner doesn't
  // define are kept (e.g. a top-level parentNoteId next to an `args` wrapper).
  for (let depth = 0; depth < 4; depth++) {
    let unwrapped = false;
    for (const key of WRAPPER_KEYS) {
      const inner = args[key];
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        const { [key]: _drop, ...siblings } = args;
        args = { ...siblings, ...inner };
        unwrapped = true;
        break;
      }
    }
    if (!unwrapped) break;
  }
  return args;
};
