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

export const buildToolSystemPrompt = (baseUrl: string, enabledMcpServices: string[] = []) => {
  const enabledMcpText = enabledMcpServices.length > 0 ? enabledMcpServices.join(', ') : 'inga';
  return [
    'När tool use är aktiverat: använd tool calls proaktivt när användaren vill skapa, uppdatera, ta bort, lista, hämta eller sammanfatta anteckningar/projekt/tasklistor/uppgifter.',
    'Tolkar även planering, påminnelser, agenda, och uppgifter/anteckningar kopplade till datum som signal att använda tool calls.',
    'För vanliga chattar, resonemang eller allmänna frågor: svara som vanlig text utan tool calls.',
    `Base URL: ${baseUrl}`,
    'GraphQL endpoint: {BASE_URL}/graphql',
    'Autentisering: använd samma Bearer-token som appen använder.',
    `Aktiva MCP-tjänster: ${enabledMcpText}.`,
    'Svara med ENDAST ett JSON-block i ```json ... ``` när du vill anropa tools.',
    'Format:',
    '{"tool":"<name>","arguments":{...}}',
    'eller lista:',
    '[{"tool":"<name>","arguments":{...}}, {"tool":"<name2>","arguments":{...}}]',
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
    '- create_task(title, description?, dueDate?, priority?, parentNoteId?, parentId?, recurrenceType?, recurrenceDays?, reminderEnabled?, reminderOffsetMinutes?)',
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

