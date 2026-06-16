import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View, FlatList, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable, AppState, Linking, useWindowDimensions, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Button, useTheme, IconButton, List, ActivityIndicator, ProgressBar, Portal, Dialog, TextInput as PaperTextInput, Switch, Menu, Divider, Chip } from 'react-native-paper';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MobileLlamaProvider } from '@/services/ai/provider';
import { useStore } from '@/stores/useStore';
import { ChatMessage, Conversation, HFModel, HFFile, AIProject, normalizeToolArguments, sortModels, type HFModelSort } from '@repo/ai';
import { searchHuggingFaceModels, getModelFiles } from '@/services/ai/huggingface';
import { downloadModel as serviceDownloadModel, getBestQuantization, deleteModel as serviceDeleteModel, cancelDownload as cancelModelDownload } from '@/services/ai/modelService';
import { isNativeFileSystemAvailable, subscribeDownloads, getDownloadSnapshot, getActiveDownloads, pauseModelDownload, resumeModelDownload, resumePersistedDownloads, getModelPath as getLocalModelPath, type DownloadState } from '@/services/ai/ModelDownloader';
import { recommendFileForDevice, assessModelFit, describeHardwareBudget, formatBytes } from '@/services/ai/hardware';
import { saveConversationLocal, getConversationsLocal, deleteConversationLocal, saveMessageLocal, getMessagesLocal, getModelsLocal, saveModelLocal, saveProjectLocal, getProjectsLocal, deleteProjectLocal } from '@/services/database';
import { combineSystemPrompts, buildToolUseNotice } from '@/services/ai/prompt';
import { API_URL, fetchWithAuth } from '@/services/api';
import { buildToolSystemPrompt, extractToolCalls } from '@/services/ai/tooling';
import { extractThinking } from '@/services/ai/thinking';
import { shouldStopToolIteration, toToolCallKeys, toToolIterationSignature } from '@/services/ai/toolChain';
import { generateApiProviderResponse, streamApiProviderResponse, API_PROVIDERS, API_PROVIDER_LIST, type ApiProviderType } from '@/services/ai/apiProviders';
import { recordUsage, getUsageSnapshot, recordToolUse, getToolUsageRows, type UsageSnapshot } from '@/services/ai/usageTracker';
import { toolUsageLabel, type ToolUsageRow } from '@repo/shared';
import { pullAiSync, pushAiSync } from '@/services/ai/sync';
import { initSocket, getSocket } from '@/services/socket';
import { buildSecurityNoteMap, isReadableWithLocks } from '@/services/ai/security';
import { modelManager } from '@/services/ai/ModelManager';
import { isAiBackgroundWorkEnabled, setAiBackgroundWorkEnabled } from '@/services/ai/runtimeSettings';
import { acquireKeepAwake } from '@/services/ai/keepAwake';
import { startAiForegroundService, stopAiForegroundService } from '@/services/ai/foregroundService';
import IconPickerModal from '@/components/IconPickerModal';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { resolveAiSettingsScope } from '@/services/ai/settingsScope';
import { MCP_INTEGRATIONS, McpUiSettings, createEmptyMcpUiSettings, decrypt, encrypt, safeDecrypt, isAnyCiphertext, normalizeMcpUiSettings, resolveMcpSettings, toEffectiveMcpUiSettings, mcpSettingsFromJson, mcpSettingsToJsonString, mergePresetProviders, buildAttachmentContextBlock, summarizeAttachmentsForUi, imageDataUrls, MAX_ATTACHMENTS, CONTEXT_LEVELS, contextLevelConfig, summarizeToolPolicy, normalizeContextLevel, applyDelegationDefaults, serializeAiDelegation, summarizeToolMessage, formatToolFields, type AiAttachment, type ContextLevel, type AiTaskSource, type AiTaskDelegation } from '@repo/shared';
import { setDelegation as setLocalDelegation } from '@/services/ai/agentDelegations';
import { syncDelegationToBackend } from '@/services/ai/agentBackendSync';
import { pickAttachments } from '@/services/ai/attachments';
import { retrieveForChat } from '@/services/ai/embeddingsService';
import { getSourceMinLevels } from '@/services/nextcloud';
import { CustomErrorBoundary } from '@/components/ErrorBoundary';

const provider = new MobileLlamaProvider();

// Defensive wrappers around the shared parsers used while RENDERING messages. A single
// malformed/corrupted message row must never throw inside renderItem and crash the whole
// chat list — on any parse failure we degrade to a safe empty result.
const safeExtractToolCalls = (text: unknown): { calls: any[]; cleaned: string } => {
  const s = typeof text === 'string' ? text : '';
  try { return extractToolCalls(s); } catch { return { calls: [], cleaned: s }; }
};
const safeExtractThinking = (text: unknown): { thinking: string; answer: string } | null => {
  const s = typeof text === 'string' ? text : '';
  try { return extractThinking(s); } catch { return { thinking: '', answer: s }; }
};
const safeSummarizeTool = (text: unknown): string => {
  const s = typeof text === 'string' ? text : '';
  try { return summarizeToolMessage(s)?.summary || ''; } catch { return ''; }
};
const safeToolFields = (text: unknown): { label: string; value: string }[] => {
  const s = typeof text === 'string' ? text : '';
  try { const f = formatToolFields(s); return Array.isArray(f) ? f : []; } catch { return []; }
};

type LocalConversation = Conversation & { localOnly?: boolean };
type LocalAIProject = AIProject & { localOnly?: boolean; userId?: string };
// A user-added custom provider — an OpenAI-compatible endpoint (Ollama/Hermes/
// LM Studio/own proxy). id is prefixed `custom_`. Sent via the Hermes code path.
type CustomProvider = { id: string; label: string; baseUrl: string; model: string; apiKey: string };
type PullAiSyncResult = Awaited<ReturnType<typeof pullAiSync>>;

const ProjectDialog = React.memo(({
  visible,
  mode,
  initialName,
  initialPrompt,
  icon,
  iconColor,
  onPickIcon,
  initialLocalOnly,
  onDelete,
  onSave,
  onDismiss,
}: {
  visible: boolean;
  mode: 'create' | 'edit';
  initialName: string;
  initialPrompt: string;
  icon?: string;
  iconColor?: string;
  onPickIcon: () => void;
  initialLocalOnly: boolean;
  onDelete?: () => void;
  onSave: (name: string, prompt: string, localOnly: boolean) => void;
  onDismiss: () => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [localOnly, setLocalOnly] = useState(initialLocalOnly);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setPrompt(initialPrompt);
      setLocalOnly(initialLocalOnly);
    }
  }, [visible, initialName, initialPrompt, initialLocalOnly]);

  return (
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>{mode === 'create' ? t('ai.project.createTitle') : t('ai.project.editTitle')}</Dialog.Title>
      <Dialog.Content>
        <PaperTextInput
          mode="outlined"
          label={t('ai.project.name')}
          value={name}
          onChangeText={setName}
          autoCorrect={false}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Button mode="outlined" onPress={onPickIcon}>
            {t('ai.project.pickIcon')}
          </Button>
          {icon ? (
            <View style={{ marginLeft: 12 }}>
              <FontAwesome5
                name={icon.replace(/^Fa/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}
                size={18}
                color={iconColor || theme.colors.onSurface}
              />
            </View>
          ) : null}
        </View>
        <PaperTextInput
          mode="outlined"
          label={t('ai.project.prompt')}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          autoCorrect={false}
          style={{ marginTop: 12 }}
        />
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text>{t('ai.localOnlyLabel')}</Text>
          <Switch value={localOnly} onValueChange={setLocalOnly} />
        </View>
      </Dialog.Content>
      <Dialog.Actions style={{ marginTop: 12 }}>
        <Button onPress={onDismiss}>{t('common.cancel')}</Button>
        {mode === 'edit' ? <Button onPress={onDelete}>{t('common.delete')}</Button> : null}
        <Button mode="contained" onPress={() => onSave(name, prompt, localOnly)} style={{ marginLeft: 8 }}>
          {mode === 'create' ? t('common.create') : t('common.save')}
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
});

const ChatDialog = React.memo(({
  visible,
  initialName,
  initialLocalOnly,
  onPickIcon,
  onDelete,
  onSave,
  onDismiss,
}: {
  visible: boolean;
  initialName: string;
  initialLocalOnly: boolean;
  onPickIcon: () => void;
  onDelete: () => void;
  onSave: (name: string, localOnly: boolean) => void;
  onDismiss: () => void;
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [localOnly, setLocalOnly] = useState(initialLocalOnly);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setLocalOnly(initialLocalOnly);
    }
  }, [visible, initialName, initialLocalOnly]);

  return (
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>{t('ai.chatDialog.editTitle')}</Dialog.Title>
      <Dialog.Content>
        <PaperTextInput
          mode="outlined"
          label={t('ai.chatDialog.name')}
          value={name}
          onChangeText={setName}
          autoCorrect={false}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Button mode="outlined" onPress={onPickIcon}>
            {t('ai.chatDialog.pickIcon')}
          </Button>
        </View>
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text>{t('ai.localOnlyLabel')}</Text>
          <Switch value={localOnly} onValueChange={setLocalOnly} />
        </View>
      </Dialog.Content>
      <Dialog.Actions style={{ marginTop: 12 }}>
        <Button onPress={onDismiss}>{t('common.cancel')}</Button>
        <Button onPress={onDelete}>{t('common.delete')}</Button>
        <Button mode="contained" onPress={() => onSave(name, localOnly)} style={{ marginLeft: 8 }}>
          {t('common.save')}
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
});

