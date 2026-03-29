import { AIProject, ChatMessage, Conversation } from '@repo/ai';
import { decrypt, encrypt } from '@repo/shared';
import { fetchWithAuth } from '../api';

type LocalConversation = Conversation & { localOnly?: boolean };
type LocalAIProject = AIProject & { localOnly?: boolean };
type PullAiSyncResult = {
  conversations: Conversation[];
  messages: Array<{ conversationId: string; message: ChatMessage }>;
  projects: AIProject[];
};

const PULL_DEDUP_TTL_MS = 1200;
let pullInFlight: Promise<PullAiSyncResult> | null = null;
let lastPullAt = 0;
let lastPullResult: PullAiSyncResult | null = null;

const looksEncrypted = (value: string) =>
  value.startsWith('U2FsdGVkX1') ||
  /^[A-Za-z0-9+/=]{32,}$/.test(value);

const safeDecrypt = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const decrypted = decrypt(value);
  if (decrypted) return decrypted;
  return looksEncrypted(value) ? '' : value;
};

const toEncryptedConversation = (conversation: LocalConversation) => ({
  id: conversation.id,
  titleEnc: encrypt(conversation.title || ''),
  modelEnc: conversation.model ? encrypt(conversation.model) : '',
  projectIdEnc: conversation.projectId ? encrypt(conversation.projectId) : '',
  iconEnc: conversation.icon ? encrypt(conversation.icon) : '',
  iconColorEnc: conversation.iconColor ? encrypt(conversation.iconColor) : '',
  createdAtEnc: encrypt(conversation.createdAt),
  updatedAtEnc: encrypt(conversation.updatedAt),
  updatedAt: conversation.updatedAt,
});

const toEncryptedMessage = (conversationId: string, message: ChatMessage) => ({
  id: String(message.id || ''),
  conversationId,
  roleEnc: encrypt(message.role),
  contentEnc: encrypt(message.content || ''),
  toolCallsEnc: message.toolCalls ? encrypt(JSON.stringify(message.toolCalls)) : '',
  toolCallIdEnc: message.toolCallId ? encrypt(message.toolCallId) : '',
  createdAtEnc: encrypt(message.createdAt || new Date().toISOString()),
  createdAt: message.createdAt || new Date().toISOString(),
});

const toEncryptedProject = (project: LocalAIProject) => ({
  id: project.id,
  nameEnc: encrypt(project.name || ''),
  systemPromptEnc: project.systemPrompt ? encrypt(project.systemPrompt) : '',
  iconEnc: project.icon ? encrypt(project.icon) : '',
  iconColorEnc: project.iconColor ? encrypt(project.iconColor) : '',
  createdAtEnc: encrypt(project.createdAt),
  updatedAtEnc: encrypt(project.updatedAt),
  updatedAt: project.updatedAt,
});

export const pushAiSync = async (payload: {
  conversations?: LocalConversation[];
  messages?: Array<{ conversationId: string; message: ChatMessage }>;
  projects?: LocalAIProject[];
  deletedConversationIds?: string[];
  deletedProjectIds?: string[];
}) => {
  await fetchWithAuth('/ai/sync/push', {
    method: 'POST',
    body: JSON.stringify({
      conversations: (payload.conversations || []).filter((item) => !item.localOnly).map(toEncryptedConversation),
      messages: (payload.messages || []).map((item) => toEncryptedMessage(item.conversationId, item.message)),
      projects: (payload.projects || []).filter((item) => !item.localOnly).map(toEncryptedProject),
      deletedConversationIds: payload.deletedConversationIds || [],
      deletedProjectIds: payload.deletedProjectIds || [],
    }),
  });
};

export const pullAiSync = async () => {
  const now = Date.now();
  if (lastPullResult && now - lastPullAt < PULL_DEDUP_TTL_MS) return lastPullResult;
  if (pullInFlight) return pullInFlight;
  pullInFlight = (async () => {
    const data = await fetchWithAuth('/ai/sync/pull');
    const result: PullAiSyncResult = {
      conversations: (data?.conversations || []).map((item: any) => ({
        id: item.id,
        title: safeDecrypt(item.titleEnc || ''),
        model: item.modelEnc ? safeDecrypt(item.modelEnc) : undefined,
        projectId: item.projectIdEnc ? safeDecrypt(item.projectIdEnc) : undefined,
        icon: item.iconEnc ? safeDecrypt(item.iconEnc) : undefined,
        iconColor: item.iconColorEnc ? safeDecrypt(item.iconColorEnc) : undefined,
        createdAt: safeDecrypt(item.createdAtEnc || ''),
        updatedAt: safeDecrypt(item.updatedAtEnc || ''),
        messages: [],
        localOnly: false,
      })) as Conversation[],
      messages: (data?.messages || []).map((item: any) => {
        let toolCalls: any[] | undefined;
        if (item.toolCallsEnc) {
          try {
            toolCalls = JSON.parse(safeDecrypt(item.toolCallsEnc));
          } catch {}
        }
        return {
          conversationId: item.conversationId,
          message: {
            id: item.id,
            role: safeDecrypt(item.roleEnc || '') as any,
            content: safeDecrypt(item.contentEnc || ''),
            toolCalls,
            toolCallId: item.toolCallIdEnc ? safeDecrypt(item.toolCallIdEnc) : undefined,
            createdAt: safeDecrypt(item.createdAtEnc || ''),
          } as ChatMessage,
        };
      }),
      projects: (data?.projects || []).map((item: any) => ({
        id: item.id,
        name: safeDecrypt(item.nameEnc || ''),
        systemPrompt: item.systemPromptEnc ? safeDecrypt(item.systemPromptEnc) : '',
        icon: item.iconEnc ? safeDecrypt(item.iconEnc) : undefined,
        iconColor: item.iconColorEnc ? safeDecrypt(item.iconColorEnc) : undefined,
        createdAt: safeDecrypt(item.createdAtEnc || ''),
        updatedAt: safeDecrypt(item.updatedAtEnc || ''),
        localOnly: false,
      })) as AIProject[],
    };
    lastPullAt = Date.now();
    lastPullResult = result;
    return result;
  })();
  try {
    return await pullInFlight;
  } finally {
    pullInFlight = null;
  }
};
