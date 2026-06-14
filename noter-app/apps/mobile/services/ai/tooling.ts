export type ToolCall = {
  tool: string;
  arguments: Record<string, any>;
};

const allowedTools = new Set([
  'list_notes', 'get_note', 'create_note', 'update_note', 'delete_note',
  'list_projects', 'create_project', 'update_project', 'delete_project',
  'list_tasklists', 'create_tasklist', 'update_tasklist', 'delete_tasklist',
  'list_tasks', 'get_task', 'create_task', 'update_task', 'delete_task',
  'mcp_list_tools', 'mcp_call_tool'
]);

export type ToolContainer = { id: string; title: string };
export type ToolPromptContext = {
  projects?: ToolContainer[];
  taskLists?: ToolContainer[];
};

/**
 * "Du är här, just nu" — current date/time in the user's own timezone plus the
 * IANA zone + UTC offset, so the agent resolves relative times ("imorgon kl 11",
 * "på fredag") to the correct absolute instant the user means. Computed from the
 * device clock, which is the user's local time on mobile/desktop.
 */
export const buildTimeContextLines = (now: Date = new Date()): string[] => {
  let timezone = 'UTC';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }
  let local = now.toISOString();
  try {
    local = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(now);
  } catch { /* fall back to ISO */ }
  const offMin = -now.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const offset = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return [
    `Aktuell tid (användarens tidszon): ${local} (${timezone}, ${offset}). ISO nu: ${now.toISOString()}.`,
    'Räkna alltid relativa tider ("idag", "imorgon", "på fredag kl 11", "om en timme") utifrån denna aktuella tid och användarens tidszon. Om användaren anger en annan tidszon, använd den i stället.',
    'dueDate och andra tidsfält ska vara ISO 8601 (helst med tidszonsoffset, t.ex. 2026-06-14T11:00:00+02:00, eller UTC med Z) som motsvarar den lokala tid användaren faktiskt menar.',
  ];
};

const buildContainerLines = (context?: ToolPromptContext): string[] => {
  if (!context) return [];
  const fmt = (items?: ToolContainer[]) =>
    (items && items.length)
      ? items.slice(0, 50).map((c) => `${c.title || '(namnlös)'} [id:${c.id}]`).join(', ')
      : '(inga)';
  return [
    `Tillgängliga projektmappar (type=project): ${fmt(context.projects)}.`,
    `Tillgängliga uppgiftslistor (type=task_list): ${fmt(context.taskLists)}.`,
    'Välj rätt projektmapp/uppgiftslista för uppgiften och sätt parentId (anteckning/projekt/lista) respektive parentNoteId (uppgift) till rätt id ovan. Finns ingen lämplig, använd list_projects/list_tasklists eller skapa en ny först.',
  ];
};