function AIScreenInner() {
  const theme = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // Offset = the stack header height so the composer lands exactly above the
  // keyboard (the KeyboardAvoidingView sits below the header).
  const headerOffset = insets.top + (Platform.OS === 'ios' ? 44 : 56);
  const params = useLocalSearchParams<{ openSettings?: string; settingsTab?: string }>();
  const { t } = useTranslation();
  
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'models' | 'instructions'>('models');

  // Chat
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  // AI chat file attachments (text files inlined; binary → placeholder). Settings
  // toggle below gates the attach button. Cleared after each send.
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(true);
  // Per-thread privacy: when on, a NEW conversation stays local-only (encrypted on
  // this device, never pushed to the server). Existing threads keep their own flag.
  const [nextThreadLocalOnly, setNextThreadLocalOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [contextInfo, setContextInfo] = useState('');
  const [infoVisible, setInfoVisible] = useState(false);
  const stopRequestedRef = useRef(false);
  // Chat list ref so opening a thread (and new messages) scrolls to the latest.
  const messagesListRef = useRef<FlatList<any>>(null);
  const scrollChatToEnd = useCallback((animated = false) => {
    requestAnimationFrame(() => {
      try { messagesListRef.current?.scrollToEnd({ animated }); } catch {}
    });
  }, []);
  const [tokensPerSecond, setTokensPerSecond] = useState<number | null>(null);
  const [enableToolUse, setEnableToolUse] = useState(true);
  // Chat complexity: gates which tools + searches the chat may use (minimal → just
  // answer, deep → full tools + search). Mirrors the web AISidebar.
  const [chatContextLevel, setChatContextLevel] = useState<ContextLevel>('standard');
  // Semantic retrieval (RAG): when on, the chat retrieves relevant notes/tasks for each
  // message (lexical+vector → optional GraphRAG → rerank) and injects them as context.
  // Lock-aware (only readable items). Persisted as JSON in `ai_retrieval_settings`.
  const [retrievalSettings, setRetrievalSettings] = useState<{ enableSemantic: boolean; enableGraphRAG: boolean; enableRerank: boolean }>(
    { enableSemantic: false, enableGraphRAG: false, enableRerank: true }
  );
  const [toolUsageRows, setToolUsageRows] = useState<ToolUsageRow[]>([]);
  // AI-statistik now lives in the AI-instruktioner tab; load it when that opens.
  useEffect(() => { if (settingsVisible && settingsTab === 'instructions') { getToolUsageRows().then(setToolUsageRows).catch(() => {}); } }, [settingsVisible, settingsTab]);
  const [userScopeKey, setUserScopeKey] = useState<string>('anon');
  const [collapsedTool, setCollapsedTool] = useState<Record<string, boolean>>({});
  const [collapsedThinking, setCollapsedThinking] = useState<Record<string, boolean>>({});

  // Projects
  const [projects, setProjects] = useState<LocalAIProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  // Once we've consulted the persisted project choice (incl. "All" = null), never let the
  // auto-select-first-project logic override it — that's what made the selection jump when
  // navigating chat ↔ project list. Stored encrypted, scoped per user.
  const projectSelInitRef = useRef(false);
  // Guards the persist effects below until the initial load has populated state. Without
  // it, the moment userScopeKey is set the save effects fire with empty initial state and
  // overwrite the stored keys/models/flags with '' — wiping them on every launch (this is
  // why API keys "had to be re-entered" each time). Set true at the end of the load IIFE.
  const settingsHydratedRef = useRef(false);
  const ALL_PROJECTS_SENTINEL = '__ALL__';
  // Clearly-visible press ripple for list rows in the AI section (parity with settings
  // rows). Stronger alpha so it's obvious which row was tapped on both iOS and Android.
  const ROW_RIPPLE = 'rgba(33, 150, 243, 0.40)';
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [projectDialogVisible, setProjectDialogVisible] = useState(false);
  const [projectDialogMode, setProjectDialogMode] = useState<'create' | 'edit'>('edit');
  const [projectDialogId, setProjectDialogId] = useState<string | null>(null);
  const [projectDialogName, setProjectDialogName] = useState('');
  const [projectDialogPrompt, setProjectDialogPrompt] = useState('');
  const [projectDialogIcon, setProjectDialogIcon] = useState<string | undefined>();
  const [projectDialogIconColor, setProjectDialogIconColor] = useState<string | undefined>();
  const [projectDialogLocalOnly, setProjectDialogLocalOnly] = useState(false);
  const [projectIconPickerVisible, setProjectIconPickerVisible] = useState(false);
  const [chatDialogVisible, setChatDialogVisible] = useState(false);
  const [chatDialogId, setChatDialogId] = useState<string | null>(null);
  const [chatDialogName, setChatDialogName] = useState('');
  const [chatDialogIcon, setChatDialogIcon] = useState<string | undefined>();
  const [chatDialogIconColor, setChatDialogIconColor] = useState<string | undefined>();
  const [chatDialogLocalOnly, setChatDialogLocalOnly] = useState(false);
  const [chatIconPickerVisible, setChatIconPickerVisible] = useState(false);
  const [confirmProjectDeleteId, setConfirmProjectDeleteId] = useState<string | null>(null);
  const [confirmChatDeleteId, setConfirmChatDeleteId] = useState<string | null>(null);

  // Models
  const [localModels, setLocalModels] = useState<any[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  // 0..1 while a local GGUF is being loaded into the engine; null when idle/loaded.
  const [modelLoadProgress, setModelLoadProgress] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HFModel[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [modelSort, setModelSort] = useState<HFModelSort>('downloads');
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [downloadDialogVisible, setDownloadDialogVisible] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [processingModels, setProcessingModels] = useState<Record<string, boolean>>({});
  const [downloadStage, setDownloadStage] = useState<Record<string, string>>({});
  const [allowBackgroundAIWork, setAllowBackgroundAIWork] = useState(false);
  const [aiUseApiProviders, setAiUseApiProviders] = useState(false);
  const [apiProvider, setApiProvider] = useState<string>('openrouter');
  const [providerMenuVisible, setProviderMenuVisible] = useState(false);
  // Paper Menu reliability: the anchor must OPEN only (never toggle), because a
  // toggle races the Portal backdrop's dismiss and makes the dropdown need several
  // taps / "stop working". A short guard after a dismiss also stops a propagated
  // tap from immediately reopening the menu. See openMenuSafely/dismissMenuSafely.
  const providerMenuGuardRef = useRef(0);
  const modelMenuGuardRef = useRef(0);
  const openMenuSafely = (guardRef: React.MutableRefObject<number>, setVisible: (v: boolean) => void) => {
    if (Date.now() - guardRef.current > 250) setVisible(true);
  };
  const dismissMenuSafely = (guardRef: React.MutableRefObject<number>, setVisible: (v: boolean) => void) => {
    guardRef.current = Date.now();
    setVisible(false);
  };
  // User-added custom providers (e.g. several Hermes/Ollama agents). Each is an
  // OpenAI-compatible endpoint reusing the Hermes send path. Persisted encrypted.
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [addProviderDialogVisible, setAddProviderDialogVisible] = useState(false);
  const [newProvider, setNewProvider] = useState<CustomProvider>({ id: '', label: '', baseUrl: '', model: '', apiKey: '' });
  const [modelMenuVisible, setModelMenuVisible] = useState(false);
  const [customModelMode, setCustomModelMode] = useState(false);
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [openRouterModel, setOpenRouterModel] = useState('openai/gpt-4o-mini');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [groqModel, setGroqModel] = useState('llama-3.3-70b-versatile');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [anthropicModel, setAnthropicModel] = useState('claude-sonnet-4-6');
  const [grokApiKey, setGrokApiKey] = useState('');
  const [grokModel, setGrokModel] = useState('grok-4.3');
  // Self-hosted Hermes agent (MacBook / Raspberry Pi): user-supplied base URL,
  // model id, and an optional key. Stored encrypted at rest like the other keys.
  const [hermesApiKey, setHermesApiKey] = useState('');
  const [hermesModel, setHermesModel] = useState('hermes-3-llama-3.1-8b');
  const [hermesBaseUrl, setHermesBaseUrl] = useState('');

  // Resolve the active provider's key/model + setters without N-way ternaries at
  // each use. Add a provider to API_PROVIDERS + a binding row here and the whole UI
  // (menu, key/model inputs, validation, send) picks it up. `baseUrl` is only set
  // for configurable (self-hosted) providers.
  const apiProviderBindings: Record<ApiProviderType, {
    key: string; setKey: (v: string) => void; model: string; setModel: (v: string) => void;
    baseUrl?: string; setBaseUrl?: (v: string) => void;
  }> = {
    openrouter: { key: openRouterApiKey, setKey: setOpenRouterApiKey, model: openRouterModel, setModel: setOpenRouterModel },
    gemini: { key: geminiApiKey, setKey: setGeminiApiKey, model: geminiModel, setModel: setGeminiModel },
    groq: { key: groqApiKey, setKey: setGroqApiKey, model: groqModel, setModel: setGroqModel },
    openai: { key: openaiApiKey, setKey: setOpenaiApiKey, model: openaiModel, setModel: setOpenaiModel },
    anthropic: { key: anthropicApiKey, setKey: setAnthropicApiKey, model: anthropicModel, setModel: setAnthropicModel },
    grok: { key: grokApiKey, setKey: setGrokApiKey, model: grokModel, setModel: setGrokModel },
    hermes: { key: hermesApiKey, setKey: setHermesApiKey, model: hermesModel, setModel: setHermesModel, baseUrl: hermesBaseUrl, setBaseUrl: setHermesBaseUrl },
  };
  // Custom providers are resolved separately from the static binding map.
  const isCustomProvider = apiProvider.startsWith('custom_');
  const activeCustom = isCustomProvider ? customProviders.find((p) => p.id === apiProvider) : undefined;
  const updateActiveCustom = (patch: Partial<CustomProvider>) =>
    setCustomProviders((prev) => prev.map((p) => (p.id === apiProvider ? { ...p, ...patch } : p)));

  const activeBinding: { key: string; setKey: (v: string) => void; model: string; setModel: (v: string) => void; baseUrl?: string; setBaseUrl?: (v: string) => void } =
    isCustomProvider && activeCustom
      ? {
          key: activeCustom.apiKey, setKey: (v) => updateActiveCustom({ apiKey: v }),
          model: activeCustom.model, setModel: (v) => updateActiveCustom({ model: v }),
          baseUrl: activeCustom.baseUrl, setBaseUrl: (v) => updateActiveCustom({ baseUrl: v }),
        }
      : (apiProviderBindings[apiProvider as ApiProviderType] ?? apiProviderBindings.openrouter);

  // Metadata for the active provider — static registry entry, or a Hermes-like
  // descriptor for a custom one (configurable endpoint, optional key).
  const activeProviderMeta = isCustomProvider
    ? { id: apiProvider, label: activeCustom?.label || 'Egen provider', endpoint: null as string | null, apiKeyUrl: '', defaultModels: activeCustom?.model ? [activeCustom.model] : [], configurableEndpoint: true, apiKeyOptional: true, hint: 'Bas-URL till din egen OpenAI-kompatibla server (Ollama/Hermes/LM Studio)' }
    : API_PROVIDERS[apiProvider as ApiProviderType];
  // Provider id actually sent to the API layer: custom → reuse the Hermes path.
  const sendProviderId: ApiProviderType = isCustomProvider ? 'hermes' : (apiProvider as ApiProviderType);

  const activeApiKey = activeBinding.key;
  const activeApiModel = activeBinding.model;
  const activeBaseUrl = activeBinding.baseUrl;

  // Build a delegation from the CURRENT chat settings so the chat can hand a task to
  // the AI agent "with the model/source I'm using right now" (self-delegation flow).
  const currentChatDelegationDefaults = () => {
    if (!aiUseApiProviders) {
      return { source: 'local' as AiTaskSource, provider: 'mlc', model: activeModel || undefined, contextLevel: chatContextLevel, toolUse: enableToolUse, runOnBackend: false };
    }
    const source: AiTaskSource = sendProviderId === 'hermes' ? 'hermes' : 'api';
    return { source, provider: apiProvider, model: activeApiModel || undefined, baseUrl: activeBaseUrl, contextLevel: chatContextLevel, toolUse: enableToolUse, runOnBackend: false };
  };

  // Usage / limits for the active provider+model (calls + tokens, today + month).
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(null);
  const refreshUsage = useCallback(async () => {
    if (!activeApiModel) { setUsageSnapshot(null); return; }
    try { setUsageSnapshot(await getUsageSnapshot(apiProvider, activeApiModel)); } catch {}
  }, [apiProvider, activeApiModel]);
  useEffect(() => { void refreshUsage(); }, [refreshUsage]);
  const [mcpSettings, setMcpSettings] = useState<McpUiSettings>(() => createEmptyMcpUiSettings());
  // Easy custom MCP JSON — paste/import a portable config or export the current one.
  const [mcpJsonOpen, setMcpJsonOpen] = useState(false);
  const [mcpJsonText, setMcpJsonText] = useState('');
  const [mcpJsonError, setMcpJsonError] = useState<string | null>(null);
  const [mcpJsonNotice, setMcpJsonNotice] = useState<string | null>(null);
  const [mcpDashboardOpen, setMcpDashboardOpen] = useState(false);
  const [mcpDashboardLoading, setMcpDashboardLoading] = useState(false);
  const [mcpDashboardError, setMcpDashboardError] = useState<string | null>(null);
  const [mcpDashboardRows, setMcpDashboardRows] = useState<any[]>([]);
  const [localEngineText, setLocalEngineText] = useState<string>('');
  const [searchSizes, setSearchSizes] = useState<Record<string, number | null>>({});
  // Per-model available quant files (lazy-fetched when a row is expanded) for the picker.
  const [modelFiles, setModelFiles] = useState<Record<string, HFFile[]>>({});
  const [modelFilesLoading, setModelFilesLoading] = useState<Record<string, boolean>>({});
  // Live list of in-progress/paused downloads for the "Aktiva nedladdningar" panel.
  const [activeDownloadsList, setActiveDownloadsList] = useState<DownloadState[]>([]);

  // History
  const [conversations, setConversations] = useState<LocalConversation[]>([]);

  const getMcpEnvValues = (): Record<string, string | undefined> => {
    const env = process.env as Record<string, string | undefined>;
    return {
      MCP_SLACK_ENABLED: env.EXPO_PUBLIC_MCP_SLACK_ENABLED,
      SLACK_MCP_ENABLED: env.EXPO_PUBLIC_SLACK_MCP_ENABLED,
      MCP_SLACK_BOT_TOKEN: env.EXPO_PUBLIC_MCP_SLACK_BOT_TOKEN,
      SLACK_BOT_TOKEN: env.EXPO_PUBLIC_SLACK_BOT_TOKEN,
      MCP_SLACK_TEAM_ID: env.EXPO_PUBLIC_MCP_SLACK_TEAM_ID,
      SLACK_TEAM_ID: env.EXPO_PUBLIC_SLACK_TEAM_ID,
      MCP_SLACK_CHANNEL_IDS: env.EXPO_PUBLIC_MCP_SLACK_CHANNEL_IDS,
      SLACK_CHANNEL_IDS: env.EXPO_PUBLIC_SLACK_CHANNEL_IDS,
      MCP_GOOGLE_WORKSPACE_ENABLED: env.EXPO_PUBLIC_MCP_GOOGLE_WORKSPACE_ENABLED,
      GOOGLE_WORKSPACE_MCP_ENABLED: env.EXPO_PUBLIC_GOOGLE_WORKSPACE_MCP_ENABLED,
      MCP_GOOGLE_OAUTH_CLIENT_ID: env.EXPO_PUBLIC_MCP_GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_ID: env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
      MCP_GOOGLE_OAUTH_CLIENT_SECRET: env.EXPO_PUBLIC_MCP_GOOGLE_OAUTH_CLIENT_SECRET,
      GOOGLE_OAUTH_CLIENT_SECRET: env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_SECRET,
      MCP_GOOGLE_OAUTH_REDIRECT_URI: env.EXPO_PUBLIC_MCP_GOOGLE_OAUTH_REDIRECT_URI,
      GOOGLE_OAUTH_REDIRECT_URI: env.EXPO_PUBLIC_GOOGLE_OAUTH_REDIRECT_URI,
      MCP_GOOGLE_OAUTH_PATH: env.EXPO_PUBLIC_MCP_GOOGLE_OAUTH_PATH,
      GOOGLE_OAUTH_PATH: env.EXPO_PUBLIC_GOOGLE_OAUTH_PATH,
      MCP_NOTION_ENABLED: env.EXPO_PUBLIC_MCP_NOTION_ENABLED,
      NOTION_MCP_ENABLED: env.EXPO_PUBLIC_NOTION_MCP_ENABLED,
      MCP_NOTION_API_TOKEN: env.EXPO_PUBLIC_MCP_NOTION_API_TOKEN,
      NOTION_API_TOKEN: env.EXPO_PUBLIC_NOTION_API_TOKEN,
      MCP_NOTION_WORKSPACE_ID: env.EXPO_PUBLIC_MCP_NOTION_WORKSPACE_ID,
      NOTION_WORKSPACE_ID: env.EXPO_PUBLIC_NOTION_WORKSPACE_ID,
      MCP_FILESYSTEM_ENABLED: env.EXPO_PUBLIC_MCP_FILESYSTEM_ENABLED,
      FILESYSTEM_MCP_ENABLED: env.EXPO_PUBLIC_FILESYSTEM_MCP_ENABLED,
      MCP_FILESYSTEM_ALLOWED_PATHS: env.EXPO_PUBLIC_MCP_FILESYSTEM_ALLOWED_PATHS,
      FILESYSTEM_ALLOWED_PATHS: env.EXPO_PUBLIC_FILESYSTEM_ALLOWED_PATHS,
      MCP_PLAYWRIGHT_ENABLED: env.EXPO_PUBLIC_MCP_PLAYWRIGHT_ENABLED,
      PLAYWRIGHT_MCP_ENABLED: env.EXPO_PUBLIC_PLAYWRIGHT_MCP_ENABLED,
      MCP_PLAYWRIGHT_BROWSER: env.EXPO_PUBLIC_MCP_PLAYWRIGHT_BROWSER,
      PLAYWRIGHT_BROWSER: env.EXPO_PUBLIC_PLAYWRIGHT_BROWSER,
      MCP_PLAYWRIGHT_HEADLESS: env.EXPO_PUBLIC_MCP_PLAYWRIGHT_HEADLESS,
      PLAYWRIGHT_HEADLESS: env.EXPO_PUBLIC_PLAYWRIGHT_HEADLESS,
      MCP_PLAYWRIGHT_CHANNEL: env.EXPO_PUBLIC_MCP_PLAYWRIGHT_CHANNEL,
      PLAYWRIGHT_CHANNEL: env.EXPO_PUBLIC_PLAYWRIGHT_CHANNEL,
    };
  };

  useEffect(() => {
    // Title of the thread you're currently in (if any), so the header clearly says which
    // chat is open. It's horizontally scrollable and width-capped to the space left of the
    // header icons (left menu + 4 right icons), so a long title never overlaps them —
    // it's cut off right before the icons and you can scroll sideways to read the rest.
    const activeConv = currentConversationId
      ? conversations.find((c) => c.id === currentConversationId)
      : null;
    const threadTitle = (activeConv?.title || '').trim();
    // left menu icon ≈ 48, right cluster (4 icons) ≈ 184, + breathing room.
    const titleMaxWidth = Math.max(96, windowWidth - 48 - 184 - 16);
    navigation.setOptions({
      headerTitleAlign: 'left',
      headerTitleContainerStyle: { maxWidth: titleMaxWidth },
      headerTitle: () => (
        threadTitle ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={{ maxWidth: titleMaxWidth }}
            contentContainerStyle={{ alignItems: 'center' }}
          >
            <Text variant="titleMedium" numberOfLines={1} style={{ color: theme.colors.onSurface }}>
              {threadTitle}
            </Text>
          </ScrollView>
        ) : (
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{t('tabs.ai')}</Text>
        )
      ),
      headerLeft: () => (
        <IconButton
          icon="menu"
          onPress={() => setSidebarVisible(true)}
        />
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton
            icon="information-outline"
            onPress={() => setInfoVisible(true)}
            accessibilityLabel={t('ai.threadInfo', 'Information om tråden')}
          />
          <IconButton
            icon={nextThreadLocalOnly ? 'cellphone-lock' : 'cloud-sync-outline'}
            iconColor={nextThreadLocalOnly ? theme.colors.primary : theme.colors.onSurfaceVariant}
            onPress={() => setNextThreadLocalOnly((prev) => !prev)}
            accessibilityLabel={nextThreadLocalOnly ? t('ai.threadLocalOnly', 'Nya trådar: endast lokalt') : t('ai.threadSynced', 'Nya trådar: synkas E2E')}
          />
          <IconButton icon="plus" onPress={createNewChat} />
          <IconButton
            icon={settingsVisible ? 'close' : 'cog'}
            onPress={() => setSettingsVisible((prev) => !prev)}
          />
        </View>
      ),
    });
  }, [navigation, theme, settingsVisible, activeModel, activeProjectId, nextThreadLocalOnly, t, currentConversationId, conversations, windowWidth]);

  useEffect(() => {
    if (params.openSettings === '1') {
      setSettingsVisible(true);
      if (params.settingsTab === 'instructions' || params.settingsTab === 'models') {
        setSettingsTab(params.settingsTab);
      }
    }
  }, [params.openSettings, params.settingsTab]);

  useEffect(() => {
    loadModels();
    (async () => {
     // The WHOLE restore is wrapped so a single failing await (a network refresh, a
     // decrypt of legacy data, a SecureStore hiccup) can never abort hydration. If it
     // did, `settingsHydratedRef` would stay false forever and EVERY persist effect
     // would be gated off — so the "use API-based AI" toggle, the chosen model/provider
     // etc. would silently never save. The finally guarantees hydration completes.
     try {
      // Stable per-user scope (survives JWT rotation on re-login) + one-time migration
      // from the legacy token-hash scope so settings are never "forgotten".
      const scopeKey = await resolveAiSettingsScope();
      setUserScopeKey(scopeKey);
      // Restore the remembered AI-project selection (encrypted) before any auto-select runs.
      try {
        const savedProj = safeDecrypt(await AsyncStorage.getItem(`ai_active_project_${scopeKey}`) || '', '');
        if (savedProj) setActiveProjectId(savedProj === ALL_PROJECTS_SENTINEL ? null : savedProj);
      } catch {}
      projectSelInitRef.current = true;
      const saved = await AsyncStorage.getItem(`ai_system_prompt_${scopeKey}`);
      if (saved) setSystemPrompt(decrypt(saved));
      const savedToolUse = await AsyncStorage.getItem(`ai_tool_use_enabled_${scopeKey}`);
      if (savedToolUse !== null) setEnableToolUse(savedToolUse === 'true');
      const savedContextLevel = await AsyncStorage.getItem(`ai_chat_context_level_${scopeKey}`);
      if (savedContextLevel) setChatContextLevel(normalizeContextLevel(savedContextLevel));
      const savedRetrieval = await AsyncStorage.getItem(`ai_retrieval_settings_${scopeKey}`);
      if (savedRetrieval) { try { const r = JSON.parse(savedRetrieval); setRetrievalSettings((prev) => ({ ...prev, ...r })); } catch {} }
      const savedAttachmentsEnabled = await AsyncStorage.getItem(`ai_attachments_enabled_${scopeKey}`);
      if (savedAttachmentsEnabled !== null) setAttachmentsEnabled(savedAttachmentsEnabled === 'true');
      const savedNextLocalOnly = await AsyncStorage.getItem(`ai_next_thread_local_only_${scopeKey}`);
      if (savedNextLocalOnly !== null) setNextThreadLocalOnly(savedNextLocalOnly === 'true');
      const savedBackgroundWork = await AsyncStorage.getItem(`ai_background_work_${scopeKey}`);
      if (savedBackgroundWork !== null) {
        setAllowBackgroundAIWork(savedBackgroundWork === 'true');
        await setAiBackgroundWorkEnabled(savedBackgroundWork === 'true');
      } else {
        const globalSetting = await isAiBackgroundWorkEnabled();
        setAllowBackgroundAIWork(globalSetting);
      }
      await refreshRemoteSync(scopeKey);
      const savedApiEnabled = await AsyncStorage.getItem(`ai_api_enabled_${scopeKey}`);
      if (savedApiEnabled !== null) setAiUseApiProviders(savedApiEnabled === 'true');
      // Custom providers (encrypted JSON in SecureStore). Load before restoring id.
      const customRaw = await SecureStore.getItemAsync(`ai_custom_providers_${scopeKey}`);
      let loadedCustom: CustomProvider[] = [];
      if (customRaw) {
        try {
          const parsed = JSON.parse(safeDecrypt(customRaw, customRaw) || '[]');
          if (Array.isArray(parsed)) loadedCustom = parsed;
        } catch {}
      }
      // Pre-seed this user's private Hermes agents (exclusive per username; nothing
      // for anyone else). Persist encrypted only when something was actually added.
      const username = await SecureStore.getItemAsync('auth_username').catch(() => null);
      const { merged: withPresets, added: presetsAdded } = mergePresetProviders(loadedCustom, username);
      setCustomProviders(withPresets);
      if (presetsAdded) {
        try {
          await SecureStore.setItemAsync(`ai_custom_providers_${scopeKey}`, encrypt(JSON.stringify(withPresets)));
        } catch {}
      }
      // Provider/model/base-url are stored encrypted; safeDecrypt reads any legacy
      // plaintext value transparently (so existing installs keep working).
      const savedApiProvider = safeDecrypt(await AsyncStorage.getItem(`ai_api_provider_${scopeKey}`) || '', '');
      if (savedApiProvider && (savedApiProvider in API_PROVIDERS || savedApiProvider.startsWith('custom_'))) setApiProvider(savedApiProvider);
      const savedOpenRouterModel = safeDecrypt(await AsyncStorage.getItem(`ai_openrouter_model_${scopeKey}`) || '', '');
      if (savedOpenRouterModel) setOpenRouterModel(savedOpenRouterModel);
      const savedGeminiModel = safeDecrypt(await AsyncStorage.getItem(`ai_gemini_model_${scopeKey}`) || '', '');
      if (savedGeminiModel) setGeminiModel(savedGeminiModel);
      const savedGroqModel = safeDecrypt(await AsyncStorage.getItem(`ai_groq_model_${scopeKey}`) || '', '');
      if (savedGroqModel) setGroqModel(savedGroqModel);
      const savedOpenaiModel = safeDecrypt(await AsyncStorage.getItem(`ai_openai_model_${scopeKey}`) || '', '');
      if (savedOpenaiModel) setOpenaiModel(savedOpenaiModel);
      const savedAnthropicModel = safeDecrypt(await AsyncStorage.getItem(`ai_anthropic_model_${scopeKey}`) || '', '');
      if (savedAnthropicModel) setAnthropicModel(savedAnthropicModel);
      const savedGrokModel = safeDecrypt(await AsyncStorage.getItem(`ai_grok_model_${scopeKey}`) || '', '');
      if (savedGrokModel) setGrokModel(savedGrokModel);
      const savedHermesModel = safeDecrypt(await AsyncStorage.getItem(`ai_hermes_model_${scopeKey}`) || '', '');
      if (savedHermesModel) setHermesModel(savedHermesModel);
      const savedHermesBaseUrl = safeDecrypt(await AsyncStorage.getItem(`ai_hermes_base_url_${scopeKey}`) || '', '');
      if (savedHermesBaseUrl) setHermesBaseUrl(savedHermesBaseUrl);
      const openRouterKeyEnc = await SecureStore.getItemAsync(`ai_openrouter_key_${scopeKey}`);
      if (openRouterKeyEnc) setOpenRouterApiKey(safeDecrypt(openRouterKeyEnc) || '');
      const geminiKeyEnc = await SecureStore.getItemAsync(`ai_gemini_key_${scopeKey}`);
      if (geminiKeyEnc) setGeminiApiKey(safeDecrypt(geminiKeyEnc) || '');
      const groqKeyEnc = await SecureStore.getItemAsync(`ai_groq_key_${scopeKey}`);
      if (groqKeyEnc) setGroqApiKey(safeDecrypt(groqKeyEnc) || '');
      const openaiKeyEnc = await SecureStore.getItemAsync(`ai_openai_key_${scopeKey}`);
      if (openaiKeyEnc) setOpenaiApiKey(safeDecrypt(openaiKeyEnc) || '');
      const anthropicKeyEnc = await SecureStore.getItemAsync(`ai_anthropic_key_${scopeKey}`);
      if (anthropicKeyEnc) setAnthropicApiKey(safeDecrypt(anthropicKeyEnc) || '');
      const grokKeyEnc = await SecureStore.getItemAsync(`ai_grok_key_${scopeKey}`);
      if (grokKeyEnc) setGrokApiKey(safeDecrypt(grokKeyEnc) || '');
      const hermesKeyEnc = await SecureStore.getItemAsync(`ai_hermes_key_${scopeKey}`);
      if (hermesKeyEnc) setHermesApiKey(safeDecrypt(hermesKeyEnc) || '');
      const mcpSettingsRaw = await SecureStore.getItemAsync(`ai_mcp_settings_${scopeKey}`);
      let parsedMcpSettings = createEmptyMcpUiSettings();
      if (mcpSettingsRaw) {
        try {
          parsedMcpSettings = normalizeMcpUiSettings(JSON.parse(decrypt(mcpSettingsRaw) || mcpSettingsRaw || '{}'));
        } catch {}
      }
      const resolvedMcpSettings = resolveMcpSettings(parsedMcpSettings, getMcpEnvValues());
      setMcpSettings(toEffectiveMcpUiSettings(resolvedMcpSettings));
     } catch (e) {
       console.warn('[ai-settings] hydration step failed (persistence still enabled):', e);
     } finally {
      // Hydration complete — only now may the persist effects write to storage, so they
      // never clobber the just-loaded values with empty initial state. ALWAYS runs, even
      // if a step above threw, so the toggle/model/provider persist reliably.
      settingsHydratedRef.current = true;
     }
    })();
  }, []);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_tool_use_enabled_${userScopeKey}`, enableToolUse ? 'true' : 'false');
  }, [enableToolUse, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_chat_context_level_${userScopeKey}`, chatContextLevel);
  }, [chatContextLevel, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_retrieval_settings_${userScopeKey}`, JSON.stringify(retrievalSettings));
  }, [retrievalSettings, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_attachments_enabled_${userScopeKey}`, attachmentsEnabled ? 'true' : 'false');
  }, [attachmentsEnabled, userScopeKey]);

  // Auto-save the system prompt locally (encrypted) as you type — debounced — so it
  // always persists without needing an explicit save tap.
  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    const handle = setTimeout(() => {
      AsyncStorage.setItem(`ai_system_prompt_${userScopeKey}`, systemPrompt ? encrypt(systemPrompt) : '').catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [systemPrompt, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_next_thread_local_only_${userScopeKey}`, nextThreadLocalOnly ? 'true' : 'false');
  }, [nextThreadLocalOnly, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_background_work_${userScopeKey}`, allowBackgroundAIWork ? 'true' : 'false');
    setAiBackgroundWorkEnabled(allowBackgroundAIWork).catch(() => {});
  }, [allowBackgroundAIWork, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_api_enabled_${userScopeKey}`, aiUseApiProviders ? 'true' : 'false');
  }, [aiUseApiProviders, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    // Provider/model choices are encrypted at rest too (not just keys) so nothing about
    // the user's AI config sits in plaintext AsyncStorage on the device.
    AsyncStorage.setItem(`ai_api_provider_${userScopeKey}`, apiProvider ? encrypt(apiProvider) : '');
  }, [apiProvider, userScopeKey]);

  // Custom providers (incl. their API keys) saved encrypted in SecureStore.
  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    SecureStore.setItemAsync(`ai_custom_providers_${userScopeKey}`, customProviders.length ? encrypt(JSON.stringify(customProviders)) : '');
  }, [customProviders, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_openrouter_model_${userScopeKey}`, openRouterModel ? encrypt(openRouterModel) : '');
  }, [openRouterModel, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_gemini_model_${userScopeKey}`, geminiModel ? encrypt(geminiModel) : '');
  }, [geminiModel, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_groq_model_${userScopeKey}`, groqModel ? encrypt(groqModel) : '');
  }, [groqModel, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_openai_model_${userScopeKey}`, openaiModel ? encrypt(openaiModel) : '');
  }, [openaiModel, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_anthropic_model_${userScopeKey}`, anthropicModel ? encrypt(anthropicModel) : '');
  }, [anthropicModel, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_grok_model_${userScopeKey}`, grokModel ? encrypt(grokModel) : '');
  }, [grokModel, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    AsyncStorage.setItem(`ai_hermes_model_${userScopeKey}`, hermesModel ? encrypt(hermesModel) : '');
  }, [hermesModel, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    // The Hermes base URL is the user's own server address — encrypt it at rest too.
    AsyncStorage.setItem(`ai_hermes_base_url_${userScopeKey}`, hermesBaseUrl ? encrypt(hermesBaseUrl) : '');
  }, [hermesBaseUrl, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    SecureStore.setItemAsync(`ai_openrouter_key_${userScopeKey}`, openRouterApiKey ? encrypt(openRouterApiKey) : '');
  }, [openRouterApiKey, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    SecureStore.setItemAsync(`ai_gemini_key_${userScopeKey}`, geminiApiKey ? encrypt(geminiApiKey) : '');
  }, [geminiApiKey, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    SecureStore.setItemAsync(`ai_groq_key_${userScopeKey}`, groqApiKey ? encrypt(groqApiKey) : '');
  }, [groqApiKey, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    SecureStore.setItemAsync(`ai_openai_key_${userScopeKey}`, openaiApiKey ? encrypt(openaiApiKey) : '');
  }, [openaiApiKey, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    SecureStore.setItemAsync(`ai_anthropic_key_${userScopeKey}`, anthropicApiKey ? encrypt(anthropicApiKey) : '');
  }, [anthropicApiKey, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    SecureStore.setItemAsync(`ai_grok_key_${userScopeKey}`, grokApiKey ? encrypt(grokApiKey) : '');
  }, [grokApiKey, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    SecureStore.setItemAsync(`ai_hermes_key_${userScopeKey}`, hermesApiKey ? encrypt(hermesApiKey) : '');
  }, [hermesApiKey, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey || !settingsHydratedRef.current) return;
    SecureStore.setItemAsync(`ai_mcp_settings_${userScopeKey}`, encrypt(JSON.stringify(mcpSettings)));
  }, [mcpSettings, userScopeKey]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if ((nextState === 'background' || nextState === 'inactive') && loading && !allowBackgroundAIWork) {
        stopRequestedRef.current = true;
      }
    });
    return () => sub.remove();
  }, [loading, allowBackgroundAIWork]);

  // #2: when background AI work is allowed, hold a keep-awake lock for the whole
  // duration of an active generation. This stops the OS from locking the screen
  // and suspending the JS engine mid-response — so both on-device (llama.rn) and
  // streaming API generations actually run to completion when the user switches
  // away or the screen would otherwise lock. Released the moment loading ends.
  useEffect(() => {
    if (!(loading && allowBackgroundAIWork)) return;
    const release = acquireKeepAwake();
    // Android: also run a foreground service so generation continues when the app is
    // backgrounded / screen locked (keep-awake alone only covers a foregrounded app).
    // No-op on iOS / before the native build. Gated on AI actually working + the toggle.
    void startAiForegroundService();
    return () => { release(); void stopAiForegroundService(); };
  }, [loading, allowBackgroundAIWork]);

  // Lazy-fetch the available quant files when a model row is expanded, so the picker can
  // list every size + flag the recommended one for this device. Cached per model id.
  useEffect(() => {
    const id = expandedModelId;
    if (!id || modelFiles[id] || modelFilesLoading[id]) return;
    let cancelled = false;
    setModelFilesLoading(prev => ({ ...prev, [id]: true }));
    getModelFiles(id)
      .then((files) => { if (!cancelled) setModelFiles(prev => ({ ...prev, [id]: files })); })
      .catch(() => { if (!cancelled) setModelFiles(prev => ({ ...prev, [id]: [] })); })
      .finally(() => { if (!cancelled) setModelFilesLoading(prev => ({ ...prev, [id]: false })); });
    return () => { cancelled = true; };
  }, [expandedModelId]);

  // Reduce the "long delay before a local model answers": warm the engine shortly after a
  // local model is selected so it's already resident when the user sends. Silent + best-
  // effort (the on-send load shows progress + surfaces real errors); skipped in API mode,
  // when no model is chosen, when it's already loaded, or while not chatting.
  useEffect(() => {
    if (aiUseApiProviders || !activeModel || loading) return;
    if (!modelManager.isAvailable()) return;
    if (provider.isLoaded(activeModel)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      provider.loadModel(activeModel).catch(() => { /* on-send load will report */ });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeModel, aiUseApiProviders, loading]);

  // #3: re-attach to module-owned downloads. A download keeps running even after
  // this screen / the download dialog is closed (it lives in ModelDownloader), so
  // on (re)mount we hydrate from the live snapshot and then track every update —
  // reopening the model list always shows the real, ongoing progress.
  useEffect(() => {
    const apply = (modelId: string, percent: number, stage: string) => {
      // 'paused'/'retrying' are still in-progress; only these three end a download.
      const finished = stage === 'completed' || stage === 'failed' || stage === 'cancelled';
      setDownloadProgress(prev => {
        const next = { ...prev };
        if (finished) delete next[modelId]; else next[modelId] = percent;
        return next;
      });
      setDownloadStage(prev => ({ ...prev, [modelId]: stage }));
      setProcessingModels(prev => {
        const next = { ...prev };
        if (finished) delete next[modelId]; else next[modelId] = true;
        return next;
      });
      setActiveDownloadsList(getActiveDownloads());
    };
    for (const s of getDownloadSnapshot()) apply(s.modelId, s.percent, s.stage);
    setActiveDownloadsList(getActiveDownloads());
    const unsub = subscribeDownloads((s) => apply(s.modelId, s.percent, s.stage));
    // Resume any downloads interrupted by an app kill; register them in the DB on finish.
    resumePersistedDownloads(async (_modelId, meta) => {
      try {
        await saveModelLocal({
          id: uuidv4(),
          name: meta.name || 'Modell',
          filename: meta.quantization ? `${meta.quantization}.gguf` : 'model.gguf',
          path: meta.target,
          size: meta.totalBytes || 0,
          downloaded: true,
          quantization: meta.quantization,
        } as any);
        await loadModels();
      } catch { /* best-effort */ }
    }).catch(() => {});
    return unsub;
  }, []);

  useEffect(() => {
    let active = true;
    let currentSocket: ReturnType<typeof getSocket> | null = null;
    let refreshInterval: ReturnType<typeof setInterval> | null = null;
    let appStateSub: { remove: () => void } | null = null;
    const setup = async () => {
      try {
        const token = await SecureStore.getItemAsync('token');
        if (!active || !token) return;
        currentSocket = initSocket(token) || getSocket();
        if (!currentSocket) return;
        const handler = async () => {
          await refreshRemoteSync(userScopeKey || undefined);
        };
        currentSocket.on('ai:sync-updated', handler);
        currentSocket.on('connect', handler);
        refreshInterval = setInterval(() => {
          handler().catch(() => {});
        }, 15000);
        appStateSub = AppState.addEventListener('change', (nextState) => {
          if (nextState === 'active') {
            handler().catch(() => {});
          }
        });
        await handler();
        return () => {
          currentSocket?.off('ai:sync-updated', handler);
          currentSocket?.off('connect', handler);
          if (refreshInterval) clearInterval(refreshInterval);
          refreshInterval = null;
          appStateSub?.remove();
          appStateSub = null;
        };
      } catch {
        return () => {};
      }
    };
    let cleanup: (() => void) | undefined;
    setup().then((teardown) => {
      if (typeof teardown === 'function') cleanup = teardown;
    });
    return () => {
      active = false;
      cleanup?.();
      if (refreshInterval) clearInterval(refreshInterval);
      appStateSub?.remove();
    };
  }, [userScopeKey]);

  const refreshLocalEngine = () => {
      // llama.rn runs GGUF directly on-device — no conversion. We just report whether
      // the native engine is compiled into this build (it is in an EAS/dev build, not
      // in Expo Go), so the user knows whether downloaded models can actually run here.
      setLocalEngineText(modelManager.isAvailable() ? t('ai.localEngineReady') : t('ai.localEngineMissing'));
  };

  useEffect(() => {
      refreshLocalEngine();
  }, []);

  const loadModels = async () => {
      const models = await getModelsLocal();
      setLocalModels(models);
      if (models.length > 0 && !activeModel) {
          setActiveModel(models[0].path);
      }
  };

  const loadConversations = async () => {
      let convs = await getConversationsLocal();
      setConversations(convs);
  };

  const mergeRemoteSync = async (remote: PullAiSyncResult, scopeKey?: string) => {
      try {
          for (const conversation of remote.conversations) {
              await saveConversationLocal(conversation);
          }
          for (const row of remote.messages) {
              // CORRUPTION GUARD (the real root cause of empty threads): pullAiSync runs
              // safeDecrypt on the server ciphertext. If the data key isn't ready yet (the
              // launch merge can race ahead of crypto restore), safeDecrypt returns the
              // value UNCHANGED — i.e. STILL CIPHERTEXT, which is non-empty, so the old
              // "blank" check let it through. saveMessageLocal then RE-ENCRYPTS that
              // ciphertext over the good local row (INSERT OR REPLACE by id) → the thread
              // can never decrypt again and reads as empty/garbled. So skip a row unless
              // its content is genuinely readable plaintext (not blank, not still-encrypted).
              // Once the key is ready a later pull (or loadChat's self-heal) merges it for real.
              const m = row.message as any;
              const content = typeof m?.content === 'string' ? m.content : '';
              const readableText = content.trim().length > 0 && !isAnyCiphertext(content);
              const hasToolCalls = Array.isArray(m?.toolCalls) && m.toolCalls.length > 0;
              if (!readableText && !hasToolCalls) continue;
              await saveMessageLocal(row.conversationId, row.message);
          }
          const convs = await getConversationsLocal();
          setConversations(convs);
      } catch {}
      try {
          for (const project of remote.projects) {
              await saveProjectLocal(project, scopeKey);
          }
          const items = await getProjectsLocal(scopeKey);
          setProjects(items);
          if (items.length > 0 && !activeProjectId && !projectSelInitRef.current) {
              setActiveProjectId(items[0].id);
          }
      } catch {}
  };

  const refreshRemoteSync = async (scopeKey?: string) => {
      const localConvs = await getConversationsLocal();
      setConversations(localConvs);
      const localProjects = await getProjectsLocal(scopeKey);
      setProjects(localProjects);
      try {
          const remote = await pullAiSync();
          await mergeRemoteSync(remote, scopeKey);
      } catch {}
  };

  const loadProjects = async (scopeKey?: string) => {
      let items = await getProjectsLocal(scopeKey);
      setProjects(items);
      if (items.length > 0 && !activeProjectId && !projectSelInitRef.current) {
          setActiveProjectId(items[0].id);
      }
  };

  const isConversationLocalOnly = (conversationId: string) =>
      Boolean(conversations.find((item) => item.id === conversationId)?.localOnly);
  const activeModelLabel = aiUseApiProviders
      ? activeApiModel
      : (activeModel || '');

  const formatError = (error: unknown) => {
      const message = (error as any)?.message ? String((error as any).message) : String(error);
      if (message.includes('Native filesystem not available')) return 'Filsystem saknas. Kör i dev‑client.';
      if (message.includes('Model path not found')) return 'Modellfilen hittades inte. Ladda ner modellen igen.';
      if (message.includes('Model not loaded')) return 'Ingen lokal modell är laddad. Välj och ladda en modell först.';
      if (message.includes('Download failed')) return 'Nedladdningen misslyckades. Kontrollera nätverket och försök igen.';
      return message;
  };

  const formatTimestamp = (value?: string) => {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDownloadStage = (stage?: string) => {
      if (!stage) return '';
      const map: Record<string, string> = {
          queued: t('ai.downloadStageQueued'),
          downloading: t('ai.downloadStageDownloadingGguf'),
          completed: t('ai.downloadStageCompleted'),
          failed: t('ai.downloadStageLocalFailed'),
          paused: 'Pausad',
          retrying: 'Återförsöker…',
          cancelled: 'Avbruten',
      };
      return map[stage] || stage;
  };

  const getActiveProject = () => projects.find(p => p.id === activeProjectId) || null;


  const graphQLRequest = async (query: string, variables: Record<string, any>) => {
      if (!query || typeof query !== 'string') {
          throw new Error('GraphQL query saknas');
      }
      try {
          const json = await fetchWithAuth('/graphql', {
              method: 'POST',
              body: JSON.stringify({ query, variables })
          });
          if (!json || typeof json !== 'object') {
              throw new Error('Ogiltigt GraphQL-svar');
          }
          if (Array.isArray((json as any).errors) && (json as any).errors.length > 0) {
              throw new Error((json as any).errors[0]?.message || 'GraphQL error');
          }
          if (!('data' in (json as any))) {
              throw new Error('GraphQL data saknas');
          }
          return (json as any).data;
      } catch (error: any) {
          const message = String(error?.message || '');
          if (error?.status === 401 || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('token')) {
              throw new Error('Sessionen har gått ut. Logga in igen.');
          }
          throw error;
      }
  };

  const getEnabledMcpServices = () =>
    (Object.keys(mcpSettings) as Array<keyof McpUiSettings>).filter((key) => Boolean(mcpSettings[key]?.enabled)) as string[];

  const ensureSecureApiTransport = () => {
      try {
          const parsed = new URL(API_URL);
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

  const mcpRequest = async (path: '/mcp/tools' | '/mcp/call', body: Record<string, any>) => {
      ensureSecureApiTransport();
      const payload = {
          ...body,
          mcpUiSettings: mcpSettings,
          mcpUiSettingsEnc: encrypt(JSON.stringify(mcpSettings)),
      };
      const json = await fetchWithAuth(path, {
          method: 'POST',
          body: JSON.stringify(payload),
      });
      if (!json || typeof json !== 'object') {
          throw new Error('Ogiltigt MCP-svar');
      }
      if ((json as any).message && !(json as any).result) {
          throw new Error(String((json as any).message));
      }
      return json as Record<string, any>;
  };

  const loadMcpDashboard = async () => {
      setMcpDashboardLoading(true);
      setMcpDashboardError(null);
      try {
          ensureSecureApiTransport();
          const json = await fetchWithAuth('/mcp/dashboard?limit=80', { method: 'GET' });
          if (!json || typeof json !== 'object') {
              throw new Error('Ogiltigt dashboard-svar');
          }
          const rows = Array.isArray((json as any).persistedAudit) ? (json as any).persistedAudit : [];
          setMcpDashboardRows(rows);
      } catch (error: any) {
          setMcpDashboardRows([]);
          setMcpDashboardError(String(error?.message || 'Kunde inte läsa MCP-dashboard'));
      } finally {
          setMcpDashboardLoading(false);
      }
  };

  const safePreview = (value: unknown, maxLen: number = 2000) => {
      try {
          const serialized = JSON.stringify(value);
          if (serialized.length > maxLen) {
              return `${serialized.slice(0, maxLen)}...`;
          }
          return serialized;
      } catch {
          return String(value);
      }
  };

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
          const tools = Array.isArray(result?.result?.tools) ? result.result.tools : [];
          return tools.map((item: any) => ({
              type: 'mcp_tool',
              id: item.name || '',
              title: item.name || '',
              descriptionPreview: String(item.description || '').slice(0, 300),
          }));
      }
      if (tool === 'mcp_call_tool') {
          const content = Array.isArray(result?.result?.content) ? result.result.content : [];
          return content.map((entry: any, index: number) => ({
              type: 'mcp_result',
              id: String(index + 1),
              title: entry.type || 'content',
              contentPreview: String(entry.text || JSON.stringify(entry)).slice(0, 400),
          }));
      }
      return [];
  };

  // Apply an AI tool's note/project mutation to the local store immediately, so the new/
  // changed note appears in the app right away (no wait for the WSS echo, no forced reload).
  // Idempotent with the note:created/updated socket handler (dedupes by _id).
  const applyNoteMutationLocally = (note: any) => {
    if (note && note._id) { try { useStore.getState().ingestServerNote(note); } catch { /* non-fatal */ } }
  };

  // TRUE end-to-end encryption for AI-created/edited content: encrypt the sensitive fields
  // ON-DEVICE with the user's active key BEFORE the GraphQL mutation, so the backend stores
  // ciphertext it cannot read (it passes already-encrypted values through unchanged). encrypt()
  // uses the v3 user key when E2E is active, else the legacy scheme — same as a typed note.
  const e2eNoteInput = (input: Record<string, any>): Record<string, any> => {
    const out = { ...input };
    if (typeof out.title === 'string') out.title = encrypt(out.title);
    if (typeof out.content === 'string') out.content = encrypt(out.content);
    if (Array.isArray(out.tags)) out.tags = out.tags.map((t: any) => (typeof t === 'string' ? encrypt(t) : t));
    return out;
  };
  const e2eTaskInput = (input: Record<string, any>): Record<string, any> => {
    const out = { ...input };
    if (typeof out.title === 'string') out.title = encrypt(out.title);
    if (typeof out.description === 'string') out.description = encrypt(out.description);
    return out;
  };

  const executeToolCall = async (tool: string, rawArgs: Record<string, any>, intentText: string) => {
      // Statistics: count every tool/skill the AI invokes (for the usage panel).
      void recordToolUse(tool);
      // Some models double-wrap fields under a stray `args`/`input` key, which makes
      // GraphQL reject the mutation ("Field args is not defined by type TaskInput").
      // Flatten to the TaskInput/NoteInput shape before doing anything.
      const args = normalizeToolArguments(tool, rawArgs);
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
              const data = await graphQLRequest(query, { input: e2eNoteInput(input) });
              applyNoteMutationLocally((data as any)?.createNote);
              return data;
          }
          case 'update_note': {
              const { ensureReadableNote } = getAISecurityContext();
              ensureReadableNote(requireId(args.id));
              const query = `mutation($id:String!,$input:NoteInput!){updateNote(id:$id,input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              if (!args.updates || Object.keys(args.updates).length === 0) throw new Error('update_note kräver updates');
              const data = await graphQLRequest(query, { id: requireId(args.id), input: e2eNoteInput(args.updates || {}) });
              applyNoteMutationLocally((data as any)?.updateNote);
              return data;
          }
          case 'delete_note': {
              const { ensureReadableNote } = getAISecurityContext();
              ensureReadableNote(requireId(args.id));
              const query = `mutation($id:String!){deleteNote(id:$id)}`;
              const data = await graphQLRequest(query, { id: requireId(args.id) });
              useStore.getState().ingestServerNoteDeletion(requireId(args.id));
              return data;
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
              const data = await graphQLRequest(query, { input: e2eNoteInput({ ...args, type: 'project' }) });
              applyNoteMutationLocally((data as any)?.createNote);
              return data;
          }
          case 'update_project': {
              const { ensureReadableNote } = getAISecurityContext();
              ensureReadableNote(requireId(args.id));
              const query = `mutation($id:String!,$input:NoteInput!){updateNote(id:$id,input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              if (!args.updates || Object.keys(args.updates).length === 0) throw new Error('update_project kräver updates');
              const data = await graphQLRequest(query, { id: requireId(args.id), input: e2eNoteInput({ ...args.updates }) });
              applyNoteMutationLocally((data as any)?.updateNote);
              return data;
          }
          case 'delete_project': {
              const { ensureReadableNote } = getAISecurityContext();
              ensureReadableNote(requireId(args.id));
              const query = `mutation($id:String!){deleteNote(id:$id)}`;
              const data = await graphQLRequest(query, { id: requireId(args.id) });
              useStore.getState().ingestServerNoteDeletion(requireId(args.id));
              return data;
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
              const state = useStore.getState();
              const inputBase = (!args.parentId && state.activeProjectId) ? { ...args, parentId: state.activeProjectId } : args;
              const query = `mutation($input:NoteInput!){createNote(input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              return graphQLRequest(query, { input: { ...inputBase, type: 'task_list' } });
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
              // Pull the agent-only fields out so they don't leak into TaskInput.
              const { delegateToAi, aiInstructions, ...taskArgs } = args as Record<string, any>;
              if (taskArgs.parentNoteId) {
                  const { ensureReadableNote } = getAISecurityContext();
                  ensureReadableNote(String(taskArgs.parentNoteId));
              }
              // Self-delegation: hand the task to the AI agent using the CURRENT chat
              // model/source/level so it runs later with "what I'm using right now".
              let delegation: AiTaskDelegation | null = null;
              if (delegateToAi) {
                  delegation = applyDelegationDefaults(currentChatDelegationDefaults());
                  if (typeof aiInstructions === 'string' && aiInstructions.trim()) delegation.instructions = aiInstructions.trim();
                  (taskArgs as any).aiAgent = serializeAiDelegation(delegation);
              }
              const query = `mutation($input:TaskInput!){createTask(input:$input){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes aiAgent createdAt updatedAt}}`;
              const res = await graphQLRequest(query, { input: e2eTaskInput(withDefaultReminderForDueDate(withNormalizedDueDate(withDefaultPriority(taskArgs)))) });
              if ((res as any)?.createTask) { try { useStore.getState().ingestServerTask((res as any).createTask); } catch { /* non-fatal */ } }
              const newId = (res as any)?.createTask?._id;
              if (delegation && newId) {
                  try { await setLocalDelegation(String(newId), delegation); } catch { /* best-effort */ }
                  if (delegation.runOnBackend) { try { await syncDelegationToBackend(String(newId), delegation); } catch { /* best-effort */ } }
              }
              return res;
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
              const data = await graphQLRequest(query, { id: requireId(args.id), input: e2eTaskInput(withNormalizedDueDate(args.updates || {})) });
              if ((data as any)?.updateTask) { try { useStore.getState().ingestServerTask((data as any).updateTask); } catch { /* non-fatal */ } }
              return data;
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
              const data = await graphQLRequest(query, { id: requireId(args.id) });
              useStore.getState().ingestServerTaskDeletion(requireId(args.id));
              return data;
          }
          case 'mcp_list_tools': {
              const service = String(args.service || '').trim();
              if (!service) throw new Error('mcp_list_tools kräver service');
              return mcpRequest('/mcp/tools', { service });
          }
          case 'mcp_call_tool': {
              const service = String(args.service || '').trim();
              const toolName = String(args.toolName || '').trim();
              const toolArgs = args.args && typeof args.args === 'object' && !Array.isArray(args.args) ? args.args : {};
              if (!service || !toolName) throw new Error('mcp_call_tool kräver service och toolName');
              return mcpRequest('/mcp/call', {
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

  const processToolCalls = async (conversationId: string, assistantId: string, assistantText: string, intentText: string) => {
      const policy = contextLevelConfig(chatContextLevel);
      if (!enableToolUse || !policy.allowReadTools) return [];
      const { calls: rawCalls, cleaned } = safeExtractToolCalls(assistantText);
      // Gate by context level: write/mutation tools only when the level permits.
      const WRITE_TOOLS = new Set(['create_note', 'update_note', 'delete_note', 'create_project', 'update_project', 'delete_project', 'create_tasklist', 'update_tasklist', 'delete_tasklist', 'create_task', 'update_task', 'delete_task']);
      const calls = policy.allowWriteTools ? rawCalls : rawCalls.filter((c) => !WRITE_TOOLS.has(c.tool));
      const newMessages: ChatMessage[] = [];
      if (cleaned !== assistantText) {
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: cleaned } : m));
          const cleanedMsg = { id: assistantId, role: 'assistant', content: cleaned, createdAt: new Date().toISOString() } as ChatMessage;
          await saveMessageLocal(conversationId, cleanedMsg);
          if (!isConversationLocalOnly(conversationId)) {
              pushAiSync({ messages: [{ conversationId, message: cleanedMsg }] }).catch(() => {});
          }
      }
      if (calls.length === 0) return [];
      const seen = new Set<string>();
      for (const call of calls) {
          const key = `${call.tool}:${JSON.stringify(call.arguments || {})}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const toolMsg: ChatMessage = { id: uuidv4(), role: 'tool', content: `Tool call: ${call.tool} ${safePreview({ args: call.arguments || {} })}`, createdAt: new Date().toISOString() };
          setMessages(prev => [...prev, toolMsg]);
          await saveMessageLocal(conversationId, toolMsg);
          if (!isConversationLocalOnly(conversationId)) {
              pushAiSync({ messages: [{ conversationId, message: toolMsg }] }).catch(() => {});
          }
          newMessages.push(toolMsg);
          if (toolMsg.id) setCollapsedTool(prev => ({ ...prev, [toolMsg.id as string]: true }));
          try {
              const result = await executeToolCall(call.tool, call.arguments || {}, intentText);
              if (['create_note', 'update_note', 'delete_note', 'create_project', 'update_project', 'delete_project'].includes(call.tool)) {
                  // Optimistically merge the just-created/updated note so it shows INSTANTLY
                  // (tasks already appeared live; notes lagged because they only refreshed via
                  // a slow server refetch / a socket event the GraphQL create may not emit).
                  try {
                      const created = (result as any)?.createNote ?? (result as any)?.updateNote;
                      if (created && created._id) useStore.getState().ingestServerNote(created);
                  } catch {}
                  try {
                      await useStore.getState().fetchNotes();
                  } catch {}
              }
              if (['create_task', 'update_task', 'delete_task', 'create_tasklist', 'update_tasklist', 'delete_tasklist'].includes(call.tool)) {
                  try {
                      await useStore.getState().fetchTasks();
                  } catch {}
              }
              // Write results now come back END-TO-END ENCRYPTED (the backend can't read the
              // user-key fields), so the raw result is ciphertext. For the chat trace + the AI's
              // next turn, show the AI's own plaintext args + the new id instead of the blob.
              const createdId = (result as any)?.createNote?._id ?? (result as any)?.updateNote?._id
                  ?? (result as any)?.createTask?._id ?? (result as any)?.updateTask?._id;
              const traceResult = WRITE_TOOLS.has(call.tool)
                  ? { _id: createdId, ...(call.arguments || {}) }
                  : result;
              const entitiesRead = buildToolReadTrace(call.tool, traceResult);
              const resultMsg: ChatMessage = { id: uuidv4(), role: 'tool', content: `Tool result: ${call.tool} ${safePreview({ entitiesRead, result: traceResult })}`, createdAt: new Date().toISOString() };
              setMessages(prev => [...prev, resultMsg]);
              await saveMessageLocal(conversationId, resultMsg);
              if (!isConversationLocalOnly(conversationId)) {
                  pushAiSync({ messages: [{ conversationId, message: resultMsg }] }).catch(() => {});
              }
              newMessages.push(resultMsg);
              if (resultMsg.id) setCollapsedTool(prev => ({ ...prev, [resultMsg.id as string]: true }));
          } catch (e: any) {
              const errorText = e?.message || 'Unknown error';
              const errMsg: ChatMessage = { id: uuidv4(), role: 'tool', content: `Tool error: ${call.tool} ${errorText}`, createdAt: new Date().toISOString() };
              setMessages(prev => [...prev, errMsg]);
              await saveMessageLocal(conversationId, errMsg);
              if (!isConversationLocalOnly(conversationId)) {
                  pushAiSync({ messages: [{ conversationId, message: errMsg }] }).catch(() => {});
              }
              newMessages.push(errMsg);
              if (errMsg.id) setCollapsedTool(prev => ({ ...prev, [errMsg.id as string]: true }));
              if (String(errorText).toLowerCase().includes('sessionen har gått ut')) {
                  break;
              }
          }
      }
      return newMessages;
  };

  const runAIGeneration = async (conversationId: string, initialHistory: ChatMessage[], images: string[] = []) => {
      let currentHistory = [...initialHistory];
      const intentText = [...initialHistory].reverse().find((msg) => msg.role === 'user')?.content || '';
      let iterations = 0;
      const maxIterations = 5;
      const executedCallKeys = new Set<string>();
      const iterationSignatures = new Set<string>();

      while (iterations < maxIterations && !stopRequestedRef.current) {
          iterations += 1;
          const assistantId = uuidv4();
          const assistantMsg: ChatMessage = {
              id: assistantId,
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString()
          };
          setMessages(prev => [...prev, assistantMsg]);

          let streamed = false;
          let fullContent = '';
          let tokenCount = 0;
          const startTime = Date.now();
          let lastUpdate = startTime;

          const updateTps = () => {
              const elapsed = (Date.now() - startTime) / 1000;
              if (elapsed <= 0) return;
              setTokensPerSecond(tokenCount / elapsed);
          };

          let generationError: any = null;
          if (aiUseApiProviders) {
              try {
                  // Real SSE streaming: append each delta as it arrives. A fresh
                  // AbortController lets the existing Stop button cancel the stream.
                  const controller = new AbortController();
                  const apiResult = await streamApiProviderResponse({
                      provider: sendProviderId,
                      apiKey: activeApiKey,
                      model: activeApiModel,
                      history: currentHistory,
                      baseUrl: activeBaseUrl,
                      // Images attach only to the first turn (the user's message).
                      images: iterations === 1 ? images : [],
                      signal: controller.signal,
                      onToken: (delta) => {
                          if (stopRequestedRef.current) { try { controller.abort(); } catch {} return; }
                          fullContent += delta;
                          tokenCount += 1;
                          if (Date.now() - lastUpdate > 100) {
                              updateTps();
                              lastUpdate = Date.now();
                          }
                          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
                      },
                  });
                  // Reconcile with the final text (covers the non-streaming fallback path).
                  if (apiResult.text && apiResult.text.length >= fullContent.length) {
                      fullContent = apiResult.text;
                  }
                  tokenCount = Math.max(tokenCount, 1);
                  updateTps();
                  setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
                  // Record usage for the limits/förbrukning display (best-effort).
                  void recordUsage(apiProvider, activeApiModel, apiResult.totalTokens).then(refreshUsage);
              } catch (apiError: any) {
                  generationError = apiError;
              }
          } else {
              try {
                  await provider.streamResponse(
                      currentHistory,
                      { streamDelayMs: 10, shouldStop: () => stopRequestedRef.current },
                      (token) => {
                          if (stopRequestedRef.current) return;
                          streamed = true;
                          fullContent += token;
                          tokenCount += 1;
                          if (Date.now() - lastUpdate > 300) {
                              updateTps();
                              lastUpdate = Date.now();
                          }
                          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
                      }
                  );
              } catch (streamError: any) {
                  generationError = streamError;
              }

              if (!streamed && !stopRequestedRef.current) {
                  const tryGenerate = async () => {
                      const response = await provider.generateResponse(currentHistory);
                      fullContent = response;
                      tokenCount = Math.max(tokenCount, 1);
                      updateTps();
                      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
                  };
                  try {
                      await tryGenerate();
                  } catch (firstError: any) {
                      generationError = firstError;
                      try {
                          await new Promise(resolve => setTimeout(resolve, 300));
                          await tryGenerate();
                          generationError = null;
                      } catch (secondError: any) {
                          generationError = secondError;
                      }
                  }
              }
          }

          if (!fullContent && generationError && !stopRequestedRef.current) {
              fullContent = `${t('ai.errorPrefix')}${generationError?.message || 'Unknown error'}`;
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
          }

          const extractedBeforeTools = safeExtractToolCalls(fullContent);
          if (!enableToolUse && extractedBeforeTools.cleaned !== fullContent) {
              fullContent = extractedBeforeTools.cleaned;
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
          }

          updateTps();
          const savedMsg: ChatMessage = { ...assistantMsg, content: (fullContent || '').toString() };
          await saveMessageLocal(conversationId, savedMsg);
          if (!isConversationLocalOnly(conversationId)) {
              pushAiSync({ messages: [{ conversationId, message: savedMsg }] }).catch(() => {});
          }

          const newToolMessages = await processToolCalls(conversationId, assistantId, fullContent, intentText);
          if (newToolMessages.length === 0) break;
          const extracted = safeExtractToolCalls(fullContent);
          const { calls } = extracted;
          const callKeys = toToolCallKeys(calls);
          const signature = toToolIterationSignature(extracted.cleaned || '', fullContent, callKeys);
          if (shouldStopToolIteration(signature, callKeys, iterationSignatures, executedCallKeys)) break;
          if (calls.some(c => /^(create|update|delete)_/.test(c.tool))) break;

          const cleaned = extracted.cleaned || fullContent;
          currentHistory = [...currentHistory, { ...assistantMsg, content: cleaned }, ...newToolMessages];
      }
  };

  const buildHistory = (userMsg: ChatMessage) => {
      const maxChars = 12000;
      const projectPrompt = getActiveProject()?.systemPrompt || '';
      const toolContext = (() => {
        const state = useStore.getState() as any;
        const allNotes = Array.isArray(state.notes) ? state.notes : [];
        const pick = (type: string) => allNotes
          .filter((n: any) => n?.type === type)
          .map((n: any) => ({ id: String(n._id), title: String(n.title || '') }));
        return { projects: pick('project'), taskLists: pick('task_list') };
      })();
      const policy = contextLevelConfig(chatContextLevel);
      const effectiveToolUse = enableToolUse && policy.allowReadTools;
      const toolPrompt = effectiveToolUse ? buildToolSystemPrompt(API_URL.replace(/\/+$/, ''), getEnabledMcpServices(), toolContext) : '';
      const toolUseNotice = buildToolUseNotice(effectiveToolUse);
      const levelNotice = `Kontextnivå: ${policy.label} — ${policy.description} Tillåtet: ${summarizeToolPolicy(chatContextLevel, enableToolUse).join(', ')}.${policy.allowWriteTools ? '' : ' (Endast läs-/sökverktyg på denna nivå.)'}`;
      const delegationNotice = effectiveToolUse
        ? 'Självdelegering: om användaren uttryckligen ber dig schemalägga/ta dig an en uppgift själv (som AI-agent), anropa create_task med delegateToAi=true (sätt dueDate som deadline, aiInstructions för extra styrning). Då körs uppgiften senare av AI-agenten med nuvarande modell/källa. Vanlig uppgift till användaren: create_task utan delegateToAi.'
        : '';
      const combinedPrompt = combineSystemPrompts([systemPrompt, levelNotice, toolUseNotice, delegationNotice, toolPrompt].filter(Boolean).join('\n\n'), projectPrompt);
      const systemMsg = combinedPrompt
        ? ({ id: 'system', role: 'system', content: combinedPrompt, createdAt: new Date().toISOString() } as ChatMessage)
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
          total = (systemMsg ? systemMsg.content.length : 0) + userMsg.content.length;
      }

      setContextInfo(`${total} tecken`);
      return systemMsg ? [systemMsg, ...trimmed] : trimmed;
  };

  const formatSearchSize = (size?: number | null) => {
      if (size === undefined || size === null) return 'Size: ...';
      if (typeof size === 'number') {
          const gb = size / 1024 / 1024 / 1024;
          if (gb >= 1) return `Size: ${gb.toFixed(2)} GB`;
          const mb = size / 1024 / 1024;
          return `Size: ${mb.toFixed(1)} MB`;
      }
      return 'Size: ?';
  };

  // Compact count (12 345 → "12.3k", 2 100 000 → "2.1M") for downloads/likes.
  const formatCount = (n?: number): string => {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '–';
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
      return String(n);
  };
  // Release/updated date → locale short date, or '–'.
  const formatModelDate = (iso?: string): string => {
      if (!iso) return '–';
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? '–' : d.toLocaleDateString();
  };

  const createNewChat = async () => {
      const newId = uuidv4();
      const newConv: LocalConversation = {
          id: newId,
          title: 'Ny chatt',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
          model: activeModelLabel || undefined,
          projectId: activeProjectId || undefined,
          localOnly: nextThreadLocalOnly,
      };
      await saveConversationLocal(newConv);
      if (!newConv.localOnly) {
          pushAiSync({ conversations: [newConv] }).catch(() => {});
      }
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversationId(newId);
      setMessages([]);
  };

  const loadChat = async (id: string) => {
      // Always switch to the tapped thread and leave settings, even if the message read
      // below fails — otherwise the screen looks blank/stuck on the previous view.
      setCurrentConversationId(id);
      setSettingsVisible(false);
      let msgs: ChatMessage[] = [];
      try {
        msgs = await getMessagesLocal(id);
      } catch (e) {
        console.error('[ai] getMessagesLocal failed', e);
        msgs = [];
      }
      setMessages(msgs);
      const conv = conversations.find(c => c.id === id);
      if (conv?.projectId) {
        setActiveProjectId(conv.projectId || null);
      } else {
        setActiveProjectId(null);
      }
      // Self-heal: re-pull from the server when the local copy looks unusable — either
      // empty, blank, or still-ciphertext (a row corrupted by an earlier key-not-ready
      // merge on a prior build). The key is available now, so the corruption-guarded
      // merge replaces the bad rows with real decrypted content. Skip local-only threads.
      const looksUnusable = msgs.length === 0
          || msgs.some(m => !m.content || !String(m.content).trim() || isAnyCiphertext(m.content));
      if (looksUnusable && !isConversationLocalOnly(id)) {
        try {
          const remote = await pullAiSync({ force: true });
          await mergeRemoteSync(remote, userScopeKey || undefined);
          msgs = await getMessagesLocal(id);
          setMessages(msgs);
        } catch { /* offline / no key — keep what we have */ }
      }
  };

  const deleteChat = async (id: string) => {
      await deleteConversationLocal(id);
      pushAiSync({ deletedConversationIds: [id] }).catch(() => {});
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
          setCurrentConversationId(null);
          setMessages([]);
      }
      if (chatDialogId === id) {
          setChatDialogVisible(false);
          setChatDialogId(null);
          setChatDialogName('');
          setChatDialogIcon(undefined);
          setChatDialogIconColor(undefined);
          setChatDialogLocalOnly(false);
          setChatIconPickerVisible(false);
      }
  };

  const openProjectDialog = (project: LocalAIProject) => {
      setProjectDialogMode('edit');
      setProjectDialogId(project.id);
      setProjectDialogName(project.name);
      setProjectDialogPrompt(project.systemPrompt || '');
      setProjectDialogIcon(project.icon);
      setProjectDialogIconColor(project.iconColor);
      setProjectDialogLocalOnly(Boolean(project.localOnly));
      setProjectDialogVisible(true);
  };

  const openNewProjectDialog = () => {
      setProjectDialogMode('create');
      setProjectDialogId(null);
      setProjectDialogName('');
      setProjectDialogPrompt('');
      setProjectDialogIcon(undefined);
      setProjectDialogIconColor(undefined);
      setProjectDialogLocalOnly(false);
      setProjectDialogVisible(true);
  };

  const openChatDialog = (chat: LocalConversation) => {
      setChatDialogId(chat.id);
      setChatDialogName(chat.title);
      setChatDialogIcon(chat.icon);
      setChatDialogIconColor(chat.iconColor);
      setChatDialogLocalOnly(Boolean(chat.localOnly));
      setChatDialogVisible(true);
  };

  const handleSaveProjectDialog = async (nameInput: string, promptInput: string, localOnly: boolean) => {
      const name = nameInput.trim();
      if (!name) return;
      if (projectDialogMode === 'create') {
          const project: LocalAIProject = {
              id: uuidv4(),
              name,
              systemPrompt: promptInput,
              icon: projectDialogIcon,
              iconColor: projectDialogIconColor,
              localOnly,
              createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userId: userScopeKey
          };
      await saveProjectLocal(project, userScopeKey);
      if (!project.localOnly) {
          pushAiSync({ projects: [project] }).catch(() => {});
      }
          setProjects(prev => [project, ...prev]);
          setActiveProjectId(project.id);
          setProjectDialogVisible(false);
          return;
      }
      if (!projectDialogId) return;
      const proj = projects.find(p => p.id === projectDialogId);
      if (!proj) return;
      const updated: LocalAIProject = {
          ...proj,
          name,
          systemPrompt: promptInput,
          icon: projectDialogIcon,
          iconColor: projectDialogIconColor,
          localOnly,
          updatedAt: new Date().toISOString(),
          userId: userScopeKey
      };
      await saveProjectLocal(updated, userScopeKey);
      if (updated.localOnly) pushAiSync({ deletedProjectIds: [updated.id] }).catch(() => {});
      else pushAiSync({ projects: [updated] }).catch(() => {});
      setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
      setProjectDialogVisible(false);
  };

  const handleSaveChatDialog = async (nameInput: string, localOnly: boolean) => {
      if (!chatDialogId) return;
      const conv = conversations.find(c => c.id === chatDialogId);
      if (!conv) return;
      const trimmed = nameInput.trim();
      const updated: LocalConversation = {
          ...conv,
          title: trimmed || conv.title,
          icon: chatDialogIcon,
          iconColor: chatDialogIconColor,
          localOnly,
          updatedAt: new Date().toISOString()
      };
      await saveConversationLocal(updated);
      if (updated.localOnly) {
          pushAiSync({ deletedConversationIds: [updated.id] }).catch(() => {});
      } else {
          pushAiSync({ conversations: [updated] }).catch(() => {});
      }
      setConversations(prev => prev.map(c => c.id === updated.id ? updated : c));
      setChatDialogVisible(false);
  };

  const confirmDeleteProject = async () => {
      if (!confirmProjectDeleteId) return;
      await handleDeleteProject(confirmProjectDeleteId);
      setConfirmProjectDeleteId(null);
  };

  const confirmDeleteChat = async () => {
      if (!confirmChatDeleteId) return;
      await deleteChat(confirmChatDeleteId);
      setConfirmChatDeleteId(null);
      setChatDialogVisible(false);
  };

  const handleSelectProject = (projectId: string | null) => {
      projectSelInitRef.current = true;
      setActiveProjectId(projectId);
      // Remember the choice locally (encrypted) so it survives chat ↔ list navigation + restarts.
      AsyncStorage.setItem(`ai_active_project_${userScopeKey}`, encrypt(projectId ?? ALL_PROJECTS_SENTINEL)).catch(() => {});
  };

  const handleDeleteProject = async (projectId: string) => {
      await deleteProjectLocal(projectId);
      pushAiSync({ deletedProjectIds: [projectId] }).catch(() => {});
      setProjects(prev => prev.filter(p => p.id !== projectId));
      if (activeProjectId === projectId) {
          setActiveProjectId(null);
      }
  };

  const handleSearch = async () => {
      if (!searchQuery) return;
      setIsSearching(true);
      setLoading(true);
      setSearchResults([]); // Clear previous results
      setSearchSizes({});
      try {
          console.log('Searching for:', searchQuery);
          // Use the mobile-specific HF service to search
          const results = await searchHuggingFaceModels(searchQuery);
          console.log('Search results:', results.length);
          if (results.length === 0) {
              alert('No models found matching your query.');
          }
          setSearchResults(results);
          results.forEach(async (model) => {
              try {
                  const files = await getModelFiles(model.id);
                  const best = getBestQuantization(files);
                  setSearchSizes(prev => ({ ...prev, [model.id]: best?.size ?? null }));
              } catch {
                  setSearchSizes(prev => ({ ...prev, [model.id]: null }));
              }
          });
      } catch (e) {
          console.error('Search failed:', e);
          alert('Search failed: ' + String(e));
      } finally {
          setIsSearching(false);
          setLoading(false);
      }
  };

  const downloadModel = async (model: HFModel, pickedFile?: HFFile) => {
      try {
        if (!isNativeFileSystemAvailable()) {
            alert('AI-modeller kräver en dev build (inte Expo Go). Bygg appen med EAS och installera den innan nedladdning.');
            return;
        }
        setProcessingModels(prev => ({ ...prev, [model.id]: true }));
        setDownloadProgress(prev => ({ ...prev, [model.id]: 0 }));
        setDownloadStage(prev => ({ ...prev, [model.id]: 'queued' }));

        // Use the explicitly-picked quant if the user chose one; otherwise recommend the
        // best-fitting variant for THIS device's RAM (falls back to quant-priority when
        // RAM is unknown). Reuse already-fetched files for the row to avoid a refetch.
        const files = pickedFile ? [pickedFile] : (modelFiles[model.id] || await getModelFiles(model.id));
        const file = pickedFile || recommendFileForDevice(files);

        if (!file) {
            alert('No suitable GGUF file found for this model');
            setProcessingModels(prev => {
                const newP = { ...prev };
                delete newP[model.id];
                return newP;
            });
            setDownloadProgress(prev => {
                const newP = { ...prev };
                delete newP[model.id];
                return newP;
            });
            return;
        }

        await serviceDownloadModel(model, file, (percent) => {
            setDownloadProgress(prev => ({ ...prev, [model.id]: percent }));
        }, {
            onStageChange: (stage) => setDownloadStage(prev => ({ ...prev, [model.id]: stage }))
        });

        await loadModels();
        
        setProcessingModels(prev => {
            const newP = { ...prev };
            delete newP[model.id];
            return newP;
        });
        setDownloadProgress(prev => {
            const newP = { ...prev };
            delete newP[model.id];
            return newP;
        });
        setDownloadStage(prev => {
            const newS = { ...prev };
            delete newS[model.id];
            return newS;
        });
      } catch (e) {
          console.error(e);
          alert('Download failed: ' + formatError(e));
          setDownloadProgress(prev => {
              const newP = { ...prev };
              delete newP[model.id];
              return newP;
          });
          setProcessingModels(prev => {
              const newP = { ...prev };
              delete newP[model.id];
              return newP;
          });
          setDownloadStage(prev => {
              const newS = { ...prev };
              delete newS[model.id];
              return newS;
          });
      }
  };

  const handleCancelDownload = async (modelId: string) => {
      try {
          await cancelModelDownload(modelId);
      } catch (e) {
          console.error(e);
      } finally {
          setProcessingModels(prev => {
              const newP = { ...prev };
              delete newP[modelId];
              return newP;
          });
          setDownloadProgress(prev => {
              const newP = { ...prev };
              delete newP[modelId];
              return newP;
          });
      }
  };

  const handleDeleteModel = async (id: string, path: string) => {
      if (activeModel === path) {
          alert('Cannot delete active model');
          return;
      }
      try {
          await serviceDeleteModel(id, path);
          await loadModels();
      } catch (e) {
          alert('Delete failed: ' + String(e));
      }
  };

  const handleSend = async () => {
    const hasAttachments = attachmentsEnabled && attachments.length > 0;
    if ((!input.trim() && !hasAttachments) || loading) return;

    // Whole-handler guard: an error thrown in an async event handler is NOT caught by the
    // React error boundary — it becomes an unhandled rejection that can crash the release
    // app. Wrap everything (incl. pre-flight validation) so the chat can never crash; on any
    // failure we just show a system message and reset loading.
    try {
    if (!aiUseApiProviders && !activeModel) {
        alert('Please select a model first');
        setSettingsTab('models');
        setSettingsVisible(true);
        return;
    }
    if (aiUseApiProviders) {
        const meta = activeProviderMeta;
        if (!meta) {
            alert('AI-leverantörens konfiguration kunde inte läsas. Välj leverantör och modell i inställningarna.');
            setSettingsVisible(true);
            return;
        }
        if (meta.configurableEndpoint && !activeBaseUrl?.trim()) {
            alert(`Ange bas-URL till din ${meta.label} först`);
            setSettingsVisible(true);
            return;
        }
        if (!meta.apiKeyOptional && !activeApiKey) {
            alert(`Ange ${meta.label} API-nyckel och modell först`);
            setSettingsVisible(true);
            return;
        }
        if (!activeApiModel) {
            alert(`Ange ${meta.label} modell först`);
            setSettingsVisible(true);
            return;
        }
    }

    let conversationId = currentConversationId;
    if (!conversationId) {
        const newId = uuidv4();
        const titleSeed = input.trim() || (attachmentsEnabled && attachments[0]?.name) || 'Ny chatt';
        const newConv: LocalConversation = {
            id: newId,
            title: titleSeed.substring(0, 30) + (titleSeed.length > 30 ? '...' : ''),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
            model: activeModelLabel,
            projectId: activeProjectId || undefined,
            localOnly: nextThreadLocalOnly,
        };
        await saveConversationLocal(newConv);
        if (!newConv.localOnly) {
            pushAiSync({ conversations: [newConv] }).catch(() => {});
        }
        setConversations(prev => [newConv, ...prev]);
        setCurrentConversationId(newId);
        conversationId = newId;
    }
    if (!conversationId) return;
    
    // Attachments: the displayed/saved message stays clean (text + a short 📎 note
    // of file names); the MODEL receives the full extracted file context prepended.
    const sentAttachments = attachmentsEnabled ? attachments : [];
    const attachmentNote = sentAttachments.length
        ? `\n\n📎 ${summarizeAttachmentsForUi(sentAttachments).join(', ')}`
        : '';
    const userMsg: ChatMessage = {
        id: uuidv4(),
        role: 'user',
        content: input + attachmentNote,
        createdAt: new Date().toISOString()
    };
    // Separate copy for the model with the file context block prepended (not stored).
    const modelUserMsg: ChatMessage = sentAttachments.length
        ? { ...userMsg, content: buildAttachmentContextBlock(sentAttachments) + input }
        : userMsg;

    // Auto-name the thread from the FIRST user message (e.g. a chat started via the +
    // button is "Ny chatt" until now). Skip if the user already renamed it. Renaming
    // later is still available via the chat's edit dialog.
    try {
      const isFirstUserMsg = !messages.some((m) => m.role === 'user');
      const conv = conversations.find((c) => c.id === conversationId);
      const DEFAULT_TITLES = ['', 'new chat', 'ny chatt', 'untitled'];
      if (conv && isFirstUserMsg && DEFAULT_TITLES.includes((conv.title || '').trim().toLowerCase())) {
        const seed = (input.trim() || sentAttachments[0]?.name || 'Ny chatt');
        const newTitle = seed.substring(0, 40) + (seed.length > 40 ? '…' : '');
        const updated: LocalConversation = { ...conv, title: newTitle, updatedAt: new Date().toISOString() };
        await saveConversationLocal(updated);
        setConversations((prev) => prev.map((c) => (c.id === conversationId ? updated : c)));
        if (!updated.localOnly) pushAiSync({ conversations: [updated] }).catch(() => {});
      }
    } catch {}

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachments([]);
    setLoading(true);
    setTokensPerSecond(null);
    stopRequestedRef.current = false;

    try {
      await saveMessageLocal(conversationId, userMsg);
      if (!isConversationLocalOnly(conversationId)) {
          pushAiSync({ messages: [{ conversationId, message: userMsg }] }).catch(() => {});
      }
      if (!aiUseApiProviders) {
          // Surface model-load progress in the chat so the wait before the first token is
          // visible (loading a multi-GB GGUF is the bulk of the "long delay"). Skip the
          // progress UI entirely if the model is already resident.
          if (!provider.isLoaded(activeModel as string)) {
              setModelLoadProgress(0);
              try {
                  await provider.loadModel(activeModel as string, (p) => setModelLoadProgress(Math.max(0, Math.min(1, p))));
              } finally {
                  setModelLoadProgress(null);
              }
          }
      }
      // Image attachments → vision models (API path); only forwarded on this turn.
      const sentImages = aiUseApiProviders ? imageDataUrls(sentAttachments) : [];
      // Semantic retrieval (RAG): inject relevant, LOCK-SAFE notes/tasks as context when
      // enabled in settings. Two-stage (recall → optional GraphRAG → rerank). Best-effort.
      let history = buildHistory(modelUserMsg);
      if (retrievalSettings.enableSemantic) {
        try {
          const st: any = useStore.getState();
          const block = await retrieveForChat(
            input,
            (st.notes || []) as any,
            (st.tasks || []) as any,
            new Set<string>(Array.isArray(st.unlockedProtectedNoteIds) ? st.unlockedProtectedNoteIds : []),
            { enableSemantic: true, enableGraphRAG: retrievalSettings.enableGraphRAG, enableRerank: retrievalSettings.enableRerank, limit: 6, contextLevel: chatContextLevel, sourceMinLevels: await getSourceMinLevels() },
          );
          if (block) history = [{ id: uuidv4(), role: 'system', content: block, createdAt: new Date().toISOString() } as any, ...history];
        } catch { /* non-fatal — chat continues without retrieval context */ }
      }
      await runAIGeneration(conversationId, history, sentImages);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: `${t('ai.errorPrefix')}${formatError(error)}`, createdAt: new Date().toISOString() }]);
    } finally {
      setLoading(false);
      setTokensPerSecond(null);
    }
    } catch (outer) {
      // Pre-flight / setup failure (before the inner generation try). Never let it escape.
      console.error('[ai] handleSend failed:', outer);
      try {
        setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: `${t('ai.errorPrefix')}${formatError(outer)}`, createdAt: new Date().toISOString() }]);
      } catch { /* ignore */ }
      try { setLoading(false); } catch { /* ignore */ }
    }
  };

  const handleAttach = async () => {
    try {
      const picked = await pickAttachments();
      if (picked.length) {
        setAttachments(prev => [...prev, ...picked].slice(0, MAX_ATTACHMENTS));
      }
    } catch (e) {
      alert('Kunde inte bifoga fil: ' + String(e));
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleCopyMessage = async (content: string) => {
    if (!content) return;
    await Clipboard.setStringAsync(content);
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    setLoading(false);
    setTokensPerSecond(null);
    setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: t('ai.responseStopped'), createdAt: new Date().toISOString() }]);
  };

  const visibleConversations = activeProjectId
    ? conversations.filter(c => c.projectId === activeProjectId)
    : conversations;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {sidebarVisible && (
        <View style={styles.sidebarOverlay}>
          <View style={[styles.sidebar, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>
              {t('ai.projectsTitle')}
            </Text>
            <View style={{ flexDirection: 'row', marginBottom: 12 }}>
              <Button mode="contained" onPress={openNewProjectDialog}>
                {t('ai.project.createTitle')}
              </Button>
            </View>
            <ScrollView style={{ flex: 1 }}>
              <List.Item
                title={t('common.all')}
                onPress={() => handleSelectProject(null)}
                rippleColor={ROW_RIPPLE}
                style={!activeProjectId ? { backgroundColor: theme.colors.secondaryContainer, borderRadius: 8 } : undefined}
                left={() => <List.Icon icon="folder" />}
                right={() => activeProjectId ? null : <List.Icon icon="check" />}
              />
              {projects.map((project) => (
                <List.Item
                  key={project.id}
                  title={project.name}
                  onPress={() => handleSelectProject(project.id)}
                  onLongPress={() => openProjectDialog(project)}
                  rippleColor={ROW_RIPPLE}
                  style={activeProjectId === project.id ? { backgroundColor: theme.colors.secondaryContainer, borderRadius: 8 } : undefined}
                  left={() => (
                    project.icon ? (
                      <View style={{ justifyContent: 'center', marginLeft: 6 }}>
                        <FontAwesome5 name={project.icon.replace(/^Fa/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()} size={18} color={project.iconColor || theme.colors.onSurface} />
                      </View>
                    ) : (
                      <List.Icon icon="folder-outline" />
                    )
                  )}
                  right={() => (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {activeProjectId === project.id && <List.Icon icon="check" />}
                    </View>
                  )}
                />
              ))}
              <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface }}>
                {t('ai.chatsTitle')}
              </Text>
              {visibleConversations.length === 0 ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>{t('ai.noChats')}</Text>
              ) : (
                visibleConversations.map((conv) => (
                  <List.Item
                    key={conv.id}
                    title={conv.title || t('ai.newChatFallback')}
                    rippleColor={ROW_RIPPLE}
                    style={currentConversationId === conv.id ? { backgroundColor: theme.colors.secondaryContainer, borderRadius: 8 } : undefined}
                    onPress={() => {
                      loadChat(conv.id);
                      setSidebarVisible(false);
                    }}
                    onLongPress={() => openChatDialog(conv)}
                    left={() => (
                      conv.icon ? (
                        <View style={{ justifyContent: 'center', marginLeft: 6 }}>
                          <FontAwesome5 name={conv.icon.replace(/^Fa/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()} size={18} color={conv.iconColor || theme.colors.onSurface} />
                        </View>
                      ) : (
                        <List.Icon icon="message-text-outline" />
                      )
                    )}
                    right={() => null}
                  />
                ))
              )}
            </ScrollView>
          </View>
          <Pressable style={styles.sidebarBackdrop} onPress={() => setSidebarVisible(false)} />
        </View>
      )}
      <Portal>
        {/* Thread info (moved from the chat's bottom edge): context usage + stats. */}
        <Dialog visible={infoVisible} onDismiss={() => setInfoVisible(false)}>
          <Dialog.Title>{t('ai.threadInfo', 'Information om tråden')}</Dialog.Title>
          <Dialog.Content>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>Kontextnivå</Text>
              <Text style={{ color: theme.colors.onSurface }}>{contextLevelConfig(chatContextLevel).label}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>Kontext (skickat)</Text>
              <Text style={{ color: theme.colors.onSurface }}>{contextInfo || '—'}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>Verktyg</Text>
              <Text style={{ color: theme.colors.onSurface }}>{enableToolUse ? 'På' : 'Av'}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>Modell</Text>
              <Text style={{ color: theme.colors.onSurface, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>{activeModelLabel || '—'}</Text>
            </View>
            {/* Storage/sync status lives here (in the ℹ️ info dialog) instead of as a
                permanent banner above the composer. */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>Lagring</Text>
              <Text style={{ color: theme.colors.onSurface, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
                {nextThreadLocalOnly ? '🔒 Endast lokalt (synkas inte)' : 'Synkas krypterat (E2E)'}
              </Text>
            </View>
            {tokensPerSecond !== null ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>Hastighet</Text>
                <Text style={{ color: theme.colors.onSurface }}>{tokensPerSecond.toFixed(1)} tok/s</Text>
              </View>
            ) : null}
            <Text style={{ marginTop: 8, fontSize: 11, color: theme.colors.onSurfaceVariant }}>
              Ändra kontextnivå och verktyg under Inställningar → AI-instruktioner.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setInfoVisible(false)}>{t('common.close')}</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Add a custom OpenAI-compatible provider (e.g. another Hermes/Ollama agent). */}
        <Dialog visible={addProviderDialogVisible} onDismiss={() => setAddProviderDialogVisible(false)}>
          <Dialog.Title>Egen API-provider</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodySmall" style={{ marginBottom: 10, color: theme.colors.onSurfaceVariant }}>
              OpenAI-kompatibel server (Ollama/Hermes/LM Studio/egen proxy). Lagras krypterat lokalt.
            </Text>
            <PaperTextInput mode="outlined" label="Namn (t.ex. Hermes Pi)" value={newProvider.label} onChangeText={(v) => setNewProvider((p) => ({ ...p, label: v }))} style={{ marginBottom: 8 }} />
            <PaperTextInput mode="outlined" label="Bas-URL" placeholder="http://100.64.0.2:11434" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={newProvider.baseUrl} onChangeText={(v) => setNewProvider((p) => ({ ...p, baseUrl: v }))} style={{ marginBottom: 8 }} />
            <PaperTextInput mode="outlined" label="Modell (t.ex. qwen2.5:3b-instruct)" autoCapitalize="none" autoCorrect={false} value={newProvider.model} onChangeText={(v) => setNewProvider((p) => ({ ...p, model: v }))} style={{ marginBottom: 8 }} />
            <PaperTextInput mode="outlined" label="API-nyckel (valfri)" secureTextEntry value={newProvider.apiKey} onChangeText={(v) => setNewProvider((p) => ({ ...p, apiKey: v }))} />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAddProviderDialogVisible(false)}>Avbryt</Button>
            <Button
              disabled={!newProvider.label.trim() || !newProvider.baseUrl.trim()}
              onPress={() => {
                const id = `custom_${uuidv4()}`;
                const created: CustomProvider = { ...newProvider, id, label: newProvider.label.trim(), baseUrl: newProvider.baseUrl.trim() };
                setCustomProviders((prev) => [...prev, created]);
                setApiProvider(id);
                setAddProviderDialogVisible(false);
              }}
            >
              Spara
            </Button>
          </Dialog.Actions>
        </Dialog>
        <ProjectDialog
          visible={projectDialogVisible}
          mode={projectDialogMode}
          initialName={projectDialogName}
          initialPrompt={projectDialogPrompt}
          initialLocalOnly={projectDialogLocalOnly}
          icon={projectDialogIcon}
          iconColor={projectDialogIconColor}
          onPickIcon={() => setProjectIconPickerVisible(true)}
          onDelete={projectDialogId ? () => setConfirmProjectDeleteId(projectDialogId) : undefined}
          onSave={handleSaveProjectDialog}
          onDismiss={() => setProjectDialogVisible(false)}
        />
        <ChatDialog
          visible={chatDialogVisible}
          initialName={chatDialogName}
          initialLocalOnly={chatDialogLocalOnly}
          onPickIcon={() => setChatIconPickerVisible(true)}
          onDelete={() => chatDialogId && setConfirmChatDeleteId(chatDialogId)}
          onSave={handleSaveChatDialog}
          onDismiss={() => setChatDialogVisible(false)}
        />
        <Dialog visible={!!confirmProjectDeleteId} onDismiss={() => setConfirmProjectDeleteId(null)}>
          <Dialog.Title>Ta bort projekt</Dialog.Title>
          <Dialog.Content>
            <Text>Vill du ta bort projektmappen?</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmProjectDeleteId(null)}>Avbryt</Button>
            <Button mode="contained" onPress={confirmDeleteProject}>Ta bort</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!confirmChatDeleteId} onDismiss={() => setConfirmChatDeleteId(null)}>
          <Dialog.Title>Ta bort chatt</Dialog.Title>
          <Dialog.Content>
            <Text>Vill du ta bort chatten?</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmChatDeleteId(null)}>Avbryt</Button>
            <Button mode="contained" onPress={confirmDeleteChat}>Ta bort</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <IconPickerModal
        visible={projectIconPickerVisible}
        onDismiss={() => setProjectIconPickerVisible(false)}
        currentIcon={projectDialogIcon}
        currentColor={projectDialogIconColor}
        onSelect={(icon, color) => {
          setProjectDialogIcon(icon);
          setProjectDialogIconColor(color);
          setProjectIconPickerVisible(false);
        }}
      />
      <IconPickerModal
        visible={chatIconPickerVisible}
        onDismiss={() => setChatIconPickerVisible(false)}
        currentIcon={chatDialogIcon}
        currentColor={chatDialogIconColor}
        onSelect={(icon, color) => {
          setChatDialogIcon(icon);
          setChatDialogIconColor(color);
          setChatIconPickerVisible(false);
        }}
      />
      {settingsVisible ? (
        <View style={{ flex: 1, padding: 16 }}>
          <View style={{ flexDirection: 'row', marginBottom: 12 }}>
            <Button mode={settingsTab === 'models' ? 'contained' : 'text'} onPress={() => setSettingsTab('models')} style={{ marginRight: 8 }} testID="ai-settings-tab-models">
              Modeller
            </Button>
            <Button mode={settingsTab === 'instructions' ? 'contained' : 'text'} onPress={() => setSettingsTab('instructions')} testID="ai-settings-tab-instructions">
              AI Instruktioner
            </Button>
          </View>

          {settingsTab === 'models' && (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 48 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: theme.colors.onSurface }}>Använd API-baserad AI</Text>
                <Switch value={aiUseApiProviders} onValueChange={setAiUseApiProviders} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <Text style={{ color: theme.colors.onSurface, flex: 1 }}>Tillåt filbilagor i chatten</Text>
                <Switch value={attachmentsEnabled} onValueChange={setAttachmentsEnabled} />
              </View>
              {aiUseApiProviders ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: theme.colors.onSurface, marginBottom: 6 }}>API Provider</Text>
                  <Menu
                    visible={providerMenuVisible}
                    onDismiss={() => dismissMenuSafely(providerMenuGuardRef, setProviderMenuVisible)}
                    anchorPosition="bottom"
                    anchor={
                      <Button mode="outlined" onPress={() => openMenuSafely(providerMenuGuardRef, setProviderMenuVisible)} testID="ai-provider-dropdown-button" icon="chevron-down" contentStyle={{ flexDirection: 'row-reverse' }}>
                        {activeProviderMeta.label}
                      </Button>
                    }
                  >
                    {API_PROVIDER_LIST.map((p) => (
                      <Menu.Item
                        key={p.id}
                        onPress={() => { setApiProvider(p.id); dismissMenuSafely(providerMenuGuardRef, setProviderMenuVisible); }}
                        title={p.label}
                        leadingIcon={apiProvider === p.id ? 'check' : undefined}
                      />
                    ))}
                    {customProviders.length > 0 ? <Divider /> : null}
                    {customProviders.map((c) => (
                      <Menu.Item
                        key={c.id}
                        onPress={() => { setApiProvider(c.id); dismissMenuSafely(providerMenuGuardRef, setProviderMenuVisible); }}
                        title={c.label}
                        leadingIcon={apiProvider === c.id ? 'check' : 'server-network'}
                      />
                    ))}
                    <Divider />
                    <Menu.Item
                      onPress={() => {
                        dismissMenuSafely(providerMenuGuardRef, setProviderMenuVisible);
                        setNewProvider({ id: '', label: '', baseUrl: '', model: '', apiKey: '' });
                        setAddProviderDialogVisible(true);
                      }}
                      title="Lägg till egen provider…"
                      leadingIcon="plus"
                    />
                  </Menu>
                  {isCustomProvider ? (
                    <Button
                      mode="text"
                      compact
                      textColor={theme.colors.error}
                      onPress={() => {
                        const removingId = apiProvider;
                        setCustomProviders((prev) => prev.filter((p) => p.id !== removingId));
                        setApiProvider('openrouter');
                      }}
                      style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    >
                      Ta bort denna egna provider
                    </Button>
                  ) : null}
                  {activeProviderMeta.configurableEndpoint ? (
                    <>
                      <PaperTextInput
                        mode="outlined"
                        label={`${activeProviderMeta.label} bas-URL`}
                        value={activeBinding.baseUrl ?? ''}
                        onChangeText={activeBinding.setBaseUrl ?? (() => {})}
                        autoCorrect={false}
                        autoCapitalize="none"
                        placeholder="http://192.168.50.16:8080"
                        keyboardType="url"
                        style={{ marginTop: 8 }}
                        testID="ai-hermes-base-url"
                      />
                      {activeProviderMeta.hint ? (
                        <Text style={{ marginTop: 4, fontSize: 12, color: theme.colors.onSurfaceVariant }}>
                          {activeProviderMeta.hint}
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                  <PaperTextInput
                    mode="outlined"
                    label={`${activeProviderMeta.label} API Key${activeProviderMeta.apiKeyOptional ? ' (valfri)' : ''}`}
                    value={activeBinding.key}
                    onChangeText={activeBinding.setKey}
                    autoCorrect={false}
                    secureTextEntry
                    style={{ marginTop: 8 }}
                  />
                  {/* Per-provider model picker: choose from the provider's known
                      models, or switch to a custom id. Selection is remembered per
                      provider (AsyncStorage). */}
                  <Text style={{ color: theme.colors.onSurface, marginTop: 12, marginBottom: 6 }}>Modell ({activeProviderMeta.label})</Text>
                  {!customModelMode ? (
                    <Menu
                      visible={modelMenuVisible}
                      onDismiss={() => dismissMenuSafely(modelMenuGuardRef, setModelMenuVisible)}
                      anchorPosition="bottom"
                      anchor={
                        <Button mode="outlined" onPress={() => openMenuSafely(modelMenuGuardRef, setModelMenuVisible)} testID="ai-model-dropdown-button" icon="chevron-down" contentStyle={{ flexDirection: 'row-reverse' }}>
                          {activeBinding.model || 'Välj modell'}
                        </Button>
                      }
                    >
                      {activeProviderMeta.defaultModels.map((m) => (
                        <Menu.Item
                          key={m}
                          onPress={() => { activeBinding.setModel(m); dismissMenuSafely(modelMenuGuardRef, setModelMenuVisible); }}
                          title={m}
                          leadingIcon={activeBinding.model === m ? 'check' : undefined}
                        />
                      ))}
                      <Divider />
                      <Menu.Item
                        onPress={() => { setCustomModelMode(true); dismissMenuSafely(modelMenuGuardRef, setModelMenuVisible); }}
                        title="Egen modell-id…"
                        leadingIcon="pencil"
                      />
                    </Menu>
                  ) : (
                    <View>
                      <PaperTextInput
                        mode="outlined"
                        label={`Egen modell-id`}
                        value={activeBinding.model}
                        onChangeText={activeBinding.setModel}
                        autoCorrect={false}
                        autoCapitalize="none"
                        placeholder={activeProviderMeta.defaultModels[0]}
                      />
                      <Button mode="text" compact onPress={() => setCustomModelMode(false)} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                        ← Välj från lista
                      </Button>
                    </View>
                  )}
                  {activeProviderMeta.apiKeyUrl ? (
                    <Button
                      mode="text"
                      compact
                      onPress={() => Linking.openURL(activeProviderMeta.apiKeyUrl)}
                      style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    >
                      Hämta API-nyckel
                    </Button>
                  ) : null}
                  {usageSnapshot ? (
                    <View style={{ marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: theme.colors.surfaceVariant }}>
                      <Text style={{ fontWeight: '600', color: theme.colors.onSurface, marginBottom: 6 }}>Förbrukning & rate limit ({activeApiModel || '—'})</Text>
                      <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>
                        Idag: {usageSnapshot.callsDay}{usageSnapshot.limit.callsPerDay ? ` / ${usageSnapshot.limit.callsPerDay}` : ''} anrop · {usageSnapshot.tokensDay.toLocaleString()} tokens{usageSnapshot.limit.tokensPerDay ? ` / ${usageSnapshot.limit.tokensPerDay.toLocaleString()}` : ''}
                      </Text>
                      {usageSnapshot.limit.callsPerDay ? (
                        <View style={{ marginTop: 6 }}>
                          <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Anrop/dag: {Math.round((usageSnapshot.callsDay / usageSnapshot.limit.callsPerDay) * 100)}%</Text>
                          <ProgressBar progress={Math.min(1, usageSnapshot.callsDay / usageSnapshot.limit.callsPerDay)} color={usageSnapshot.callsDay / usageSnapshot.limit.callsPerDay > 0.85 ? theme.colors.error : theme.colors.primary} style={{ height: 6, borderRadius: 3, marginTop: 2 }} />
                        </View>
                      ) : null}
                      {usageSnapshot.limit.tokensPerDay ? (
                        <View style={{ marginTop: 6 }}>
                          <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Tokens/dag: {Math.round((usageSnapshot.tokensDay / usageSnapshot.limit.tokensPerDay) * 100)}%</Text>
                          <ProgressBar progress={Math.min(1, usageSnapshot.tokensDay / usageSnapshot.limit.tokensPerDay)} color={usageSnapshot.tokensDay / usageSnapshot.limit.tokensPerDay > 0.85 ? theme.colors.error : theme.colors.primary} style={{ height: 6, borderRadius: 3, marginTop: 2 }} />
                        </View>
                      ) : null}
                      {!usageSnapshot.limit.callsPerDay && !usageSnapshot.limit.tokensPerDay ? (
                        <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, marginTop: 4 }}>Ingen publik gräns för denna källa (t.ex. egen Hermes-server).</Text>
                      ) : null}
                      <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, marginTop: 6 }}>
                        Denna månad: {usageSnapshot.callsMonth} anrop · {usageSnapshot.tokensMonth.toLocaleString()} tokens
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={{ marginTop: 12 }}>
                  <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>Nedladdade modeller</Text>
                  {localModels.length === 0 ? (
                    <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>Inga modeller nedladdade</Text>
                  ) : (
                    // map (not FlatList) so the whole models tab scrolls as one — a
                    // VirtualizedList can't nest inside a ScrollView.
                    localModels.map((m) => (
                      <View key={m.id} style={[styles.modelItem, { borderColor: theme.colors.outline }]}>
                        <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                          <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>{m.name}</Text>
                          <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurfaceVariant }}>{(m.size / 1024 / 1024).toFixed(1)} MB</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Button
                            mode={activeModel === m.path ? 'contained' : 'outlined'}
                            onPress={() => setActiveModel(m.path)}
                            style={{ marginRight: 8 }}
                          >
                            {activeModel === m.path ? 'Active' : 'Select'}
                          </Button>
                          <IconButton icon="delete" onPress={() => handleDeleteModel(m.id, m.path)} />
                        </View>
                      </View>
                    ))
                  )}
                </View>
              )}
              <View style={{ marginTop: 12 }}>
                <Button mode="contained" onPress={() => setDownloadDialogVisible(true)} testID="ai-open-download-models-dialog">
                  Ladda ner nya AI-modeller
                </Button>
                <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                  Nedladdning och konvertering fortsätter i bakgrunden även om du stänger dialogen.
                </Text>
              </View>
            </ScrollView>
          )}
          {settingsTab === 'instructions' && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
              <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>AI Instruktioner</Text>
              <TextInput
                style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outline, borderWidth: 1, borderRadius: 8, padding: 8, height: 160, textAlignVertical: 'top' }]}
                placeholder={t('ai.systemPromptPlaceholder')}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                value={systemPrompt}
                onChangeText={setSystemPrompt}
                multiline
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <Text style={{ color: theme.colors.onSurface }}>{t('ai.toolUseLabel')}</Text>
                <Switch value={enableToolUse} onValueChange={setEnableToolUse} />
              </View>
              {/* Context level moved here from the chat bottom-bar popup so it lives with
                  the other AI instructions and applies globally. */}
              <Text style={{ marginTop: 16, fontWeight: '600', color: theme.colors.onSurface }}>Kontextnivå (komplexitet)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {CONTEXT_LEVELS.map((l) => (
                  <Chip key={l} compact selected={chatContextLevel === l} onPress={() => setChatContextLevel(l)} testID={`chat-context-${l}`}>
                    {contextLevelConfig(l).label}
                  </Chip>
                ))}
              </View>
              <Text style={{ marginTop: 6, fontSize: 12, color: theme.colors.onSurfaceVariant }}>
                {contextLevelConfig(chatContextLevel).description}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }} testID="chat-tool-policy">
                {summarizeToolPolicy(chatContextLevel, enableToolUse).map((cap) => (
                  <Chip key={cap} compact textStyle={{ fontSize: 10 }}>{cap}</Chip>
                ))}
              </View>

              {/* Semantisk kontext (RAG): hämta relevanta anteckningar/uppgifter och injicera
                  som kontext. Lås-medvetet. Kräver semantisk sök (inbäddningar) påslagen för
                  vektor-/GraphRAG-steget; det lexikala steget + rerank funkar ändå. */}
              <Text style={{ marginTop: 16, fontWeight: '600', color: theme.colors.onSurface }}>Semantisk kontext (RAG)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ color: theme.colors.onSurface, flex: 1, marginRight: 8 }}>Hämta relevant kontext per meddelande</Text>
                <Switch value={retrievalSettings.enableSemantic} onValueChange={(v) => setRetrievalSettings((p) => ({ ...p, enableSemantic: v }))} />
              </View>
              {retrievalSettings.enableSemantic && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <Text style={{ color: theme.colors.onSurface, flex: 1, marginRight: 8 }}>GraphRAG (utöka med relaterade via grafen)</Text>
                    <Switch value={retrievalSettings.enableGraphRAG} onValueChange={(v) => setRetrievalSettings((p) => ({ ...p, enableGraphRAG: v }))} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <Text style={{ color: theme.colors.onSurface, flex: 1, marginRight: 8 }}>Rerank (omordna träffar efter relevans)</Text>
                    <Switch value={retrievalSettings.enableRerank} onValueChange={(v) => setRetrievalSettings((p) => ({ ...p, enableRerank: v }))} />
                  </View>
                  <Text style={{ marginTop: 6, fontSize: 12, color: theme.colors.onSurfaceVariant }}>
                    Två-stegs RAG: lexikal + vektor-träff (RRF) → {retrievalSettings.enableGraphRAG ? 'graf-expansion → ' : ''}{retrievalSettings.enableRerank ? 'rerank' : 'fusionsordning'}. Bara läsbara (olåsta) objekt. Vektor-/GraphRAG-steget kräver att semantisk sök (inbäddningar) är på.
                  </Text>
                </>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <Text style={{ color: theme.colors.onSurface }}>{t('ai.backgroundWorkLabel')}</Text>
                <Switch value={allowBackgroundAIWork} onValueChange={setAllowBackgroundAIWork} />
              </View>
              {localEngineText ? (
                <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                  {localEngineText}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', marginTop: 10 }}>
                <Button mode="outlined" onPress={refreshLocalEngine}>
                  {t('ai.checkLocalEngine')}
                </Button>
              </View>

              {/* AI-statistik (moved here from the chat bottom-bar cog popup). */}
              <Text style={{ marginTop: 16, fontWeight: '600', color: theme.colors.onSurface }}>AI-statistik (verktyg)</Text>
              <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, marginBottom: 4 }}>idag · månad · totalt — lagras krypterat lokalt</Text>
              {toolUsageRows.length === 0 ? (
                <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>Inga verktygsanrop registrerade ännu.</Text>
              ) : (
                <View testID="ai-tool-stats">
                  {toolUsageRows.slice(0, 10).map((r) => (
                    <View key={r.tool} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 }}>
                      <Text style={{ fontSize: 12, flex: 1, color: theme.colors.onSurface }} numberOfLines={1}>{toolUsageLabel(r.tool)}</Text>
                      <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>{r.countDay} · {r.countMonth} · {r.total}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={{ marginTop: 14, padding: 12, borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 10 }}>
                <Text variant="titleSmall" style={{ color: theme.colors.onSurface, marginBottom: 6 }}>MCP Integrationer</Text>
                <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 10 }}>
                  Värden här sparas krypterat på enheten och prioriteras över motsvarande .env-värden.
                </Text>

                {/* Easy custom MCP JSON — paste/import or export the whole config. */}
                <Button
                  mode="text"
                  compact
                  onPress={() => {
                    setMcpJsonOpen((open) => {
                      const next = !open;
                      if (next) {
                        setMcpJsonText(mcpSettingsToJsonString(mcpSettings));
                        setMcpJsonError(null);
                        setMcpJsonNotice(null);
                      }
                      return next;
                    });
                  }}
                  style={{ alignSelf: 'flex-start', marginBottom: 6 }}
                >
                  {mcpJsonOpen ? 'Dölj JSON-import/export' : 'Importera/exportera som JSON'}
                </Button>
                {mcpJsonOpen ? (
                  <View style={{ marginBottom: 12, borderWidth: 1, borderColor: theme.colors.outlineVariant, borderRadius: 8, padding: 10 }}>
                    <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8, fontSize: 12 }}>
                      Klistra in en konfiguration ({'{ "mcpServers": { … } }'}) och tryck Importera. Stödjer Claude Desktop-stilen.
                    </Text>
                    <PaperTextInput
                      mode="outlined"
                      multiline
                      numberOfLines={8}
                      value={mcpJsonText}
                      onChangeText={(value) => { setMcpJsonText(value); setMcpJsonError(null); setMcpJsonNotice(null); }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                      testID="mcp-json-textarea"
                    />
                    {mcpJsonError ? <Text style={{ color: theme.colors.error, marginTop: 4, fontSize: 12 }}>{mcpJsonError}</Text> : null}
                    {mcpJsonNotice ? <Text style={{ color: theme.colors.primary, marginTop: 4, fontSize: 12 }}>{mcpJsonNotice}</Text> : null}
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <Button
                        mode="contained"
                        compact
                        onPress={() => {
                          try {
                            setMcpSettings(mcpSettingsFromJson(mcpJsonText));
                            setMcpJsonError(null);
                            setMcpJsonNotice('Importerat. Sparas krypterat på enheten.');
                          } catch (e: any) {
                            setMcpJsonError('Ogiltig JSON: ' + (e?.message || 'kunde inte tolka'));
                            setMcpJsonNotice(null);
                          }
                        }}
                        testID="mcp-json-import"
                      >
                        Importera
                      </Button>
                      <Button
                        mode="outlined"
                        compact
                        onPress={() => {
                          setMcpJsonText(mcpSettingsToJsonString(mcpSettings));
                          setMcpJsonError(null);
                          setMcpJsonNotice('Aktuell konfiguration laddad i rutan.');
                        }}
                        testID="mcp-json-export"
                      >
                        Exportera aktuell
                      </Button>
                    </View>
                  </View>
                ) : null}

                {MCP_INTEGRATIONS.map((integration) => (
                  <View key={integration.id} style={{ marginBottom: 12, borderWidth: 1, borderColor: theme.colors.outlineVariant, borderRadius: 8, padding: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text style={{ color: theme.colors.onSurface, fontWeight: '600' }}>{integration.label}</Text>
                      <Switch
                        value={Boolean(mcpSettings[integration.id]?.enabled)}
                        testID={`mcp-enabled-${integration.id}`}
                        onValueChange={(value) =>
                          setMcpSettings((prev) => ({
                            ...prev,
                            [integration.id]: {
                              ...prev[integration.id],
                              enabled: value,
                            },
                          }))
                        }
                      />
                    </View>
                    {integration.fields.map((field) => (
                      <PaperTextInput
                        key={`${integration.id}-${field.key}`}
                        mode="outlined"
                        label={field.label}
                        value={mcpSettings[integration.id]?.values[field.key] || ''}
                        onChangeText={(value) =>
                          setMcpSettings((prev) => ({
                            ...prev,
                            [integration.id]: {
                              ...prev[integration.id],
                              values: {
                                ...prev[integration.id].values,
                                [field.key]: value,
                              },
                            },
                          }))
                        }
                        autoCorrect={false}
                        secureTextEntry={field.secret}
                        style={{ marginTop: 8 }}
                        testID={`mcp-${integration.id}-${field.key}`}
                      />
                    ))}
                  </View>
                ))}
              </View>
              <View style={{ marginTop: 14, padding: 12, borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 10 }} testID="mcp-dashboard-section-mobile">
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurface }}>MCP Säkerhetsdashboard</Text>
                  <Button
                    mode="outlined"
                    onPress={async () => {
                      const nextOpen = !mcpDashboardOpen;
                      setMcpDashboardOpen(nextOpen);
                      if (nextOpen) {
                        await loadMcpDashboard();
                      }
                    }}
                    testID="mcp-dashboard-toggle-mobile"
                  >
                    {mcpDashboardOpen ? 'Dölj' : 'Visa'}
                  </Button>
                </View>
                <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                  Visar endast aktuell användares auditmetadata från backend.
                </Text>
                {mcpDashboardOpen ? (
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <Button mode="text" onPress={loadMcpDashboard} testID="mcp-dashboard-refresh-mobile">
                        Uppdatera
                      </Button>
                      {mcpDashboardLoading ? <ActivityIndicator size="small" style={{ marginLeft: 8 }} /> : null}
                    </View>
                    {mcpDashboardError ? (
                      <Text style={{ color: theme.colors.error, marginBottom: 8 }}>{mcpDashboardError}</Text>
                    ) : null}
                    <View style={{ maxHeight: 180 }}>
                      <ScrollView testID="mcp-dashboard-list-mobile">
                        {mcpDashboardRows.length === 0 ? (
                          <Text style={{ color: theme.colors.onSurfaceVariant }}>Ingen spårning hittades.</Text>
                        ) : (
                          mcpDashboardRows.map((row: any, index: number) => (
                            <View key={`${row.at || index}-${row.service || ''}`} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.outlineVariant }}>
                              <Text style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                                {row.service || '-'} · {row.action || '-'} · {row.ok ? 'OK' : 'NEJ'}
                              </Text>
                              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                                {(row.at ? new Date(row.at).toLocaleString('sv-SE') : '-') + (row.toolName ? ` · ${row.toolName}` : '')}
                              </Text>
                            </View>
                          ))
                        )}
                      </ScrollView>
                    </View>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <Button
                  mode="contained"
                  onPress={async () => {
                    if (!userScopeKey) return;
                    await AsyncStorage.setItem(`ai_system_prompt_${userScopeKey}`, encrypt(systemPrompt));
                  }}
                  style={{ marginRight: 8 }}
                >
                  Spara
                </Button>
                <Button
                  mode="outlined"
                  onPress={async () => {
                    setSystemPrompt('');
                    if (!userScopeKey) return;
                    await AsyncStorage.removeItem(`ai_system_prompt_${userScopeKey}`);
                  }}
                >
                  Rensa
                </Button>
              </View>
            </ScrollView>
          )}
          {/* Full-screen native Modal (Paper's Dialog won't reliably fill height): a
              padded title at top, the model list flexes to fill all space, and the
              close button is pinned to the bottom. Long names scroll horizontally. */}
          <Modal
            visible={downloadDialogVisible}
            animationType="slide"
            onRequestClose={() => setDownloadDialogVisible(false)}
          >
            <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
              <View style={{ paddingTop: 18, paddingHorizontal: 16, paddingBottom: 10 }}>
                <Text style={{ color: theme.colors.onSurface, fontSize: 20, fontWeight: '700' }}>Hämta AI-modeller</Text>
                <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 }}>Sök, utforska och ladda ner från HuggingFace</Text>
              </View>
              <View style={{ flex: 1, paddingHorizontal: 16 }}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, color: theme.colors.onSurface, borderColor: theme.colors.outline, borderWidth: 1, borderRadius: 4, padding: 8 }]}
                    placeholder={t('ai.searchPlaceholder')}
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    returnKeyType="search"
                    onSubmitEditing={handleSearch}
                  />
                  <Button mode="contained" onPress={handleSearch} loading={isSearching}>Sök</Button>
                </View>
                {/* Active downloads panel: always visible while anything is downloading/
                    paused, so all in-progress transfers are listed with pause/resume/cancel
                    even if you search away or collapse the row that started them. */}
                {activeDownloadsList.length > 0 && (
                  <View style={{ marginBottom: 10, padding: 8, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surfaceVariant }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.onSurface, marginBottom: 4 }}>Aktiva nedladdningar ({activeDownloadsList.length})</Text>
                    {activeDownloadsList.map((d) => (
                      <View key={d.modelId} style={{ marginTop: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text numberOfLines={1} style={{ flex: 1, marginRight: 8, fontSize: 12, color: theme.colors.onSurface }}>
                            {d.name || d.modelId}{d.quantization ? ` · ${d.quantization}` : ''}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {d.stage === 'paused' ? (
                              <IconButton icon="play" size={18} onPress={() => resumeModelDownload(d.modelId)} accessibilityLabel="Återuppta" style={{ margin: 0 }} />
                            ) : (d.stage === 'downloading' || d.stage === 'queued' || d.stage === 'retrying') ? (
                              <IconButton icon="pause" size={18} onPress={() => pauseModelDownload(d.modelId)} accessibilityLabel="Pausa" style={{ margin: 0 }} />
                            ) : null}
                            <IconButton icon="close" size={18} onPress={() => handleCancelDownload(d.modelId)} accessibilityLabel="Avbryt" style={{ margin: 0 }} />
                          </View>
                        </View>
                        <ProgressBar progress={typeof d.percent === 'number' ? d.percent : 0} color={d.stage === 'paused' ? theme.colors.onSurfaceVariant : theme.colors.primary} style={{ height: 6, borderRadius: 3 }} />
                        <Text style={{ fontSize: 10.5, color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                          {Math.round((d.percent || 0) * 100)}% · {formatDownloadStage(d.stage)}{d.error ? ` · ${d.error}` : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {/* Sort: downloads, likes (rating) or release date — client-side re-sort. */}
                {searchResults.length > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Sortera:</Text>
                    {([['downloads', 'Nedladdningar'], ['likes', 'Likes'], ['recent', 'Senaste']] as [HFModelSort, string][]).map(([key, label]) => (
                      <Chip key={key} compact selected={modelSort === key} onPress={() => setModelSort(key)} style={{ height: 30 }} textStyle={{ fontSize: 11, marginVertical: 0 }}>
                        {label}
                      </Chip>
                    ))}
                  </View>
                )}
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
                  {searchResults.length === 0 && !isSearching && (
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 24, textAlign: 'center' }}>
                      Sök efter en modell ovan (t.ex. "llama 1b", "qwen") för att börja.
                    </Text>
                  )}
                  <View style={{ gap: 10 }}>
                    {sortModels(searchResults, modelSort).map((item) => (
                      <View key={item.id} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.outline, paddingVertical: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Pressable style={{ flex: 1, minWidth: 0, marginRight: 8 }} onPress={() => setExpandedModelId((cur) => (cur === item.id ? null : item.id))}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <IconButton icon={expandedModelId === item.id ? 'chevron-down' : 'chevron-right'} size={16} style={{ margin: 0, marginRight: 2, width: 18 }} />
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
                                <Text style={{ color: theme.colors.onSurface, fontWeight: '600', fontSize: 13 }}>{item.name}</Text>
                              </ScrollView>
                            </View>
                            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, marginTop: 2 }}>
                              {item.author} · ⬇ {formatCount(item.downloads)} · ♥ {formatCount(item.likes)}{formatSearchSize(searchSizes[item.id]) ? ` · ${formatSearchSize(searchSizes[item.id])}` : ''}
                            </Text>
                          </Pressable>
                          {processingModels[item.id] ? (
                            <Button mode="outlined" compact onPress={() => handleCancelDownload(item.id)} labelStyle={{ fontSize: 12 }}>Avbryt</Button>
                          ) : (
                            <Button mode="contained-tonal" compact onPress={() => downloadModel(item)} labelStyle={{ fontSize: 12 }}>Ladda ner</Button>
                          )}
                        </View>
                        {expandedModelId === item.id && (
                          <View style={{ marginTop: 6, marginLeft: 20, gap: 2 }}>
                            <Text selectable style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Modell-id: {item.id}</Text>
                            <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Nedladdningar: {formatCount(item.downloads)}</Text>
                            <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Likes: {formatCount(item.likes)}</Text>
                            <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Släppt: {formatModelDate(item.createdAt)}</Text>
                            <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Uppdaterad: {formatModelDate(item.lastModified)}</Text>
                            {Array.isArray(item.tags) && item.tags.length > 0 && (
                              <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Taggar: {item.tags.slice(0, 8).join(', ')}</Text>
                            )}

                            {/* Quantization / size picker with a per-device recommendation. */}
                            <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.onSurface, marginTop: 8 }}>Välj storlek / kvantisering</Text>
                            {describeHardwareBudget() ? (
                              <Text style={{ fontSize: 10.5, color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>{describeHardwareBudget()}</Text>
                            ) : null}
                            {modelFilesLoading[item.id] ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                                <ActivityIndicator size="small" />
                                <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Hämtar varianter…</Text>
                              </View>
                            ) : (() => {
                              const files = [...(modelFiles[item.id] || [])]
                                .filter((f) => !!f && typeof f.size === 'number')
                                .sort((a, b) => (a.size || 0) - (b.size || 0));
                              if (files.length === 0) {
                                return <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, paddingVertical: 4 }}>Inga GGUF-varianter hittades.</Text>;
                              }
                              const recommended = recommendFileForDevice(files);
                              return (
                                <View style={{ gap: 4, marginTop: 2 }}>
                                  {files.map((f) => {
                                    const fit = assessModelFit(f.size);
                                    const isRec = recommended && f.filename === recommended.filename;
                                    const fitColor = fit.level === 'good' ? '#2e9e5b' : fit.level === 'tight' ? '#c98a00' : fit.level === 'risky' ? theme.colors.error : theme.colors.onSurfaceVariant;
                                    return (
                                      <View key={f.filename} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: isRec ? 1.5 : StyleSheet.hairlineWidth, borderColor: isRec ? theme.colors.primary : theme.colors.outlineVariant, backgroundColor: isRec ? ((theme.colors as any).primaryContainer || 'transparent') : 'transparent' }}>
                                        <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onSurface }}>{f.quantization || 'GGUF'}</Text>
                                            <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{formatBytes(f.size)}</Text>
                                            {isRec ? (
                                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.primary, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}>
                                                <FontAwesome5 name="star" size={8} solid color={theme.colors.onPrimary} />
                                                <Text style={{ fontSize: 9, fontWeight: '700', color: theme.colors.onPrimary }}>Rekommenderad</Text>
                                              </View>
                                            ) : fit.label ? (
                                              <Text style={{ fontSize: 9.5, color: fitColor }}>{fit.label}</Text>
                                            ) : null}
                                          </View>
                                        </View>
                                        <Button
                                          mode={isRec ? 'contained' : 'outlined'}
                                          compact
                                          disabled={!!processingModels[item.id]}
                                          onPress={() => downloadModel(item, f)}
                                          labelStyle={{ fontSize: 11 }}
                                        >
                                          Ladda ner
                                        </Button>
                                      </View>
                                    );
                                  })}
                                </View>
                              );
                            })()}
                          </View>
                        )}
                        {typeof downloadProgress[item.id] === 'number' && (
                          <View style={{ marginTop: 6 }}>
                            <ProgressBar progress={downloadProgress[item.id]} color={theme.colors.primary} style={{ height: 8, borderRadius: 4 }} />
                            <Text style={{ fontSize: 11, marginTop: 3, color: theme.colors.onSurface, fontWeight: '600' }}>
                              {(downloadProgress[item.id] * 100).toFixed(0)}% · {formatDownloadStage(downloadStage[item.id])}
                            </Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              <View style={{ paddingHorizontal: 16, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.outline }}>
                <Button mode="contained" onPress={() => setDownloadDialogVisible(false)} style={{ marginVertical: 4 }}>{t('common.close')}</Button>
              </View>
            </View>
          </Modal>
        </View>
      ) : (
        <>
            {/* padding on BOTH platforms reliably lifts the composer to sit right
                above the keyboard. The tab bar hides on keyboard (tabBarHideOnKeyboard)
                so nothing wedges between the composer and the keyboard. Offset =
                header height so it lands exactly, not too high. (A previous
                Android `behavior={undefined}` removed all avoidance and hid the input.) */}
            <KeyboardAvoidingView
              behavior="padding"
              style={{ flex: 1 }}
              keyboardVerticalOffset={headerOffset}
            >
              <FlatList
                ref={messagesListRef}
                data={messages}
                keyExtractor={(item, index) => item.id ?? String(index)}
                contentContainerStyle={messages.length === 0 ? { flexGrow: 1, justifyContent: 'center' } : styles.listContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                // A selected-but-empty thread (or one whose local copy is still being
                // self-healed from the server) shows a clear hint instead of a blank screen.
                ListEmptyComponent={
                  currentConversationId ? (
                    <View style={{ alignItems: 'center', paddingHorizontal: 32 }}>
                      <FontAwesome5 name="comments" size={28} color={theme.colors.onSurfaceVariant} />
                      <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 10, textAlign: 'center' }}>
                        {loading ? t('ai.loadingThread', 'Laddar konversationen…') : t('ai.emptyThread', 'Inga meddelanden ännu. Skriv nedan för att fortsätta.')}
                      </Text>
                    </View>
                  ) : null
                }
                // Keep the latest message in view: opening a thread loads messages
                // (content grows) and streaming appends — both fire this.
                onContentSizeChange={() => scrollChatToEnd(false)}
                renderItem={({ item, index }) => {
                  // Defensive: content can be undefined/null on a corrupted or partially-
                  // synced row. Coerce to a string so no string method below ever throws
                  // (a single bad row must never crash the whole message list).
                  const safeContent = typeof item.content === 'string' ? item.content : '';
                  if (item.role === 'tool') {
                    const key = item.id ?? String(index);
                    const collapsed = collapsedTool[key] ?? true;
                    // Colour-code + icon by kind so call/result/error read at a glance.
                    const kind = safeContent.startsWith('Tool error:')
                      ? { label: 'Fel', icon: 'exclamation-triangle', color: theme.colors.error }
                      : safeContent.startsWith('Tool result:')
                      ? { label: 'Resultat', icon: 'check-circle', color: '#2e9e5b' }
                      : safeContent.startsWith('Tool call:')
                      ? { label: 'Anrop', icon: 'play-circle', color: theme.colors.primary }
                      : { label: 'Verktyg', icon: 'tools', color: theme.colors.primary };
                    // Human one-liner ("Skapade uppgift: X", "Sökte…", "Anropade …")
                    // so the card is always informative — never empty.
                    const summary = safeSummarizeTool(safeContent) || `Tool use · ${kind.label}`;
                    // Body text with the "Tool call/result:" prefix stripped; falls back to
                    // the summary so the box is never blank. Shown as a 2-line preview when
                    // collapsed (so content is always visible) and in full when expanded.
                    const bodyText = safeContent.replace(/^Tool (call|result|error):\s*/i, '').trim() || summary;
                    // Readable "Label: value" rows from the tool arguments so the user
                    // clearly sees WHAT was done + WHICH values were filled in.
                    const fields = safeToolFields(safeContent);
                    return (
                      <View style={[styles.messageRow, styles.rowLeft]}>
                        <View style={[styles.toolCard, { borderColor: kind.color, backgroundColor: theme.colors.surfaceVariant }]}>
                          <Pressable
                            style={styles.toolHeader}
                            onPress={() => setCollapsedTool(prev => ({ ...prev, [key]: !collapsed }))}
                            accessibilityRole="button"
                            accessibilityLabel={`Tool use ${kind.label}: ${summary}`}
                          >
                            <View style={styles.toolHeaderLeft}>
                              <FontAwesome5 name={kind.icon} size={14} color={kind.color} />
                              <Text style={[styles.toolTitle, { color: theme.colors.onSurface }]} numberOfLines={1}>
                                {summary}
                              </Text>
                            </View>
                            <FontAwesome5 name={collapsed ? 'chevron-down' : 'chevron-up'} size={12} color={theme.colors.onSurfaceVariant} />
                          </Pressable>
                          {!collapsed && fields.length > 0 ? (
                            <View style={{ marginTop: 6, gap: 3 }}>
                              {fields.map((f, fi) => (
                                <View key={fi} style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                  <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.onSurface }}>{f.label}: </Text>
                                  <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, flexShrink: 1 }} selectable>{f.value}</Text>
                                </View>
                              ))}
                            </View>
                          ) : (
                            <Text
                              style={[styles.toolBody, { color: theme.colors.onSurfaceVariant }]}
                              numberOfLines={collapsed ? 2 : undefined}
                              selectable={!collapsed}
                            >
                              {collapsed && fields.length > 0 ? fields.map((f) => `${f.label}: ${f.value}`).join(' · ') : bodyText}
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  }
                  const isAssistant = item.role === 'assistant';
                  const split = isAssistant ? safeExtractThinking(safeContent) : null;
                  const displayText = split ? split.answer : safeContent;
                  const thinkKey = (item.id ?? String(index)) + '_think';
                  const thinkingCollapsed = collapsedThinking[thinkKey] ?? true;
                  // #1: the "AI is working" animation lives INSIDE the last assistant
                  // bubble (a real chat bubble), shown only before any token arrives.
                  // Once streaming starts (displayText/thinking fills in) it disappears,
                  // so it never overlaps the streaming text and never eats footer space.
                  const isThinkingBubble = isAssistant
                    && loading
                    && index === messages.length - 1
                    && !displayText
                    && !(split && split.thinking);
                  return (
                    <View style={[styles.messageRow, item.role === 'user' ? styles.rowRight : styles.rowLeft]}>
                      <View style={[
                        styles.bubble,
                        item.role === 'user' ? styles.userBubble : styles.assistantBubble,
                        { backgroundColor: item.role === 'user' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }
                      ]}>
                        {split && split.thinking ? (
                          // Reasoning ("thinking") is visually set apart from the answer: a
                          // tinted card with a coloured left accent + brain icon, collapsed by
                          // default, so the actual answer below is unmistakably the response.
                          <View style={{
                            marginBottom: 8,
                            borderRadius: 10,
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: theme.colors.tertiary,
                            borderLeftWidth: 3,
                            borderLeftColor: theme.colors.tertiary,
                            backgroundColor: (theme.colors as any).tertiaryContainer || theme.colors.surface,
                            overflow: 'hidden',
                          }}>
                            <Pressable
                              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 7 }}
                              onPress={() => setCollapsedThinking(prev => ({ ...prev, [thinkKey]: !thinkingCollapsed }))}
                              accessibilityRole="button"
                              accessibilityLabel={t('ai.reasoning', 'Tänkande')}
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                                <FontAwesome5 name="brain" size={13} color={(theme.colors as any).onTertiaryContainer || theme.colors.tertiary} />
                                <Text style={{ fontSize: 13, fontWeight: '700', color: (theme.colors as any).onTertiaryContainer || theme.colors.tertiary }}>
                                  {t('ai.reasoning', 'Tänkande')}
                                </Text>
                              </View>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={{ fontSize: 11, color: (theme.colors as any).onTertiaryContainer || theme.colors.tertiary, opacity: 0.8 }}>
                                  {thinkingCollapsed ? t('ai.showReasoning', 'Visa') : t('ai.hideReasoning', 'Dölj')}
                                </Text>
                                <FontAwesome5 name={thinkingCollapsed ? 'chevron-down' : 'chevron-up'} size={11} color={(theme.colors as any).onTertiaryContainer || theme.colors.tertiary} />
                              </View>
                            </Pressable>
                            {!thinkingCollapsed && (
                              <Text selectable style={{ paddingHorizontal: 10, paddingBottom: 8, fontSize: 12.5, lineHeight: 18, fontStyle: 'italic', color: (theme.colors as any).onTertiaryContainer || theme.colors.onSurfaceVariant }}>
                                {split.thinking}
                              </Text>
                            )}
                          </View>
                        ) : null}
                        {isThinkingBubble ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2 }}>
                            <ActivityIndicator size="small" />
                            <Text style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant, fontStyle: 'italic' }}>
                              {t('ai.thinking')}
                            </Text>
                          </View>
                        ) : null}
                        {displayText ? (
                          <Text style={{ color: item.role === 'user' ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}>
                            {displayText}
                          </Text>
                        ) : null}
                        {isThinkingBubble ? null : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                            {item.createdAt ? (
                              <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>
                                {formatTimestamp(item.createdAt)}
                              </Text>
                            ) : <View />}
                            {(item.role === 'user' || item.role === 'assistant') ? (
                              <IconButton
                                icon="content-copy"
                                size={16}
                                onPress={() => handleCopyMessage(item.content)}
                              />
                            ) : null}
                          </View>
                        )}
                      </View>
                    </View>
                  );
                }}
              />
              {/* #1: the AI-working animation now renders inside the last assistant
                  bubble (see isThinkingBubble in renderItem) — no bottom-anchored loader
                  eating space, and it hides itself the moment streaming begins. */}
              {/* Local-model load progress: shown as a chat bubble while the GGUF is being
                  read into the engine (before any assistant bubble exists), so the wait
                  before the first token is visible instead of a blank spinner. */}
              {modelLoadProgress !== null ? (
                <View style={[styles.messageRow, styles.rowLeft]}>
                  <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: theme.colors.surfaceVariant, minWidth: 200 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <ActivityIndicator size="small" />
                      <Text style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant, fontStyle: 'italic' }}>
                        {t('ai.loadingModel', 'Laddar modell')} {Math.round(modelLoadProgress * 100)}%
                      </Text>
                    </View>
                    <ProgressBar progress={modelLoadProgress} color={theme.colors.primary} style={{ height: 5, borderRadius: 3, marginTop: 6 }} />
                  </View>
                </View>
              ) : null}
              {/* The "Nästa tråd sparas endast lokalt" status used to sit here permanently;
                  it now lives in the header ℹ️ info dialog (Lagring row) so it doesn't take
                  space in local mode. The header icon (cellphone-lock) still signals it. */}
              {attachmentsEnabled && attachments.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ maxHeight: 44 }}
                  contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 6, gap: 6, flexDirection: 'row' }}
                >
                  {summarizeAttachmentsForUi(attachments).map((label, i) => (
                    <Pressable
                      key={`${label}-${i}`}
                      onPress={() => handleRemoveAttachment(i)}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surfaceVariant, borderRadius: 14, paddingLeft: 10, paddingRight: 6, paddingVertical: 4 }}
                    >
                      <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }} numberOfLines={1}>{label}</Text>
                      <Text style={{ fontSize: 14, marginLeft: 4, color: theme.colors.onSurfaceVariant }}>✕</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
              <View style={[styles.inputContainer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outline }]}>
                {attachmentsEnabled ? (
                  <IconButton icon="paperclip" onPress={handleAttach} disabled={loading} testID="ai-attach-button" />
                ) : null}
                <TextInput
                  style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outline }]}
                  placeholder={t('ai.inputPlaceholder')}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  value={input}
                  onChangeText={setInput}
                  multiline
                  textAlignVertical="top"
                  autoCorrect
                  autoCapitalize="sentences"
                  returnKeyType="send"
                  onSubmitEditing={handleSend}
                  blurOnSubmit={false}
                />
                {loading ? (
                  <IconButton
                    icon="stop"
                    onPress={handleStop}
                  />
                ) : (
                  <IconButton
                    icon="send"
                    onPress={handleSend}
                  />
                )}
              </View>
            </KeyboardAvoidingView>
        </>
      )}
    </View>
  );
}

// Screen-scoped error boundary: a render-time crash anywhere in the AI screen (model
// search, message list, settings) shows a recoverable "try again" card for THIS screen
// only — the rest of the app keeps working instead of the whole app going blank.
export default function AIScreen() {
  return (
    <CustomErrorBoundary>
      <AIScreenInner />
    </CustomErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBar: { flexDirection: 'row', justifyContent: 'space-around', padding: 8 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },
  messageRow: { marginBottom: 8, flexDirection: 'row' },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubble: { padding: 12, borderRadius: 16, maxWidth: '80%' },
  userBubble: { borderTopRightRadius: 6 },
  assistantBubble: { borderTopLeftRadius: 6 },
  inputContainer: { padding: 8, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, marginRight: 6, minHeight: 36, maxHeight: 80 },
  modelItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, marginBottom: 8 },
  sidebarOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, flexDirection: 'row' },
  sidebarBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sidebar: { width: 320, padding: 16 },
  toolCard: { borderWidth: 1, borderRadius: 12, padding: 10, maxWidth: '90%', backgroundColor: 'transparent' },
  toolHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // flex + minWidth:0 lets the title truncate inside the row instead of pushing the
  // chevron off-screen; gap keeps the icon spacing.
  toolHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, marginRight: 8 },
  toolTitle: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  // flexShrink + full-width keeps long expanded bodies wrapping inside the card.
  toolBody: { marginTop: 8, fontSize: 12, flexShrink: 1, width: '100%' }
});
