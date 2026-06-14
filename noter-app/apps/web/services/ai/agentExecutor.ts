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
  type AiTaskDelegation,
  type Note,
  type Task,
} from '@repo/shared';
import { runAgentTask, type AgentAccess, type ChatMessage } from '@repo/ai';
import { API_PROVIDERS, generateApiProviderResponse, type ApiProviderType } from './apiProviders';
import { useStore } from '../../stores/useStore';
import { patchDelegation, setRunLogEntry } from './agentDelegations';

const AGENT_MEMORY_PROJECT_TITLE = 'AI-agent';

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
  const store = useStore.getState();
  const notes: Note[] = Array.isArray(store.notes) ? store.notes : [];
  const tasks: Task[] = Array.isArray(store.tasks) ? store.tasks : [];
  const byType = (type: string) => notes.filter((n) => normalizeNoteType(n.type) === type);

  switch (tool) {
    case 'list_notes':
      return { notes: notes.filter((n) => normalizeNoteType(n.type) === 'note' && (args.parentId ? String(n.parentId) === String(args.parentId) : true)) };
    case 'get_note':
      return { note: notes.find((n) => n._id === args.id) ?? null };
    case 'list_projects':
      return { projects: byType('project').map((n) => ({ id: n._id, title: n.title })) };
    case 'list_tasklists':
      return { taskLists: byType('task_list').map((n) => ({ id: n._id, title: n.title })) };
    case 'list_tasks':
      return { tasks: tasks.filter((t) => (args.parentNoteId ? String(t.parentNoteId) === String(args.parentNoteId) : true) && (typeof args.completed === 'boolean' ? !!t.completed === args.completed : true)) };
    case 'get_task':
      return { task: tasks.find((t) => t._id === args.id) ?? null };
    case 'create_note':
    case 'create_project':
    case 'create_tasklist': {
      const type = tool === 'create_project' ? 'project' : tool === 'create_tasklist' ? 'task_list' : 'note';
      await store.createNote(args.title || 'Untitled', args.parentId || null, type as any);
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
      await store.createTask(args.title || 'Uppgift', args.parentNoteId || undefined, args.dueDate || null, {
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
  const notes: Note[] = Array.isArray(useStore.getState().notes) ? useStore.getState().notes : [];
  const cl = contextLevelConfig(delegation.contextLevel);
  const fmt = (type: string) => !cl.includeContainers ? '(utelämnat — låg kontextnivå)'
    : (notes.filter((n) => normalizeNoteType(n.type) === type).slice(0, cl.maxContextItems).map((n) => `${n.title || '(namnlös)'} [id:${n._id}]`).join(', ') || '(inga)');
  const memoryProject = notes.find((n) => normalizeNoteType(n.type) === 'project' && (n.title || '').trim().toLowerCase() === AGENT_MEMORY_PROJECT_TITLE.toLowerCase());
  const memoryNotes = memoryProject ? notes.filter((n) => String(n.parentId) === String(memoryProject._id)) : [];
  const memoryBlock = memoryNotes.length ? `\nMinnen/instruktioner/regler (projekt "${AGENT_MEMORY_PROJECT_TITLE}"):\n${memoryNotes.map((n) => `- ${n.title}: ${(n.content || '').slice(0, 600)}`).join('\n')}` : '';
  let tz = 'UTC'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep */ }
  const levelHint = cl.level === 'minimal' ? 'KONTEXTNIVÅ minimal: svara direkt, läs inte databasen om det inte krävs.'
    : cl.level === 'fast' ? 'KONTEXTNIVÅ lätt: använd verktyg sparsamt, föredra snabba enkla steg.'
    : cl.allowVectorSearch ? 'KONTEXTNIVÅ djup: grundliga sökningar tillåtna när det behövs.'
    : 'KONTEXTNIVÅ standard: verktyg vid behov, föredra billiga snabba steg.';
  return [
    delegation.role ? `Din roll: ${delegation.role}.` : 'Du är en autonom AI-agent som utför en delegerad uppgift åt användaren.',
    levelHint,
    'Arbeta i korta steg med tool calls i ```json {"tool","arguments"} ``` format. Wrappa ALDRIG fälten i en extra "args"-nivå.',
    'Verktyg: list_notes, get_note, list_projects, list_tasklists, list_tasks, get_task, create_note, update_note, create_task, update_task, complete_task, delete_task.',
    `Aktuell tid: ${new Date().toISOString()} (${tz}).`,
    `Projektmappar: ${fmt('project')}.`,
    `Uppgiftslistor: ${fmt('task_list')}.`,
    'Bocka av uppgiften (complete_task) när målet är klart. Du kan skapa framtida uppgifter åt dig själv (create_task med dueDate).',
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
