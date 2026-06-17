/**
 * Mobile agent executor — runs a delegated AI task end-to-end on the device.
 *
 * It wires the shared, tested `runAgentTask` brain (@repo/ai) to:
 *   - invokeModel: the standalone provider send (services/ai/apiProviders), with
 *     the task's chosen source/provider/model + the stored key/base-URL, and
 *   - executeTool: a self-contained tool executor over the Zustand store (so it
 *     reuses the app's local-first + encrypted-sync write path; nothing here talks
 *     to the network directly except the model send).
 *
 * The whole thing is deliberately decoupled from the chat UI (ai.tsx) so the
 * scheduler can run a task with no screen mounted. Reads are surfaced via the
 * runner's onAccess hook and persisted on the task so the UI can transparently
 * show everything the agent looked at.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  safeDecrypt,
  normalizeNoteType,
  type Task,
  type AiTaskDelegation,
  type Note,
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
} from '@repo/shared';
import { runAgentTask, type AgentAccess, type ChatMessage } from '@repo/ai';
import { API_PROVIDERS, generateApiProviderResponse, type ApiProviderType } from './apiProviders';
import { modelManager } from './ModelManager';
import { getModelsLocal } from '@/services/database';
import { buildToolSystemPrompt, type ToolContainer } from './tooling';
import { patchDelegation, setRunLogEntry } from './agentDelegations';
import { recordToolUse } from './usageTracker';
import { useStore } from '@/stores/useStore';
import { resolveAiNoteParentId, resolveAiTaskParentId } from './placement';

const scopeKeyForToken = async (): Promise<string> => {
  const token = await SecureStore.getItemAsync('token').catch(() => null);
  return token ? Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token) : Promise.resolve('anon');
};

type CustomProvider = { id: string; label: string; baseUrl: string; model: string; apiKey: string };

export interface ResolvedModelConfig {
  sendProvider: ApiProviderType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  /** True when the model runs on-device via llama.rn (no API key / network). */
  local?: boolean;
  /** Absolute GGUF path for local inference. */
  localModelPath?: string;
}

/**
 * Resolve how to call the model for this delegation: which provider to send as,
 * the key, the base URL (Hermes/custom) and the model id — read from the same
 * encrypted local settings the chat uses.
 */
export const resolveModelConfig = async (delegation: AiTaskDelegation): Promise<ResolvedModelConfig | null> => {
  const scopeKey = await scopeKeyForToken();

  // Local on-device model (llama.rn): no provider/key/network. The delegation's `model`
  // holds the GGUF path (set when self-assigning a local task); fall back to the first
  // downloaded model so a background run can still pick one up.
  if (delegation.source === 'local') {
    let path = delegation.model || '';
    if (!path || !/\.gguf$/i.test(path)) {
      const models = await getModelsLocal().catch(() => [] as any[]);
      path = models[0]?.path || path;
    }
    if (!path) return null;
    return { sendProvider: 'hermes', apiKey: '', model: path, local: true, localModelPath: path };
  }

  const providerId = delegation.provider || 'openrouter';

  // Custom provider (a user-added Hermes/agent): send via the Hermes path.
  if (providerId.startsWith('custom_') || providerId.startsWith('preset-')) {
    const raw = await SecureStore.getItemAsync(`ai_custom_providers_${scopeKey}`).catch(() => null);
    let custom: CustomProvider | undefined;
    if (raw) {
      try { custom = (JSON.parse(safeDecrypt(raw, raw) || '[]') as CustomProvider[]).find((p) => p.id === providerId); } catch { /* ignore */ }
    }
    if (!custom) return null;
    return { sendProvider: 'hermes', apiKey: custom.apiKey || '', baseUrl: custom.baseUrl, model: delegation.model || custom.model };
  }

  const meta = API_PROVIDERS[providerId as ApiProviderType];
  if (!meta) return null;
  const keyEnc = await SecureStore.getItemAsync(`ai_${providerId}_key_${scopeKey}`).catch(() => null);
  const apiKey = keyEnc ? safeDecrypt(keyEnc) || '' : '';
  const baseUrl = providerId === 'hermes'
    // Stored encrypted; safeDecrypt reads legacy plaintext transparently.
    ? (safeDecrypt((await AsyncStorage.getItem(`ai_hermes_base_url_${scopeKey}`)) || '', '') || undefined)
    : undefined;
  const model = delegation.model || meta.defaultModels[0] || '';
  return { sendProvider: providerId as ApiProviderType, apiKey, baseUrl, model };
};

