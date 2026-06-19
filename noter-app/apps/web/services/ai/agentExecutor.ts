/**
 * Web/Electron agent executor — runs a delegated AI task using the shared
 * runAgentTask brain, the web provider send, and a web-store-backed tool executor.
 * Mirrors apps/mobile/services/ai/agentExecutor.
 */
import {
  decrypt,
  normalizeNoteType,
  resolveMaxSteps,
  resolveTokenBudget,
  isOverRunBudget,
  contextLevelConfig,
  collectAgentMemoryNotes,
  renderAgentMemoryBlock,
  AGENT_PLANNING_INSTRUCTIONS,
  AGENT_LOCK_POLICY,
  buildSecurityNoteMap,
  isReadableWithLocks,
  AI_INDEX_NO_UNLOCK,
  agentSearchNotes,
  type AiTaskDelegation,
  type Note,
  type Task,
} from '@repo/shared';
import { runAgentTask, type AgentAccess, type ChatMessage } from '@repo/ai';
import { API_PROVIDERS, generateApiProviderResponse, type ApiProviderType } from './apiProviders';
import { useStore } from '../../stores/useStore';
import { patchDelegation, setRunLogEntry } from './agentDelegations';
import { recordToolUse } from './usageTracker';
import { resolveAiNoteParentId, resolveAiTaskParentId } from './placement';

const ls = (key: string): string | null => {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
};

type CustomProvider = { id: string; label: string; baseUrl: string; model: string; apiKey: string };

export interface ResolvedModelConfig { sendProvider: ApiProviderType; apiKey: string; baseUrl?: string; model: string }

export const resolveModelConfig = (delegation: AiTaskDelegation): ResolvedModelConfig | null => {
  const providerId = delegation.provider || 'openrouter';
  if (providerId.startsWith('custom') || providerId.startsWith('preset-')) {
    let custom: CustomProvider | undefined;
    const raw = ls('aiCustomProviders');
    if (raw) { try { custom = (JSON.parse(decrypt(raw) || raw) as CustomProvider[]).find((p) => p.id === providerId); } catch { /* ignore */ } }
    if (!custom) return null;
    return { sendProvider: 'hermes', apiKey: custom.apiKey || '', baseUrl: custom.baseUrl, model: delegation.model || custom.model };
  }
  const meta = API_PROVIDERS[providerId as ApiProviderType];
  if (!meta) return null;
  const keyRaw = ls(`${providerId === 'openrouter' ? 'openrouter' : providerId}ApiKey`);
  const apiKey = keyRaw ? decrypt(keyRaw) || keyRaw : '';
  const baseUrl = providerId === 'hermes' ? (ls('hermesBaseUrl') || undefined) : undefined;
  return { sendProvider: providerId as ApiProviderType, apiKey, baseUrl, model: delegation.model || meta.defaultModels[0] || '' };
};

