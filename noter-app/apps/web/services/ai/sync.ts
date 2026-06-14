import { AIProject, ChatMessage, Conversation } from '@repo/ai';
import { encrypt, safeDecrypt } from '@repo/shared';
import { getApiBaseUrl } from '../api';
import { readStoredToken } from '../../lib/authStorage';

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

const getHeaders = () => {
  const token = readStoredToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const baseUrl = () => `${getApiBaseUrl().replace(/\/+$/, '')}/ai/sync`;

// Shared safeDecrypt (single source of truth) — handles plaintext/legacy/v3.

const fetchJsonWithRetry = async (url: string, options: RequestInit, retries = 2) => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        if (response.status >= 500 && attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        throw new Error(`AI sync request failed: ${response.status}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI sync request failed');
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
  const body = {
    conversations: (payload.conversations || []).filter((item) => !item.localOnly).map(toEncryptedConversation),
    messages: (payload.messages || []).map((item) => toEncryptedMessage(item.conversationId, item.message)),
    projects: (payload.projects || []).filter((item) => !item.localOnly).map(toEncryptedProject),
    deletedConversationIds: payload.deletedConversationIds || [],
    deletedProjectIds: payload.deletedProjectIds || [],
  };
  await fetchJsonWithRetry(`${baseUrl()}/push`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
};

export const pullAiSync = async () => {
  const now = Date.now();
  if (lastPullResult && now - lastPullAt < PULL_DEDUP_TTL_MS) return lastPullResult;
  if (pullInFlight) return pullInFlight;
  pullInFlight = (async () => {
    const data = await fetchJsonWithRetry(`${baseUrl()}/pull`, {
      method: 'GET',
      headers: getHeaders(),
    });
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
