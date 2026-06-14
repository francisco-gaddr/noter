/**
 * Per-tool / per-skill AI usage counters — the data layer behind the admin statistics
 * for "how the AI actually works": which tools/skills it calls, how often, and (for MCP)
 * which external tool. Mirrors the provider/model token tracking but keyed by tool name.
 *
 * Pure + date-injected so it unit-tests without a clock or storage; each app wraps it
 * with its own ENCRYPTED local store (localStorage / AsyncStorage).
 */
export interface ToolUsageRecord {
  day: string;   // YYYY-MM-DD
  month: string; // YYYY-MM
  countDay: number;
  countMonth: number;
  total: number; // all-time
}

export type ToolUsageState = Record<string, ToolUsageRecord>;

export const emptyToolRecord = (day: string, month: string): ToolUsageRecord => ({
  day, month, countDay: 0, countMonth: 0, total: 0,
});

/** Fold one tool call into a record, rolling day/month buckets when the date advanced. */
export const applyToolUsage = (prev: ToolUsageRecord | undefined, day: string, month: string): ToolUsageRecord => {
  const base = prev ?? emptyToolRecord(day, month);
  const dayRolled = base.day !== day;
  const monthRolled = base.month !== month;
  return {
    day,
    month,
    countDay: (dayRolled ? 0 : base.countDay) + 1,
    countMonth: (monthRolled ? 0 : base.countMonth) + 1,
    total: base.total + 1,
  };
};

export interface ToolUsageRow {
  tool: string;
  countDay: number;
  countMonth: number;
  total: number;
}

/** Sorted (most-used first) rows for the current day/month, buckets reset if stale. */
export const toolUsageSummary = (state: ToolUsageState, day: string, month: string): ToolUsageRow[] => {
  const rows: ToolUsageRow[] = Object.entries(state || {}).map(([tool, r]) => ({
    tool,
    countDay: r.day === day ? r.countDay : 0,
    countMonth: r.month === month ? r.countMonth : 0,
    total: r.total || 0,
  }));
  return rows.sort((a, b) => b.total - a.total || a.tool.localeCompare(b.tool));
};

/** Human label + category for a tool name (reuses the chat tool-description taxonomy). */
export const toolUsageLabel = (tool: string): string => ({
  list_notes: 'Lista anteckningar', get_note: 'Läs anteckning', create_note: 'Skapa anteckning',
  update_note: 'Ändra anteckning', delete_note: 'Ta bort anteckning',
  list_projects: 'Lista projekt', create_project: 'Skapa projekt', update_project: 'Ändra projekt', delete_project: 'Ta bort projekt',
  list_tasklists: 'Lista uppgiftslistor', create_tasklist: 'Skapa lista', update_tasklist: 'Ändra lista', delete_tasklist: 'Ta bort lista',
  list_tasks: 'Lista uppgifter', get_task: 'Läs uppgift', create_task: 'Skapa uppgift',
  update_task: 'Ändra uppgift', complete_task: 'Bocka av uppgift', delete_task: 'Ta bort uppgift',
  mcp_list_tools: 'Lista MCP-verktyg', mcp_call_tool: 'Anropa MCP-verktyg',
}[tool] || tool);

/** Total tool calls (all-time) across the state — a single headline number. */
export const totalToolCalls = (state: ToolUsageState): number =>
  Object.values(state || {}).reduce((sum, r) => sum + (r.total || 0), 0);