const buildToolExecutor = () => async (tool: string, args: Record<string, any>): Promise<unknown> => {
  // Statistics: count tool/skill calls made by the delegated agent too (not just chat).
  try { recordToolUse(tool); } catch { /* best-effort */ }
  const store = useStore.getState();
  const allNotes: Note[] = Array.isArray(store.notes) ? store.notes : [];
  const tasks: Task[] = Array.isArray(store.tasks) ? store.tasks : [];
  // SECURITY: the agent NEVER gets the UI unlock — locked notes/folders are invisible to it
  // even ones the user has open right now. Empty unlock set = hard-filter every locked read.
  const unlockedIds = AI_INDEX_NO_UNLOCK as Set<string>;
  const noteMap = buildSecurityNoteMap(allNotes as any[]);
  const readable = (n: Note) => isReadableWithLocks(n as any, noteMap, unlockedIds);
  const notes: Note[] = allNotes.filter(readable);
  const byType = (type: string) => notes.filter((n) => normalizeNoteType(n.type) === type);
  // A task tied to a locked list/project is also off-limits.
  const taskReadable = (t: Task) => !t.parentNoteId || isReadableWithLocks(noteMap.get(String(t.parentNoteId)) as any, noteMap, unlockedIds);

  switch (tool) {
    case 'search_notes':
      // Lock-safe lexical+rerank search (same retrieval as chat, empty unlock set). Pass the RAW
      // store data — agentSearchNotes does the lock-filtering itself.
      return { results: agentSearchNotes(allNotes, tasks, String(args.query ?? args.q ?? ''), Number(args.limit) || 8) };
    case 'list_notes':
      return { notes: notes.filter((n) => normalizeNoteType(n.type) === 'note' && (args.parentId ? String(n.parentId) === String(args.parentId) : true)) };
    case 'get_note': {
      const n = allNotes.find((x) => x._id === args.id);
      if (n && !readable(n)) return { note: null, error: 'Anteckningen är låst och kan inte läsas av AI-agenten.' };
      return { note: n ?? null };
    }
    case 'list_projects':
      return { projects: byType('project').map((n) => ({ id: n._id, title: n.title })) };
    case 'list_tasklists':
      return { taskLists: byType('task_list').map((n) => ({ id: n._id, title: n.title })) };
    case 'list_tasks':
      return { tasks: tasks.filter((t) => taskReadable(t) && (args.parentNoteId ? String(t.parentNoteId) === String(args.parentNoteId) : true) && (typeof args.completed === 'boolean' ? !!t.completed === args.completed : true)) };
    case 'get_task': {
      const t = tasks.find((x) => x._id === args.id);
      if (t && !taskReadable(t)) return { task: null, error: 'Uppgiften tillhör en låst lista och kan inte läsas.' };
      return { task: t ?? null };
    }
    case 'create_note':
    case 'create_project':
    case 'create_tasklist': {
      const type = tool === 'create_project' ? 'project' : tool === 'create_tasklist' ? 'task_list' : 'note';
      // Smart placement for plain notes: best-matching folder, else a default AI folder.
      const parentId = (tool === 'create_note' && type === 'note')
        ? await resolveAiNoteParentId(args)
        : (args.parentId || null);
      await store.createNote(args.title || 'Untitled', parentId, type as any);
      return { ok: true };
    }
    case 'update_note':
    case 'update_project':
    case 'update_tasklist': {
      const updates = args.updates || args;
      await store.updateNote(String(args.id), updates.title ?? undefined, updates.content ?? undefined);
      return { ok: true };
    }
    case 'create_task': {
      const parentNoteId = args.parentNoteId || (await resolveAiTaskParentId(args)) || undefined;
      await store.createTask(args.title || 'Uppgift', parentNoteId, args.dueDate || null, {
        description: args.description || '', priority: args.priority || 'medium', reminderEnabled: !!args.reminderEnabled,
      });
      return { ok: true };
    }
    case 'update_task':
    case 'complete_task': {
      const updates = tool === 'complete_task' ? { completed: true } : (args.updates || args);
      await store.updateTask(String(args.id), updates);
      return { ok: true };
    }
    case 'delete_task':
      await store.deleteTask(String(args.id));
      return { ok: true };
    default:
      return { error: `Okänt verktyg: ${tool}` };
  }
};

