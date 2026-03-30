'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage, HFModel, HFFile, Conversation, AIProject } from '@repo/ai';
import { AI_PROMPT_PRESETS, AiPromptPreset, AiToolAccessMode, MCP_INTEGRATIONS, McpUiSettings, buildAiSessionInsights, buildAiSyncNotice, buildToolUseNotice, createEmptyMcpUiSettings, decrypt, encrypt, getAiPromptPresetPrompt, isMutatingAiTool, normalizeMcpUiSettings, resolveMcpSettings, toEffectiveMcpUiSettings } from '@repo/shared';
import { db } from '../services/db';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../stores/useStore';
import { LmStudioModel, normalizeLmStudioBaseUrl, buildLmStudioHeaders, splitSseBuffer, extractLmStudioText } from '../services/lmstudio';
import { FaBars, FaCog, FaPlus, FaRegSmile, FaComments, FaCopy } from 'react-icons/fa';
import * as FaIcons from 'react-icons/fa';
import { IconPicker } from './IconPicker';
import { getApiBaseUrl } from '../services/api';
import { shouldStopToolIteration, toToolCallKeys, toToolIterationSignature } from '../services/ai/toolChain';
import { ApiProviderType, generateApiProviderResponse } from '../services/ai/apiProviders';
import { pullAiSync, pushAiSync } from '../services/ai/sync';
import { connectSocket, socket } from '../services/socket';
import { buildSecurityNoteMap, isReadableWithLocks } from '../services/ai/security';
import i18n from '../app/i18n';
import { getWebAuthTokenSync } from '../services/authStorage';

type LocalConversation = Conversation & { localOnly?: boolean; userId?: string };
type LocalAIProject = AIProject & { localOnly?: boolean; userId?: string };
type McpFetchDiagnostics = {
  level: 'idle' | 'ok' | 'warning' | 'error';
  message: string;
  endpoint: string;
  attempted: string[];
  fromCache: boolean;
  lastSuccessAt: number | null;
};