/** A tool executor over the store (the agent's hands). Mirrors the chat tools. */
const buildToolExecutor = () => async (tool: string, args: Record<string, any>): Promise<unknown> => {
  // Statistics: count tool/skill calls made by the delegated agent too (not just chat).
  void recordToolUse(tool);
  const store = useStore.getState();
  const allNotes: Note[] = Array.isArray(store.notes) ? store.notes : [];
  const tasks: Task[] = Array.isArray(store.tasks) ? store.tasks : [];
  // SECURITY: the agent may only ever see UNLOCKED notes; hard-filter every read.
  const unlockedIds = new Set<string>((store as any).unlockedProtectedNoteIds || []);
  const noteMap = buildSecurityNoteMap(allNotes as any[]);
  const readable = (n: Note) => isReadableWithLocks(n as any, noteMap, unlockedIds);
  const notes: Note[] = allNotes.filter(readable);
  const byType = (type: string) => notes.filter((n) => normalizeNoteType(n.type) === type);
  const taskReadable = (t: Task) => !t.parentNoteId || isReadableWithLocks(noteMap.get(String(t.parentNoteId)) as any, noteMap, unlockedIds);

  switch (tool) {
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
      const type = tool === 'create_project' ? 'project' : tool === 'create_tasklist' ? 'task_list' : (args.type || 'note');
      // Plain notes get smart placement (best-match folder → default AI folder); folder/list
      // creation keeps the caller's parentId.
      const parentId = (tool === 'create_note' && type === 'note')
        ? await resolveAiNoteParentId(args)
        : (args.parentId || null);
      const note = await store.createNote({ title: args.title || 'Untitled', content: args.content || '', tags: args.tags || [], parentId, type } as any);
      return { note };
    }
    case 'update_note':
    case 'update_project':
    case 'update_tasklist': {
      const updates = args.updates || args;
      const note = await store.updateNote(String(args.id), updates);
      return { note };
    }
    case 'create_task': {
      // Smart placement: explicit list → best-matching task list → default AI task list.
      const parentNoteId = args.parentNoteId || (await resolveAiTaskParentId(args)) || undefined;
      const task = await store.createTask({
        title: args.title || 'Uppgift', description: args.description || '', dueDate: args.dueDate || null,
        priority: args.priority || 'medium', parentNoteId,
        reminderEnabled: !!args.reminderEnabled,
      } as any);
      return { task };
    }
    case 'update_task':
    case 'complete_task': {
      const updates = tool === 'complete_task' ? { completed: true } : (args.updates || args);
      const task = await store.updateTask(String(args.id), updates);
      return { task };
    }
    case 'delete_task':
      await store.deleteTask(String(args.id));
      return { ok: true };
    default:
      return { error: `Okänt verktyg: ${tool}` };
  }
};

/** Build the agent's system prompt: tool rules + folders/lists + memory + task. */
const buildAgentSystem = (task: Task, delegation: AiTaskDelegation, baseUrl: string): string => {
  const store = useStore.getState();
  const allNotes: Note[] = Array.isArray(store.notes) ? store.notes : [];
  // SECURITY: never inject locked containers/memory into the prompt.
  const unlockedIds = new Set<string>((store as any).unlockedProtectedNoteIds || []);
  const noteMap = buildSecurityNoteMap(allNotes as any[]);
  const notes: Note[] = allNotes.filter((n) => isReadableWithLocks(n as any, noteMap, unlockedIds));
  // Context level gates how much we inject (cheaper/faster for light jobs).
  const cl = contextLevelConfig(delegation.contextLevel);
  const cap = (arr: ToolContainer[]) => arr.slice(0, cl.maxContextItems);
  const containers = cl.includeContainers ? {
    projects: cap(notes.filter((n) => normalizeNoteType(n.type) === 'project').map((n): ToolContainer => ({ id: n._id, title: n.title }))),
    taskLists: cap(notes.filter((n) => normalizeNoteType(n.type) === 'task_list').map((n): ToolContainer => ({ id: n._id, title: n.title }))),
  } : { projects: [], taskLists: [] };
  // Agent memory: notes inside the configured memory project(s) — or the conventional
  // "AI-agent" project — act as memory/instructions/index/rules. Locked notes excluded.
  const memoryBlock = renderAgentMemoryBlock(collectAgentMemoryNotes(notes, delegation, 40, unlockedIds));
  const toolPrompt = buildToolSystemPrompt(baseUrl, [], containers);
  const levelHint = cl.level === 'minimal'
    ? 'KONTEXTNIVÅ minimal: svara direkt, undvik att läsa databasen om det inte uttryckligen krävs.'
    : cl.level === 'fast'
      ? 'KONTEXTNIVÅ lätt: använd verktyg sparsamt, föredra snabba enkla steg.'
      : cl.allowVectorSearch
        ? 'KONTEXTNIVÅ djup: du får göra grundliga sökningar när det behövs.'
        : 'KONTEXTNIVÅ standard: använd verktyg vid behov, föredra billiga snabba steg.';
  return [
    delegation.role ? `Din roll: ${delegation.role}.` : 'Du är en autonom AI-agent som utför en delegerad uppgift åt användaren.',
    levelHint,
    'Arbeta i korta steg med tool calls. Läs bara det du behöver. Undvik upprepning.',
    'Bocka av uppgiften (complete_task / update_task completed=true) när målet är uppfyllt, annars planera nästa steg.',
    'Du kan skapa framtida uppgifter åt dig själv (create_task med dueDate) för uppföljning.',
    AGENT_PLANNING_INSTRUCTIONS,
    toolPrompt,
    memoryBlock,
    `\nDin uppgift: "${task.title}".`,
    task.description ? `Beskrivning: ${task.description}` : '',
    delegation.instructions ? `Extra instruktioner: ${delegation.instructions}` : '',
    `Uppgiftens id: ${task._id}.`,
  ].filter(Boolean).join('\n');
};

