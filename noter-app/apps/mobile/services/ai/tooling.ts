import { extractToolCalls as sharedExtractToolCalls, DEFAULT_TOOL_NAMES, buildTimeContextLines, type ToolCall } from '@repo/shared';

export type { ToolCall };
export { buildTimeContextLines };

const allowedTools = new Set(DEFAULT_TOOL_NAMES);

export type ToolContainer = { id: string; title: string };
export type ToolPromptContext = {
  projects?: ToolContainer[];
  taskLists?: ToolContainer[];
};

// buildTimeContextLines now lives in @repo/shared/timeContext (re-exported above) so the
// mobile + web prompts inject the SAME strong, worked-example time block.

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
    'NÄR en åtgärd behövs: ditt svar ska INNEHÅLLA ett JSON-tool-call. Skriv inte bara att du "ska" eller "kan" göra något — emittera själva JSON:en så att åtgärden faktiskt körs.',
    'Föredra ett ```json-block, men ren JSON utan kodstaket fungerar också. Lägg inget annat på samma rad som JSON:en.',
    'Format:',
    '{"tool":"<name>","arguments":{...}}',
    'eller lista (flera åtgärder i tur):',
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

/**
 * Robust tool-call extraction — delegates to the shared parser, which accepts ```json,
 * plain ```/~~~ fences AND bare un-fenced JSON, and unwraps args/input/parameters. This
 * is what makes the model's tool calls actually fire instead of being read as chat.
 */
export const extractToolCalls = (text: string): { calls: ToolCall[]; cleaned: string } =>
  sharedExtractToolCalls(text, allowedTools);

