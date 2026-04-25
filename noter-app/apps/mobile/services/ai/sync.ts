import { AIProject, ChatMessage, Conversation } from '@repo/ai';
import { decrypt, decryptV3, encryptV3 } from '@repo/shared';
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
  value.startsWith('noter:v3:') ||
  value.startsWith('U2FsdGVkX1') ||
  /^[A-Za-z0-9+/=]{32,}$/.test(value);

const safeDecrypt = async (value: unknown) => {
  if (typeof value !== 'string') return '';
  if (value.startsWith('noter:v3:')) {
    const decrypted = await decryptV3(value);
    return decrypted || '';
  }
  const decrypted = decrypt(value);
  if (decrypted) return decrypted;
  return looksEncrypted(value) ? '' : value;
};

const toEncryptedConversation = async (conversation: LocalConversation) => ({
  id: conversation.id,
  titleEnc: await encryptV3(conversation.title || ''),
  modelEnc: conversation.model ? await encryptV3(conversation.model) : '',
  projectIdEnc: conversation.projectId ? await encryptV3(conversation.projectId) : '',
  iconEnc: conversation.icon ? await encryptV3(conversation.icon) : '',
  iconColorEnc: conversation.iconColor ? await encryptV3(conversation.iconColor) : '',
  createdAtEnc: await encryptV3(conversation.createdAt),
  updatedAtEnc: await encryptV3(conversation.updatedAt),
  updatedAt: conversation.updatedAt,
});

const toEncryptedMessage = async (conversationId: string, message: ChatMessage) => ({
  id: String(message.id || ''),
  conversationId,
  roleEnc: await encryptV3(message.role),
  contentEnc: await encryptV3(message.content || ''),
  toolCallsEnc: message.toolCalls ? await encryptV3(JSON.stringify(message.toolCalls)) : '',
  toolCallIdEnc: message.toolCallId ? await encryptV3(message.toolCallId) : '',
  createdAtEnc: await encryptV3(message.createdAt || new Date().toISOString()),
  createdAt: message.createdAt || new Date().toISOString(),
});

const toEncryptedProject = async (project: LocalAIProject) => ({
  id: project.id,
  nameEnc: await encryptV3(project.name || ''),
  systemPromptEnc: project.systemPrompt ? await encryptV3(project.systemPrompt) : '',
  iconEnc: project.icon ? await encryptV3(project.icon) : '',
  iconColorEnc: project.iconColor ? await encryptV3(project.iconColor) : '',
  createdAtEnc: await encryptV3(project.createdAt),
  updatedAtEnc: await encryptV3(project.updatedAt),
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
      conversations: await Promise.all((payload.conversations || []).filter((item) => !item.localOnly).map(toEncryptedConversation)),
      messages: await Promise.all((payload.messages || []).map((item) => toEncryptedMessage(item.conversationId, item.message))),
      projects: await Promise.all((payload.projects || []).filter((item) => !item.localOnly).map(toEncryptedProject)),
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
      conversations: await Promise.all((data?.conversations || []).map(async (item: any) => ({
        id: item.id,
        title: await safeDecrypt(item.titleEnc || ''),
        model: item.modelEnc ? await safeDecrypt(item.modelEnc) : undefined,
        projectId: item.projectIdEnc ? await safeDecrypt(item.projectIdEnc) : undefined,
        icon: item.iconEnc ? await safeDecrypt(item.iconEnc) : undefined,
        iconColor: item.iconColorEnc ? await safeDecrypt(item.iconColorEnc) : undefined,
        createdAt: await safeDecrypt(item.createdAtEnc || ''),
        updatedAt: await safeDecrypt(item.updatedAtEnc || ''),
        messages: [],
        localOnly: false,
      }))) as Conversation[],
      messages: await Promise.all((data?.messages || []).map(async (item: any) => {
        let toolCalls: any[] | undefined;
        if (item.toolCallsEnc) {
          try {
            toolCalls = JSON.parse(await safeDecrypt(item.toolCallsEnc));
          } catch {}
        }
        return {
          conversationId: item.conversationId,
          message: {
            id: item.id,
            role: await safeDecrypt(item.roleEnc || '') as any,
            content: await safeDecrypt(item.contentEnc || ''),
            toolCalls,
            toolCallId: item.toolCallIdEnc ? await safeDecrypt(item.toolCallIdEnc) : undefined,
            createdAt: await safeDecrypt(item.createdAtEnc || ''),
          } as ChatMessage,
        };
      })),
      projects: await Promise.all((data?.projects || []).map(async (item: any) => ({
        id: item.id,
        name: await safeDecrypt(item.nameEnc || ''),
        systemPrompt: item.systemPromptEnc ? await safeDecrypt(item.systemPromptEnc) : '',
        icon: item.iconEnc ? await safeDecrypt(item.iconEnc) : undefined,
        iconColor: item.iconColorEnc ? await safeDecrypt(item.iconColorEnc) : undefined,
        createdAt: await safeDecrypt(item.createdAtEnc || ''),
        updatedAt: await safeDecrypt(item.updatedAtEnc || ''),
        localOnly: false,
      }))) as AIProject[],
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