export interface AgentRunOutcome {
  ok: boolean;
  summary: string;
  accesses: AgentAccess[];
  stopped: string;
}

/**
 * Run one delegated task to completion (best-effort) and persist the outcome on
 * the task's aiAgent field. Marks status running → done/error, increments
 * runCount, stores the result summary + the access log.
 */
export const runScheduledAgentTask = async (
  task: Task,
  opts: { onAccess?: (a: AgentAccess) => void; isAborted?: () => boolean } = {},
): Promise<AgentRunOutcome> => {
  const delegation = task.aiAgent;
  if (!delegation || delegation.assignee !== 'ai') return { ok: false, summary: 'Inte en AI-uppgift', accesses: [], stopped: 'error' };

  // Persist agent state to the local delegation map (decoupled from sync).
  const persist = async (patch: Partial<AiTaskDelegation>) => {
    await patchDelegation(task._id, patch).catch(() => {});
  };

  // Budget guard: don't run a task past its allowed number of runs.
  if (isOverRunBudget(delegation)) {
    await persist({ status: 'done', result: 'Körbudget uppnådd.' });
    return { ok: false, summary: 'Körbudget uppnådd', accesses: [], stopped: 'error' };
  }

  await persist({ status: 'running', lastRunAt: new Date().toISOString(), runCount: (delegation.runCount || 0) + 1 });

  const config = await resolveModelConfig(delegation);
  // Local models need a GGUF path, not an API key; remote ones need a key (unless the
  // provider marks it optional). Either path must resolve a model first.
  if (!config || !config.model || (!config.local && !config.apiKey && !API_PROVIDERS[config.sendProvider]?.apiKeyOptional)) {
    await persist({ status: 'error', result: 'Saknar modell/nyckel-konfiguration för agenten.' });
    return { ok: false, summary: 'Saknar modellkonfiguration', accesses: [], stopped: 'error' };
  }

  const accesses: AgentAccess[] = [];
  const invokeModel = async (messages: ChatMessage[]): Promise<string> => {
    // Local on-device model: run via llama.rn. Works in the background too (when the
    // "AI-arbete i bakgrunden" setting keeps the engine resident); honest caveat — a
    // large model may not finish within iOS's short background window and will simply
    // retry on the next wake. Remote API/Hermes runs are unaffected.
    if (config.local && config.localModelPath) {
      if (!modelManager.isAvailable()) throw new Error('Lokal AI-motor saknas i detta bygge.');
      await modelManager.load(config.localModelPath);
      return await modelManager.complete(messages, { shouldStop: opts.isAborted });
    }
    const res = await generateApiProviderResponse({
      provider: config.sendProvider,
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      history: messages,
    });
    return res.text;
  };

  const system = buildAgentSystem(task, delegation, config.baseUrl || '');
  const result = await runAgentTask({
    system,
    goal: `Utför uppgiften "${task.title}" nu och bocka av den när den är klar.`,
    maxSteps: resolveMaxSteps(delegation),
    tokenBudget: resolveTokenBudget(delegation),
    deps: {
      invokeModel,
      executeTool: buildToolExecutor(),
      isAborted: opts.isAborted,
      onAccess: (a) => { accesses.push(a); opts.onAccess?.(a); },
    },
  });

  const ok = result.stopped === 'done';
  const budgetNote = result.stopped === 'budget' ? ` (tokenbudget nådd, ~${result.tokensUsed} tokens)` : '';
  const summary = ((result.finalText || '').slice(0, 500) || `Avslutad (${result.stopped}).`) + budgetNote;
  await persist({ status: ok ? 'done' : 'error', result: summary });
  // Transparent log of exactly what the agent read/did this run.
  await setRunLogEntry(task._id, {
    at: new Date().toISOString(),
    stopped: result.stopped,
    summary,
    accesses: accesses.map((a) => ({ kind: a.kind, id: a.id, title: a.title, at: a.at })),
  });
  return { ok, summary, accesses, stopped: result.stopped };
};

/** Convenience: read the delegation summary for display. */
export const describeDelegation = (d?: AiTaskDelegation | null): string => {
  if (!d || d.assignee !== 'ai') return '';
  const src = d.source === 'local' ? 'Lokal' : d.source === 'hermes' ? 'Hermes' : 'API';
  return `${src}${d.model ? ` · ${d.model}` : ''}${d.localOnly ? ' · endast lokalt' : ''}`;
};
