export type AiPromptPreset = 'balanced' | 'research' | 'execution' | 'concise';
export type AiToolAccessMode = 'read-only' | 'full';

export const AI_PROMPT_PRESETS: ReadonlyArray<{ id: AiPromptPreset; title: string; prompt: string }> = [
  {
    id: 'balanced',
    title: 'Balanced',
    prompt: 'Var tydlig, hjälpsam och strukturerad. Prioritera korrekta svar, kort sammanfattning först och konkreta nästa steg när det hjälper användaren.',
  },
  {
    id: 'research',
    title: 'Research',
    prompt: 'Arbeta undersökande och analytiskt. Förklara antaganden, osäkerheter, alternativ och rekommendationer innan du drar slutsatser.',
  },
  {
    id: 'execution',
    title: 'Execution',
    prompt: 'Fokusera på att slutföra uppgifter. Bryt ned arbetet i tydliga steg, verifiera resultat och var proaktiv med säkra åtgärder.',
  },
  {
    id: 'concise',
    title: 'Concise',
    prompt: 'Svara kort, praktiskt och direkt. Undvik onödiga utvecklingar och ge kompakta svar med hög signal.',
  },
];

const READ_ONLY_TOOLS = new Set([
  'list_notes',
  'get_note',
  'list_projects',
  'list_tasklists',
  'list_tasks',
  'get_task',
  'mcp_list_tools',
]);

export const getAiPromptPresetPrompt = (preset: AiPromptPreset) =>
  AI_PROMPT_PRESETS.find((item) => item.id === preset)?.prompt || AI_PROMPT_PRESETS[0].prompt;

export const buildAiSyncNotice = (syncEnabled: boolean) =>
  syncEnabled
    ? 'AI-sync är aktiverat. Endast krypterad ciphertext får delas med backend. Lokal historik ska fortsätta vara krypterad at rest.'
    : 'AI-sync är avstängt. All AI-historik, projektdata och meddelanden ska stanna lokalt på denna enhet och endast lagras krypterat at rest.';

export const buildToolUseNotice = (enabled: boolean, accessMode: AiToolAccessMode = 'full') => {
  if (!enabled) {
    return 'Tool-use är avstängt. Svara som vanlig chatt utan JSON-tool-calls och utan att försöka köra verktyg.';
  }
  if (accessMode === 'read-only') {
    return 'Tool-use är aktiverat i läsläge. Assistenten får bara läsa, lista, sammanfatta och verifiera information. Den får inte skapa, uppdatera, radera eller köra skrivande MCP-anrop.';
  }
  return 'Tool-use är aktiverat. Assistenten kan utföra säkra verktygsanrop för att läsa, skapa, uppdatera och verifiera anteckningar, uppgifter, projekt och uttryckligen tillåtna MCP-anrop.';
};

export const isMutatingAiTool = (tool: string) => !READ_ONLY_TOOLS.has(tool);

export const buildAiSessionInsights = (input: {
  providerLabel: string;
  modelLabel: string;
  syncEnabled: boolean;
  toolUseEnabled: boolean;
  toolAccessMode: AiToolAccessMode;
  promptPreset: AiPromptPreset;
  enabledMcpServices: string[];
}) => [
  { id: 'provider', label: 'Provider', value: input.providerLabel || '-' },
  { id: 'model', label: 'Modell', value: input.modelLabel || '-' },
  { id: 'sync', label: 'Sync', value: input.syncEnabled ? 'Krypterad backend-sync' : 'Endast lokal krypterad lagring' },
  { id: 'tools', label: 'Tool-use', value: input.toolUseEnabled ? (input.toolAccessMode === 'read-only' ? 'På · läsläge' : 'På · full åtkomst') : 'Av' },
  { id: 'preset', label: 'Promptprofil', value: AI_PROMPT_PRESETS.find((item) => item.id === input.promptPreset)?.title || 'Balanced' },
  { id: 'mcp', label: 'MCP', value: input.enabledMcpServices.length ? input.enabledMcpServices.join(', ') : 'Inga aktiva tjänster' },
];