export const buildToolSystemPrompt = (baseUrl: string, enabledMcpServices: string[] = [], context?: ToolPromptContext) => {
  const enabledMcpText = enabledMcpServices.length > 0 ? enabledMcpServices.join(', ') : 'inga';
  return [
    'När tool use är aktiverat: använd tool calls proaktivt när användaren vill skapa, uppdatera, ta bort, lista, hämta eller sammanfatta anteckningar/projekt/tasklistor/uppgifter.',
    'Tolkar även planering, påminnelser, agenda, och uppgifter/anteckningar kopplade till datum som signal att använda tool calls.',
    'För vanliga chattar, resonemang eller allmänna frågor: svara som vanlig text utan tool calls.',
    ...buildTimeContextLines(),
    ...buildContainerLines(context),
    `Base URL: ${baseUrl}`,
    'GraphQL endpoint: {BASE_URL}/graphql',
    'Autentisering: använd samma Bearer-token som appen använder.',
    `Aktiva MCP-tjänster: ${enabledMcpText}.`,
    'Svara med ENDAST ett JSON-block i ```json ... ``` när du vill anropa tools.',
    'Format:',
    '{"tool":"<name>","arguments":{...}}',
    'eller lista:',
    '[{"tool":"<name>","arguments":{...}}, {"tool":"<name2>","arguments":{...}}]',
    'VIKTIGT: lägg fälten DIREKT i "arguments". Wrappa dem ALDRIG i en extra "args"-, "input"- eller "parameters"-nivå. Ex korrekt: {"tool":"create_task","arguments":{"title":"Springa","dueDate":"2026-06-14T11:00:00.000Z"}}.',
    'Om användaren ber om ändring i data, utför nödvändiga tool calls direkt.',
    'Använd inte tool calls när användaren uttryckligen vill ha resonemang utan ändring.',
    'Frasexempel som ska trigga tool use:',
    '- "lägg till uppgift att ringa tandläkaren imorgon 09:00".',
    '- "visa mina uppgifter med deadline denna vecka".',
    '- "skapa projektet Hemrenovering och lägg till två uppgifter".',
    '- "ta bort uppgiften som heter Köp mjölk".',
    '- "lägg möte i Google Calendar" -> mcp_list_tools(service="googleWorkspace") -> mcp_call_tool(service="googleWorkspace", ...).',
    'Frasexempel som inte ska trigga tool use:',
    '- "förklara prioriteringstekniken Eisenhower".',
    '- "skriv ett förslag på dagsplan utan att spara något".',
    '- Projektmappar är notes med type="project".',
    '- Tasklistor är notes med type="task_list".',
    'Tools:',
    '- list_notes(parentId?, type?)',
    '- get_note(id)',
    '- create_note(title, content?, tags?, parentId?, type?, locked?, password?, icon?, iconColor?, order?)',
    '- update_note(id, updates)',
    '- delete_note(id)',
    '- list_projects(parentId?)',
    '- create_project(title, content?, tags?, parentId?, locked?, password?, icon?, iconColor?, order?)',
    '- update_project(id, updates)',
    '- delete_project(id)',
    '- list_tasklists(parentId?)',
    '- create_tasklist(title, content?, tags?, parentId?, locked?, password?, icon?, iconColor?, order?)',
    '- update_tasklist(id, updates)',
    '- delete_tasklist(id)',
    '- list_tasks(parentNoteId?, completed?)',
    '- get_task(id)',
    '- create_task(title, description?, dueDate?, priority?, parentNoteId?, parentId?, recurrenceType?, recurrenceDays?, reminderEnabled?, reminderOffsetMinutes?, delegateToAi?, aiInstructions?)',
    '  (delegateToAi=true → uppgiften delegeras till AI-agenten och körs senare med nuvarande modell/källa; sätt dueDate som deadline. aiInstructions = extra styrning till agenten.)',
    '- update_task(id, updates)',
    '- delete_task(id)',
    '- mcp_list_tools(service)',
    '- mcp_call_tool(service, toolName, args)',
    'Efter tool call: sammanfatta resultatet kort.'
  ].join('\n');
};

export const extractToolCalls = (text: string): { calls: ToolCall[]; cleaned: string } => {
  const calls: ToolCall[] = [];
  const pushCall = (tool: string, args: unknown) => {
    if (!allowedTools.has(tool)) return;
    if (calls.length >= 8) return;
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      calls.push({ tool, arguments: {} });
      return;
    }
    const asJson = JSON.stringify(args);
    if (asJson.length > 8000) return;
    calls.push({ tool, arguments: args as Record<string, any> });
  };

  let cleaned = text;
  const blockRegex = /```json([\s\S]*?)```/g;
  const matches = text.matchAll(blockRegex);
  for (const match of matches) {
    const jsonText = match[1].trim();
    try {
      const parsed = JSON.parse(jsonText);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      list.forEach((item) => {
        if (!item?.tool || typeof item.tool !== 'string') return;
        pushCall(item.tool, item.arguments || {});
      });
    } catch {}
    cleaned = cleaned.replace(match[0], '').trim();
  }

  return { calls, cleaned };
};

