import { decrypt } from '@repo/shared';
import AIConversationSync from '../../models/AIConversationSync';
import AIMessageSync from '../../models/AIMessageSync';
import McpAuditLog from '../../models/McpAuditLog';
import Note from '../../models/Note';
import Task from '../../models/Task';
import { listMcpAuditForUser } from './auditStore';

type DashboardRange = '1d' | '7d' | '30d' | '90d' | '365d';
type DashboardGroup = 'hour' | 'day' | 'week';
type DashboardSort = 'asc' | 'desc';

const toTrimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const toDateSafe = (value: unknown) => {
  if (!value) return null;
  const raw = typeof value === 'string' ? value : String(value);
  const decrypted = decrypt(raw) || raw;
  const d = new Date(decrypted);
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

const toTextSafe = (value: unknown) => {
  if (value == null) return '';
  const raw = typeof value === 'string' ? value : String(value);
  return decrypt(raw) || raw;
};

const toBoolSafe = (value: unknown) => {
  const text = toTextSafe(value).toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return false;
};

const countWords = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

const getRangeMs = (range: DashboardRange) => {
  if (range === '1d') return 24 * 60 * 60 * 1000;
  if (range === '7d') return 7 * 24 * 60 * 60 * 1000;
  if (range === '90d') return 90 * 24 * 60 * 60 * 1000;
  if (range === '365d') return 365 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
};

const toRange = (value: unknown): DashboardRange => {
  const raw = toTrimmed(value);
  if (raw === '1d' || raw === '7d' || raw === '30d' || raw === '90d' || raw === '365d') return raw;
  return '30d';
};

const toGroup = (value: unknown, range: DashboardRange): DashboardGroup => {
  const raw = toTrimmed(value);
  if (raw === 'hour' || raw === 'day' || raw === 'week') return raw;
  if (range === '1d') return 'hour';
  if (range === '365d') return 'week';
  return 'day';
};

const toSort = (value: unknown): DashboardSort => (toTrimmed(value).toLowerCase() === 'asc' ? 'asc' : 'desc');
const toRoleFilter = (value: unknown) => {
  const role = toTrimmed(value).toLowerCase();
  if (!role || role === 'all') return '';
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role;
  return '';
};
const toTextFilter = (value: unknown) => toTrimmed(value).toLowerCase();
const toDateInput = (value: unknown) => {
  const raw = toTrimmed(value);
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

const startOfWeek = (d: Date) => {
  const next = new Date(d);
  const weekday = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - weekday);
  next.setHours(0, 0, 0, 0);
  return next;
};

const bucketKey = (d: Date, group: DashboardGroup) => {
  if (group === 'hour') {
    const next = new Date(d);
    next.setMinutes(0, 0, 0);
    return next.toISOString();
  }
  if (group === 'week') {
    return startOfWeek(d).toISOString();
  }
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
};

const bucketLabel = (key: string, group: DashboardGroup) => {
  const d = new Date(key);
  if (group === 'hour') return d.toLocaleString('sv-SE', { month: '2-digit', day: '2-digit', hour: '2-digit' });
  if (group === 'week') return `v.${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  return d.toLocaleDateString('sv-SE');
};

type UsagePoint = {
  messages: number;
  inputCharacters: number;
  inputWords: number;
  assistantCharacters: number;
  assistantWords: number;
  tasksCreated: number;
  tasksCompleted: number;
  notesCreated: number;
  mcpActions: number;
};

const getUsageSeries = (events: Array<{ at: Date; role?: string; chars?: number; words?: number; type: keyof UsagePoint }>, group: DashboardGroup) => {
  const map = new Map<string, UsagePoint>();
  for (const event of events) {
    const key = bucketKey(event.at, group);
    const row = map.get(key) || {
      messages: 0,
      inputCharacters: 0,
      inputWords: 0,
      assistantCharacters: 0,
      assistantWords: 0,
      tasksCreated: 0,
      tasksCompleted: 0,
      notesCreated: 0,
      mcpActions: 0,
    };
    if (event.type === 'messages') row.messages += 1;
    if (event.type === 'inputCharacters') row.inputCharacters += event.chars || 0;
    if (event.type === 'inputWords') row.inputWords += event.words || 0;
    if (event.type === 'assistantCharacters') row.assistantCharacters += event.chars || 0;
    if (event.type === 'assistantWords') row.assistantWords += event.words || 0;
    if (event.type === 'tasksCreated') row.tasksCreated += 1;
    if (event.type === 'tasksCompleted') row.tasksCompleted += 1;
    if (event.type === 'notesCreated') row.notesCreated += 1;
    if (event.type === 'mcpActions') row.mcpActions += 1;
    map.set(key, row);
  }
  return [...map.entries()]
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([key, value]) => ({
      bucket: key,
      label: bucketLabel(key, group),
      ...value,
    }));
};

export const getSystemDashboardForUser = async (params: {
  userId: string;
  range?: unknown;
  group?: unknown;
  sort?: unknown;
  logLimit?: unknown;
  from?: unknown;
  to?: unknown;
  service?: unknown;
  action?: unknown;
  role?: unknown;
}) => {
  const userId = toTrimmed(params.userId);
  if (!userId) throw new Error('userId krävs');
  const range = toRange(params.range);
  const group = toGroup(params.group, range);
  const sort = toSort(params.sort);
  const serviceFilter = toTextFilter(params.service);
  const actionFilter = toTextFilter(params.action);
  const roleFilter = toRoleFilter(params.role);
  const rawLimit = Number(params.logLimit);
  const logLimit = Number.isFinite(rawLimit) ? Math.max(20, Math.min(Math.trunc(rawLimit), 500)) : 120;
  const now = Date.now();
  const defaultStartAt = new Date(now - getRangeMs(range));
  const inputFrom = toDateInput(params.from);
  const inputTo = toDateInput(params.to);
  const startAt = inputFrom || defaultStartAt;
  const endAt = inputTo || new Date(now);
  if (startAt.getTime() > endAt.getTime()) {
    throw new Error('Ogiltigt tidsintervall');
  }

  const [notes, tasks, conversationsCount, messages] = await Promise.all([
    Note.find({ userId }).lean(),
    Task.find({ userId }).lean(),
    AIConversationSync.countDocuments({ userId }),
    AIMessageSync.find({ userId, createdAt: { $gte: startAt } }).sort({ createdAt: -1 }).limit(4000).lean(),
  ]);

  const notesWithDates = notes
    .map((note: any) => ({ at: toDateSafe(note.createdAt) }))
    .filter((item) => item.at && item.at.getTime() >= startAt.getTime()) as Array<{ at: Date }>;

  const tasksParsed = tasks.map((task: any) => ({
    createdAt: toDateSafe(task.createdAt),
    completed: toBoolSafe(task.completed),
    updatedAt: toDateSafe(task.updatedAt),
  }));

  const tasksInRange = tasksParsed.filter((task) => task.createdAt && task.createdAt.getTime() >= startAt.getTime()) as Array<{ createdAt: Date; completed: boolean; updatedAt: Date | null }>;
  const completedInRange = tasksParsed.filter((task) => task.completed && task.updatedAt && task.updatedAt.getTime() >= startAt.getTime()) as Array<{ updatedAt: Date }>;
  const tasksCompletedTotal = tasksParsed.filter((task) => task.completed).length;

  const parsedMessages = messages.map((message: any) => {
    const role = toTextSafe(message.roleEnc);
    const content = toTextSafe(message.contentEnc);
    const chars = content.length;
    const words = countWords(content);
    const createdAt = message.createdAt instanceof Date ? message.createdAt : toDateSafe(message.createdAtEnc) || new Date();
    return { role, chars, words, createdAt };
  }).filter((message) => {
    const ts = message.createdAt.getTime();
    if (ts < startAt.getTime() || ts > endAt.getTime()) return false;
    if (roleFilter && message.role.toLowerCase() !== roleFilter) return false;
    return true;
  });

  const inputStats = parsedMessages.filter((message) => message.role.toLowerCase() === 'user');
  const assistantStats = parsedMessages.filter((message) => message.role.toLowerCase() === 'assistant');
  const totalInputCharacters = inputStats.reduce((sum, item) => sum + item.chars, 0);
  const totalInputWords = inputStats.reduce((sum, item) => sum + item.words, 0);
  const totalAssistantCharacters = assistantStats.reduce((sum, item) => sum + item.chars, 0);
  const totalAssistantWords = assistantStats.reduce((sum, item) => sum + item.words, 0);

  const persistedAudit = await listMcpAuditForUser({ userId, limit: logLimit });
  const filteredAudit = persistedAudit
    .filter((row) => {
      const at = Number(row.at);
      if (!Number.isFinite(at) || at < startAt.getTime() || at > endAt.getTime()) return false;
      if (serviceFilter && String(row.service || '').toLowerCase() !== serviceFilter) return false;
      if (actionFilter && String(row.action || '').toLowerCase() !== actionFilter) return false;
      return true;
    })
    .sort((a, b) => (sort === 'asc' ? a.at - b.at : b.at - a.at));

  const usageEvents: Array<{ at: Date; role?: string; chars?: number; words?: number; type: keyof UsagePoint }> = [];
  for (const message of parsedMessages) {
    usageEvents.push({ at: message.createdAt, type: 'messages' });
    if (message.role === 'user') {
      usageEvents.push({ at: message.createdAt, type: 'inputCharacters', chars: message.chars });
      usageEvents.push({ at: message.createdAt, type: 'inputWords', words: message.words });
    }
    if (message.role === 'assistant') {
      usageEvents.push({ at: message.createdAt, type: 'assistantCharacters', chars: message.chars });
      usageEvents.push({ at: message.createdAt, type: 'assistantWords', words: message.words });
    }
  }
  for (const note of notesWithDates) usageEvents.push({ at: note.at, type: 'notesCreated' });
  for (const task of tasksInRange) usageEvents.push({ at: task.createdAt, type: 'tasksCreated' });
  for (const item of completedInRange) usageEvents.push({ at: item.updatedAt, type: 'tasksCompleted' });
  for (const item of filteredAudit) usageEvents.push({ at: new Date(item.at), type: 'mcpActions' });

  const usageSeries = getUsageSeries(usageEvents, group);
  const hourByWeekday = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    label: ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'][weekday],
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
  }));
  for (const message of parsedMessages) {
    const d = message.createdAt;
    const weekday = (d.getDay() + 6) % 7;
    const hour = d.getHours();
    hourByWeekday[weekday].hours[hour].count += 1;
  }
  const hourCounts = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: hourByWeekday.reduce((sum, row) => sum + row.hours[hour].count, 0),
  })).sort((a, b) => b.count - a.count);

  const localStorageRows = {
    notes: notes.length,
    tasks: tasks.length,
    aiConversations: conversationsCount,
    aiMessagesInRange: parsedMessages.length,
    mcpAuditRecords: await McpAuditLog.countDocuments({ userId }),
  };

  const tasksOpenTotal = Math.max(0, tasks.length - tasksCompletedTotal);
  return {
    now,
    userId,
    filters: {
      range,
      group,
      sort,
      logLimit,
      service: serviceFilter || 'all',
      action: actionFilter || 'all',
      role: roleFilter || 'all',
      from: startAt.toISOString(),
      to: endAt.toISOString(),
    },
    adminSettings: {
      transportPolicy: 'https-required-outside-localhost',
      dashboardScope: 'user-only',
      auditRetentionDays: 45,
      mcpAuditKeyRotation: 'enabled',
      mcpAuditVersionedPayload: 'v1',
    },
    availableFilters: {
      services: ['all', ...Array.from(new Set(persistedAudit.map((row) => String(row.service || '').trim()).filter(Boolean))).sort()],
      actions: ['all', ...Array.from(new Set(persistedAudit.map((row) => String(row.action || '').trim()).filter(Boolean))).sort()],
      roles: ['all', ...Array.from(new Set(messages.map((message: any) => toTextSafe(message.roleEnc).toLowerCase()).filter(Boolean))).sort()],
    },
    summary: {
      notesTotal: notes.length,
      tasksTotal: tasks.length,
      tasksCompletedTotal,
      tasksOpenTotal,
      aiConversationsTotal: conversationsCount,
      aiMessagesInRange: parsedMessages.length,
      inputCharactersInRange: totalInputCharacters,
      inputWordsInRange: totalInputWords,
      assistantCharactersInRange: totalAssistantCharacters,
      assistantWordsInRange: totalAssistantWords,
      mcpAuditInRange: filteredAudit.length,
    },
    localDatabaseOverview: localStorageRows,
    usageSeries,
    usageHeatmap: {
      hourByWeekday,
      peakHours: hourCounts.slice(0, 5),
    },
    logs: {
      mcpAudit: filteredAudit.slice(0, logLimit),
      aiMessages: parsedMessages
        .sort((a, b) => (sort === 'asc' ? a.createdAt.getTime() - b.createdAt.getTime() : b.createdAt.getTime() - a.createdAt.getTime()))
        .slice(0, Math.min(logLimit, 200))
        .map((item) => ({
          at: item.createdAt.getTime(),
          role: item.role,
          characters: item.chars,
          words: item.words,
        })),
    },
  };
};