export const AISidebar = () => {
  const { user, token, notes, tasks } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [width, setWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const isElectron = typeof window !== 'undefined' && (window as any).mlc?.isElectron;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  // Chat State
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; type: string; size: number; content: string; encoding: 'text' | 'base64' }>>([]);
  const [lmTokensPerSecond, setLmTokensPerSecond] = useState<number | null>(null);
  const [showThinking, setShowThinking] = useState(true);
  const [showTokensPerSecond, setShowTokensPerSecond] = useState(true);
  const [autoScrollOnSend, setAutoScrollOnSend] = useState(true);
  const [enableEmojiPicker, setEnableEmojiPicker] = useState(true);
  const [enableAttachments, setEnableAttachments] = useState(true);
  const [enableToolUse, setEnableToolUse] = useState(true);
  const [toolAccessMode, setToolAccessMode] = useState<AiToolAccessMode>('full');
  const [promptPreset, setPromptPreset] = useState<AiPromptPreset>('balanced');
  const [syncWithBackend, setSyncWithBackend] = useState(true);
  const [collapsedThinking, setCollapsedThinking] = useState<Record<string, boolean>>({});
  const [collapsedTool, setCollapsedTool] = useState<Record<string, boolean>>({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [toolSettingsOpen, setToolSettingsOpen] = useState(false);
  const [scrollSignal, setScrollSignal] = useState(0);
  const scrollBottomRef = useRef<HTMLDivElement | null>(null);
  const assistantSaveRef = useRef<Record<string, number>>({});
  const assistantConvRef = useRef<Record<string, string>>({});
  const assistantCreatedRef = useRef<Record<string, string>>({});
  const draftInputRef = useRef('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const mcpDashboardRequestIdRef = useRef(0);
  const systemDashboardRequestIdRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const activeChatIdRef = useRef<string | null>(null);
  
  // History State
  const [conversations, setConversations] = useState<LocalConversation[]>([]);
  const [projects, setProjects] = useState<LocalAIProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectDialogId, setProjectDialogId] = useState<string | null>(null);
  const [projectDialogName, setProjectDialogName] = useState('');
  const [projectDialogPrompt, setProjectDialogPrompt] = useState('');
  const [projectDialogIcon, setProjectDialogIcon] = useState('FaFolder');
  const [projectDialogIconColor, setProjectDialogIconColor] = useState('#000000');
  const [projectDialogLocalOnly, setProjectDialogLocalOnly] = useState(false);
  const [projectConfirmDeleteId, setProjectConfirmDeleteId] = useState<string | null>(null);
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [chatDialogId, setChatDialogId] = useState<string | null>(null);
  const [chatDialogName, setChatDialogName] = useState('');
  const [chatDialogIcon, setChatDialogIcon] = useState('FaComments');
  const [chatDialogIconColor, setChatDialogIconColor] = useState('#000000');
  const [chatDialogLocalOnly, setChatDialogLocalOnly] = useState(false);
  const [chatConfirmDeleteId, setChatConfirmDeleteId] = useState<string | null>(null);
  const [iconPickerTarget, setIconPickerTarget] = useState<'project' | 'chat' | null>(null);

  // Model State
  const [aiUseApiProviders, setAiUseApiProviders] = useState(false);
  const [aiProvider, setAiProvider] = useState<'mlc' | 'lmstudio' | ApiProviderType>('mlc');
  const [modelPath, setModelPath] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HFModel[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [localModels, setLocalModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<HFModel | null>(null);
  const [modelFiles, setModelFiles] = useState<HFFile[]>([]);
  const [modelFilesError, setModelFilesError] = useState<string | null>(null);
  const [conversionHealthText, setConversionHealthText] = useState('');
  const [conversionHealthDetailText, setConversionHealthDetailText] = useState('');
  const [conversionHealthLoading, setConversionHealthLoading] = useState(false);
  const [useGpu, setUseGpu] = useState(false);
  const [gpuLayers, setGpuLayers] = useState(32);
  const [lmBaseUrl, setLmBaseUrl] = useState('http://localhost:1234');
  const [lmToken, setLmToken] = useState('');
  const [lmModels, setLmModels] = useState<LmStudioModel[]>([]);
  const [lmSelectedModel, setLmSelectedModel] = useState<string>('');
  const [lmLoading, setLmLoading] = useState(false);
  const [lmError, setLmError] = useState<string | null>(null);
  const [apiProvider, setApiProvider] = useState<ApiProviderType>('openrouter');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [openRouterModel, setOpenRouterModel] = useState('openai/gpt-4o-mini');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [mcpSettings, setMcpSettings] = useState<McpUiSettings>(() => createEmptyMcpUiSettings());
  const [mcpDashboardOpen, setMcpDashboardOpen] = useState(false);
  const [mcpDashboardLoading, setMcpDashboardLoading] = useState(false);
  const [mcpDashboardError, setMcpDashboardError] = useState<string | null>(null);
  const [mcpDashboardData, setMcpDashboardData] = useState<any | null>(null);
  const [systemDashboardOpen, setSystemDashboardOpen] = useState(false);
  const [systemDashboardLoading, setSystemDashboardLoading] = useState(false);
  const [systemDashboardError, setSystemDashboardError] = useState<string | null>(null);
  const [systemDashboardData, setSystemDashboardData] = useState<any | null>(null);
  const [systemDashboardRange, setSystemDashboardRange] = useState<'1d' | '7d' | '30d' | '90d' | '365d'>('30d');
  const [systemDashboardGroup, setSystemDashboardGroup] = useState<'hour' | 'day' | 'week'>('day');
  const [systemDashboardSort, setSystemDashboardSort] = useState<'asc' | 'desc'>('desc');
  const [systemDashboardTab, setSystemDashboardTab] = useState<'overview' | 'usage' | 'logs' | 'storage' | 'settings'>('overview');
  const [systemDashboardServiceFilter, setSystemDashboardServiceFilter] = useState('all');
  const [systemDashboardActionFilter, setSystemDashboardActionFilter] = useState('all');
  const [systemDashboardRoleFilter, setSystemDashboardRoleFilter] = useState('all');
  const [systemDashboardFrom, setSystemDashboardFrom] = useState('');
  const [systemDashboardTo, setSystemDashboardTo] = useState('');
  const [systemDashboardLogQuery, setSystemDashboardLogQuery] = useState('');
  const [storageJsonQuery, setStorageJsonQuery] = useState('');
  const [storageJsonSection, setStorageJsonSection] = useState<'all' | 'localNotes' | 'localTasks' | 'localConversations' | 'localMessagesByConversation' | 'zustandNotes' | 'zustandTasks'>('all');
  const [storageTreeCollapsed, setStorageTreeCollapsed] = useState<Record<string, boolean>>({});
  const [systemDashboardStandaloneOpen, setSystemDashboardStandaloneOpen] = useState(false);
  const [systemDashboardDiagnostics, setSystemDashboardDiagnostics] = useState<McpFetchDiagnostics>({
    level: 'idle',
    message: '',
    endpoint: '',
    attempted: [],
    fromCache: false,
    lastSuccessAt: null,
  });
  const [mcpDashboardDiagnostics, setMcpDashboardDiagnostics] = useState<McpFetchDiagnostics>({
    level: 'idle',
    message: '',
    endpoint: '',
    attempted: [],
    fromCache: false,
    lastSuccessAt: null,
  });
  const [localDbSnapshot, setLocalDbSnapshot] = useState<any | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const activeProvider = aiUseApiProviders ? apiProvider : (aiProvider === 'lmstudio' ? 'lmstudio' : 'mlc');
  const getActiveModelLabel = () => {
    if (activeProvider === 'lmstudio') return lmSelectedModel;
    if (activeProvider === 'mlc') return modelPath;
    if (activeProvider === 'openrouter') return openRouterModel;
    return geminiModel;
  };
  const enabledMcpServices = React.useMemo(
    () => (Object.keys(mcpSettings) as Array<keyof McpUiSettings>).filter((key) => Boolean(mcpSettings[key]?.enabled)) as string[],
    [mcpSettings]
  );
  const sessionInsights = React.useMemo(
    () =>
      buildAiSessionInsights({
        providerLabel: activeProvider === 'openrouter' ? 'OpenRouter' : activeProvider === 'gemini' ? 'Gemini' : activeProvider === 'lmstudio' ? 'LM Studio' : 'MLC',
        modelLabel: getActiveModelLabel() || 'Ingen modell vald',
        syncEnabled: syncWithBackend,
        toolUseEnabled: enableToolUse,
        toolAccessMode,
        promptPreset,
        enabledMcpServices,
      }),
    [activeProvider, enableToolUse, enabledMcpServices, geminiModel, lmSelectedModel, modelPath, openRouterModel, promptPreset, syncWithBackend, toolAccessMode]
  );

  const getUserId = () => user?._id || (user as any)?.id || '';
  const getUserScopedKey = (key: string) => {
    const userId = getUserId();
    return userId ? `${key}:${userId}` : key;
  };
  const getSystemPromptKey = () => getUserScopedKey('aiSystemPrompt');
  const getProjectsKey = () => getUserScopedKey('aiProjects');
  const getMcpSettingsKey = () => getUserScopedKey('aiMcpSettings');
  const getSystemDashboardCacheKey = () => getUserScopedKey('aiSystemDashboardCache');
  const getMcpDashboardCacheKey = () => getUserScopedKey('aiMcpDashboardCache');

  const getLastConversationKey = (userId: string) => `ai:lastConversation:${userId}`;

  const persistLastConversation = (userId: string, conversationId: string | null) => {
    if (!userId || typeof window === 'undefined') return;
    const key = getLastConversationKey(userId);
    if (!conversationId) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, encrypt(conversationId));
  };

  const loadLastConversation = (userId: string) => {
    if (!userId || typeof window === 'undefined') return null;
    const key = getLastConversationKey(userId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const id = decrypt(stored);
    return id || null;
  };

  const getStoredValue = async (key: string) => {
    if (typeof window === 'undefined') return null;
    if (isElectron && (window as any).mlc?.getSetting) {
      const value = await (window as any).mlc.getSetting(key);
      return value ?? null;
    }
    return localStorage.getItem(key);
  };

  const isSensitiveSettingKey = (key: string) => {
    const lower = key.toLowerCase();
    if (lower.includes('token')) return true;
    if (lower.includes('apikey')) return true;
    if (lower.includes('api_key')) return true;
    if (lower.includes('password')) return true;
    if (lower.includes('mcp')) return true;
    return false;
  };

  const setStoredValue = (key: string, value: string | null) => {
    if (typeof window === 'undefined') return;
    const sensitive = isSensitiveSettingKey(key);
    if (isElectron && (window as any).mlc?.setSetting) {
      (window as any).mlc.setSetting(key, value);
      if (sensitive) {
        if (value === null) localStorage.removeItem(key);
        return;
      }
    }
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  };

  const settingsWriteTimersRef = useRef<Map<string, number>>(new Map());
  const sidebarResizeFrameRef = useRef<number | null>(null);

  const persistStoredValue = (key: string, value: string | null, delay = 160) => {
    if (typeof window === 'undefined') return;
    const existing = settingsWriteTimersRef.current.get(key);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timeoutId = window.setTimeout(() => {
      settingsWriteTimersRef.current.delete(key);
      setStoredValue(key, value);
    }, delay);
    settingsWriteTimersRef.current.set(key, timeoutId);
  };

  useEffect(() => {
    return () => {
      settingsWriteTimersRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      settingsWriteTimersRef.current.clear();
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current);
      }
    };
  }, []);

  const getMcpEnvValues = (): Record<string, string | undefined> => {
    const env = process.env as Record<string, string | undefined>;
    return {
      MCP_SLACK_ENABLED: env.NEXT_PUBLIC_MCP_SLACK_ENABLED ?? env.MCP_SLACK_ENABLED,
      SLACK_MCP_ENABLED: env.NEXT_PUBLIC_SLACK_MCP_ENABLED ?? env.SLACK_MCP_ENABLED,
      MCP_SLACK_BOT_TOKEN: env.NEXT_PUBLIC_MCP_SLACK_BOT_TOKEN ?? env.MCP_SLACK_BOT_TOKEN,
      SLACK_BOT_TOKEN: env.NEXT_PUBLIC_SLACK_BOT_TOKEN ?? env.SLACK_BOT_TOKEN,
      MCP_SLACK_TEAM_ID: env.NEXT_PUBLIC_MCP_SLACK_TEAM_ID ?? env.MCP_SLACK_TEAM_ID,
      SLACK_TEAM_ID: env.NEXT_PUBLIC_SLACK_TEAM_ID ?? env.SLACK_TEAM_ID,
      MCP_SLACK_CHANNEL_IDS: env.NEXT_PUBLIC_MCP_SLACK_CHANNEL_IDS ?? env.MCP_SLACK_CHANNEL_IDS,
      SLACK_CHANNEL_IDS: env.NEXT_PUBLIC_SLACK_CHANNEL_IDS ?? env.SLACK_CHANNEL_IDS,
      MCP_GOOGLE_WORKSPACE_ENABLED: env.NEXT_PUBLIC_MCP_GOOGLE_WORKSPACE_ENABLED ?? env.MCP_GOOGLE_WORKSPACE_ENABLED,
      GOOGLE_WORKSPACE_MCP_ENABLED: env.NEXT_PUBLIC_GOOGLE_WORKSPACE_MCP_ENABLED ?? env.GOOGLE_WORKSPACE_MCP_ENABLED,
      MCP_GOOGLE_OAUTH_CLIENT_ID: env.NEXT_PUBLIC_MCP_GOOGLE_OAUTH_CLIENT_ID ?? env.MCP_GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_ID: env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? env.GOOGLE_OAUTH_CLIENT_ID,
      MCP_GOOGLE_OAUTH_CLIENT_SECRET: env.NEXT_PUBLIC_MCP_GOOGLE_OAUTH_CLIENT_SECRET ?? env.MCP_GOOGLE_OAUTH_CLIENT_SECRET,
      GOOGLE_OAUTH_CLIENT_SECRET: env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_SECRET ?? env.GOOGLE_OAUTH_CLIENT_SECRET,
      MCP_GOOGLE_OAUTH_REDIRECT_URI: env.NEXT_PUBLIC_MCP_GOOGLE_OAUTH_REDIRECT_URI ?? env.MCP_GOOGLE_OAUTH_REDIRECT_URI,
      GOOGLE_OAUTH_REDIRECT_URI: env.NEXT_PUBLIC_GOOGLE_OAUTH_REDIRECT_URI ?? env.GOOGLE_OAUTH_REDIRECT_URI,
      MCP_GOOGLE_OAUTH_PATH: env.NEXT_PUBLIC_MCP_GOOGLE_OAUTH_PATH ?? env.MCP_GOOGLE_OAUTH_PATH,
      GOOGLE_OAUTH_PATH: env.NEXT_PUBLIC_GOOGLE_OAUTH_PATH ?? env.GOOGLE_OAUTH_PATH,
      MCP_NOTION_ENABLED: env.NEXT_PUBLIC_MCP_NOTION_ENABLED ?? env.MCP_NOTION_ENABLED,
      NOTION_MCP_ENABLED: env.NEXT_PUBLIC_NOTION_MCP_ENABLED ?? env.NOTION_MCP_ENABLED,
      MCP_NOTION_API_TOKEN: env.NEXT_PUBLIC_MCP_NOTION_API_TOKEN ?? env.MCP_NOTION_API_TOKEN,
      NOTION_API_TOKEN: env.NEXT_PUBLIC_NOTION_API_TOKEN ?? env.NOTION_API_TOKEN,
      MCP_NOTION_WORKSPACE_ID: env.NEXT_PUBLIC_MCP_NOTION_WORKSPACE_ID ?? env.MCP_NOTION_WORKSPACE_ID,
      NOTION_WORKSPACE_ID: env.NEXT_PUBLIC_NOTION_WORKSPACE_ID ?? env.NOTION_WORKSPACE_ID,
      MCP_FILESYSTEM_ENABLED: env.NEXT_PUBLIC_MCP_FILESYSTEM_ENABLED ?? env.MCP_FILESYSTEM_ENABLED,
      FILESYSTEM_MCP_ENABLED: env.NEXT_PUBLIC_FILESYSTEM_MCP_ENABLED ?? env.FILESYSTEM_MCP_ENABLED,
      MCP_FILESYSTEM_ALLOWED_PATHS: env.NEXT_PUBLIC_MCP_FILESYSTEM_ALLOWED_PATHS ?? env.MCP_FILESYSTEM_ALLOWED_PATHS,
      FILESYSTEM_ALLOWED_PATHS: env.NEXT_PUBLIC_FILESYSTEM_ALLOWED_PATHS ?? env.FILESYSTEM_ALLOWED_PATHS,
      MCP_PLAYWRIGHT_ENABLED: env.NEXT_PUBLIC_MCP_PLAYWRIGHT_ENABLED ?? env.MCP_PLAYWRIGHT_ENABLED,
      PLAYWRIGHT_MCP_ENABLED: env.NEXT_PUBLIC_PLAYWRIGHT_MCP_ENABLED ?? env.PLAYWRIGHT_MCP_ENABLED,
      MCP_PLAYWRIGHT_BROWSER: env.NEXT_PUBLIC_MCP_PLAYWRIGHT_BROWSER ?? env.MCP_PLAYWRIGHT_BROWSER,
      PLAYWRIGHT_BROWSER: env.NEXT_PUBLIC_PLAYWRIGHT_BROWSER ?? env.PLAYWRIGHT_BROWSER,
      MCP_PLAYWRIGHT_HEADLESS: env.NEXT_PUBLIC_MCP_PLAYWRIGHT_HEADLESS ?? env.MCP_PLAYWRIGHT_HEADLESS,
      PLAYWRIGHT_HEADLESS: env.NEXT_PUBLIC_PLAYWRIGHT_HEADLESS ?? env.PLAYWRIGHT_HEADLESS,
      MCP_PLAYWRIGHT_CHANNEL: env.NEXT_PUBLIC_MCP_PLAYWRIGHT_CHANNEL ?? env.MCP_PLAYWRIGHT_CHANNEL,
      PLAYWRIGHT_CHANNEL: env.NEXT_PUBLIC_PLAYWRIGHT_CHANNEL ?? env.PLAYWRIGHT_CHANNEL,
    };
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    let mounted = true;
    (async () => {
      const savedApiToggle = await getStoredValue('aiUseApiProviders');
      if (mounted && savedApiToggle) setAiUseApiProviders(savedApiToggle === 'true');
      const savedProvider = await getStoredValue('aiProvider');
      if (mounted && (savedProvider === 'lmstudio' || savedProvider === 'mlc' || savedProvider === 'openrouter' || savedProvider === 'gemini')) {
        setAiProvider(savedProvider as any);
      }
      
      const savedLmBase = await getStoredValue('lmstudioBaseUrl');
      if (mounted && savedLmBase) setLmBaseUrl(normalizeLmStudioBaseUrl(savedLmBase));
      
      const savedLmToken = await getStoredValue('lmstudioToken');
      if (mounted && savedLmToken) setLmToken(savedLmToken);
      
      const savedLmModel = await getStoredValue('lmstudioModel');
      if (mounted && savedLmModel) setLmSelectedModel(savedLmModel);

      const savedApiProvider = await getStoredValue('aiApiProvider');
      if (mounted && (savedApiProvider === 'openrouter' || savedApiProvider === 'gemini')) {
        setApiProvider(savedApiProvider);
      }
      const savedOpenRouterKey = await getStoredValue('openrouterApiKey');
      if (mounted && savedOpenRouterKey) setOpenRouterApiKey(decrypt(savedOpenRouterKey) || savedOpenRouterKey);
      const savedOpenRouterModel = await getStoredValue('openrouterModel');
      if (mounted && savedOpenRouterModel) setOpenRouterModel(savedOpenRouterModel);
      const savedGeminiKey = await getStoredValue('geminiApiKey');
      if (mounted && savedGeminiKey) setGeminiApiKey(decrypt(savedGeminiKey) || savedGeminiKey);
      const savedGeminiModel = await getStoredValue('geminiModel');
      if (mounted && savedGeminiModel) setGeminiModel(savedGeminiModel);
      const savedMcpSettings = await getStoredValue(getMcpSettingsKey());
      let parsedMcpSettings = createEmptyMcpUiSettings();
      if (savedMcpSettings) {
        try {
          parsedMcpSettings = normalizeMcpUiSettings(JSON.parse(decrypt(savedMcpSettings) || savedMcpSettings || '{}'));
        } catch {}
      }
      const resolvedMcpSettings = resolveMcpSettings(parsedMcpSettings, getMcpEnvValues());
      if (mounted) setMcpSettings(toEffectiveMcpUiSettings(resolvedMcpSettings));
      
      const savedSystemPrompt = await getStoredValue(getSystemPromptKey());
      if (mounted && savedSystemPrompt) {
        const decryptedPrompt = decrypt(savedSystemPrompt) || savedSystemPrompt;
        setSystemPrompt(decryptedPrompt);
      }
      
      const savedProjectId = await getStoredValue('aiActiveProjectId');
      if (mounted && savedProjectId) setActiveProjectId(savedProjectId);
      
      const savedShowThinking = await getStoredValue('aiShowThinking');
      if (mounted && savedShowThinking) setShowThinking(savedShowThinking === 'true');
      
      const savedShowTps = await getStoredValue('aiShowTokensPerSecond');
      if (mounted && savedShowTps) setShowTokensPerSecond(savedShowTps === 'true');
      
      const savedAutoScroll = await getStoredValue('aiAutoScroll');
      if (mounted && savedAutoScroll) setAutoScrollOnSend(savedAutoScroll === 'true');
      
      const savedEmoji = await getStoredValue('aiEnableEmoji');
      if (mounted && savedEmoji) setEnableEmojiPicker(savedEmoji === 'true');
      
      const savedAttachments = await getStoredValue('aiEnableAttachments');
      if (mounted && savedAttachments) setEnableAttachments(savedAttachments === 'true');
      
      const savedToolUse = await getStoredValue('aiToolUseEnabled');
      if (mounted && savedToolUse) setEnableToolUse(savedToolUse === 'true');
      const savedToolAccessMode = await getStoredValue('aiToolAccessMode');
      if (mounted && (savedToolAccessMode === 'read-only' || savedToolAccessMode === 'full')) setToolAccessMode(savedToolAccessMode);
      const savedPromptPreset = await getStoredValue('aiPromptPreset');
      if (mounted && (savedPromptPreset === 'balanced' || savedPromptPreset === 'research' || savedPromptPreset === 'execution' || savedPromptPreset === 'concise')) {
        setPromptPreset(savedPromptPreset);
      }
      const savedSyncWithBackend = await getStoredValue('aiSyncWithBackend');
      if (mounted && savedSyncWithBackend) setSyncWithBackend(savedSyncWithBackend === 'true');
      
      const savedWidth = await getStoredValue('aiSidebarWidth');
      if (mounted && savedWidth) {
        const parsed = Number(savedWidth);
        if (Number.isFinite(parsed)) setWidth(Math.min(600, Math.max(260, parsed)));
      }
      if (mounted) {
          setSettingsLoaded(true);
      }
    })();
    return () => { mounted = false; };
  }, [user]); // Re-load if user changes (login/logout)

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiProvider', aiProvider);
  }, [aiProvider, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiUseApiProviders', String(aiUseApiProviders));
  }, [aiUseApiProviders, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiToolAccessMode', toolAccessMode);
  }, [toolAccessMode, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiPromptPreset', promptPreset);
  }, [promptPreset, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiSyncWithBackend', String(syncWithBackend));
  }, [syncWithBackend, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistLmStudioSettings({ baseUrl: lmBaseUrl });
  }, [lmBaseUrl, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistLmStudioSettings({ token: lmToken });
  }, [lmToken, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (lmSelectedModel) persistLmStudioSettings({ model: lmSelectedModel });
  }, [lmSelectedModel, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiApiProvider', apiProvider);
  }, [apiProvider, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('openrouterApiKey', openRouterApiKey ? encrypt(openRouterApiKey) : null, 260);
  }, [openRouterApiKey, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('openrouterModel', openRouterModel || null);
  }, [openRouterModel, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('geminiApiKey', geminiApiKey ? encrypt(geminiApiKey) : null, 260);
  }, [geminiApiKey, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('geminiModel', geminiModel || null);
  }, [geminiModel, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue(getMcpSettingsKey(), encrypt(JSON.stringify(mcpSettings)), 220);
  }, [mcpSettings, settingsLoaded, user]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue(getSystemPromptKey(), encrypt(systemPrompt), 220);
  }, [systemPrompt, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiShowThinking', String(showThinking));
  }, [showThinking, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiShowTokensPerSecond', String(showTokensPerSecond));
  }, [showTokensPerSecond, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiAutoScroll', String(autoScrollOnSend));
  }, [autoScrollOnSend, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiEnableEmoji', String(enableEmojiPicker));
    if (!enableEmojiPicker) setEmojiOpen(false);
  }, [enableEmojiPicker, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiEnableAttachments', String(enableAttachments));
    if (!enableAttachments) setAttachments([]);
  }, [enableAttachments, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiToolUseEnabled', String(enableToolUse));
  }, [enableToolUse, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    persistStoredValue('aiSidebarWidth', String(width), 100);
  }, [width, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (activeProjectId) persistStoredValue('aiActiveProjectId', activeProjectId);
    else persistStoredValue('aiActiveProjectId', null);
  }, [activeProjectId, settingsLoaded]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isOpen) {
      document.body.classList.add('ai-sidebar-open');
      document.documentElement.style.setProperty('--ai-sidebar-width', `${width}px`);
    } else {
      document.body.classList.remove('ai-sidebar-open');
      document.documentElement.style.setProperty('--ai-sidebar-width', '0px');
    }
  }, [isOpen, width]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (event: MouseEvent) => {
      const nextWidth = Math.max(260, Math.min(window.innerWidth - event.clientX, 600));
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current);
      }
      sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
        setWidth((prev) => (prev === nextWidth ? prev : nextWidth));
        sidebarResizeFrameRef.current = null;
      });
    };
    const handleUp = () => setIsResizing(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current);
        sidebarResizeFrameRef.current = null;
      }
    };
  }, [isResizing]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleToggle = () => setIsOpen(prev => !prev);
    const handleOpenDashboard = () => {
      setIsOpen(true);
      setIsSettingsOpen(false);
      setSystemDashboardOpen(true);
      setSystemDashboardStandaloneOpen(true);
      setSystemDashboardTab('overview');
      loadSystemDashboard();
      loadLocalDbSnapshot();
    };
    window.addEventListener('ai-sidebar-toggle', handleToggle as EventListener);
    window.addEventListener('open-system-dashboard', handleOpenDashboard as EventListener);
    return () => {
      window.removeEventListener('ai-sidebar-toggle', handleToggle as EventListener);
      window.removeEventListener('open-system-dashboard', handleOpenDashboard as EventListener);
    };
  }, []);

  useEffect(() => {
    if (scrollSignal === 0) return;
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scrollSignal]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (projectDialogOpen) setProjectDialogOpen(false);
        if (chatDialogOpen) setChatDialogOpen(false);
        if (projectConfirmDeleteId) setProjectConfirmDeleteId(null);
        if (chatConfirmDeleteId) setChatConfirmDeleteId(null);
      }
      if (e.key === 'Enter') {
        if (projectConfirmDeleteId) {
          e.preventDefault();
          confirmDeleteProject();
        } else if (chatConfirmDeleteId) {
          e.preventDefault();
          confirmDeleteChat();
        }
      }
    };
    if (projectDialogOpen || chatDialogOpen || projectConfirmDeleteId || chatConfirmDeleteId) {
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }
  }, [projectDialogOpen, chatDialogOpen, projectConfirmDeleteId, chatConfirmDeleteId]);

  useEffect(() => {
    if (aiUseApiProviders || activeProvider !== 'lmstudio') return;
    if (!isOpen || !user) return;
    if (lmModels.length > 0) return;
    handleRefreshLmModels();
  }, [aiUseApiProviders, activeProvider, isOpen, user, lmModels.length]);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setCurrentConversationId(null);
      setMessages([]);
      setProjects([]);
      setSystemPrompt('');
      return;
    }
    loadConversations();
    loadProjects();
  }, [user]);

  useEffect(() => {
    if (!user || !isOpen || !syncWithBackend) return;
    const handler = () => {
      if (document.visibilityState === 'hidden') return;
      loadConversations();
      loadProjects();
    };
    connectSocket();
    socket.on('ai:sync-updated', handler);
    const refreshInterval = window.setInterval(handler, 20000);
    const focusHandler = () => handler();
    window.addEventListener('focus', focusHandler);
    document.addEventListener('visibilitychange', focusHandler);
    return () => {
      socket.off('ai:sync-updated', handler);
      window.clearInterval(refreshInterval);
      window.removeEventListener('focus', focusHandler);
      document.removeEventListener('visibilitychange', focusHandler);
    };
  }, [user, isOpen, syncWithBackend]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const savedSystemPrompt = await getStoredValue(getSystemPromptKey());
      if (savedSystemPrompt) {
        const decryptedPrompt = decrypt(savedSystemPrompt) || savedSystemPrompt;
        setSystemPrompt(decryptedPrompt);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!isElectron) return;
    const unsubscribeProgress = (window as any).mlc.onDownloadProgress((data: any) => {
      if (!data?.id) return;
      setDownloadProgress(prev => ({ ...prev, [data.id]: Math.round((data.progress || 0) * 100) }));
    });
    const unsubscribeTokens = (window as any).mlc.onChatToken((data: any) => {
      if (!data?.chatId || !data?.token) return;
      if (stopRequestedRef.current && activeChatIdRef.current === data.chatId) return;
      setMessages(prev => {
        let nextContent = '';
        const updated = prev.map(m => {
          if (m.id !== data.chatId) return m;
          nextContent = (m.content || '') + data.token;
          return { ...m, content: nextContent };
        });
        const convId = assistantConvRef.current[data.chatId];
        if (convId && nextContent) {
          saveAssistantProgress(convId, data.chatId, nextContent);
        }
        return updated;
      });
    });
    return () => {
      unsubscribeProgress?.();
      unsubscribeTokens?.();
    };
  }, [isElectron]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    refreshConversionHealth().catch(() => {});
  }, [isSettingsOpen]);

  const loadConversations = async () => {
      const userId = getUserId();
      let convs = await db.getConversations(userId || undefined);
      if (syncWithBackend) {
        try {
          const remote = await pullAiSync();
          for (const conversation of remote.conversations) {
            await db.saveConversation({ ...conversation, userId: userId || undefined });
          }
          for (const row of remote.messages) {
            await db.saveMessage(row.conversationId, row.message);
          }
          convs = await db.getConversations(userId || undefined);
        } catch {}
      }
      let normalized = convs;
      if (userId) {
        const missingUser = convs.filter(c => !c.userId);
        for (const conv of missingUser) {
          const updated = { ...conv, userId };
          await db.saveConversation(updated);
        }
        normalized = convs.map(c => c.userId ? c : { ...c, userId });
      }
      setConversations(normalized);
      const lastId = userId ? loadLastConversation(userId) : null;
      if (lastId && normalized.some(c => c.id === lastId)) {
        setCurrentConversationId(lastId);
        const msgs = await db.getMessages(lastId);
        setMessages(msgs);
      } else if (normalized.length > 0) {
        setCurrentConversationId(normalized[0].id);
        const msgs = await db.getMessages(normalized[0].id);
        setMessages(msgs);
      } else {
        setCurrentConversationId(null);
        setMessages([]);
      }
  };

  const createNewConversation = async () => {
      const newId = uuidv4();
      const userId = getUserId();
      const newConv: LocalConversation = {
          id: newId,
          title: 'New Chat',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
          model: getActiveModelLabel(),
          projectId: activeProjectId || undefined,
          icon: 'FaComments',
          iconColor: '#000000',
          localOnly: !syncWithBackend,
          userId: userId || undefined
      };
      await db.saveConversation(newConv);
      if (!newConv.localOnly) {
        try {
          await syncConversationPayload({ conversations: [newConv] });
        } catch {}
      }
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversationId(newId);
      if (userId) persistLastConversation(userId, newId);
      setMessages([]);
      setScrollSignal(prev => prev + 1);
  };

  const loadConversation = async (id: string) => {
      const msgs = await db.getMessages(id);
      setMessages(msgs);
      setCurrentConversationId(id);
      const userId = getUserId();
      if (userId) persistLastConversation(userId, id);
      const conv = conversations.find(c => c.id === id);
      if (conv?.projectId) setActiveProjectId(conv.projectId);
      else setActiveProjectId(null);
      setScrollSignal(prev => prev + 1);
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await db.deleteConversation(id);
      try {
        await syncConversationPayload({ deletedConversationIds: [id] });
      } catch {}
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
          setCurrentConversationId(null);
          setMessages([]);
          const userId = getUserId();
          if (userId) persistLastConversation(userId, null);
      }
  };

  const fetchLocalModels = async () => {
    try {
        if (isElectron) {
            const data = await (window as any).mlc.getModels();
            setLocalModels(data);
            if (data.length > 0 && !modelPath) {
                setModelPath(data[0].path);
            }
            return;
        }
        const res = await fetch('/app/api/ai/models/download');
        if (res.ok) {
            const data = await res.json();
            setLocalModels(data);
            if (data.length > 0 && !modelPath) {
                setModelPath(data[0].name);
            }
        }
    } catch (e) {
        console.error(e);
    }
  };

  const refreshConversionHealth = async () => {
    setConversionHealthLoading(true);
    try {
      const res = await fetch('/app/api/ai/models/health', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Health check failed');
      }
      if (data.mode === 'external') {
        setConversionHealthText('Serverkonvertering används för GGUF → MLC.');
      } else if (data.localBinaryAvailable && data.storageWritable) {
        setConversionHealthText('Lokal MLC-konvertering är redo.');
      } else if (!data.localBinaryAvailable) {
        setConversionHealthText('MLC-binären saknas eller kan inte startas.');
      } else if (!data.storageWritable) {
        setConversionHealthText('MLC-lagringen är inte skrivbar.');
      } else {
        setConversionHealthText('');
      }
      setConversionHealthDetailText([data.resolvedCommand ? `MLC: ${data.resolvedCommand}` : '', data.installHint || ''].filter(Boolean).join(' · '));
    } catch (error: any) {
      setConversionHealthText(error?.message || 'Kunde inte läsa MLC-status.');
      setConversionHealthDetailText('');
    } finally {
      setConversionHealthLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery) return;
    try {
        if (isElectron) {
            const data = await (window as any).mlc.searchModels({ query: searchQuery });
            setSearchResults(data);
            setSelectedModel(null);
            return;
        }
        const res = await fetch(`/app/api/ai/models/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(data);
        setSelectedModel(null);
    } catch (e) {
        console.error(e);
    }
  };

  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  const combineSystemPrompts = (mainPrompt: string, projectPrompt?: string) => {
    if (mainPrompt && projectPrompt) return `${mainPrompt}\n\n${projectPrompt}`;
    return mainPrompt || projectPrompt || '';
  };

  const emojiCategories = [
    { label: 'Ansikten', items: ['😀', '😁', '😂', '🤣', '😊', '😍', '😎', '😅', '🥳', '🤔', '😴', '😭'] },
    { label: 'Händer', items: ['👍', '👎', '👏', '🙏', '🤝', '💪', '👋', '✌️'] },
    { label: 'Symboler', items: ['✅', '❌', '⚠️', '🔥', '⭐', '✨', '💡', '🎯'] },
    { label: 'Saker', items: ['📌', '📎', '🧩', '📝', '📂', '🧠', '🔒', '🔓'] },
  ];

  const getIconComponent = (name?: string) => {
    const Icon = (FaIcons as any)[name || 'FaComments'] || FaComments;
    return Icon;
  };

  const parseThinking = (content: string) => {
    const tagMatch = content.match(/<think>([\s\S]*?)<\/think>/i) || content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    if (tagMatch) {
      const thinking = tagMatch[1].trim();
      const rest = content.replace(tagMatch[0], '').trim();
      return { thinking, rest };
    }
    const blockMatch = content.match(/```thinking([\s\S]*?)```/i);
    if (blockMatch) {
      const thinking = blockMatch[1].trim();
      const rest = content.replace(blockMatch[0], '').trim();
      return { thinking, rest };
    }
    return { thinking: '', rest: content };
  };

  const toolIcons: Record<string, string> = {
    list_notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 6h14M5 12h14M5 18h10" stroke-width="1.6"/></svg>',
    get_note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 3h9l5 5v13H6z" stroke-width="1.6"/><path d="M15 3v5h5" stroke-width="1.6"/></svg>',
    create_note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 3h9l5 5v13H6z" stroke-width="1.6"/><path d="M12 12v6M9 15h6" stroke-width="1.6"/></svg>',
    update_note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 3h9l5 5v13H6z" stroke-width="1.6"/><path d="M9 15h6" stroke-width="1.6"/></svg>',
    delete_note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14" stroke-width="1.6"/></svg>',
    list_tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6h11M9 12h11M9 18h11" stroke-width="1.6"/><path d="M3 6l1.5 1.5L7 5" stroke-width="1.6"/></svg>',
    get_task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="1.6"/><path d="M8 12l2 2 5-5" stroke-width="1.6"/></svg>',
    create_task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="1.6"/><path d="M12 9v6M9 12h6" stroke-width="1.6"/></svg>',
    update_task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="1.6"/><path d="M8 12h8" stroke-width="1.6"/></svg>',
    delete_task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14" stroke-width="1.6"/></svg>',
  };

  const toolStatusIcons: Record<string, string> = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 12l4 4L19 6" stroke-width="2"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6l-12 12" stroke-width="2"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 8h.01M11 12h2v6h-2z" stroke-width="2"/></svg>',
  };

  const parseToolMessage = (content: string) => {
    const callMatch = content.match(/^Tool call:\s*([^\s]+)\s*(.*)$/);
    if (callMatch) return { kind: 'call', tool: callMatch[1], details: callMatch[2].trim(), payload: null };
    const resultMatch = content.match(/^Tool result:\s*([^\s]+)\s*(.*)$/);
    if (resultMatch) {
      const details = resultMatch[2].trim();
      let payload: any = null;
      try {
        payload = details ? JSON.parse(details) : null;
      } catch {}
      return { kind: 'result', tool: resultMatch[1], details, payload };
    }
    const errorMatch = content.match(/^Tool error:\s*([^\s]+)\s*(.*)$/);
    if (errorMatch) return { kind: 'error', tool: errorMatch[1], details: errorMatch[2].trim(), payload: null };
    return { kind: 'tool', tool: 'tool', details: content, payload: null };
  };

  const getToolStatus = (info: { kind: string; tool: string; payload: any }) => {
    if (info.kind === 'error') return { label: 'Misslyckades', tone: 'error' };
    if (info.kind !== 'result') return { label: 'Körs', tone: 'info' };
    const data = info.payload || {};
    switch (info.tool) {
      case 'create_note':
        return { label: data?.createNote?._id ? 'Anteckning skapad' : 'Skapade anteckning', tone: 'success' };
      case 'update_note':
        return { label: data?.updateNote?._id ? 'Anteckning uppdaterad' : 'Uppdaterade anteckning', tone: 'success' };
      case 'delete_note':
        return { label: data?.deleteNote ? 'Anteckning borttagen' : 'Borttagning misslyckades', tone: data?.deleteNote ? 'success' : 'error' };
      case 'list_notes':
        return { label: `Hittade ${Array.isArray(data?.notes) ? data.notes.length : 0} anteckningar`, tone: 'success' };
      case 'get_note':
        return { label: data?.note?._id ? 'Anteckning hämtad' : 'Hämtning misslyckades', tone: data?.note?._id ? 'success' : 'error' };
      case 'create_task':
        return { label: data?.createTask?._id ? 'Uppgift skapad' : 'Skapade uppgift', tone: 'success' };
      case 'update_task':
        return { label: data?.updateTask?._id ? 'Uppgift uppdaterad' : 'Uppdaterade uppgift', tone: 'success' };
      case 'delete_task':
        return { label: data?.deleteTask ? 'Uppgift borttagen' : 'Borttagning misslyckades', tone: data?.deleteTask ? 'success' : 'error' };
      case 'list_tasks':
        return { label: `Hittade ${Array.isArray(data?.tasks) ? data.tasks.length : 0} uppgifter`, tone: 'success' };
      case 'get_task':
        return { label: data?.task?._id ? 'Uppgift hämtad' : 'Hämtning misslyckades', tone: data?.task?._id ? 'success' : 'error' };
      default:
        return { label: 'Klart', tone: 'success' };
    }
  };

  const formatTime = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  const getRecommendedFile = (files: HFFile[]) => {
    const priorities = ['Q4_K_M', 'Q5_K_M', 'Q4_0', 'Q5_0', 'Q8_0'];
    for (const quant of priorities) {
      const hit = files.find(f => f.quantization === quant);
      if (hit) return hit;
    }
    if (files.length === 0) return null;
    return [...files].sort((a, b) => a.size - b.size)[0];
  };

  const getActiveProject = () => projects.find(p => p.id === activeProjectId) || null;
  const isConversationLocalOnly = (conversationId: string) =>
    Boolean(conversations.find((item) => item.id === conversationId)?.localOnly);
  const syncConversationPayload = async (payload: Parameters<typeof pushAiSync>[0]) => {
    if (!syncWithBackend) {
      return;
    }
    await pushAiSync(payload);
  };

  const saveProjects = (next: LocalAIProject[]) => {
    if (typeof window === 'undefined') return;
    const payload = encrypt(JSON.stringify(next));
    setStoredValue(getProjectsKey(), payload);
  };

  const loadProjects = async () => {
    if (typeof window === 'undefined') return;
    const raw = await getStoredValue(getProjectsKey());
    let localProjects: LocalAIProject[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(decrypt(raw) || raw);
        if (Array.isArray(parsed)) localProjects = parsed;
      } catch {}
    }
    if (syncWithBackend) {
      try {
        const remote = await pullAiSync();
        const byId = new Map<string, AIProject>();
        for (const item of localProjects) byId.set(item.id, item);
        for (const item of remote.projects) byId.set(item.id, item);
        const merged = Array.from(byId.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        setProjects(merged);
        saveProjects(merged);
        return;
      } catch {}
    }
    setProjects(localProjects);
  };

  const openNewProjectDialog = () => {
    setProjectDialogId(null);
    setProjectDialogName('');
    setProjectDialogPrompt('');
    setProjectDialogIcon('FaFolder');
    setProjectDialogIconColor('#000000');
    setProjectDialogLocalOnly(!syncWithBackend);
    setProjectDialogOpen(true);
  };

  const openEditProjectDialog = (project: LocalAIProject) => {
    setProjectDialogId(project.id);
    setProjectDialogName(project.name);
    setProjectDialogPrompt(project.systemPrompt || '');
    setProjectDialogIcon(project.icon || 'FaFolder');
    setProjectDialogIconColor(project.iconColor || '#000000');
    setProjectDialogLocalOnly(Boolean(project.localOnly));
    setProjectDialogOpen(true);
  };

  const saveProject = () => {
    const now = new Date().toISOString();
    if (!projectDialogName.trim()) return;
    if (projectDialogId) {
      const next = projects.map(p => p.id === projectDialogId ? { ...p, name: projectDialogName.trim(), systemPrompt: projectDialogPrompt, icon: projectDialogIcon, iconColor: projectDialogIconColor, localOnly: projectDialogLocalOnly, updatedAt: now, userId: getUserId() } : p);
      setProjects(next);
      saveProjects(next);
      const updated = next.find(p => p.id === projectDialogId);
      if (updated) {
        if (updated.localOnly) syncConversationPayload({ deletedProjectIds: [updated.id] }).catch(() => {});
        else syncConversationPayload({ projects: [updated] }).catch(() => {});
      }
    } else {
      const project: LocalAIProject = {
        id: uuidv4(),
        name: projectDialogName.trim(),
        systemPrompt: projectDialogPrompt,
        icon: projectDialogIcon,
        iconColor: projectDialogIconColor,
        localOnly: projectDialogLocalOnly,
        createdAt: now,
        updatedAt: now,
        userId: getUserId(),
      };
      const next = [project, ...projects];
      setProjects(next);
      saveProjects(next);
      if (!project.localOnly) {
        syncConversationPayload({ projects: [project] }).catch(() => {});
      }
    }
    setProjectDialogOpen(false);
  };

  const deleteProject = (id: string) => {
    setProjectConfirmDeleteId(id);
  };

  const confirmDeleteProject = () => {
    if (!projectConfirmDeleteId) return;
    const next = projects.filter(p => p.id !== projectConfirmDeleteId);
    setProjects(next);
    saveProjects(next);
    syncConversationPayload({ deletedProjectIds: [projectConfirmDeleteId] }).catch(() => {});
    if (activeProjectId === projectConfirmDeleteId) {
      setActiveProjectId(null);
    }
    setProjectConfirmDeleteId(null);
  };

  const cancelDeleteProject = () => setProjectConfirmDeleteId(null);

  const openChatDialog = (conv: LocalConversation) => {
    setChatDialogId(conv.id);
    setChatDialogName(conv.title || 'Ny chatt');
    setChatDialogIcon(conv.icon || 'FaComments');
    setChatDialogIconColor(conv.iconColor || '#000000');
    setChatDialogLocalOnly(Boolean(conv.localOnly));
    setChatDialogOpen(true);
  };

  const saveChatDialog = async () => {
    if (!chatDialogId || !chatDialogName.trim()) return;
    const next = conversations.map(c => c.id === chatDialogId ? { ...c, title: chatDialogName.trim(), icon: chatDialogIcon, iconColor: chatDialogIconColor, localOnly: chatDialogLocalOnly, updatedAt: new Date().toISOString() } : c);
    setConversations(next);
    const updated = next.find(c => c.id === chatDialogId) as LocalConversation;
    await db.saveConversation(updated);
    if (updated.localOnly) {
      await syncConversationPayload({ deletedConversationIds: [updated.id] }).catch(() => {});
    } else {
      await syncConversationPayload({ conversations: [updated] }).catch(() => {});
    }
    setChatDialogOpen(false);
  };

  const requestDeleteChat = (id: string) => {
    setChatConfirmDeleteId(id);
  };

  const confirmDeleteChat = async () => {
    if (!chatConfirmDeleteId) return;
    await db.deleteConversation(chatConfirmDeleteId);
    await syncConversationPayload({ deletedConversationIds: [chatConfirmDeleteId] }).catch(() => {});
    setConversations(prev => prev.filter(c => c.id !== chatConfirmDeleteId));
    if (currentConversationId === chatConfirmDeleteId) {
      setCurrentConversationId(null);
      setMessages([]);
    }
    setChatConfirmDeleteId(null);
  };

  const cancelDeleteChat = () => setChatConfirmDeleteId(null);


  const getEnabledMcpServices = () =>
    enabledMcpServices;

  const buildHistory = (userMsg: ChatMessage) => {
    const maxChars = 12000;
    const projectPrompt = getActiveProject()?.systemPrompt || '';
    const toolUseNotice = buildToolUseNotice(enableToolUse, toolAccessMode);
    const syncNotice = buildAiSyncNotice(syncWithBackend);
    const presetNotice = getAiPromptPresetPrompt(promptPreset);
    const combinedPrompt = combineSystemPrompts([presetNotice, systemPrompt, syncNotice, toolUseNotice].filter(Boolean).join('\n\n'), projectPrompt);
    const toolPrompt = enableToolUse ? toolSystemPrompt(getEnabledMcpServices()) : '';
    const fullPrompt = [combinedPrompt, toolPrompt].filter(Boolean).join('\n\n');
    const systemMsg = fullPrompt
      ? ({ id: 'system', role: 'system', content: fullPrompt, createdAt: new Date().toISOString() } as ChatMessage)
      : null;
    let total = systemMsg ? systemMsg.content.length : 0;
    const base = [...messages, userMsg];
    const trimmed: ChatMessage[] = [];
    for (let i = base.length - 1; i >= 0; i -= 1) {
      const content = base[i].content || '';
      const nextTotal = total + content.length;
      if (nextTotal > maxChars && trimmed.length > 0) break;
      total = nextTotal;
      trimmed.unshift(base[i]);
    }
    if (trimmed.length === 0) {
      trimmed.push(userMsg);
    }
    return systemMsg ? [systemMsg, ...trimmed] : trimmed;
  };

  const buildPromptText = (history: ChatMessage[]) => {
    return history.map(m => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'assistant') return `Assistant: ${m.content}`;
      if (m.role === 'tool') return `Tool: ${m.content}`;
      return `User: ${m.content}`;
    }).join('\n');
  };

  const buildToolReadTrace = (tool: string, result: any) => {
    if (tool === 'list_notes' || tool === 'list_projects' || tool === 'list_tasklists') {
      const items = Array.isArray(result?.notes) ? result.notes : [];
      return items.map((item: any) => ({
        type: item.type || 'note',
        id: item._id,
        title: item.title || '',
        contentPreview: String(item.content || '').slice(0, 400),
      }));
    }
    if (tool === 'get_note') {
      const item = result?.note;
      if (!item) return [];
      return [{
        type: item.type || 'note',
        id: item._id,
        title: item.title || '',
        contentPreview: String(item.content || '').slice(0, 600),
      }];
    }
    if (tool === 'list_tasks') {
      const items = Array.isArray(result?.tasks) ? result.tasks : [];
      return items.map((item: any) => ({
        type: 'task',
        id: item._id,
        title: item.title || '',
        descriptionPreview: String(item.description || '').slice(0, 400),
      }));
    }
    if (tool === 'get_task') {
      const item = result?.task;
      if (!item) return [];
      return [{
        type: 'task',
        id: item._id,
        title: item.title || '',
        descriptionPreview: String(item.description || '').slice(0, 600),
      }];
    }
    if (tool === 'mcp_list_tools') {
      const items = Array.isArray(result?.result?.tools) ? result.result.tools : [];
      return items.map((item: any) => ({
        type: 'mcp_tool',
        id: item.name || '',
        title: item.name || '',
        contentPreview: String(item.description || '').slice(0, 400),
      }));
    }
    if (tool === 'mcp_call_tool') {
      const entries = Array.isArray(result?.result?.content) ? result.result.content : [];
      return entries.map((entry: any, index: number) => ({
        type: 'mcp_result',
        id: String(index + 1),
        title: entry.type || 'content',
        contentPreview: String(entry.text || JSON.stringify(entry)).slice(0, 500),
      }));
    }
    return [];
  };

  const processToolCalls = async (conversationId: string, assistantId: string, assistantText: string, intentText: string): Promise<ChatMessage[]> => {
    if (!enableToolUse) return [];
    const { calls, cleaned } = extractToolCalls(assistantText);
    const newMessages: ChatMessage[] = [];

    if (cleaned !== assistantText) {
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: cleaned } : m));
      const cleanedMsg = { id: assistantId, role: 'assistant', content: cleaned, createdAt: assistantCreatedRef.current[assistantId] || new Date().toISOString() } as ChatMessage;
      await db.saveMessage(conversationId, cleanedMsg);
      if (!isConversationLocalOnly(conversationId)) {
        syncConversationPayload({ messages: [{ conversationId, message: cleanedMsg }] }).catch(() => {});
      }
    }
    if (calls.length === 0) return [];
    
    const summaries: string[] = [];
    const seen = new Set<string>();
    for (const call of calls) {
      const key = `${call.tool}:${JSON.stringify(call.arguments || {})}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const toolMsg: ChatMessage = {
        id: uuidv4(),
        role: 'tool',
        content: `Tool call: ${call.tool} ${JSON.stringify({ args: call.arguments || {} })}`,
        createdAt: new Date().toISOString()
      };
      setCollapsedTool(prev => ({ ...prev, [toolMsg.id as string]: true }));
      setMessages(prev => [...prev, toolMsg]);
      await db.saveMessage(conversationId, toolMsg);
      if (!isConversationLocalOnly(conversationId)) {
        syncConversationPayload({ messages: [{ conversationId, message: toolMsg }] }).catch(() => {});
      }
      newMessages.push(toolMsg);

      try {
        const result = await executeToolCall(call.tool, call.arguments || {}, intentText);
        if (['create_note', 'update_note', 'delete_note', 'create_project', 'update_project', 'delete_project'].includes(call.tool)) {
          try {
            await useStore.getState().fetchNotes();
          } catch {}
        }
        if (['create_task', 'update_task', 'delete_task', 'create_tasklist', 'update_tasklist', 'delete_tasklist'].includes(call.tool)) {
          try {
            await useStore.getState().fetchTasks();
          } catch {}
        }
        const status = getToolStatus({ kind: 'result', tool: call.tool, payload: result });
        summaries.push(status.label);
        const entitiesRead = buildToolReadTrace(call.tool, result);
        const resultMsg: ChatMessage = {
          id: uuidv4(),
          role: 'tool',
          content: `Tool result: ${call.tool} ${JSON.stringify({ entitiesRead, result })}`,
          createdAt: new Date().toISOString()
        };
        setCollapsedTool(prev => ({ ...prev, [resultMsg.id as string]: true }));
        setMessages(prev => [...prev, resultMsg]);
        await db.saveMessage(conversationId, resultMsg);
        if (!isConversationLocalOnly(conversationId)) {
          syncConversationPayload({ messages: [{ conversationId, message: resultMsg }] }).catch(() => {});
        }
        newMessages.push(resultMsg);
      } catch (error: any) {
        const errMsg: ChatMessage = {
          id: uuidv4(),
          role: 'tool',
          content: `Tool error: ${call.tool} ${error?.message || 'Unknown error'}`,
          createdAt: new Date().toISOString()
        };
        setCollapsedTool(prev => ({ ...prev, [errMsg.id as string]: true }));
        setMessages(prev => [...prev, errMsg]);
        await db.saveMessage(conversationId, errMsg);
        if (!isConversationLocalOnly(conversationId)) {
          syncConversationPayload({ messages: [{ conversationId, message: errMsg }] }).catch(() => {});
        }
        newMessages.push(errMsg);
      }
    }
    if (summaries.length > 0) {
      const summaryMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: `Tool calls klara:\n${summaries.map(s => `- ${s}`).join('\n')}`,
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, summaryMsg]);
      await db.saveMessage(conversationId, summaryMsg);
      if (!isConversationLocalOnly(conversationId)) {
        syncConversationPayload({ messages: [{ conversationId, message: summaryMsg }] }).catch(() => {});
      }
    }
    return newMessages;
  };

  const fetchAIStream = async (history: ChatMessage[], assistantMsg: ChatMessage, convId: string): Promise<string> => {
    const promptText = buildPromptText(history);
    if (aiUseApiProviders) {
      const selectedProvider: ApiProviderType = apiProvider;
      const selectedApiKey = selectedProvider === 'openrouter' ? openRouterApiKey : geminiApiKey;
      const selectedModel = selectedProvider === 'openrouter' ? openRouterModel : geminiModel;
      const fullText = await generateApiProviderResponse({
        provider: selectedProvider,
        apiKey: selectedApiKey,
        model: selectedModel,
        history,
      });
      const chunks = fullText.split(/(\s+)/).filter(Boolean);
      let built = '';
      for (const chunk of chunks) {
        if (stopRequestedRef.current) break;
        built += chunk;
        setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: built } : m));
        await saveAssistantProgress(convId, assistantMsg.id as string, built);
      }
      if (!chunks.length) {
        setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: fullText } : m));
        await saveAssistantProgress(convId, assistantMsg.id as string, fullText);
      }
      return stopRequestedRef.current ? built : fullText;
    }
    
    if (activeProvider === 'lmstudio') {
        const baseUrl = normalizeLmStudioBaseUrl(lmBaseUrl || 'http://localhost:1234');
        const startTime = Date.now();
        let tokenCount = 0;
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const res = await fetch(`${baseUrl}/api/v1/chat`, {
          method: 'POST',
          headers: buildLmStudioHeaders(lmToken || undefined),
          signal: controller.signal,
          body: JSON.stringify({
            model: lmSelectedModel,
            input: promptText,
            stream: true
          })
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || 'LM Studio chat failed');
        }

        const reader = res.body?.getReader();
        if (!reader) {
          const data = await res.json().catch(() => null);
          if (data) {
            const { delta, nextText } = extractLmStudioText(data, '');
            const finalText = nextText || delta;
            if (finalText) {
              setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: finalText } : m));
                await saveAssistantProgress(convId, assistantMsg.id as string, finalText);
            }
            return finalText || '';
          }
          return '';
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (stopRequestedRef.current) break;
          const chunk = decoder.decode(value);
          const split = splitSseBuffer(buffer, chunk);
          buffer = split.buffer;
          for (const line of split.lines) {
            if (stopRequestedRef.current) break;
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.replace(/^data:\s*/, '');
            if (payload === '[DONE]') break;
            try {
              const json = JSON.parse(payload);
              const { delta, nextText } = extractLmStudioText(json, fullText);
              if (delta) {
                fullText = nextText;
                const tokens = delta.split(/\s+/).filter(Boolean).length;
                tokenCount += tokens;
                const seconds = Math.max((Date.now() - startTime) / 1000, 0.1);
                setLmTokensPerSecond(Number((tokenCount / seconds).toFixed(2)));
                setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: fullText } : m));
                await saveAssistantProgress(convId, assistantMsg.id as string, fullText);
              }
            } catch {}
          }
        }
        return fullText;
    }

    if (isElectron) {
        const result = await (window as any).mlc.chat({
            chatId: assistantMsg.id,
            modelPath,
            prompt: promptText
        });
        const fullText = typeof result?.content === 'string' ? result.content : '';
        if (fullText) {
          setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: fullText } : m));
          await saveAssistantProgress(convId, assistantMsg.id as string, fullText);
        }
        return fullText;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const response = await fetch('/app/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
          messages: history,
          modelPath: modelPath ? `models/${modelPath}` : '',
          gpuLayers: useGpu ? gpuLayers : 0
      })
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed');
    }

    const reader = response.body?.getReader();
    if (!reader) return '';

    let fullContent = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (stopRequestedRef.current) break;
      const text = new TextDecoder().decode(value);
      fullContent += text;

      setMessages(prev => {
          const last = prev[prev.length - 1];
          return [...prev.slice(0, -1), { ...last, content: fullContent }];
      });
      await saveAssistantProgress(convId, assistantMsg.id as string, fullContent);
    }
    return fullContent;
  };

  const runAIGeneration = async (convId: string, initialHistory: ChatMessage[]) => {
      let currentHistory = [...initialHistory];
      const intentText = [...initialHistory].reverse().find((msg) => msg.role === 'user')?.content || '';
      let iterations = 0;
      const maxIterations = 5;
      const executedCallKeys = new Set<string>();
      const iterationSignatures = new Set<string>();

      while (iterations < maxIterations && !stopRequestedRef.current) {
          iterations++;
          
          const assistantMsg: ChatMessage = {
              id: uuidv4(),
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString()
          };
          
          activeChatIdRef.current = assistantMsg.id as string;
          assistantConvRef.current[assistantMsg.id as string] = convId;
          assistantCreatedRef.current[assistantMsg.id as string] = assistantMsg.createdAt as string;
          setCollapsedThinking(prev => ({ ...prev, [assistantMsg.id as string]: true }));
          setMessages(prev => [...prev, assistantMsg]);
          
          try {
              let fullText = '';
              const tryFetch = async () => {
                  fullText = await fetchAIStream(currentHistory, assistantMsg, convId);
              };
              try {
                  await tryFetch();
              } catch (firstError) {
                  await new Promise(resolve => setTimeout(resolve, 300));
                  await tryFetch();
              }
              const generatedMsg = { ...assistantMsg, content: fullText } as ChatMessage;
              await db.saveMessage(convId, generatedMsg);
              if (!isConversationLocalOnly(convId)) {
                syncConversationPayload({ messages: [{ conversationId: convId, message: generatedMsg }] }).catch(() => {});
              }

              const extractedBeforeTools = extractToolCalls(fullText);
              if (!enableToolUse && extractedBeforeTools.cleaned !== fullText) {
                  fullText = extractedBeforeTools.cleaned;
                  setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: fullText } : m));
                  const cleanedMsg = { ...assistantMsg, content: fullText } as ChatMessage;
                  await db.saveMessage(convId, cleanedMsg);
                  if (!isConversationLocalOnly(convId)) {
                    syncConversationPayload({ messages: [{ conversationId: convId, message: cleanedMsg }] }).catch(() => {});
                  }
              }
              
              const newToolMessages = await processToolCalls(convId, assistantMsg.id as string, fullText, intentText);
              
              if (newToolMessages.length === 0) {
                  break;
              }
              const extracted = extractToolCalls(fullText);
              const { calls } = extracted;
              const callKeys = toToolCallKeys(calls);
              const signature = toToolIterationSignature(extracted.cleaned || '', fullText, callKeys);
              if (shouldStopToolIteration(signature, callKeys, iterationSignatures, executedCallKeys)) {
                break;
              }
              if (calls.some(c => /^(create|update|delete)_/.test(c.tool))) {
                  break;
              }
              
              // Add to history for next iteration
              // Use the cleaned text (without raw tool calls)
              // and the tool results.
              const cleaned = extracted.cleaned || fullText;
              currentHistory = [...currentHistory, { ...assistantMsg, content: cleaned }, ...newToolMessages];
              
          } catch (error: any) {
              if (!stopRequestedRef.current) {
                console.error(error);
                setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Error: ' + error.message, createdAt: new Date().toISOString() }]);
              }
              break;
          }
      }
      
      abortControllerRef.current = null;
      activeChatIdRef.current = null;
      setLoading(false);
  };

  const buildAttachmentText = () => {
    if (!enableAttachments) return '';
    if (attachments.length === 0) return '';
    const parts = attachments.map(a => {
      if (a.encoding === 'text') {
        return `\n\n[File: ${a.name}]\n${a.content}\n[/File]`;
      }
      return `\n\n[File: ${a.name} | ${a.type} | base64]\n${a.content}\n[/File]`;
    });
    return parts.join('');
  };

  const handleCopyMessage = async (content: string) => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      return;
    } catch {}
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch {}
    document.body.removeChild(textarea);
  };

  const toolSystemPrompt = (enabledMcpServices: string[] = []) => {
    const baseUrl = getApiBaseUrl();
    const now = new Date();
    const enabledMcpText = enabledMcpServices.length > 0 ? enabledMcpServices.join(', ') : 'inga';
    return [
      'När tool use är aktiverat: använd tool calls proaktivt när användaren vill skapa, uppdatera, ta bort, lista, hämta eller sammanfatta anteckningar/projekt/tasklistor/uppgifter.',
      'Tolkar även planering, påminnelser, agenda, och uppgifter/anteckningar kopplade till datum som signal att använda tool calls.',
      'För vanliga chattar, resonemang eller allmänna frågor: svara som vanlig text utan tool calls.',
      `Base URL: ${baseUrl}`,
      `Aktuellt datum/tid (ISO): ${now.toISOString()}`,
      `Aktuellt datum/tid (lokalt): ${now.toLocaleString('sv-SE')}`,
      'Endpoint: {BASE_URL}/graphql',
      'MCP endpoint: {BASE_URL}/mcp/tools och {BASE_URL}/mcp/call',
      `Aktiva MCP-tjänster i denna session: ${enabledMcpText}`,
      'Autentisering: Bearer‑token skickas automatiskt.',
      'Format:',
      '```json',
      '{"tool":"<name>","arguments":{...}}',
      '```',
      'Regler:',
      '- När tool use är AVSTÄNGT: skriv aldrig JSON tool calls och kör inga verktyg.',
      '- Inget resonemang eller extra text före tool call.',
      '- Kör inte samma tool call mer än en gång per fråga.',
      '- Om användaren säger “lista” eller vill se något specifikt, kör list_* direkt.',
      '- Om användaren ber dig skapa/planera något kopplat till uppgifter/anteckningar: kör rätt create_* direkt.',
      '- Saknar du id: kör först list_* och använd resultatet.',
      '- Skicka aldrig id:null.',
      '- För create_task/update_task: dueDate måste vara ISO 8601 med datum och tid (t.ex. 2026-03-06T14:30:00.000Z).',
      '- Om användaren anger enbart datum utan tid: sätt tiden till 00:00.',
      '- För create_task med dueDate: sätt reminderEnabled=true och reminderOffsetMinutes till [0] om användaren inte uttryckligen valt annat.',
      '- Tool use är aktiverat i denna session.',
      '- Du får och bör kombinera flera tool calls i följd när det behövs för att lösa uppgiften robust.',
      '- Returnera flera tool calls som en JSON-array i korrekt ordning.',
      '- Fortsätt verktygskedjan över flera steg när uppgiften inte är löst ännu.',
      '- Använd denna kedjeordning när relevant: discover -> select -> create/update -> verify -> explain.',
      '- discover: använd list_* för att hitta kandidater och kontext.',
      '- select: välj bästa kandidat baserat på titel, typ, parent och användarens intention.',
      '- create/update: kör create_* eller update_* med explicit parentId/parentNoteId.',
      '- verify: kör list_*/get_* efter mutation vid behov för att verifiera resultatet.',
      '- explain: avsluta med tydlig sammanfattning av vad som gjordes och var innehållet placerades.',
      '- Om ett steg misslyckas: försök en alternativ kedja (t.ex. skapa saknad lista/mapp) innan du ger upp.',
      '- Avsluta kedjan när målet är uppnått eller när du saknar nödvändig data trots list/get-försök.',
      '- Anti-loop: upprepa inte samma discover/select/create/update steg med identiska argument.',
      '- Anti-loop: om senaste tool-resultat inte ger ny information, avsluta kedjan och redovisa läget tydligt.',
      '- Efter create_task: informera alltid tydligt användaren vilken tasklista uppgiften placerades i (titel + id om tillgängligt).',
      '- Efter create_note: informera alltid tydligt användaren vilken projektmapp anteckningen placerades i (titel + id om tillgängligt).',
      '- Om användaren inte anger lista för uppgift: kör list_tasklists, välj bästa match mot intention och använd parentNoteId.',
      '- Om ingen rimlig match finns: skapa tasklista med create_tasklist och använd den nya listan.',
      '- Om användaren inte anger projektmapp för anteckning: kör list_projects, välj bästa match och använd parentId.',
      '- Om ingen rimlig match finns: skapa projektmapp med create_project och använd den nya mappen.',
      '- Vid sammanställningar: kombinera list_tasks/get_task och list_notes/get_note för att hämta fakta innan du sammanfattar.',
      '- Om underlag saknas: hämta mer data med verktygen innan du svarar.',
      '- Om användaren vill skapa en uppgift i en specifik lista: kör list_tasklists, hitta matchande titel; skapa listan om den saknas, och använd parentNoteId.',
      '- Om användaren vill skapa en anteckning i en projektmapp: kör list_projects, hitta matchande titel; skapa projektmappen om den saknas, och använd parentId.',
      '- Om ingen specifik lista/projekt anges: använd aktivt projekt/vald lista om sådan finns.',
      '- Om användaren vill att du väljer lämplig lista/projekt: kör list_tasklists/list_projects och välj bästa match.',
      '- Om användaren vill flytta en anteckning eller uppgift: kör list_* för att hitta mål och uppdatera parentId/parentNoteId.',
      '- Matcha titlar case‑insensitivt och välj närmaste; om flera likvärdiga, fråga kort.',
      '- Om användaren ber om sammanfattning av projekt: kör list_projects → list_notes(parentId) → get_note vid behov, och sammanfatta kort.',
      '- Om användaren ber om sammanfattning av tasklista: kör list_tasklists → list_tasks(parentNoteId) och sammanfatta kort.',
      '- MCP får användas endast för tjänster som är aktiverade i listan "Aktiva MCP-tjänster i denna session".',
      '- Om användaren inte explicit nämner extern tjänst ska du alltid använda lokala verktyg i Noter först.',
      '- Notion får bara användas om användaren explicit nämner Notion.',
      '- Google Workspace (Calendar/Gmail/Drive) får bara användas om användaren explicit nämner Google, Gmail, Drive eller Calendar.',
      '- Slack får bara användas om användaren explicit nämner Slack.',
      '- För MCP: börja med mcp_list_tools(service), välj sedan mcp_call_tool(service, toolName, args).',
      'Frasexempel som ofta betyder tool use:',
      '- "visa mina uppgifter idag" -> list_tasks med lämpligt filter och kort sammanfattning.',
      '- "skapa uppgift imorgon kl 14 i jobb-listan" -> list_tasklists -> create_task.',
      '- "lägg anteckning i projekt X" -> list_projects -> create_note med parentId.',
      '- "summera veckan" -> list_tasks (+ get_task vid behov) -> sammanfatta.',
      '- "flytta uppgift till lista Y" -> list_tasklists -> update_task parentNoteId.',
      '- "rätta stavfel i anteckning Z" -> list_notes/get_note -> update_note.',
      '- "lägg detta i Notion" -> mcp_list_tools(service="notion") -> mcp_call_tool(service="notion", ...).',
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

  const extractToolCalls = (text: string) => {
    const calls: Array<{ tool: string; arguments: Record<string, any> }> = [];
    const allowedTools = new Set([
      'list_notes', 'get_note', 'create_note', 'update_note', 'delete_note',
      'list_projects', 'create_project', 'update_project', 'delete_project',
      'list_tasklists', 'create_tasklist', 'update_tasklist', 'delete_tasklist',
      'list_tasks', 'get_task', 'create_task', 'update_task', 'delete_task',
      'mcp_list_tools', 'mcp_call_tool'
    ]);
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
        list.forEach(item => {
          if (typeof item?.tool === 'string') {
            pushCall(item.tool, item.arguments || {});
          }
        });
      } catch {}
      cleaned = cleaned.replace(match[0], '').trim();
    }
    const inlineRegex = /Tool call:\s*([a-z_]+)\s*(\{[\s\S]*?\})(?=\s*(?:Tool result:|Tool error:|$))/gi;
    let inlineMatch: RegExpExecArray | null;
    while ((inlineMatch = inlineRegex.exec(text)) !== null) {
      const tool = inlineMatch[1];
      const rawArgs = inlineMatch[2];
      try {
        const parsedArgs = JSON.parse(rawArgs);
        pushCall(tool, parsedArgs || {});
      } catch {}
    }
    cleaned = cleaned
      .replace(inlineRegex, '')
      .replace(/Tool result:[^\n]*\n?/gi, '')
      .replace(/Tool error:[^\n]*\n?/gi, '')
      .trim();
    return { calls, cleaned };
  };

  const resolveAuthToken = async () => {
    const stateToken = useStore.getState().token;
    if (stateToken) return stateToken;
    const inMemory = getWebAuthTokenSync();
    if (inMemory) return inMemory;
    if (isElectron && (window as any).mlc?.getSetting) {
        const stored = await (window as any).mlc.getSetting('token');
        if (stored) return stored;
    }
    const legacy = await getStoredValue('auth_token');
    return legacy || '';
  };

  const resolveGraphqlUrl = () => {
    const cleaned = getApiBaseUrl().trim().replace(/^[`'"]+|[`'"]+$/g, '').trim().replace(/\/+$/, '');
    // Ensure we don't double up on /api or /graphql
    let base = cleaned;
    if (base.endsWith('/graphql')) base = base.replace(/\/graphql$/, '');
    
    // If we have a full URL like https://daylited.com/app/api, we want https://daylited.com/api/graphql
    if (base.includes('/app/api')) {
        return `${base.replace('/app/api', '/api')}/graphql`;
    }
    
    // Default fallback
    if (base.endsWith('/api')) return `${base}/graphql`;
    return `${base}/api/graphql`;
  };

  const graphQLRequest = async (query: string, variables: Record<string, any>) => {
    let authToken = await resolveAuthToken();
    if (authToken) {
        authToken = authToken.trim().replace(/^["']|["']$/g, '');
    }
    
    const url = resolveGraphqlUrl();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify({ query, variables })
    });
    
    const json = await res.json();
    if (json.errors?.length) {
        throw new Error(json.errors[0]?.message || 'GraphQL error');
    }
    return json.data;
  };

  const resolveMcpUrl = () => {
    const cleaned = getApiBaseUrl().trim().replace(/^[`'"]+|[`'"]+$/g, '').trim().replace(/\/+$/, '');
    if (cleaned.endsWith('/api')) return cleaned;
    if (cleaned.includes('/app/api')) return cleaned.replace('/app/api', '/api');
    return `${cleaned}/api`;
  };

  const resolveMcpBaseCandidates = () => {
    const cleaned = getApiBaseUrl().trim().replace(/^[`'"]+|[`'"]+$/g, '').trim().replace(/\/+$/, '');
    const fromApi = resolveMcpUrl();
    const fromRoot = cleaned.endsWith('/api') ? cleaned.replace(/\/api$/, '') : cleaned;
    const origin = typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : '';
    const set = new Set<string>();
    if (fromApi) set.add(fromApi);
    if (fromRoot) {
      set.add(fromRoot);
      set.add(`${fromRoot}/api`);
      set.add(`${fromRoot}/app/api`);
    }
    if (origin) {
      set.add(`${origin}/api`);
      set.add(`${origin}/app/api`);
      set.add(origin);
    }
    return [...set];
  };

  const readDashboardCache = (key: string) => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const decoded = decrypt(raw) || raw;
      const parsed = JSON.parse(decoded);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const writeDashboardCache = (key: string, payload: unknown) => {
    if (typeof window === 'undefined') return;
    try {
      const asText = JSON.stringify(payload);
      localStorage.setItem(key, encrypt(asText));
    } catch {}
  };

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      return response;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const fetchMcpJson = async (pathWithQuery: string, authToken: string, options?: { retries?: number; timeoutMs?: number }) => {
    const candidates = resolveMcpBaseCandidates();
    const retries = Math.max(0, Math.min(3, Number(options?.retries ?? 2)));
    const timeoutMs = Math.max(1500, Math.min(10000, Number(options?.timeoutMs ?? 6500)));
    const attempted: string[] = [];
    for (const base of candidates) {
      const url = `${base}${pathWithQuery}`;
      ensureSecureTransport(url);
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const attemptUrl = `${url}#try-${attempt + 1}`;
        attempted.push(attemptUrl);
        let response: Response | null = null;
        let json: any = null;
        let networkError: string | null = null;
        try {
          response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
          }, timeoutMs);
          json = await response.json().catch(() => null);
        } catch (error: any) {
          networkError = String(error?.message || 'Nätverksfel');
        }
        if (response?.ok && json) return { json, url, attempted };
        const status = Number(response?.status || 0);
        const canRetry = !response || status >= 500 || status === 429 || Boolean(networkError);
        if (!canRetry) {
          if (status !== 404) {
            throw new Error(json?.message || networkError || `MCP-anrop misslyckades (${status || 'okänt'})`);
          }
          break;
        }
        if (attempt < retries) {
          await sleep(180 * (attempt + 1));
          continue;
        }
        if (status !== 404) {
          throw new Error(json?.message || networkError || `MCP-anrop misslyckades (${status || 'okänt'})`);
        }
      }
    }
    throw new Error(`MCP-endpoint saknas (404) för alla kandidater. Kontrollera backend-route /api/mcp. Testade: ${attempted.join(', ')}`);
  };

  const ensureSecureTransport = (urlLike: string) => {
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
      const parsed = new URL(urlLike, base);
      const host = parsed.hostname.toLowerCase();
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '10.0.2.2';
      if (parsed.protocol === 'http:' && !isLocal) {
        throw new Error('Osäker transport blockerad: använd HTTPS för MCP-anrop');
      }
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error('Kunde inte validera API-transport');
    }
  };

  const mcpRequest = async (path: '/tools' | '/call', body: Record<string, any>) => {
    let authToken = await resolveAuthToken();
    if (authToken) {
      authToken = authToken.trim().replace(/^["']|["']$/g, '');
    }
    const mcpUrl = `${resolveMcpUrl()}/mcp${path}`;
    ensureSecureTransport(mcpUrl);
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        ...body,
        mcpUiSettings: mcpSettings,
        mcpUiSettingsEnc: encrypt(JSON.stringify(mcpSettings)),
      }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json || json.message) {
      throw new Error(json?.message || 'MCP request failed');
    }
    return json as Record<string, any>;
  };

  const normalizeMcpDashboardPayload = (payload: any) => {
    const integrations = Array.isArray(payload?.integrations) ? payload.integrations.slice(0, 200) : [];
    const persistedAudit = Array.isArray(payload?.persistedAudit) ? payload.persistedAudit.slice(0, 500) : [];
    return {
      integrations,
      persistedAudit,
      runtimeHealth: payload?.runtimeHealth || { sessionCount: 0, sessions: [], failures: [], recentAudit: [] },
    };
  };

  const normalizeSystemDashboardPayload = (payload: any) => {
    const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : {};
    const usageSeries = Array.isArray(payload?.usageSeries) ? payload.usageSeries.slice(0, 500) : [];
    const usageHeatmap = payload?.usageHeatmap && typeof payload.usageHeatmap === 'object' ? payload.usageHeatmap : { hourByWeekday: [], peakHours: [] };
    const logs = payload?.logs && typeof payload.logs === 'object' ? payload.logs : {};
    return {
      ...payload,
      summary,
      usageSeries,
      usageHeatmap: {
        hourByWeekday: Array.isArray(usageHeatmap.hourByWeekday) ? usageHeatmap.hourByWeekday.slice(0, 7) : [],
        peakHours: Array.isArray(usageHeatmap.peakHours) ? usageHeatmap.peakHours.slice(0, 24) : [],
      },
      logs: {
        mcpAudit: Array.isArray(logs.mcpAudit) ? logs.mcpAudit.slice(0, 500) : [],
        aiMessages: Array.isArray(logs.aiMessages) ? logs.aiMessages.slice(0, 500) : [],
      },
      availableFilters: {
        services: Array.isArray(payload?.availableFilters?.services) ? payload.availableFilters.services.slice(0, 200) : ['all'],
        actions: Array.isArray(payload?.availableFilters?.actions) ? payload.availableFilters.actions.slice(0, 200) : ['all'],
        roles: Array.isArray(payload?.availableFilters?.roles) ? payload.availableFilters.roles.slice(0, 20) : ['all'],
      },
    };
  };

  const loadMcpDashboard = async () => {
    const requestId = ++mcpDashboardRequestIdRef.current;
    setMcpDashboardLoading(true);
    setMcpDashboardError(null);
    try {
      let authToken = await resolveAuthToken();
      if (authToken) authToken = authToken.trim().replace(/^["']|["']$/g, '');
      const { json, url, attempted } = await fetchMcpJson('/mcp/dashboard?limit=80', authToken || '');
      if (requestId !== mcpDashboardRequestIdRef.current) return;
      const normalized = normalizeMcpDashboardPayload(json);
      setMcpDashboardData(normalized);
      writeDashboardCache(getMcpDashboardCacheKey(), { at: Date.now(), payload: normalized });
      setMcpDashboardDiagnostics({
        level: 'ok',
        message: 'Dashboard laddad',
        endpoint: url,
        attempted,
        fromCache: false,
        lastSuccessAt: Date.now(),
      });
    } catch (error: any) {
      if (requestId !== mcpDashboardRequestIdRef.current) return;
      const cached = readDashboardCache(getMcpDashboardCacheKey());
      if (cached?.payload) {
        const normalized = normalizeMcpDashboardPayload(cached.payload);
        setMcpDashboardData(normalized);
        setMcpDashboardDiagnostics({
          level: 'warning',
          message: 'Visar senast sparad dashboarddata (offline/fallback)',
          endpoint: '',
          attempted: [],
          fromCache: true,
          lastSuccessAt: Number(cached.at || null) || null,
        });
      } else {
        setMcpDashboardDiagnostics({
          level: 'error',
          message: String(error?.message || 'Kunde inte läsa MCP-dashboard'),
          endpoint: '',
          attempted: [],
          fromCache: false,
          lastSuccessAt: null,
        });
      }
      setMcpDashboardError(String(error?.message || 'Kunde inte läsa MCP-dashboard. Kontrollera att backend exponerar /api/mcp/dashboard'));
    } finally {
      if (requestId === mcpDashboardRequestIdRef.current) setMcpDashboardLoading(false);
    }
  };

  const loadSystemDashboard = async () => {
    const requestId = ++systemDashboardRequestIdRef.current;
    setSystemDashboardLoading(true);
    setSystemDashboardError(null);
    try {
      let authToken = await resolveAuthToken();
      if (authToken) authToken = authToken.trim().replace(/^["']|["']$/g, '');
      const params = new URLSearchParams({
        range: systemDashboardRange,
        group: systemDashboardGroup,
        sort: systemDashboardSort,
        logLimit: '180',
      });
      if (systemDashboardServiceFilter && systemDashboardServiceFilter !== 'all') params.set('service', systemDashboardServiceFilter);
      if (systemDashboardActionFilter && systemDashboardActionFilter !== 'all') params.set('action', systemDashboardActionFilter);
      if (systemDashboardRoleFilter && systemDashboardRoleFilter !== 'all') params.set('role', systemDashboardRoleFilter);
      if (systemDashboardFrom) {
        const fromDate = new Date(systemDashboardFrom);
        if (Number.isFinite(fromDate.getTime())) params.set('from', fromDate.toISOString());
      }
      if (systemDashboardTo) {
        const toDate = new Date(systemDashboardTo);
        if (Number.isFinite(toDate.getTime())) params.set('to', toDate.toISOString());
      }
      const { json, url, attempted } = await fetchMcpJson(`/mcp/dashboard/system?${params.toString()}`, authToken || '');
      if (requestId !== systemDashboardRequestIdRef.current) return;
      const normalized = normalizeSystemDashboardPayload(json);
      setSystemDashboardData(normalized);
      writeDashboardCache(getSystemDashboardCacheKey(), { at: Date.now(), payload: normalized });
      setSystemDashboardDiagnostics({
        level: 'ok',
        message: 'Systemdashboard laddad',
        endpoint: url,
        attempted,
        fromCache: false,
        lastSuccessAt: Date.now(),
      });
    } catch (error: any) {
      if (requestId !== systemDashboardRequestIdRef.current) return;
      const cached = readDashboardCache(getSystemDashboardCacheKey());
      if (cached?.payload) {
        const normalized = normalizeSystemDashboardPayload(cached.payload);
        setSystemDashboardData(normalized);
        setSystemDashboardDiagnostics({
          level: 'warning',
          message: 'Visar senast sparad systemdashboarddata (offline/fallback)',
          endpoint: '',
          attempted: [],
          fromCache: true,
          lastSuccessAt: Number(cached.at || null) || null,
        });
      } else {
        setSystemDashboardDiagnostics({
          level: 'error',
          message: String(error?.message || 'Kunde inte läsa systemdashboard'),
          endpoint: '',
          attempted: [],
          fromCache: false,
          lastSuccessAt: null,
        });
      }
      setSystemDashboardError(String(error?.message || 'Kunde inte läsa systemdashboard. Kontrollera att backend exponerar /api/mcp/dashboard/system'));
    } finally {
      if (requestId === systemDashboardRequestIdRef.current) setSystemDashboardLoading(false);
    }
  };

  const downloadTextFile = (name: string, content: string, type: string) => {
    if (typeof window === 'undefined') return;
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const toCsv = (rows: Array<Record<string, any>>) => {
    if (!rows.length) return '';
    const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const escape = (value: any) => {
      const text = String(value ?? '');
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((header) => escape(row[header])).join(','));
    }
    return lines.join('\n');
  };

  const exportSystemDashboardJson = () => {
    if (!systemDashboardData) return;
    const text = JSON.stringify(systemDashboardData, null, 2);
    downloadTextFile(`system-dashboard-${Date.now()}.json`, text, 'application/json');
  };

  const exportSystemDashboardCsv = () => {
    if (!systemDashboardData) return;
    const mcpLogs = Array.isArray(systemDashboardData?.logs?.mcpAudit) ? systemDashboardData.logs.mcpAudit : [];
    const aiLogs = Array.isArray(systemDashboardData?.logs?.aiMessages) ? systemDashboardData.logs.aiMessages : [];
    const rows = [
      ...mcpLogs.map((row: any) => ({
        type: 'mcp',
        at: row.at ? new Date(row.at).toISOString() : '',
        service: row.service || '',
        action: row.action || '',
        toolName: row.toolName || '',
        role: '',
        characters: '',
        words: '',
        ok: row.ok ? 'true' : 'false',
      })),
      ...aiLogs.map((row: any) => ({
        type: 'ai',
        at: row.at ? new Date(row.at).toISOString() : '',
        service: '',
        action: '',
        toolName: '',
        role: row.role || '',
        characters: Number(row.characters || 0),
        words: Number(row.words || 0),
        ok: '',
      })),
    ];
    const csv = toCsv(rows);
    downloadTextFile(`system-dashboard-logs-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const filterJsonByQuery = (value: any, query: string): any => {
    const q = query.trim().toLowerCase();
    if (!q) return value;
    if (value == null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value).toLowerCase();
      return text.includes(q) ? value : null;
    }
    if (Array.isArray(value)) {
      const next = value
        .map((item) => filterJsonByQuery(item, q))
        .filter((item) => item !== null && item !== undefined);
      return next.length ? next : null;
    }
    if (typeof value === 'object') {
      const next: Record<string, any> = {};
      for (const [key, child] of Object.entries(value)) {
        if (key.toLowerCase().includes(q)) {
          next[key] = child;
          continue;
        }
        const filtered = filterJsonByQuery(child, q);
        if (filtered !== null && filtered !== undefined) next[key] = filtered;
      }
      return Object.keys(next).length ? next : null;
    }
    return null;
  };

  const copyText = async (text: string) => {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
  };

  const renderHighlightedText = (text: string, query: string) => {
    const q = query.trim();
    if (!q) return text;
    const lower = text.toLowerCase();
    const needle = q.toLowerCase();
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    let index = lower.indexOf(needle);
    while (index !== -1) {
      if (index > cursor) parts.push(text.slice(cursor, index));
      parts.push(
        <mark key={`${index}-${cursor}`} data-testid="system-storage-highlight" className="bg-yellow-200 text-slate-900 rounded px-0.5">
          {text.slice(index, index + needle.length)}
        </mark>,
      );
      cursor = index + needle.length;
      index = lower.indexOf(needle, cursor);
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
    return <>{parts}</>;
  };

  const isJsonContainer = (value: any) => {
    if (!value) return false;
    if (Array.isArray(value)) return true;
    return typeof value === 'object';
  };

  const setStorageTreeCollapseAll = (payload: any, collapsed: boolean) => {
    if (!collapsed) {
      setStorageTreeCollapsed({});
      return;
    }
    const next: Record<string, boolean> = {};
    const walk = (node: any, path: string) => {
      if (!isJsonContainer(node)) return;
      if (path !== 'root') next[path] = true;
      if (Array.isArray(node)) {
        node.forEach((child, index) => walk(child, `${path}[${index}]`));
        return;
      }
      for (const [key, child] of Object.entries(node)) {
        walk(child, `${path}.${key}`);
      }
    };
    walk(payload, 'root');
    setStorageTreeCollapsed(next);
  };

  const renderStorageTree = (value: any, path = 'root', depth = 0, keyLabel = 'root'): React.ReactNode => {
    const expandable = isJsonContainer(value);
    const collapsed = Boolean(storageTreeCollapsed[path]);
    const rowClass = depth === 0 ? 'text-[11px]' : 'text-[11px]';
    if (expandable) {
      const entries = Array.isArray(value)
        ? value.map((child, index) => [String(index), child] as const)
        : Object.entries(value as Record<string, any>);
      return (
        <div key={path} className={rowClass}>
          <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: `${depth * 12}px` }}>
            <button
              type="button"
              className="w-4 h-4 flex items-center justify-center rounded border text-[10px] leading-none bg-white dark:bg-slate-900"
              onClick={() => setStorageTreeCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))}
              aria-label={collapsed ? `Expandera ${keyLabel}` : `Fäll ${keyLabel}`}
            >
              {collapsed ? '▸' : '▾'}
            </button>
            <span className="font-medium">{renderHighlightedText(keyLabel, storageJsonQuery)}</span>
            <span className="text-gray-500">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>
          </div>
          {!collapsed && (
            <div>
              {entries.map(([childKey, childValue]) =>
                renderStorageTree(
                  childValue,
                  Array.isArray(value) ? `${path}[${childKey}]` : `${path}.${childKey}`,
                  depth + 1,
                  childKey,
                ),
              )}
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={path} className={rowClass}>
        <div className="flex items-start gap-2 py-0.5" style={{ paddingLeft: `${depth * 12}px` }}>
          <span className="font-medium min-w-[120px]">{renderHighlightedText(keyLabel, storageJsonQuery)}</span>
          <span className="text-slate-700 dark:text-slate-300 break-all">{renderHighlightedText(JSON.stringify(value), storageJsonQuery)}</span>
        </div>
      </div>
    );
  };

  useEffect(() => {
    setStorageTreeCollapsed({});
  }, [storageJsonQuery, storageJsonSection]);

  const sanitizeLocalValue = (value: any, depth = 0): any => {
    if (depth > 4) return '[max-depth]';
    if (value == null) return value;
    if (typeof value === 'string') return value.length > 800 ? `${value.slice(0, 800)}…` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 80).map((item) => sanitizeLocalValue(item, depth + 1));
    if (typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const key of Object.keys(value).slice(0, 80)) {
        const lower = key.toLowerCase();
        if (lower.includes('token') || lower.includes('secret') || lower.includes('apikey') || lower.includes('password')) {
          out[key] = '[redacted]';
        } else {
          out[key] = sanitizeLocalValue((value as any)[key], depth + 1);
        }
      }
      return out;
    }
    return String(value);
  };

  const loadLocalDbSnapshot = async () => {
    try {
      const userId = getUserId();
      const [localNotes, localTasks, localConversations, localModels] = await Promise.all([
        db.getAllNotes(),
        db.getAllTasks(),
        db.getConversations(userId),
        db.getModels(),
      ]);
      const localMessages = await Promise.all(localConversations.map((conversation) => db.getMessages(conversation.id)));
      const localMessageCount = localMessages.reduce((sum, rows) => sum + rows.length, 0);
      const completedTasks = localTasks.filter((task: any) => Boolean(task.completed)).length;
      const openTasks = Math.max(0, localTasks.length - completedTasks);
      setLocalDbSnapshot({
        notes: localNotes.length,
        tasks: localTasks.length,
        tasksCompleted: completedTasks,
        tasksOpen: openTasks,
        conversations: localConversations.length,
        messages: localMessageCount,
        models: localModels.length,
        raw: {
          localNotes: sanitizeLocalValue(localNotes.slice(0, 200)),
          localTasks: sanitizeLocalValue(localTasks.slice(0, 200)),
          localConversations: sanitizeLocalValue(localConversations.slice(0, 200)),
          localMessagesByConversation: localConversations.slice(0, 60).map((conversation, index) => ({
            conversationId: conversation.id,
            messages: sanitizeLocalValue((localMessages[index] || []).slice(0, 200)),
          })),
          zustandNotes: sanitizeLocalValue(notes.slice(0, 200)),
          zustandTasks: sanitizeLocalValue(tasks.slice(0, 200)),
        },
      });
    } catch {
      setLocalDbSnapshot(null);
    }
  };

  useEffect(() => {
    if (!systemDashboardOpen) return;
    const timer = window.setTimeout(() => {
      loadSystemDashboard();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    systemDashboardOpen,
    systemDashboardRange,
    systemDashboardGroup,
    systemDashboardSort,
    systemDashboardServiceFilter,
    systemDashboardActionFilter,
    systemDashboardRoleFilter,
    systemDashboardFrom,
    systemDashboardTo,
  ]);

  const parseTimeFromString = (value: string) => {
    const lower = value.toLowerCase();
    const hasClock = /[:.]/.test(lower) || /kl\.?\s*\d/.test(lower);
    if (!hasClock) return null;
    const match = lower.match(/(?:kl\.?\s*)?(\d{1,2})(?:[:.](\d{2}))?/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = match[2] ? Number(match[2]) : 0;
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
  };

  const getTimeOfDayHint = (lower: string) => {
    if (lower.includes('morgon')) return { hours: 8, minutes: 0 };
    if (lower.includes('förmiddag')) return { hours: 10, minutes: 0 };
    if (lower.includes('lunch')) return { hours: 12, minutes: 0 };
    if (lower.includes('eftermiddag')) return { hours: 15, minutes: 0 };
    if (lower.includes('middag')) return { hours: 18, minutes: 0 };
    if (lower.includes('kväll')) return { hours: 19, minutes: 0 };
    if (lower.includes('natt')) return { hours: 23, minutes: 0 };
    return null;
  };

  const addDays = (d: Date, days: number) => {
    const next = new Date(d);
    next.setDate(next.getDate() + days);
    return next;
  };

  const getWeekStart = (d: Date) => {
    const date = new Date(d);
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const parseRelativeOffset = (lower: string) => {
    const simpleMap: Record<string, number> = {
      'en': 1,
      'ett': 1,
      'halv': 0.5,
      'halvt': 0.5,
    };
    if (lower.includes('en kvart')) return 15 * 60000;
    if (lower.includes('halvtimme')) return 30 * 60000;
    const match = lower.match(/om\s+(\d+|en|ett|halv|halvt)\s*(minut|minuter|timme|timmar|dag|dagar|vecka|veckor)/);
    if (!match) return null;
    const raw = match[1];
    const unit = match[2];
    const value = /^\d+$/.test(raw) ? Number(raw) : (simpleMap[raw] ?? null);
    if (value === null) return null;
    const minutes = unit.startsWith('minut') ? value
      : unit.startsWith('timme') ? value * 60
      : unit.startsWith('dag') ? value * 1440
      : value * 10080;
    return minutes * 60000;
  };

  const resolveRelativeDate = (value: string) => {
    const lower = value.toLowerCase();
    const today = new Date();
    const weekdays = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
    if (lower.includes('övermorgon')) return addDays(today, 2);
    if (lower.includes('imorgon') || lower.includes('tomorrow')) return addDays(today, 1);
    if (lower.includes('idag') || lower.includes('today') || lower.includes('senare idag')) return new Date(today);
    if (lower.includes('nästa vecka')) {
      const next = getWeekStart(addDays(today, 7));
      return next;
    }
    if (lower.includes('början av veckan')) {
      const start = getWeekStart(today);
      return start.getTime() < today.getTime() ? getWeekStart(addDays(today, 7)) : start;
    }
    if (lower.includes('slutet av veckan')) {
      const start = getWeekStart(today);
      const friday = addDays(start, 4);
      return friday.getTime() < today.getTime() ? addDays(getWeekStart(addDays(today, 7)), 4) : friday;
    }
    const weekdayMatch = weekdays.findIndex(day => lower.includes(day));
    if (weekdayMatch >= 0) {
      const start = getWeekStart(today);
      let target = addDays(start, weekdayMatch);
      if (lower.includes('nästa') || target.getTime() < today.getTime()) {
        target = addDays(target, 7);
      }
      return target;
    }
    return null;
  };

  const normalizeDueDateValue = (raw: any) => {
    if (!raw) return undefined;
    if (raw instanceof Date) {
      return Number.isNaN(raw.getTime()) ? undefined : raw.toISOString();
    }
    if (typeof raw === 'number') {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnly) {
        const asLocalMidnight = new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00`);
        return Number.isNaN(asLocalMidnight.getTime()) ? undefined : asLocalMidnight.toISOString();
      }
      const direct = new Date(trimmed);
      if (!Number.isNaN(direct.getTime())) return direct.toISOString();
      const relOffset = parseRelativeOffset(trimmed.toLowerCase());
      if (relOffset) {
        const next = new Date(Date.now() + relOffset);
        return next.toISOString();
      }
      const rel = resolveRelativeDate(trimmed);
      if (!rel) return undefined;
      const time = parseTimeFromString(trimmed) || getTimeOfDayHint(trimmed.toLowerCase());
      const next = new Date(rel);
      if (time) {
        next.setHours(time.hours, time.minutes, 0, 0);
      } else if (trimmed.toLowerCase().includes('senare idag')) {
        const later = new Date();
        later.setHours(Math.min(later.getHours() + 2, 21), Math.round(later.getMinutes() / 15) * 15, 0, 0);
        return later.toISOString();
      } else {
        next.setHours(0, 0, 0, 0);
      }
      return next.toISOString();
    }
    return undefined;
  };

  const withNormalizedDueDate = (input: Record<string, any>) => {
    if (input.dueDate === undefined || input.dueDate === null || input.dueDate === '') return input;
    const normalized = normalizeDueDateValue(input.dueDate);
    if (!normalized) {
      throw new Error('dueDate måste vara ISO 8601 med datum och tid');
    }
    return { ...input, dueDate: normalized };
  };

  const withDefaultPriority = (input: Record<string, any>) => {
    if (input.priority === undefined || input.priority === null || input.priority === '') {
      return { ...input, priority: 'medium' };
    }
    return input;
  };

  const normalizeReminderOffsetsValue = (value: any): string => {
    if (value === undefined || value === null || value === '') return '';
    if (Array.isArray(value)) {
      const parsed = value
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v))
        .map((v) => Math.trunc(v));
      return parsed.length > 0 ? parsed.join(',') : '';
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(Math.trunc(value)) : '';
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return '';
      return trimmed;
    }
    return '';
  };

  const withDefaultReminderForDueDate = (input: Record<string, any>) => {
    if (input.dueDate === undefined || input.dueDate === null || input.dueDate === '') {
      return input;
    }
    const normalizedOffsets = normalizeReminderOffsetsValue(input.reminderOffsetMinutes);
    if (input.reminderEnabled === undefined || input.reminderEnabled === null) {
      return {
        ...input,
        reminderEnabled: true,
        reminderOffsetMinutes: normalizedOffsets || '0',
      };
    }
    if (input.reminderEnabled === true && !normalizedOffsets) {
      return {
        ...input,
        reminderOffsetMinutes: '0',
      };
    }
    return {
      ...input,
      reminderOffsetMinutes: input.reminderEnabled ? normalizedOffsets : '',
    };
  };

  const getAISecurityContext = () => {
    const state = useStore.getState() as any;
    const notes = Array.isArray(state.notes) ? state.notes : [];
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    const unlockedIds = new Set<string>(Array.isArray(state.unlockedProtectedNoteIds) ? state.unlockedProtectedNoteIds : []);
    const noteMap = buildSecurityNoteMap(notes as any);
    const ensureReadableNote = (id: string) => {
      const note = noteMap.get(String(id));
      if (!note) throw new Error('Anteckning hittades inte');
      if (!isReadableWithLocks(note as any, noteMap as any, unlockedIds)) {
        throw new Error('Åtkomst nekad: anteckningen eller projektmappen är låst');
      }
      return note as any;
    };
    const toNotePayload = (note: any) => ({
      _id: note._id,
      title: note.title,
      content: note.content,
      tags: note.tags || [],
      parentId: note.parentId ?? null,
      locked: note.locked,
      icon: note.icon,
      iconColor: note.iconColor,
      order: note.order,
      type: note.type,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
    return { notes, tasks, noteMap, unlockedIds, ensureReadableNote, toNotePayload };
  };

  const executeToolCall = async (tool: string, args: Record<string, any>, intentText: string) => {
    if (enableToolUse && toolAccessMode === 'read-only' && isMutatingAiTool(tool)) {
      throw new Error('Skrivande verktygsanrop blockeras i läsläge.');
    }
    const requireId = (value: any) => {
      if (!value) throw new Error(`Tool ${tool} kräver id`);
      return value;
    };
    switch (tool) {
      case 'list_notes': {
        const { notes, noteMap, unlockedIds, toNotePayload } = getAISecurityContext();
        const parentId = args.parentId ?? null;
        const type = args.type ?? null;
        const filtered = notes
          .filter((note: any) => (parentId === null ? !note.parentId : String(note.parentId) === String(parentId)))
          .filter((note: any) => (type ? note.type === type : true))
          .filter((note: any) => isReadableWithLocks(note as any, noteMap as any, unlockedIds))
          .map(toNotePayload);
        return { notes: filtered };
      }
      case 'get_note': {
        const { ensureReadableNote, toNotePayload } = getAISecurityContext();
        const note = ensureReadableNote(requireId(args.id));
        return { note: toNotePayload(note) };
      }
      case 'create_note': {
        const state = useStore.getState();
        const input = (!args.parentId && state.activeProjectId) ? { ...args, parentId: state.activeProjectId } : args;
        const query = `mutation($input:NoteInput!){createNote(input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
        return graphQLRequest(query, { input });
      }
      case 'update_note': {
        const { ensureReadableNote } = getAISecurityContext();
        ensureReadableNote(requireId(args.id));
        const query = `mutation($id:String!,$input:NoteInput!){updateNote(id:$id,input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
        if (!args.updates || Object.keys(args.updates).length === 0) throw new Error('update_note kräver updates');
        return graphQLRequest(query, { id: requireId(args.id), input: args.updates || {} });
      }
      case 'delete_note': {
        const { ensureReadableNote } = getAISecurityContext();
        ensureReadableNote(requireId(args.id));
        const query = `mutation($id:String!){deleteNote(id:$id)}`;
        return graphQLRequest(query, { id: requireId(args.id) });
      }
      case 'list_projects': {
        const { notes, noteMap, unlockedIds, toNotePayload } = getAISecurityContext();
        const parentId = args.parentId ?? null;
        const filtered = notes
          .filter((note: any) => note.type === 'project')
          .filter((note: any) => (parentId === null ? !note.parentId : String(note.parentId) === String(parentId)))
          .filter((note: any) => isReadableWithLocks(note as any, noteMap as any, unlockedIds))
          .map(toNotePayload);
        return { notes: filtered };
      }
      case 'create_project': {
        const query = `mutation($input:NoteInput!){createNote(input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
        return graphQLRequest(query, { input: { ...args, type: 'project' } });
      }
      case 'update_project': {
        const { ensureReadableNote } = getAISecurityContext();
        ensureReadableNote(requireId(args.id));
        const query = `mutation($id:String!,$input:NoteInput!){updateNote(id:$id,input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
        if (!args.updates || Object.keys(args.updates).length === 0) throw new Error('update_project kräver updates');
        return graphQLRequest(query, { id: requireId(args.id), input: { ...args.updates } });
      }
      case 'delete_project': {
        const { ensureReadableNote } = getAISecurityContext();
        ensureReadableNote(requireId(args.id));
        const query = `mutation($id:String!){deleteNote(id:$id)}`;
        return graphQLRequest(query, { id: requireId(args.id) });
      }
      case 'list_tasklists': {
        const { notes, noteMap, unlockedIds, toNotePayload } = getAISecurityContext();
        const parentId = args.parentId ?? null;
        const filtered = notes
          .filter((note: any) => note.type === 'task_list')
          .filter((note: any) => (parentId === null ? !note.parentId : String(note.parentId) === String(parentId)))
          .filter((note: any) => isReadableWithLocks(note as any, noteMap as any, unlockedIds))
          .map(toNotePayload);
        return { notes: filtered };
      }
      case 'create_tasklist': {
        const query = `mutation($input:NoteInput!){createNote(input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
        return graphQLRequest(query, { input: { ...args, type: 'task_list' } });
      }
      case 'update_tasklist': {
        const { ensureReadableNote } = getAISecurityContext();
        ensureReadableNote(requireId(args.id));
        const query = `mutation($id:String!,$input:NoteInput!){updateNote(id:$id,input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
        if (!args.updates || Object.keys(args.updates).length === 0) throw new Error('update_tasklist kräver updates');
        return graphQLRequest(query, { id: requireId(args.id), input: { ...args.updates } });
      }
      case 'delete_tasklist': {
        const { ensureReadableNote } = getAISecurityContext();
        ensureReadableNote(requireId(args.id));
        const query = `mutation($id:String!){deleteNote(id:$id)}`;
        return graphQLRequest(query, { id: requireId(args.id) });
      }
      case 'list_tasks': {
        const { tasks, noteMap, unlockedIds } = getAISecurityContext();
        const parentNoteId = args.parentNoteId ?? null;
        const completed = args.completed;
        const filtered = tasks
          .filter((task: any) => (parentNoteId === null ? !task.parentNoteId : String(task.parentNoteId) === String(parentNoteId)))
          .filter((task: any) => (typeof completed === 'boolean' ? Boolean(task.completed) === completed : true))
          .filter((task: any) => {
            if (!task.parentNoteId) return true;
            const parent = noteMap.get(String(task.parentNoteId));
            return isReadableWithLocks(parent as any, noteMap as any, unlockedIds);
          });
        return { tasks: filtered };
      }
      case 'get_task': {
        const { tasks, noteMap, unlockedIds } = getAISecurityContext();
        const task = tasks.find((item: any) => String(item._id) === String(requireId(args.id)));
        if (!task) throw new Error('Task hittades inte');
        if (task.parentNoteId) {
          const parent = noteMap.get(String(task.parentNoteId));
          if (!isReadableWithLocks(parent as any, noteMap as any, unlockedIds)) {
            throw new Error('Åtkomst nekad: tillhörande lista/projekt är låst');
          }
        }
        return { task };
      }
      case 'create_task': {
        const state = useStore.getState();
        const input = (!args.parentNoteId && state.selectedTaskListId) ? { ...args, parentNoteId: state.selectedTaskListId } : args;
        if (input.parentNoteId) {
          const { ensureReadableNote } = getAISecurityContext();
          ensureReadableNote(String(input.parentNoteId));
        }
        const query = `mutation($input:TaskInput!){createTask(input:$input){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
        return graphQLRequest(query, { input: withDefaultReminderForDueDate(withNormalizedDueDate(withDefaultPriority(input))) });
      }
      case 'update_task': {
        const { tasks, noteMap, unlockedIds } = getAISecurityContext();
        const existing = tasks.find((item: any) => String(item._id) === String(requireId(args.id)));
        if (existing?.parentNoteId) {
          const parent = noteMap.get(String(existing.parentNoteId));
          if (!isReadableWithLocks(parent as any, noteMap as any, unlockedIds)) {
            throw new Error('Åtkomst nekad: tillhörande lista/projekt är låst');
          }
        }
        const query = `mutation($id:String!,$input:TaskInput!){updateTask(id:$id,input:$input){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
        if (!args.updates || Object.keys(args.updates).length === 0) throw new Error('update_task kräver updates');
        return graphQLRequest(query, { id: requireId(args.id), input: withNormalizedDueDate(args.updates || {}) });
      }
      case 'delete_task': {
        const { tasks, noteMap, unlockedIds } = getAISecurityContext();
        const existing = tasks.find((item: any) => String(item._id) === String(requireId(args.id)));
        if (existing?.parentNoteId) {
          const parent = noteMap.get(String(existing.parentNoteId));
          if (!isReadableWithLocks(parent as any, noteMap as any, unlockedIds)) {
            throw new Error('Åtkomst nekad: tillhörande lista/projekt är låst');
          }
        }
        const query = `mutation($id:String!){deleteTask(id:$id)}`;
        return graphQLRequest(query, { id: requireId(args.id) });
      }
      case 'mcp_list_tools': {
        const service = String(args.service || '').trim();
        if (!service) throw new Error('mcp_list_tools kräver service');
        return mcpRequest('/tools', { service });
      }
      case 'mcp_call_tool': {
        const service = String(args.service || '').trim();
        const toolName = String(args.toolName || '').trim();
        const toolArgs = args.args && typeof args.args === 'object' && !Array.isArray(args.args) ? args.args : {};
        if (!service || !toolName) throw new Error('mcp_call_tool kräver service och toolName');
        return mcpRequest('/call', {
          service,
          toolName,
          args: toolArgs,
          intentText,
        });
      }
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  };

  const getDefaultChatTitle = (text: string) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 4).join(' ') || 'New Chat';
  };

  const saveAssistantProgress = async (conversationId: string, messageId: string, content: string) => {
    const now = Date.now();
    const last = assistantSaveRef.current[messageId] || 0;
    if (now - last < 500 && content.length > 0) return;
    assistantSaveRef.current[messageId] = now;
    await db.saveMessage(conversationId, {
      id: messageId,
      role: 'assistant',
      content,
      createdAt: assistantCreatedRef.current[messageId] || new Date().toISOString(),
    });
  };

  const handleAddFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const maxSize = 10 * 1024 * 1024;
    const next: typeof attachments = [];
    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: `Filen ${file.name} är för stor. Max 10 MB.`, createdAt: new Date().toISOString() }]);
        continue;
      }
      const encoding: 'text' | 'base64' = file.type.startsWith('text/') || file.name.endsWith('.md') ? 'text' : 'base64';
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('File read failed'));
        if (encoding === 'text') reader.readAsText(file);
        else reader.readAsDataURL(file);
      });
      next.push({ id: uuidv4(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, content, encoding });
    }
    if (next.length > 0) {
      setAttachments(prev => [...prev, ...next]);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const persistLmStudioSettings = (next: { baseUrl?: string; token?: string; model?: string }) => {
    if (typeof window === 'undefined') return;
    if (next.baseUrl !== undefined) persistStoredValue('lmstudioBaseUrl', next.baseUrl);
    if (next.token !== undefined) persistStoredValue('lmstudioToken', next.token, 220);
    if (next.model !== undefined) persistStoredValue('lmstudioModel', next.model);
  };

  const handleRefreshLmModels = async () => {
    const baseUrl = normalizeLmStudioBaseUrl(lmBaseUrl || 'http://localhost:1234');
    if (baseUrl !== lmBaseUrl) setLmBaseUrl(baseUrl);
    setLmError(null);
    setLmLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/v1/models`, {
        headers: buildLmStudioHeaders(lmToken || undefined),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'LM Studio request failed');
      }
      const data = await res.json();
      const models = Array.isArray(data?.models) ? data.models : [];
      const normalized = models.map((m: any) => ({
        key: m.key || m.id,
        displayName: m.display_name || m.key || m.id,
      })).filter((m: any) => m.key);
      setLmModels(normalized);
      if (!lmSelectedModel && normalized.length > 0) {
        setLmSelectedModel(normalized[0].key);
        persistLmStudioSettings({ model: normalized[0].key });
      }
    } catch (err: any) {
      setLmError(err?.message || 'LM Studio error');
    } finally {
      setLmLoading(false);
    }
  };

  const handleSelectModel = async (model: HFModel) => {
      setSelectedModel(model);
      setLoading(true); // Re-using loading state for search file loading
      setModelFilesError(null);
      try {
          if (isElectron) {
              try {
                const data = await (window as any).mlc.getModelFiles({ modelId: model.id });
                setModelFiles(data);
                return;
              } catch (err) {
                const res = await fetch(`/app/api/ai/models/files?modelId=${encodeURIComponent(model.id)}`);
                if (!res.ok) {
                  const text = await res.text().catch(() => '');
                  throw new Error(text || 'Files fetch failed');
                }
                const data = await res.json();
                setModelFiles(data);
                return;
              }
          }
          const res = await fetch(`/app/api/ai/models/files?modelId=${encodeURIComponent(model.id)}`);
          const data = await res.json();
          setModelFiles(data);
      } catch (e) {
          console.error(e);
          setModelFilesError('Kunde inte hämta modellfiler');
      } finally {
          setLoading(false);
      }
  };

  const handleDownload = async (model: HFModel, file: HFFile) => {
      const key = `${model.id}:${file.quantization || file.filename}`;
      setDownloadProgress(prev => ({ ...prev, [key]: 0 }));
      try {
          if (isElectron) {
              const installed = await (window as any).mlc.downloadAndConvert({
                  id: key,
                  modelId: model.id,
                  ggufUrl: file.url,
                  quant: file.quantization || 'Q4_K_M',
                  target: 'cuda'
              });
              setDownloadProgress(prev => ({ ...prev, [key]: 100 }));
              await fetchLocalModels();
              if (installed?.path) {
                setModelPath(installed.path);
              }
              setTimeout(() => {
                  setDownloadProgress(prev => {
                      const next = { ...prev };
                      delete next[key];
                      return next;
                  });
              }, 2000);
              alert(`Downloaded, converted and activated ${file.filename}`);
              return;
          }

          const interval = setInterval(() => {
              setDownloadProgress(prev => {
                  const current = prev[key] || 0;
                  return { ...prev, [key]: Math.min(current + 10, 90) };
              });
          }, 500);

          const res = await fetch('/app/api/ai/models/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: file.url, filename: file.filename })
          });

          clearInterval(interval);

          if (res.ok) {
              setDownloadProgress(prev => ({ ...prev, [key]: 100 }));
              await fetchLocalModels();
              setTimeout(() => {
                  setDownloadProgress(prev => {
                      const next = { ...prev };
                      delete next[key];
                      return next;
                  });
              }, 2000);
              alert(`Downloaded ${file.filename}`);
          } else {
              setDownloadProgress(prev => {
                  const next = { ...prev };
                  delete next[key];
                  return next;
              });
              alert('Download failed');
          }
      } catch (e) {
          console.error(e);
          setDownloadProgress(prev => {
              const next = { ...prev };
              delete next[key];
              return next;
          });
          alert('Download error');
      }
  };

  const handleDeleteModel = async (model: any) => {
      const label = model?.name || model?.modelId || model?.filename || model?.id || 'model';
      if (!confirm(`Delete ${label}?`)) return;
      try {
          if (isElectron) {
              await (window as any).mlc.deleteModel({ id: model.id });
              await fetchLocalModels();
              return;
          }
          const res = await fetch('/app/api/ai/models/download', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: model.filename })
          });
          if (res.ok) {
              await fetchLocalModels();
          } else {
              alert('Delete failed');
          }
      } catch (e) {
          console.error(e);
      }
  };

  const handleStop = async () => {
    stopRequestedRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (isElectron && activeProvider === 'mlc' && activeChatIdRef.current) {
      try {
        await (window as any).mlc.cancelChat({ chatId: activeChatIdRef.current });
      } catch {}
    }
    setLoading(false);
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || loading) return;
    if (activeProvider === 'lmstudio' && !lmSelectedModel) {
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Välj en LM Studio‑modell först.', createdAt: new Date().toISOString() }]);
      return;
    }
    if (activeProvider === 'mlc' && !modelPath) {
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Välj en lokal modell först.', createdAt: new Date().toISOString() }]);
      return;
    }
    if (activeProvider === 'openrouter' && (!openRouterApiKey || !openRouterModel)) {
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Ange OpenRouter API-nyckel och modell först.', createdAt: new Date().toISOString() }]);
      return;
    }
    if (activeProvider === 'gemini' && (!geminiApiKey || !geminiModel)) {
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Ange Gemini API-nyckel och modell först.', createdAt: new Date().toISOString() }]);
      return;
    }
    
    let convId = currentConversationId;
    if (!convId) {
        convId = uuidv4();
        const title = getDefaultChatTitle(input);
        const userId = getUserId();
        const newConv: LocalConversation = {
            id: convId,
            title,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
            model: getActiveModelLabel(),
            projectId: activeProjectId || undefined,
            icon: 'FaComments',
            iconColor: '#000000',
            localOnly: !syncWithBackend,
            userId: userId || undefined
        };
        await db.saveConversation(newConv);
        setConversations(prev => [newConv, ...prev]);
        setCurrentConversationId(convId);
        if (userId) persistLastConversation(userId, convId);
    } else {
        const existing = conversations.find(c => c.id === convId);
        if (existing && (existing.title === 'New Chat' || existing.title === 'Ny chatt')) {
            const title = getDefaultChatTitle(input);
            const updated = { ...existing, title, updatedAt: new Date().toISOString() };
            await db.saveConversation(updated);
            setConversations(prev => prev.map(c => c.id === convId ? updated : c));
            if (!updated.localOnly) {
              syncConversationPayload({ conversations: [updated] }).catch(() => {});
            }
        }
    }

    const attachmentText = buildAttachmentText();
    const trimmedInput = input.trim();
    if (trimmedInput) {
      setInputHistory(prev => {
        const last = prev[prev.length - 1];
        if (last === trimmedInput) return prev;
        return [...prev, trimmedInput];
      });
      setHistoryIndex(-1);
      draftInputRef.current = '';
    }
    const userMsg: ChatMessage = { 
        id: uuidv4(),
        role: 'user', 
        content: `${input}${attachmentText}`,
        createdAt: new Date().toISOString()
    };

    stopRequestedRef.current = false;
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachments([]);
    setEmojiOpen(false);
    setLoading(true);
    setLmTokensPerSecond(null);
    if (autoScrollOnSend) setScrollSignal(prev => prev + 1);

    try {
      await db.saveMessage(convId, userMsg);
      if (!isConversationLocalOnly(convId)) {
        syncConversationPayload({ messages: [{ conversationId: convId, message: userMsg }] }).catch(() => {});
      }
      const history = buildHistory(userMsg);
      await runAIGeneration(convId, history);
    } catch (error: any) {
        console.error(error);
        setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Error: ' + error.message, createdAt: new Date().toISOString() }]);
    } finally {
        setLoading(false);
    }
  };

  const openSystemDashboardQuick = async () => {
    setIsOpen(true);
    setIsSettingsOpen(false);
    setSystemDashboardOpen(true);
    setSystemDashboardStandaloneOpen(true);
    setSystemDashboardTab('overview');
    await Promise.all([loadSystemDashboard(), loadLocalDbSnapshot()]);
  };

  if (!user) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        className="fixed right-0 top-1/2 transform -translate-y-1/2 bg-blue-600 text-white p-2 rounded-l z-50 shadow-md hover:bg-blue-700 transition-colors"
        onClick={() => setIsOpen(true)}
        aria-label="Open AI Assistant"
      >
        AI
      </button>
    );
  }

  const visibleConversations = activeProjectId
    ? conversations.filter(c => c.projectId === activeProjectId)
    : conversations;

  return (
    <div 
        className="fixed right-0 top-0 h-full bg-white dark:bg-gray-900 border-l shadow-2xl flex flex-col z-50 transition-all duration-300 ease-in-out"
        style={{ width }}
    >
      <div
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500"
        onMouseDown={() => setIsResizing(true)}
        role="separator"
        aria-orientation="vertical"
        aria-label="Ändra AI-panelbredd"
      />
      <div className="p-3 border-b flex justify-between items-center bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMenuOpen(true)}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            aria-label="Öppna AI-meny"
          >
            <FaBars />
          </button>
          <h3 className="font-bold text-lg">AI Assistant</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={createNewConversation}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            aria-label="Ny chatt"
            data-testid="ai-new-chat"
          >
            <FaPlus />
          </button>
          <button
            onClick={() => setIsSettingsOpen(prev => !prev)}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            aria-label="Öppna AI-inställningar"
          >
            <FaCog />
          </button>
          <button 
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              aria-label="Stäng AI"
          >
              ✕
          </button>
        </div>
      </div>
      
      {isMenuOpen && (
        <div className="absolute inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setIsMenuOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-80 bg-white dark:bg-gray-900 border-r p-4 overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold">Meny</h4>
              <button onClick={() => setIsMenuOpen(false)} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">✕</button>
            </div>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h5 className="font-semibold text-sm">Projekt</h5>
                <button onClick={openNewProjectDialog} className="text-xs text-blue-600 hover:underline">Nytt projekt</button>
              </div>
              <button
                onClick={() => setActiveProjectId(null)}
                className={`w-full text-left px-2 py-1 rounded ${activeProjectId === null ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
              >
                Alla
              </button>
              {projects.map((project) => (
                (() => {
                  const Icon = getIconComponent(project.icon);
                  return (
                <div key={project.id} className="flex items-center justify-between px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                  <button
                    onClick={() => setActiveProjectId(project.id)}
                    className={`text-left flex-1 flex items-center gap-2 ${activeProjectId === project.id ? 'font-semibold' : ''}`}
                  >
                    <Icon size={14} color={project.iconColor || undefined} />
                    {project.name}
                  </button>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => openEditProjectDialog(project)} className="text-blue-600 hover:underline">Redigera</button>
                    <button onClick={() => deleteProject(project.id)} className="text-red-600 hover:underline">Ta bort</button>
                  </div>
                </div>
                  );
                })()
              ))}
            </div>
            <div>
              <h5 className="font-semibold text-sm mb-2">Chattar</h5>
              {visibleConversations.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-300">Inga chattar</div>
              ) : (
                <ul className="space-y-2">
                  {visibleConversations.map(c => (
                    (() => {
                      const Icon = getIconComponent(c.icon);
                      return (
                    <li
                      key={c.id}
                      onClick={() => { loadConversation(c.id); setIsMenuOpen(false); }}
                      className={`p-2 border rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${currentConversationId === c.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={14} color={c.iconColor || undefined} />
                        <div className="font-semibold text-sm">{c.title || 'Ny chatt'}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-500 dark:text-gray-300">{new Date(c.updatedAt).toLocaleString()}</div>
                        <div className="flex gap-2 text-xs">
                          <button onClick={(e) => { e.stopPropagation(); openChatDialog(c); }} className="text-blue-600 hover:underline">Redigera</button>
                          <button onClick={(e) => { e.stopPropagation(); requestDeleteChat(c.id); }} className="text-red-600 hover:underline">Ta bort</button>
                        </div>
                      </div>
                    </li>
                      );
                    })()
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {!isSettingsOpen && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
             <div>
               {activeProjectId && <div className="text-xs text-gray-500 dark:text-gray-300">Projekt: {getActiveProject()?.name}</div>}
              {activeProvider === 'lmstudio' && showTokensPerSecond && lmTokensPerSecond !== null && (
                 <div className="text-xs text-gray-500 dark:text-gray-300">Hastighet: {lmTokensPerSecond} tokens/s</div>
               )}
             </div>
            {activeProvider === 'mlc' && (
               <div className="flex items-center gap-2">
                  <label className="text-xs flex items-center gap-1 cursor-pointer">
                      <input 
                          type="checkbox" 
                          checked={useGpu} 
                          onChange={e => setUseGpu(e.target.checked)}
                          className="rounded"
                      />
                      GPU
                  </label>
                  {useGpu && (
                      <input 
                          type="number" 
                          value={gpuLayers} 
                          onChange={e => setGpuLayers(Number(e.target.value))}
                          className="w-12 text-xs p-1 border rounded dark:bg-gray-700"
                          min="0"
                      />
                  )}
               </div>
             )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                    <div className="text-center text-gray-500 dark:text-gray-300 mt-10">
                        Start a conversation...
                    </div>
                )}
                {messages.map((msg, i) => {
                    const key = msg.id || `msg-${i}`;
                    const isAssistant = msg.role === 'assistant';
                    const isTool = msg.role === 'tool';
                    const { thinking, rest } = isAssistant ? parseThinking(msg.content) : { thinking: '', rest: msg.content };
                    const collapsed = collapsedThinking[key] ?? true;
                    if (isTool) {
                      const info = parseToolMessage(msg.content);
                      const toolCollapsed = collapsedTool[key] ?? true;
                      const iconSvg = toolIcons[info.tool] || toolIcons.list_notes;
                      const label = info.kind === 'call'
                        ? `Tool call: ${info.tool}`
                        : info.kind === 'result'
                          ? `Tool result: ${info.tool}`
                          : `Tool error: ${info.tool}`;
                      const status = getToolStatus(info);
                      const statusIcon = toolStatusIcons[status.tone] || toolStatusIcons.info;
                      return (
                        <div key={key} className="p-3 rounded-lg max-w-[90%] bg-gray-50 dark:bg-gray-800/70 mr-auto border border-gray-200 dark:border-gray-700">
                          <button
                            className="w-full text-left text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2"
                            onClick={() => setCollapsedTool(prev => ({ ...prev, [key]: !toolCollapsed }))}
                          >
                            <span className="w-4 h-4 text-gray-700 dark:text-gray-200" dangerouslySetInnerHTML={{ __html: iconSvg }} />
                            {label}
                          </button>
                          <div className={`mt-1 text-xs flex items-center gap-2 ${status.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                            <span className="w-3.5 h-3.5" dangerouslySetInnerHTML={{ __html: statusIcon }} />
                            {status.label}
                          </div>
                          {!toolCollapsed && (
                            <div className="mt-2 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                              {info.details || '(inga detaljer)'}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div key={key} className={`p-3 rounded-lg max-w-[90%] ${msg.role === 'user' ? 'bg-blue-100 dark:bg-blue-900 ml-auto' : 'bg-gray-100 dark:bg-gray-800 mr-auto'}`}>
                          <div className="text-xs text-gray-500 dark:text-gray-300 mb-1 flex items-center justify-between">
                            <span className="capitalize">{msg.role}</span>
                            <span>{formatTime(msg.createdAt)}</span>
                          </div>
                          {isAssistant && showThinking && thinking && (
                            <div className="mb-2 border border-purple-200 dark:border-purple-700 rounded">
                              <button
                                className="w-full text-left px-2 py-1 text-xs font-semibold text-purple-700 dark:text-purple-200 bg-purple-50 dark:bg-purple-900/40"
                                onClick={() => setCollapsedThinking(prev => ({ ...prev, [key]: !collapsed }))}
                              >
                                {collapsed ? 'Visa tänkande' : 'Dölj tänkande'}
                              </button>
                              {!collapsed && (
                                <div className="px-2 py-2 text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                                  {thinking}
                                </div>
                              )}
                            </div>
                          )}
                      <div className="flex items-start justify-between gap-2">
                        <div className="whitespace-pre-wrap flex-1">{rest}</div>
                        {(msg.role === 'assistant' || msg.role === 'user') && (
                          <button
                            className="text-xs text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100"
                            onClick={() => handleCopyMessage(rest)}
                            aria-label="Kopiera meddelande"
                          >
                            <FaCopy />
                          </button>
                        )}
                      </div>
                      </div>
                    );
                })}
                {loading && <div className="text-gray-500 dark:text-gray-300 text-sm animate-pulse">Thinking...</div>}
                <div ref={scrollBottomRef} />
            </div>

            <div className="p-4 border-t bg-gray-50 dark:bg-gray-800">
                <textarea 
                    className="w-full border rounded p-2 bg-white dark:bg-gray-700 text-black dark:text-white resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                    rows={3}
                    placeholder="Type a message..."
                    value={input}
                    onChange={e => {
                      setInput(e.target.value);
                      if (historyIndex !== -1) setHistoryIndex(-1);
                    }}
                    data-testid="ai-chat-input"
                    onKeyDown={e => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                          if (inputHistory.length === 0) return;
                          e.preventDefault();
                          if (historyIndex === -1) draftInputRef.current = input;
                          if (e.key === 'ArrowUp') {
                            const nextIndex = historyIndex === -1 ? inputHistory.length - 1 : Math.max(0, historyIndex - 1);
                            setHistoryIndex(nextIndex);
                            setInput(inputHistory[nextIndex] || '');
                          } else {
                            const nextIndex = historyIndex + 1;
                            if (nextIndex >= inputHistory.length) {
                              setHistoryIndex(-1);
                              setInput(draftInputRef.current);
                            } else {
                              setHistoryIndex(nextIndex);
                              setInput(inputHistory[nextIndex] || '');
                            }
                          }
                          return;
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                />
                {enableAttachments && attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {attachments.map(a => (
                      <div key={a.id} className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded flex items-center gap-2">
                        <span className="truncate max-w-[160px]">{a.name}</span>
                        <button onClick={() => removeAttachment(a.id)} className="text-red-600">✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-between mt-2 items-center">
                    <div className="flex items-center gap-3">
                      {enableEmojiPicker && (
                        <div className="relative">
                          <button
                            className="text-xs text-gray-600 dark:text-gray-200 px-2 py-1 rounded border border-gray-200 dark:border-gray-700"
                            onClick={() => setEmojiOpen(prev => !prev)}
                            aria-label="Emoji"
                          >
                            <FaRegSmile />
                          </button>
                          {emojiOpen && (
                            <div className="absolute bottom-10 left-0 bg-white dark:bg-gray-800 border rounded p-3 w-72 max-h-64 overflow-auto z-10 shadow-lg">
                              {emojiCategories.map(section => (
                                <div key={section.label} className="mb-3">
                                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">{section.label}</div>
                                  <div className="grid grid-cols-6 gap-1">
                                    {section.items.map(e => (
                                      <button
                                        key={e}
                                        className="text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                        onClick={() => { setInput(prev => `${prev}${e}`); setEmojiOpen(false); }}
                                      >
                                        {e}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="relative">
                        <button
                          className="text-xs text-gray-600 dark:text-gray-200 px-2 py-1 rounded border border-gray-200 dark:border-gray-700"
                          onClick={() => setToolSettingsOpen(prev => !prev)}
                          aria-label="Tool use"
                        >
                          <FaCog />
                        </button>
                        {toolSettingsOpen && (
                          <div className="absolute bottom-10 left-0 bg-white dark:bg-gray-800 border rounded p-3 w-60 shadow-lg z-10">
                            <label className="text-xs flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={enableToolUse}
                                onChange={(e) => setEnableToolUse(e.target.checked)}
                              />
                              Tool use
                            </label>
                            <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
                              När detta är avstängt chattar assistenten bara och gör inga tool calls.
                            </div>
                          </div>
                        )}
                      </div>
                      {enableAttachments && (
                        <label className="text-xs text-gray-600 dark:text-gray-200 cursor-pointer">
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => handleAddFiles(e.target.files)}
                            accept=".md,.txt,.doc,.docx,.pdf,.jpg,.jpeg,.png,text/markdown,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
                          />
                          Lägg till filer
                        </label>
                      )}
                      <button 
                          className="text-xs text-gray-500 dark:text-gray-300 hover:underline"
                          onClick={() => setMessages([])}
                      >
                          Clear Chat
                      </button>
                    </div>
                    {loading ? (
                      <button
                          className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition-colors"
                          onClick={handleStop}
                          data-testid="ai-chat-stop"
                      >
                          Stop
                      </button>
                    ) : (
                      <button 
                          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
                          onClick={handleSend}
                          disabled={(!input.trim() && attachments.length === 0) || (activeProvider === 'mlc' ? !modelPath : activeProvider === 'lmstudio' ? !lmSelectedModel : activeProvider === 'openrouter' ? (!openRouterApiKey || !openRouterModel) : (!geminiApiKey || !geminiModel))}
                          data-testid="ai-chat-send"
                      >
                          Send
                      </button>
                    )}
                </div>
            </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="flex-1 overflow-auto p-4 space-y-6">
          <div>
            <h4 className="font-bold mb-2">Systemprompt</h4>
            <textarea
              className="w-full border rounded p-2 text-sm dark:bg-gray-900"
              rows={4}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Skriv huvudprompten för AI här"
              data-testid="ai-system-prompt"
            />
            <div className="mt-4 rounded border p-3 bg-gray-50 dark:bg-gray-800">
              <h5 className="font-bold text-sm mb-2">AI-läge och lagring</h5>
              <div className="text-xs text-gray-500 dark:text-gray-300 mb-3">
                AI-historik lagras alltid krypterat lokalt. När backend-sync är avstängd stannar chattar och projekt endast på denna enhet.
              </div>
              <label className="text-sm flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={syncWithBackend}
                  onChange={(e) => setSyncWithBackend(e.target.checked)}
                />
                Synka AI-chattar med backend
              </label>
              <div className="text-xs text-gray-500 dark:text-gray-300 mt-1">
                {syncWithBackend ? 'Krypterad ciphertext kan synkas till backend.' : 'Endast lokal krypterad lagring används.'}
              </div>
              <div className="mt-3">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">Promptprofil</label>
                <select
                  value={promptPreset}
                  onChange={(e) => setPromptPreset(e.target.value as AiPromptPreset)}
                  className="w-full p-2 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
                  data-testid="ai-prompt-preset-select"
                >
                  {AI_PROMPT_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.id === 'balanced' ? 'Balanserad' : preset.id === 'research' ? 'Research' : preset.id === 'execution' ? 'Utförande' : 'Kortfattad'}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-gray-500 dark:text-gray-300 mt-1">
                  Profilen läggs ovanpå din systemprompt och projektprompt.
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                {sessionInsights.map((item) => (
                  <div key={item.id} className="rounded border bg-white dark:bg-slate-900 p-2">
                    <div className="text-[11px] uppercase tracking-wider text-gray-500">{item.label}</div>
                    <div className="text-sm font-medium break-words">{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded border bg-white dark:bg-slate-900 p-3" data-testid="ai-conversion-health-panel">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">GGUF- och MLC-diagnostik</div>
                  <button
                    type="button"
                    onClick={() => refreshConversionHealth()}
                    className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700"
                  >
                    {conversionHealthLoading ? 'Kontrollerar…' : 'Uppdatera'}
                  </button>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-300 mt-2">
                  Visar om MLC-binären kan hittas, vilken kommando-upplösning som används och om GGUF → MLC-konvertering är redo.
                </div>
                {conversionHealthText ? (
                  <div className="text-sm mt-2">{conversionHealthText}</div>
                ) : null}
                {conversionHealthDetailText ? (
                  <div className="text-xs text-gray-500 dark:text-gray-300 mt-1 break-words">{conversionHealthDetailText}</div>
                ) : null}
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-bold mb-2">Svar</h4>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableToolUse}
                onChange={(e) => setEnableToolUse(e.target.checked)}
              />
              Tool use i chatt
            </label>
            <div className="text-xs text-gray-500 dark:text-gray-300 mt-1">
              När detta är avstängt chattar assistenten bara och gör inga tool calls.
            </div>
            <div className="mt-3">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">Åtkomstläge för verktyg</label>
              <select
                value={toolAccessMode}
                onChange={(e) => setToolAccessMode(e.target.value as AiToolAccessMode)}
                className="w-full p-2 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
                data-testid="ai-tool-access-mode-select"
              >
                <option value="read-only">Endast läsning</option>
                <option value="full">Full åtkomst</option>
              </select>
              <div className="text-xs text-gray-500 dark:text-gray-300 mt-1">
                {toolAccessMode === 'read-only'
                  ? 'AI får bara läsa, lista och sammanfatta data. Skrivande verktyg och skrivande MCP-anrop blockeras.'
                  : 'AI får utföra skrivande verktygsanrop och godkända MCP-åtgärder när tool-use är aktiverat.'}
              </div>
            </div>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={showThinking}
                onChange={(e) => setShowThinking(e.target.checked)}
              />
              Visa tänkande
            </label>
            <label className="text-sm flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={showTokensPerSecond}
                onChange={(e) => setShowTokensPerSecond(e.target.checked)}
              />
              Visa tokens per sekund
            </label>
            <label className="text-sm flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={autoScrollOnSend}
                onChange={(e) => setAutoScrollOnSend(e.target.checked)}
              />
              Auto‑scroll till botten vid skickat meddelande
            </label>
            <label className="text-sm flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={enableEmojiPicker}
                onChange={(e) => setEnableEmojiPicker(e.target.checked)}
              />
              Visa emoji‑knapp
            </label>
            <label className="text-sm flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={enableAttachments}
                onChange={(e) => setEnableAttachments(e.target.checked)}
              />
              Tillåt filuppladdning
            </label>
          </div>

          <div>
            <h4 className="font-bold mb-2">Provider</h4>
            <label className="text-sm flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                checked={aiUseApiProviders}
                onChange={(e) => setAiUseApiProviders(e.target.checked)}
              />
              Använd API-baserad AI (OpenRouter/Gemini) istället för lokala modeller
            </label>
            <div className="mb-4">
              <label htmlFor="ai-provider-select" className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">AI Provider</label>
              <select
                id="ai-provider-select"
                value={aiUseApiProviders ? apiProvider : aiProvider}
                onChange={(e) => {
                  if (aiUseApiProviders) setApiProvider(e.target.value as ApiProviderType);
                  else setAiProvider(e.target.value as 'mlc' | 'lmstudio');
                }}
                className="w-full p-2 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
                data-testid="ai-provider-select"
              >
                {aiUseApiProviders ? (
                  <>
                    <option value="openrouter">OpenRouter API</option>
                    <option value="gemini">Google Gemini API</option>
                  </>
                ) : (
                  <>
                    <option value="mlc">Local (MLC)</option>
                    <option value="lmstudio">LM Studio</option>
                  </>
                )}
              </select>
            </div>

            {!aiUseApiProviders && aiProvider === 'lmstudio' && (
              <div className="mb-6 p-3 border rounded bg-gray-50 dark:bg-gray-800">
                <div className="mb-3">
                  <label htmlFor="lmstudio-base-url" className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">LM Studio Base URL</label>
                  <input
                    id="lmstudio-base-url"
                    className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                    value={lmBaseUrl}
                    onChange={(e) => setLmBaseUrl(e.target.value)}
                    onBlur={() => setLmBaseUrl(normalizeLmStudioBaseUrl(lmBaseUrl || ''))}
                    placeholder="http://localhost:1234"
                    data-testid="lmstudio-base-url"
                  />
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-300">
                    Använd bara bas‑URL, t.ex. http://localhost:1234
                  </div>
                </div>
                <div className="mb-3">
                  <label htmlFor="lmstudio-token" className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">LM Studio Token</label>
                  <input
                    id="lmstudio-token"
                    className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                    value={lmToken}
                    onChange={(e) => setLmToken(e.target.value)}
                    placeholder="Optional"
                    data-testid="lmstudio-token"
                  />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={handleRefreshLmModels}
                    className="bg-blue-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                    disabled={lmLoading}
                    data-testid="lmstudio-refresh-models"
                  >
                    {lmLoading ? i18n.t('common.loading') : i18n.t('common.fetchModels')}
                  </button>
                  {lmError && <div className="text-xs text-red-500">{lmError}</div>}
                </div>
                <div>
                  <label htmlFor="lmstudio-model-select" className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">LM Studio‑modell</label>
                  <select
                    id="lmstudio-model-select"
                    className="w-full p-2 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={lmSelectedModel}
                    onChange={(e) => setLmSelectedModel(e.target.value)}
                    data-testid="lmstudio-model-select"
                  >
                    <option value="">Välj modell</option>
                    {lmModels.map(m => (
                      <option key={m.key} value={m.key}>{m.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {aiUseApiProviders && apiProvider === 'openrouter' && (
              <div className="mb-6 p-3 border rounded bg-gray-50 dark:bg-gray-800">
                <div className="mb-3">
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">OpenRouter API Key</label>
                  <input
                    className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                    value={openRouterApiKey}
                    onChange={(e) => setOpenRouterApiKey(e.target.value)}
                    placeholder="sk-or-..."
                    data-testid="openrouter-api-key"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">OpenRouter Modell</label>
                  <input
                    className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                    value={openRouterModel}
                    onChange={(e) => setOpenRouterModel(e.target.value)}
                    placeholder="openai/gpt-4o-mini"
                    data-testid="openrouter-model"
                  />
                </div>
              </div>
            )}

            {aiUseApiProviders && apiProvider === 'gemini' && (
              <div className="mb-6 p-3 border rounded bg-gray-50 dark:bg-gray-800">
                <div className="mb-3">
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">Gemini API Key</label>
                  <input
                    className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="AIza..."
                    data-testid="gemini-api-key"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">Gemini Modell</label>
                  <input
                    className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    placeholder="gemini-2.5-flash"
                    data-testid="gemini-model"
                  />
                </div>
              </div>
            )}

            <div className="mb-6 p-3 border rounded bg-gray-50 dark:bg-gray-800" data-testid="mcp-settings-section">
              <h5 className="font-bold text-sm mb-2">MCP Integrationer</h5>
              <div className="text-xs text-gray-500 dark:text-gray-300 mb-3">
                Värden från denna vy sparas krypterat lokalt och prioriteras över .env-värden.
              </div>
              <div className="space-y-4">
                {MCP_INTEGRATIONS.map((integration) => (
                  <div key={integration.id} className="border border-gray-200 dark:border-gray-700 rounded p-3">
                    <label className="text-sm flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        checked={Boolean(mcpSettings[integration.id]?.enabled)}
                        onChange={(e) =>
                          setMcpSettings((prev) => ({
                            ...prev,
                            [integration.id]: {
                              ...prev[integration.id],
                              enabled: e.target.checked,
                            },
                          }))
                        }
                        data-testid={`mcp-enabled-${integration.id}`}
                      />
                      {integration.label}
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      {integration.fields.map((field) => (
                        <div key={`${integration.id}-${field.key}`}>
                          <label className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">
                            {field.label}
                          </label>
                          <input
                            className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                            type={field.secret ? 'password' : 'text'}
                            value={mcpSettings[integration.id]?.values[field.key] || ''}
                            onChange={(e) =>
                              setMcpSettings((prev) => ({
                                ...prev,
                                [integration.id]: {
                                  ...prev[integration.id],
                                  values: {
                                    ...prev[integration.id].values,
                                    [field.key]: e.target.value,
                                  },
                                },
                              }))
                            }
                            placeholder={field.placeholder || ''}
                            data-testid={`mcp-${integration.id}-${field.key}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-6 p-3 border rounded bg-gray-50 dark:bg-gray-800" data-testid="mcp-dashboard-section">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h5 className="font-bold text-sm">MCP Säkerhetsdashboard</h5>
                <button
                  className="text-xs px-2 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={async () => {
                    const nextOpen = !mcpDashboardOpen;
                    setMcpDashboardOpen(nextOpen);
                    if (nextOpen) {
                      await loadMcpDashboard();
                    }
                  }}
                  data-testid="mcp-dashboard-toggle"
                >
                  {mcpDashboardOpen ? 'Dölj' : 'Visa'}
                </button>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-300 mb-2">
                Visar endast din användares krypterat lagrade MCP-spårning.
              </div>
              <div className={`text-[11px] mb-2 p-2 rounded border ${
                mcpDashboardDiagnostics.level === 'ok'
                  ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/20'
                  : mcpDashboardDiagnostics.level === 'warning'
                    ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20'
                    : mcpDashboardDiagnostics.level === 'error'
                      ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/20'
                      : 'border-gray-300 bg-white dark:border-slate-700 dark:bg-slate-900'
              }`}>
                <div className="font-semibold">
                  {mcpDashboardDiagnostics.level === 'ok' ? 'MCP ansluten' : mcpDashboardDiagnostics.level === 'warning' ? 'MCP fallback-läge' : mcpDashboardDiagnostics.level === 'error' ? 'MCP ej ansluten' : 'MCP väntar på data'}
                </div>
                <div>{mcpDashboardDiagnostics.message || 'Ingen diagnostik ännu.'}</div>
              </div>
              {mcpDashboardOpen && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      className="text-xs px-2 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={loadMcpDashboard}
                      disabled={mcpDashboardLoading}
                      data-testid="mcp-dashboard-refresh"
                    >
                      {mcpDashboardLoading ? i18n.t('common.loading') : i18n.t('common.refresh')}
                    </button>
                    {mcpDashboardError ? <div className="text-xs text-red-500">{mcpDashboardError}</div> : null}
                  </div>
                  <div className="max-h-52 overflow-y-auto border rounded bg-white dark:bg-gray-900" data-testid="mcp-dashboard-list">
                    {(Array.isArray(mcpDashboardData?.persistedAudit) ? mcpDashboardData.persistedAudit : []).length === 0 ? (
                      <div className="text-xs p-2 text-gray-500">Ingen spårning hittades.</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-2">Tid</th>
                            <th className="text-left p-2">Tjänst</th>
                            <th className="text-left p-2">Action</th>
                            <th className="text-left p-2">Tool</th>
                            <th className="text-left p-2">OK</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(mcpDashboardData.persistedAudit as any[]).map((row: any, index: number) => (
                            <tr key={`${row.at || index}-${row.service || ''}`} className="border-b">
                              <td className="p-2">{row.at ? new Date(row.at).toLocaleString('sv-SE') : '-'}</td>
                              <td className="p-2">{row.service || '-'}</td>
                              <td className="p-2">{row.action || '-'}</td>
                              <td className="p-2">{row.toolName || '-'}</td>
                              <td className="p-2">{row.ok ? 'Ja' : 'Nej'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="hidden" data-testid="system-dashboard-section-legacy">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 2 4-5"/></svg>
                    </span>
                    <h5 className="font-bold text-sm">Specifik Systemdashboard (Electron/Web)</h5>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                    Endast inloggad användares data. Sektionerad vy för översikt, användning, loggar, lagring och admin-inställningar.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs px-2 py-1 rounded border bg-white/70 hover:bg-white dark:bg-slate-900/60 dark:hover:bg-slate-800"
                    onClick={async () => {
                      const nextOpen = !systemDashboardOpen;
                      setSystemDashboardOpen(nextOpen);
                      if (nextOpen) {
                        await Promise.all([loadSystemDashboard(), loadLocalDbSnapshot()]);
                      }
                    }}
                    data-testid="system-dashboard-toggle"
                  >
                    {systemDashboardOpen ? 'Dölj' : 'Visa'}
                  </button>
                </div>
              </div>
              {systemDashboardOpen && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-blue-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/80">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end mb-2">
                      <label className="text-xs">
                        <span className="block mb-1">Tidsspann</span>
                        <select value={systemDashboardRange} onChange={(e) => setSystemDashboardRange(e.target.value as any)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900">
                          <option value="1d">1 dag</option><option value="7d">7 dagar</option><option value="30d">30 dagar</option><option value="90d">90 dagar</option><option value="365d">365 dagar</option>
                        </select>
                      </label>
                      <label className="text-xs">
                        <span className="block mb-1">Intervall</span>
                        <select value={systemDashboardGroup} onChange={(e) => setSystemDashboardGroup(e.target.value as any)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900">
                          <option value="hour">Timme</option><option value="day">Dag</option><option value="week">Vecka</option>
                        </select>
                      </label>
                      <label className="text-xs">
                        <span className="block mb-1">Sortering</span>
                        <select value={systemDashboardSort} onChange={(e) => setSystemDashboardSort(e.target.value as any)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900">
                          <option value="desc">Senaste först</option><option value="asc">Äldsta först</option>
                        </select>
                      </label>
                      <label className="text-xs">
                        <span className="block mb-1">Rollfilter</span>
                        <select value={systemDashboardRoleFilter} onChange={(e) => setSystemDashboardRoleFilter(e.target.value)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900">
                          {(Array.isArray(systemDashboardData?.availableFilters?.roles) ? systemDashboardData.availableFilters.roles : ['all', 'user', 'assistant', 'system', 'tool']).map((role: string) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                      <label className="text-xs">
                        <span className="block mb-1">Service</span>
                        <select value={systemDashboardServiceFilter} onChange={(e) => setSystemDashboardServiceFilter(e.target.value)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900">
                          {(Array.isArray(systemDashboardData?.availableFilters?.services) ? systemDashboardData.availableFilters.services : ['all']).map((service: string) => (
                            <option key={service} value={service}>{service}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs">
                        <span className="block mb-1">Action</span>
                        <select value={systemDashboardActionFilter} onChange={(e) => setSystemDashboardActionFilter(e.target.value)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900">
                          {(Array.isArray(systemDashboardData?.availableFilters?.actions) ? systemDashboardData.availableFilters.actions : ['all']).map((action: string) => (
                            <option key={action} value={action}>{action}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs">
                        <span className="block mb-1">Från (valfritt)</span>
                        <input type="datetime-local" value={systemDashboardFrom} onChange={(e) => setSystemDashboardFrom(e.target.value)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900" />
                      </label>
                      <label className="text-xs">
                        <span className="block mb-1">Till (valfritt)</span>
                        <input type="datetime-local" value={systemDashboardTo} onChange={(e) => setSystemDashboardTo(e.target.value)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900" />
                      </label>
                      <button className="text-xs px-2 py-1.5 rounded border bg-white hover:bg-gray-50 dark:bg-slate-900 dark:hover:bg-slate-800" onClick={async () => { await Promise.all([loadSystemDashboard(), loadLocalDbSnapshot()]); }} disabled={systemDashboardLoading} data-testid="system-dashboard-refresh">
                        {systemDashboardLoading ? i18n.t('common.loading') : i18n.t('common.refresh')}
                      </button>
                      <div className="flex gap-1">
                        <button className="text-xs px-2 py-1.5 rounded border bg-white hover:bg-gray-50 dark:bg-slate-900 dark:hover:bg-slate-800" onClick={exportSystemDashboardJson}>Export JSON</button>
                        <button className="text-xs px-2 py-1.5 rounded border bg-white hover:bg-gray-50 dark:bg-slate-900 dark:hover:bg-slate-800" onClick={exportSystemDashboardCsv}>Export CSV</button>
                      </div>
                    </div>
                  </div>
                  {systemDashboardError ? <div className="text-xs text-red-500">{systemDashboardError}</div> : null}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'overview', label: 'Översikt', icon: <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="4"/><rect x="14" y="10" width="7" height="11"/><rect x="3" y="14" width="7" height="7"/></svg> },
                      { id: 'usage', label: 'Användning', icon: <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19h16"/><path d="M7 16V8"/><path d="M12 16V5"/><path d="M17 16v-3"/></svg> },
                      { id: 'logs', label: 'Loggar', icon: <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v16H4z"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/></svg> },
                      { id: 'storage', label: 'Lagring', icon: <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg> },
                      { id: 'settings', label: 'Inställningar', icon: <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0A1.7 1.7 0 0 0 10 3.2V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z"/></svg> },
                    ].map((tab: any) => (
                      <button
                        key={tab.id}
                        className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition ${systemDashboardTab === tab.id ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white/80 dark:bg-slate-900/70 border-blue-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800'}`}
                        onClick={() => setSystemDashboardTab(tab.id)}
                      >
                        {tab.icon}
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const summary = systemDashboardData?.summary || {};
                    const usageSeries = Array.isArray(systemDashboardData?.usageSeries) ? systemDashboardData.usageSeries : [];
                    const maxMessages = usageSeries.reduce((max: number, row: any) => Math.max(max, Number(row.messages || 0)), 1);
                    const heatmapRows = Array.isArray(systemDashboardData?.usageHeatmap?.hourByWeekday) ? systemDashboardData.usageHeatmap.hourByWeekday : [];
                    const peakHours = Array.isArray(systemDashboardData?.usageHeatmap?.peakHours) ? systemDashboardData.usageHeatmap.peakHours : [];
                    const maxHeat = heatmapRows.reduce((max: number, row: any) => Math.max(max, ...(Array.isArray(row?.hours) ? row.hours.map((cell: any) => Number(cell.count || 0)) : [0])), 1);
                    const mcpLogs = Array.isArray(systemDashboardData?.logs?.mcpAudit) ? systemDashboardData.logs.mcpAudit : [];
                    const aiLogs = Array.isArray(systemDashboardData?.logs?.aiMessages) ? systemDashboardData.logs.aiMessages : [];
                    const localOverview = systemDashboardData?.localDatabaseOverview || {};
                    const logQuery = systemDashboardLogQuery.trim().toLowerCase();
                    const filteredMcpLogs = mcpLogs.filter((row: any) => {
                      if (!logQuery) return true;
                      return [row.service, row.action, row.toolName, row.message, row.ok ? 'ja' : 'nej'].join(' ').toLowerCase().includes(logQuery);
                    });
                    const filteredAiLogs = aiLogs.filter((row: any) => {
                      if (!logQuery) return true;
                      return [row.role, row.characters, row.words].join(' ').toLowerCase().includes(logQuery);
                    });
                    if (systemDashboardLoading && !systemDashboardData) {
                      return (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="h-24 rounded-lg bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-slate-800 dark:to-slate-700 animate-pulse" />
                          <div className="h-24 rounded-lg bg-gradient-to-r from-sky-100 to-cyan-100 dark:from-slate-800 dark:to-slate-700 animate-pulse" />
                          <div className="h-24 rounded-lg bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-slate-800 dark:to-slate-700 animate-pulse" />
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-3">
                        {systemDashboardTab === 'overview' && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                              <div className="rounded-lg border border-transparent bg-gradient-to-r from-blue-600 to-indigo-600 p-[1px]"><div className="rounded-lg bg-white dark:bg-slate-900 p-2"><div className="text-gray-500">Input tecken</div><div className="font-semibold">{Number(summary.inputCharactersInRange || 0).toLocaleString('sv-SE')}</div></div></div>
                              <div className="rounded-lg border border-transparent bg-gradient-to-r from-cyan-600 to-blue-600 p-[1px]"><div className="rounded-lg bg-white dark:bg-slate-900 p-2"><div className="text-gray-500">Input ord</div><div className="font-semibold">{Number(summary.inputWordsInRange || 0).toLocaleString('sv-SE')}</div></div></div>
                              <div className="rounded-lg border border-transparent bg-gradient-to-r from-violet-600 to-indigo-600 p-[1px]"><div className="rounded-lg bg-white dark:bg-slate-900 p-2"><div className="text-gray-500">Skapade uppgifter</div><div className="font-semibold">{Number(summary.tasksTotal || 0).toLocaleString('sv-SE')}</div></div></div>
                              <div className="rounded-lg border border-transparent bg-gradient-to-r from-green-600 to-emerald-600 p-[1px]"><div className="rounded-lg bg-white dark:bg-slate-900 p-2"><div className="text-gray-500">Färdiga uppgifter</div><div className="font-semibold">{Number(summary.tasksCompletedTotal || 0).toLocaleString('sv-SE')}</div></div></div>
                              <div className="rounded-lg border border-transparent bg-gradient-to-r from-fuchsia-600 to-purple-600 p-[1px]"><div className="rounded-lg bg-white dark:bg-slate-900 p-2"><div className="text-gray-500">MCP-loggar</div><div className="font-semibold">{Number(summary.mcpAuditInRange || 0).toLocaleString('sv-SE')}</div></div></div>
                            </div>
                            <div className="rounded-lg border bg-white/90 p-3 dark:bg-slate-900/80">
                              <div className="text-xs font-semibold mb-2">Snabböversikt</div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                <div>Konversationer: <span className="font-semibold">{Number(summary.aiConversationsTotal || 0).toLocaleString('sv-SE')}</span></div>
                                <div>AI-meddelanden: <span className="font-semibold">{Number(summary.aiMessagesInRange || 0).toLocaleString('sv-SE')}</span></div>
                                <div>Öppna uppgifter: <span className="font-semibold">{Number(summary.tasksOpenTotal || 0).toLocaleString('sv-SE')}</span></div>
                                <div>Assistant tecken: <span className="font-semibold">{Number(summary.assistantCharactersInRange || 0).toLocaleString('sv-SE')}</span></div>
                              </div>
                            </div>
                          </div>
                        )}
                        {systemDashboardTab === 'usage' && (
                          <div className="space-y-3">
                            <div className="rounded-lg border bg-white/90 p-3 dark:bg-slate-900/80">
                              <div className="text-xs font-semibold mb-2">Användning över tid</div>
                              <div className="space-y-1 max-h-44 overflow-y-auto">
                                {usageSeries.length === 0 ? (
                                  <div className="text-xs text-gray-500">Ingen data för valt spann.</div>
                                ) : (
                                  usageSeries.map((row: any, index: number) => (
                                    <div key={`${row.bucket || index}`} className="grid grid-cols-12 gap-2 items-center text-[11px]">
                                      <div className="col-span-3 truncate">{row.label}</div>
                                      <div className="col-span-6 h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                        <div className="h-2 rounded bg-gradient-to-r from-blue-500 to-indigo-600" style={{ width: `${Math.max(2, Math.round((Number(row.messages || 0) / maxMessages) * 100))}%` }} />
                                      </div>
                                      <div className="col-span-3 text-right">{Number(row.messages || 0).toLocaleString('sv-SE')} msg</div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                            <div className="rounded-lg border bg-white/90 p-3 dark:bg-slate-900/80">
                              <div className="text-xs font-semibold mb-2">Heatmap för användningstider</div>
                              <div className="space-y-1">
                                {heatmapRows.map((weekday: any) => (
                                  <div key={weekday.label} className="flex items-center gap-1">
                                    <div className="w-8 text-[10px] text-gray-500">{weekday.label}</div>
                                    <div className="grid gap-[2px] flex-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                                      {(Array.isArray(weekday.hours) ? weekday.hours : []).map((cell: any) => (
                                        <div key={`${weekday.label}-${cell.hour}`} title={`${weekday.label} ${String(cell.hour).padStart(2, '0')}:00 — ${cell.count}`} className="h-3 rounded" style={{ backgroundColor: `rgba(59,130,246,${maxHeat > 0 ? Math.min(1, Number(cell.count || 0) / maxHeat) : 0})` }} />
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2 text-[11px] text-gray-500">
                                Populära tider: {peakHours.map((item: any) => `${String(item.hour).padStart(2, '0')}:00 (${item.count})`).join(', ') || '-'}
                              </div>
                            </div>
                          </div>
                        )}
                        {systemDashboardTab === 'logs' && (
                          <div className="space-y-3">
                            <div className="rounded-lg border bg-white/90 p-3 dark:bg-slate-900/80">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="text-xs font-semibold">Loggfilter</div>
                                <input value={systemDashboardLogQuery} onChange={(e) => setSystemDashboardLogQuery(e.target.value)} placeholder="Sök i loggar..." className="border rounded p-1.5 text-xs w-56 dark:bg-gray-900" />
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <div className="text-xs font-semibold mb-2">MCP-loggar</div>
                                  <div className="max-h-52 overflow-y-auto border rounded bg-white dark:bg-gray-900">
                                    <table className="w-full text-[11px]">
                                      <thead><tr className="border-b"><th className="text-left p-1">Tid</th><th className="text-left p-1">Tjänst</th><th className="text-left p-1">Action</th><th className="text-left p-1">Tool</th><th className="text-left p-1">OK</th></tr></thead>
                                      <tbody>
                                        {filteredMcpLogs.map((row: any, index: number) => (
                                          <tr key={`${row.at || index}-${row.service || ''}`} className="border-b">
                                            <td className="p-1">{row.at ? new Date(row.at).toLocaleString('sv-SE') : '-'}</td>
                                            <td className="p-1">{row.service || '-'}</td>
                                            <td className="p-1">{row.action || '-'}</td>
                                            <td className="p-1">{row.toolName || '-'}</td>
                                            <td className="p-1">{row.ok ? 'Ja' : 'Nej'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold mb-2">AI-användningsloggar</div>
                                  <div className="max-h-52 overflow-y-auto border rounded bg-white dark:bg-gray-900">
                                    <table className="w-full text-[11px]">
                                      <thead><tr className="border-b"><th className="text-left p-1">Tid</th><th className="text-left p-1">Roll</th><th className="text-left p-1">Tecken</th><th className="text-left p-1">Ord</th></tr></thead>
                                      <tbody>
                                        {filteredAiLogs.map((row: any, index: number) => (
                                          <tr key={`${row.at || index}-${row.role || ''}`} className="border-b">
                                            <td className="p-1">{row.at ? new Date(row.at).toLocaleString('sv-SE') : '-'}</td>
                                            <td className="p-1">{row.role || '-'}</td>
                                            <td className="p-1">{Number(row.characters || 0).toLocaleString('sv-SE')}</td>
                                            <td className="p-1">{Number(row.words || 0).toLocaleString('sv-SE')}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        {systemDashboardTab === 'storage' && (
                          <div className="rounded-lg border bg-white/90 p-3 dark:bg-slate-900/80">
                            <div className="text-xs font-semibold mb-2">Lokal databas och lagring (inloggad användare)</div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                              <div>Backend Notes: <span className="font-semibold">{Number(localOverview.notes || 0).toLocaleString('sv-SE')}</span></div>
                              <div>Backend Tasks: <span className="font-semibold">{Number(localOverview.tasks || 0).toLocaleString('sv-SE')}</span></div>
                              <div>Backend AI Msg: <span className="font-semibold">{Number(localOverview.aiMessagesInRange || 0).toLocaleString('sv-SE')}</span></div>
                              <div>Backend MCP Audit: <span className="font-semibold">{Number(localOverview.mcpAuditRecords || 0).toLocaleString('sv-SE')}</span></div>
                              <div>Lokal Store Notes: <span className="font-semibold">{Number(notes.length || 0).toLocaleString('sv-SE')}</span></div>
                              <div>Lokal Store Tasks: <span className="font-semibold">{Number(tasks.length || 0).toLocaleString('sv-SE')}</span></div>
                              <div>Lokal DB Conv: <span className="font-semibold">{Number(localDbSnapshot?.conversations || 0).toLocaleString('sv-SE')}</span></div>
                              <div>Lokal DB Msg: <span className="font-semibold">{Number(localDbSnapshot?.messages || 0).toLocaleString('sv-SE')}</span></div>
                            </div>
                          </div>
                        )}
                        {systemDashboardTab === 'settings' && (
                          <div className="rounded-lg border bg-white/90 p-3 dark:bg-slate-900/80">
                            <div className="text-xs font-semibold mb-2">Admin-inställningar och policy</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                              <div className="rounded border p-2">Transportpolicy: <span className="font-semibold">{systemDashboardData?.adminSettings?.transportPolicy || '-'}</span></div>
                              <div className="rounded border p-2">Dashboard-scope: <span className="font-semibold">{systemDashboardData?.adminSettings?.dashboardScope || '-'}</span></div>
                              <div className="rounded border p-2">Retention (dagar): <span className="font-semibold">{systemDashboardData?.adminSettings?.auditRetentionDays ?? '-'}</span></div>
                              <div className="rounded border p-2">Key rotation: <span className="font-semibold">{systemDashboardData?.adminSettings?.mcpAuditKeyRotation || '-'}</span></div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          <div>
            <h4 className="font-bold mb-2">Local Models</h4>
            {localModels.length === 0 ? (
                <div className="text-sm text-gray-500 mb-4">No models downloaded.</div>
            ) : (
                <ul className="space-y-2 mb-6">
                    {localModels.map((m: any) => {
                        const label = m.name || m.modelId || m.filename || m.id;
                        const isActive = modelPath === (m.path || m.name);
                        return (
                          <li key={m.id || m.name} className="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-800 rounded border">
                            <div className="text-sm">
                                <div className="font-bold">{label}</div>
                                {typeof m.size === 'number' && (
                                  <div className="text-xs text-gray-500">{(m.size / 1024 / 1024).toFixed(1)} MB</div>
                                )}
                            </div>
                            <div className="flex gap-2">
                              <button 
                                  onClick={() => setModelPath(m.path || m.name)}
                                  className={`px-2 py-1 text-xs rounded ${isActive ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                              >
                                  {isActive ? 'Active' : 'Select'}
                              </button>
                              <button 
                                  onClick={() => handleDeleteModel(m)}
                                  className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
                              >
                                  Delete
                              </button>
                            </div>
                        </li>
                        );
                    })}
                </ul>
            )}
          </div>

          <div>
            <h4 className="font-bold mb-2">Search Hugging Face</h4>
            <div className="flex gap-2 mb-4">
                <input 
                  className="flex-1 border rounded p-2 text-sm dark:bg-gray-800"
                  placeholder="Search GGUF models..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
                <button 
                  onClick={handleSearch}
                  disabled={loading}
                  className="bg-blue-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                >
                    {loading ? 'Searching...' : 'Search'}
                </button>
            </div>

            {loading && !selectedModel && (
                <div className="flex justify-center p-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                </div>
            )}

            <ul className="space-y-2">
                {searchResults.map((m: any) => (
                    <li key={m.id} className="p-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer" onClick={() => handleSelectModel(m)}>
                        <div className="font-bold text-sm">{m.name}</div>
                        <div className="text-xs text-gray-500">Likes: {m.likes} | Downloads: {m.downloads}</div>
                    </li>
                ))}
            </ul>

            {selectedModel && (
                <div className="mt-4 border-t pt-4">
                    <div className="mb-3">
                      <h5 className="font-bold text-sm">{selectedModel.name}</h5>
                      <div className="text-xs text-gray-500">
                        {selectedModel.author} • Likes {selectedModel.likes ?? 0} • Downloads {selectedModel.downloads ?? 0}
                      </div>
                      {selectedModel.tags?.length ? (
                        <div className="text-[11px] text-gray-400 mt-1 truncate">
                          {selectedModel.tags.slice(0, 6).join(', ')}
                        </div>
                      ) : null}
                    </div>
                    {modelFilesError && (
                        <div className="text-xs text-red-500 mb-2">
                          {modelFilesError}
                          <button
                            onClick={() => handleSelectModel(selectedModel)}
                            className="ml-2 text-blue-500 hover:underline"
                          >
                            Försök igen
                          </button>
                        </div>
                    )}
                    {(() => {
                      const recommended = getRecommendedFile(modelFiles);
                      if (!recommended) return null;
                      const key = `${selectedModel.id}:${recommended.quantization || recommended.filename}`;
                      return (
                        <div className="mb-3 p-2 border rounded text-xs">
                          <div className="font-semibold mb-1">Rekommenderad nedladdning</div>
                          <div className="truncate mb-2">
                            {recommended.filename} ({(recommended.size / 1024 / 1024).toFixed(0)} MB)
                          </div>
                          {downloadProgress[key] !== undefined ? (
                            <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                              <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${downloadProgress[key]}%` }}></div>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDownload(selectedModel, recommended); }}
                              className="text-blue-500 hover:underline"
                            >
                              Ladda ner
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    <h6 className="font-semibold text-xs mb-2">Filer</h6>
                    {loading && (
                        <div className="flex justify-center p-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                        </div>
                    )}
                    <ul className="space-y-2 max-h-40 overflow-y-auto">
                      {modelFiles.map((f) => {
                        const key = `${selectedModel.id}:${f.quantization || f.filename}`;
                        return (
                            <li key={key} className="flex justify-between items-center text-xs border-b pb-1">
                                <div>
                                    <div>{f.filename}</div>
                                    <div className="text-gray-500">{(f.size / 1024 / 1024).toFixed(1)} MB - {f.quantization}</div>
                                </div>
                                {downloadProgress[key] !== undefined ? (
                                    <div className="w-24 bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                                        <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${downloadProgress[key]}%` }}></div>
                                    </div>
                                ) : (
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); handleDownload(selectedModel, f); }}
                                      className="text-blue-500 hover:underline"
                                    >
                                        Download
                                    </button>
                                )}
                            </li>
                            );
                        })}
                    </ul>
                </div>
            )}
          </div>
        </div>
      )}

      {systemDashboardStandaloneOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-sm flex items-center justify-center p-2 sm:p-3"
          data-testid="system-dashboard-section"
          onClick={() => setSystemDashboardStandaloneOpen(false)}
        >
          <div
            className="w-[98vw] h-[96vh] max-w-[1800px] max-h-[96vh] overflow-hidden rounded-2xl border border-blue-300/40 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-950 dark:to-slate-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-blue-200/60 dark:border-slate-700 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 2 4-5"/></svg>
                  Systemdashboard
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-300">Dedikerad vy för inloggad användares statistik, loggar och lokal data</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="text-xs px-2 py-1 rounded border bg-white dark:bg-slate-900" onClick={exportSystemDashboardJson}>Export JSON</button>
                <button className="text-xs px-2 py-1 rounded border bg-white dark:bg-slate-900" onClick={exportSystemDashboardCsv}>Export CSV</button>
                <button className="text-xs px-2 py-1 rounded border bg-white dark:bg-slate-900" onClick={() => setSystemDashboardStandaloneOpen(false)}>Stäng</button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto max-h-[calc(96vh-56px)] space-y-3">
              <div className={`rounded border p-2 text-xs ${
                systemDashboardDiagnostics.level === 'ok'
                  ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/20'
                  : systemDashboardDiagnostics.level === 'warning'
                    ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20'
                    : systemDashboardDiagnostics.level === 'error'
                      ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/20'
                      : 'border-gray-300 bg-white dark:border-slate-700 dark:bg-slate-900'
              }`}>
                <div className="font-semibold">
                  {systemDashboardDiagnostics.level === 'ok' ? 'Ansluten' : systemDashboardDiagnostics.level === 'warning' ? 'Fallback-läge' : systemDashboardDiagnostics.level === 'error' ? 'Ej ansluten' : 'Väntar på data'}
                </div>
                <div className="mt-1">{systemDashboardDiagnostics.message || 'Ingen diagnostik ännu.'}</div>
                {systemDashboardDiagnostics.endpoint ? <div className="mt-1 break-all">Endpoint: {systemDashboardDiagnostics.endpoint}</div> : null}
                {systemDashboardDiagnostics.lastSuccessAt ? <div className="mt-1">Senast lyckad: {new Date(systemDashboardDiagnostics.lastSuccessAt).toLocaleString('sv-SE')}</div> : null}
                {systemDashboardDiagnostics.attempted.length ? <div className="mt-1">Försök: {systemDashboardDiagnostics.attempted.slice(0, 4).join(' | ')}</div> : null}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                <label className="text-xs"><span className="block mb-1">Tidsspann</span><select value={systemDashboardRange} onChange={(e) => setSystemDashboardRange(e.target.value as any)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900"><option value="1d">1 dag</option><option value="7d">7 dagar</option><option value="30d">30 dagar</option><option value="90d">90 dagar</option><option value="365d">365 dagar</option></select></label>
                <label className="text-xs"><span className="block mb-1">Intervall</span><select value={systemDashboardGroup} onChange={(e) => setSystemDashboardGroup(e.target.value as any)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900"><option value="hour">Timme</option><option value="day">Dag</option><option value="week">Vecka</option></select></label>
                <label className="text-xs"><span className="block mb-1">Sortering</span><select value={systemDashboardSort} onChange={(e) => setSystemDashboardSort(e.target.value as any)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900"><option value="desc">Senaste först</option><option value="asc">Äldsta först</option></select></label>
                <label className="text-xs"><span className="block mb-1">Service</span><select value={systemDashboardServiceFilter} onChange={(e) => setSystemDashboardServiceFilter(e.target.value)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900">{(Array.isArray(systemDashboardData?.availableFilters?.services) ? systemDashboardData.availableFilters.services : ['all']).map((service: string) => <option key={service} value={service}>{service}</option>)}</select></label>
                <label className="text-xs"><span className="block mb-1">Action</span><select value={systemDashboardActionFilter} onChange={(e) => setSystemDashboardActionFilter(e.target.value)} className="w-full border rounded p-1.5 text-xs dark:bg-gray-900">{(Array.isArray(systemDashboardData?.availableFilters?.actions) ? systemDashboardData.availableFilters.actions : ['all']).map((action: string) => <option key={action} value={action}>{action}</option>)}</select></label>
                <button className="text-xs px-2 py-1.5 rounded border bg-white dark:bg-slate-900" onClick={async () => { await Promise.all([loadSystemDashboard(), loadLocalDbSnapshot()]); }} disabled={systemDashboardLoading} data-testid="system-dashboard-refresh">{systemDashboardLoading ? i18n.t('common.loading') : i18n.t('common.refresh')}</button>
              </div>
              {systemDashboardError ? <div className="text-xs text-red-500 p-2 rounded border border-red-300 bg-red-50 dark:bg-red-950/30">{systemDashboardError}</div> : null}
              <div className="flex flex-wrap gap-2">
                {['overview', 'usage', 'logs', 'storage', 'settings'].map((tab) => (
                  <button key={tab} className={`text-xs px-3 py-1.5 rounded-full border ${systemDashboardTab === tab ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-900'}`} onClick={() => setSystemDashboardTab(tab as any)}>
                    {tab === 'overview' ? 'Översikt' : tab === 'usage' ? 'Användning' : tab === 'logs' ? 'Loggar' : tab === 'storage' ? 'Lagring' : 'Inställningar'}
                  </button>
                ))}
              </div>
              {(() => {
                const summary = systemDashboardData?.summary || {};
                const usageSeries = Array.isArray(systemDashboardData?.usageSeries) ? systemDashboardData.usageSeries : [];
                const mcpLogs = Array.isArray(systemDashboardData?.logs?.mcpAudit) ? systemDashboardData.logs.mcpAudit : [];
                const aiLogs = Array.isArray(systemDashboardData?.logs?.aiMessages) ? systemDashboardData.logs.aiMessages : [];
                const localOverview = systemDashboardData?.localDatabaseOverview || {};
                const raw = localDbSnapshot?.raw || {};
                const storagePayload = {
                  generatedAt: new Date().toISOString(),
                  localOverview: {
                    backend: localOverview,
                    localSummary: {
                      notes: Number(localDbSnapshot?.notes || 0),
                      tasks: Number(localDbSnapshot?.tasks || 0),
                      conversations: Number(localDbSnapshot?.conversations || 0),
                      messages: Number(localDbSnapshot?.messages || 0),
                    },
                  },
                  raw,
                };
                const sectionMap: Record<string, any> = {
                  localNotes: raw?.localNotes || [],
                  localTasks: raw?.localTasks || [],
                  localConversations: raw?.localConversations || [],
                  localMessagesByConversation: raw?.localMessagesByConversation || [],
                  zustandNotes: raw?.zustandNotes || [],
                  zustandTasks: raw?.zustandTasks || [],
                };
                const scopedPayload = storageJsonSection === 'all'
                  ? storagePayload
                  : { [storageJsonSection]: sectionMap[storageJsonSection] || [] };
                const filteredStoragePayload = filterJsonByQuery(scopedPayload, storageJsonQuery) || {};
                if (systemDashboardLoading && !systemDashboardData) return <div className="h-40 rounded-xl bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-slate-800 dark:to-slate-700 animate-pulse" />;
                if (systemDashboardTab === 'overview') return (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="p-3 rounded border bg-white dark:bg-slate-900"><div className="text-gray-500">Input tecken</div><div className="font-semibold">{Number(summary.inputCharactersInRange || 0).toLocaleString('sv-SE')}</div></div>
                    <div className="p-3 rounded border bg-white dark:bg-slate-900"><div className="text-gray-500">Input ord</div><div className="font-semibold">{Number(summary.inputWordsInRange || 0).toLocaleString('sv-SE')}</div></div>
                    <div className="p-3 rounded border bg-white dark:bg-slate-900"><div className="text-gray-500">Uppgifter</div><div className="font-semibold">{Number(summary.tasksTotal || 0).toLocaleString('sv-SE')}</div></div>
                    <div className="p-3 rounded border bg-white dark:bg-slate-900"><div className="text-gray-500">Färdiga</div><div className="font-semibold">{Number(summary.tasksCompletedTotal || 0).toLocaleString('sv-SE')}</div></div>
                    <div className="p-3 rounded border bg-white dark:bg-slate-900"><div className="text-gray-500">MCP-loggar</div><div className="font-semibold">{Number(summary.mcpAuditInRange || 0).toLocaleString('sv-SE')}</div></div>
                  </div>
                );
                if (systemDashboardTab === 'usage') return usageSeries.length ? (
                  <div className="space-y-1">{usageSeries.map((row: any, i: number) => <div key={`${row.bucket || i}`} className="grid grid-cols-12 gap-2 text-xs"><div className="col-span-3">{row.label}</div><div className="col-span-7"><div className="h-2 rounded bg-gray-200 dark:bg-gray-700"><div className="h-2 rounded bg-gradient-to-r from-blue-500 to-indigo-600" style={{ width: `${Math.max(2, Math.min(100, (Number(row.messages || 0) * 100) / Math.max(1, ...usageSeries.map((s: any) => Number(s.messages || 0)))))}%` }} /></div></div><div className="col-span-2 text-right">{Number(row.messages || 0)}</div></div>)}</div>
                ) : (
                  <div className="p-8 rounded border bg-white dark:bg-slate-900 text-center text-xs text-gray-500">
                    <svg viewBox="0 0 24 24" className="h-10 w-10 mx-auto mb-2 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 2 4-5"/></svg>
                    Ingen användningsdata hittades för valt tidsintervall.
                  </div>
                );
                if (systemDashboardTab === 'logs') return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded border bg-white dark:bg-slate-900 p-2"><div className="text-xs font-semibold mb-2">MCP-loggar</div>{mcpLogs.length ? <pre className="text-[11px] overflow-auto max-h-72">{JSON.stringify(mcpLogs, null, 2)}</pre> : <div className="text-xs text-gray-500"><svg viewBox="0 0 24 24" className="h-8 w-8 mb-2 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></svg>Inga MCP-loggar.</div>}</div>
                    <div className="rounded border bg-white dark:bg-slate-900 p-2"><div className="text-xs font-semibold mb-2">AI-loggar</div>{aiLogs.length ? <pre className="text-[11px] overflow-auto max-h-72">{JSON.stringify(aiLogs, null, 2)}</pre> : <div className="text-xs text-gray-500">Inga AI-loggar.</div>}</div>
                  </div>
                );
                if (systemDashboardTab === 'storage') return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div>Backend Notes: <span className="font-semibold">{Number(localOverview.notes || 0).toLocaleString('sv-SE')}</span></div>
                      <div>Backend Tasks: <span className="font-semibold">{Number(localOverview.tasks || 0).toLocaleString('sv-SE')}</span></div>
                      <div>Local Notes: <span className="font-semibold">{Number(localDbSnapshot?.notes || 0).toLocaleString('sv-SE')}</span></div>
                      <div>Local Tasks: <span className="font-semibold">{Number(localDbSnapshot?.tasks || 0).toLocaleString('sv-SE')}</span></div>
                    </div>
                    <div className="rounded border bg-white dark:bg-slate-900 p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold">Strukturerad lokal lagringsdata (Electron-enhet)</div>
                        <div className="flex items-center gap-2">
                          <button
                            className="text-xs px-2 py-1 rounded border"
                            onClick={async () => copyText(JSON.stringify(storagePayload, null, 2))}
                            data-testid="system-storage-copy-all"
                          >
                            Kopiera allt
                          </button>
                          <button
                            className="text-xs px-2 py-1 rounded border"
                            onClick={() => downloadTextFile(`system-dashboard-storage-${Date.now()}.json`, JSON.stringify(storagePayload, null, 2), 'application/json')}
                            data-testid="system-storage-export-all"
                          >
                            Exportera allt
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <input
                          className="border rounded p-1.5 text-xs dark:bg-gray-900"
                          value={storageJsonQuery}
                          onChange={(e) => setStorageJsonQuery(e.target.value)}
                          placeholder="Sök i JSON-innehåll…"
                          data-testid="system-storage-search"
                        />
                        <select
                          className="border rounded p-1.5 text-xs dark:bg-gray-900"
                          value={storageJsonSection}
                          onChange={(e) => setStorageJsonSection(e.target.value as any)}
                          data-testid="system-storage-section-filter"
                        >
                          <option value="all">Alla sektioner</option>
                          <option value="localNotes">Local notes</option>
                          <option value="localTasks">Local tasks</option>
                          <option value="localConversations">Local conversations</option>
                          <option value="localMessagesByConversation">Local messages</option>
                          <option value="zustandNotes">Store notes</option>
                          <option value="zustandTasks">Store tasks</option>
                        </select>
                        <div className="text-[11px] text-gray-500 dark:text-gray-300 flex items-center">
                          Matchande noder: {Object.keys(filteredStoragePayload || {}).length}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className="text-xs px-2 py-1 rounded border"
                          onClick={() => setStorageTreeCollapseAll(filteredStoragePayload, false)}
                          data-testid="system-storage-expand-all"
                        >
                          Expandera alla
                        </button>
                        <button
                          className="text-xs px-2 py-1 rounded border"
                          onClick={() => setStorageTreeCollapseAll(filteredStoragePayload, true)}
                          data-testid="system-storage-collapse-all"
                        >
                          Fäll alla
                        </button>
                      </div>
                      {Object.keys(filteredStoragePayload || {}).length ? (
                        <div className="text-[11px] overflow-auto max-h-[54vh] border rounded p-2 bg-slate-50 dark:bg-slate-950/40" data-testid="system-storage-tree">
                          {renderStorageTree(filteredStoragePayload, 'root', 0, 'root')}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 text-center p-6">
                          <svg viewBox="0 0 24 24" className="h-9 w-9 mx-auto mb-2 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>
                          Ingen lagringsdata matchade valt filter/sökning.
                        </div>
                      )}
                    </div>
                  </div>
                );
                return (
                  <div className="rounded border bg-white dark:bg-slate-900 p-3 text-xs space-y-1">
                    <div>Transportpolicy: {systemDashboardData?.adminSettings?.transportPolicy || '-'}</div>
                    <div>Dashboard-scope: {systemDashboardData?.adminSettings?.dashboardScope || '-'}</div>
                    <div>Retention: {systemDashboardData?.adminSettings?.auditRetentionDays ?? '-'}</div>
                    <div>Key rotation: {systemDashboardData?.adminSettings?.mcpAuditKeyRotation || '-'}</div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {iconPickerTarget && (
        <IconPicker
          onSelect={(iconName, iconColor) => {
            if (iconPickerTarget === 'project') {
              setProjectDialogIcon(iconName || 'FaFolder');
              setProjectDialogIconColor(iconColor || '#000000');
            }
            if (iconPickerTarget === 'chat') {
              setChatDialogIcon(iconName || 'FaComments');
              setChatDialogIconColor(iconColor || '#000000');
            }
            setIconPickerTarget(null);
          }}
          onClose={() => setIconPickerTarget(null)}
        />
      )}

      {projectDialogOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setProjectDialogOpen(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              {projectDialogId ? 'Redigera projekt' : 'Nytt projekt'}
            </h2>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1">Namn</label>
              <input
                className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                value={projectDialogName}
                onChange={(e) => setProjectDialogName(e.target.value)}
                placeholder="Projektets namn"
                data-testid="ai-project-name"
              />
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1">Ikon</label>
              <button
                className="w-full border rounded p-2 text-sm dark:bg-gray-900 flex items-center gap-2"
                onClick={() => setIconPickerTarget('project')}
              >
                {(() => {
                  const Icon = getIconComponent(projectDialogIcon);
                  return <Icon size={20} color={projectDialogIconColor} />;
                })()}
                Välj ikon
              </button>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1">Systemprompt</label>
              <textarea
                className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                rows={4}
                value={projectDialogPrompt}
                onChange={(e) => setProjectDialogPrompt(e.target.value)}
                placeholder="Tilläggsprompt för projektet"
                data-testid="ai-project-prompt"
              />
            </div>
            <label className="mt-3 text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={projectDialogLocalOnly}
                onChange={(e) => setProjectDialogLocalOnly(e.target.checked)}
              />
              Endast lokal (synkas inte till server)
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
                onClick={() => setProjectDialogOpen(false)}
              >
                Avbryt
              </button>
              <button
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
                onClick={saveProject}
                data-testid="ai-project-save"
              >
                Spara
              </button>
            </div>
          </div>
        </div>
      )}

      {chatDialogOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setChatDialogOpen(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              Redigera chatt
            </h2>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1">Namn</label>
              <input
                className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                value={chatDialogName}
                onChange={(e) => setChatDialogName(e.target.value)}
                placeholder="Chattnamn"
              />
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1">Ikon</label>
              <button
                className="w-full border rounded p-2 text-sm dark:bg-gray-900 flex items-center gap-2"
                onClick={() => setIconPickerTarget('chat')}
              >
                {(() => {
                  const Icon = getIconComponent(chatDialogIcon);
                  return <Icon size={20} color={chatDialogIconColor} />;
                })()}
                Välj ikon
              </button>
            </div>
            <label className="mt-3 text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={chatDialogLocalOnly}
                onChange={(e) => setChatDialogLocalOnly(e.target.checked)}
              />
              Endast lokal (synkas inte till server)
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
                onClick={() => setChatDialogOpen(false)}
              >
                Avbryt
              </button>
              <button
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
                onClick={saveChatDialog}
              >
                Spara
              </button>
            </div>
          </div>
        </div>
      )}

      {projectConfirmDeleteId && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={cancelDeleteProject} />
          <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Ta bort projekt?</h2>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">Projektet och dess kopplingar tas bort.</div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100" onClick={cancelDeleteProject}>Avbryt</button>
              <button className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white" onClick={confirmDeleteProject}>Ta bort</button>
            </div>
          </div>
        </div>
      )}

      {chatConfirmDeleteId && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={cancelDeleteChat} />
          <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Ta bort chatt?</h2>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">Chattens historik tas bort.</div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100" onClick={cancelDeleteChat}>Avbryt</button>
              <button className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white" onClick={confirmDeleteChat}>Ta bort</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