const buildAgentSystem = (task: Task, delegation: AiTaskDelegation): string => {
  const store = useStore.getState();
  const allNotes: Note[] = Array.isArray(store.notes) ? store.notes : [];
  // SECURITY: never inject locked containers/memory into the prompt (empty unlock set —
  // a UI folder-unlock is never extended to the agent).
  const unlockedIds = AI_INDEX_NO_UNLOCK as Set<string>;
  const noteMap = buildSecurityNoteMap(allNotes as any[]);
  const notes: Note[] = allNotes.filter((n) => isReadableWithLocks(n as any, noteMap, unlockedIds));
  const cl = contextLevelConfig(delegation.contextLevel);
  const fmt = (type: string) => !cl.includeContainers ? '(utelämnat — låg kontextnivå)'
    : (notes.filter((n) => normalizeNoteType(n.type) === type).slice(0, cl.maxContextItems).map((n) => `${n.title || '(namnlös)'} [id:${n._id}]`).join(', ') || '(inga)');
  const memoryBlock = renderAgentMemoryBlock(collectAgentMemoryNotes(notes, delegation, 40, unlockedIds));
  let tz = 'UTC'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep */ }
  const levelHint = cl.level === 'minimal' ? 'KONTEXTNIVÅ minimal: svara direkt, läs inte databasen om det inte krävs.'
    : cl.level === 'fast' ? 'KONTEXTNIVÅ lätt: använd verktyg sparsamt, föredra snabba enkla steg.'
    : cl.allowVectorSearch ? 'KONTEXTNIVÅ djup: grundliga sökningar tillåtna när det behövs.'
    : 'KONTEXTNIVÅ standard: verktyg vid behov, föredra billiga snabba steg.';
  return [
    delegation.role ? `Din roll: ${delegation.role}.` : 'Du är en autonom AI-agent som utför en delegerad uppgift åt användaren.',
    AGENT_LOCK_POLICY,
    levelHint,
    'Arbeta i korta steg med tool calls i ```json {"tool","arguments"} ``` format. Wrappa ALDRIG fälten i en extra "args"-nivå.',
    'Verktyg: search_notes (sök i anteckningar/uppgifter — använd det FÖRST för att hitta relevant innehåll i stället för att lista allt), list_notes, get_note, list_projects, list_tasklists, list_tasks, get_task, create_note, update_note, create_task, update_task, complete_task, delete_task.',
    `Aktuell tid: ${new Date().toISOString()} (${tz}).`,
    `Projektmappar: ${fmt('project')}.`,
    `Uppgiftslistor: ${fmt('task_list')}.`,
    'Bocka av uppgiften (complete_task) när målet är klart. Du kan skapa framtida uppgifter åt dig själv (create_task med dueDate).',
    AGENT_PLANNING_INSTRUCTIONS,
    memoryBlock,
    `\nDin uppgift: "${task.title}".`,
    task.description ? `Beskrivning: ${task.description}` : '',
    delegation.instructions ? `Extra instruktioner: ${delegation.instructions}` : '',
    `Uppgiftens id: ${task._id}.`,
  ].filter(Boolean).join('\n');
};

export interface AgentRunOutcome { ok: boolean; summary: string; accesses: AgentAccess[]; stopped: string }

export const runScheduledAgentTask = async (
  task: Task,
  opts: { userId?: string | null; onAccess?: (a: AgentAccess) => void; isAborted?: () => boolean } = {},
): Promise<AgentRunOutcome> => {
  const delegation = task.aiAgent;
  if (!delegation || delegation.assignee !== 'ai') return { ok: false, summary: 'Inte en AI-uppgift', accesses: [], stopped: 'error' };

  const persist = (patch: Partial<AiTaskDelegation>) => patchDelegation(task._id, patch, opts.userId);
  persist({ status: 'running', lastRunAt: new Date().toISOString(), runCount: (delegation.runCount || 0) + 1 });

  const config = resolveModelConfig(delegation);
  if (!config || !config.model || (!config.apiKey && !API_PROVIDERS[config.sendProvider]?.apiKeyOptional)) {
    persist({ status: 'error', result: 'Saknar modell/nyckel-konfiguration.' });
    return { ok: false, summary: 'Saknar modellkonfiguration', accesses: [], stopped: 'error' };
  }

  const accesses: AgentAccess[] = [];
  const invokeModel = async (messages: ChatMessage[]): Promise<string> => {
    const res = await generateApiProviderResponse({ provider: config.sendProvider, apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl, history: messages });
    return res.text;
  };

  const result = await runAgentTask({
    system: buildAgentSystem(task, delegation),
    goal: `Utför uppgiften "${task.title}" nu och bocka av den när den är klar.`,
    maxSteps: resolveMaxSteps(delegation),
    tokenBudget: resolveTokenBudget(delegation),
    deps: { invokeModel, executeTool: buildToolExecutor(), isAborted: opts.isAborted, onAccess: (a) => { accesses.push(a); opts.onAccess?.(a); } },
  });

  const ok = result.stopped === 'done';
  const budgetNote = result.stopped === 'budget' ? ` (tokenbudget nådd, ~${result.tokensUsed} tokens)` : '';
  const summary = ((result.finalText || '').slice(0, 500) || `Avslutad (${result.stopped}).`) + budgetNote;
  persist({ status: ok ? 'done' : 'error', result: summary });
  setRunLogEntry(task._id, { at: new Date().toISOString(), stopped: result.stopped, summary, accesses: accesses.map((a) => ({ kind: a.kind, id: a.id, title: a.title, at: a.at })) }, opts.userId);
  return { ok, summary, accesses, stopped: result.stopped };
};
