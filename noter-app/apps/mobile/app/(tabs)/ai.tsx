import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, FlatList, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable, AppState } from 'react-native';
import { Text, Button, useTheme, IconButton, List, ActivityIndicator, ProgressBar, Portal, Dialog, TextInput as PaperTextInput, Switch, Menu } from 'react-native-paper';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MobileLlamaProvider } from '@/services/ai/provider';
import { useStore } from '@/stores/useStore';
import { ChatMessage, Conversation, HFModel, AIProject } from '@repo/ai';
import { searchHuggingFaceModels, getModelFiles, getConversionHealth } from '@/services/ai/huggingface';
import { downloadModel as serviceDownloadModel, getBestQuantization, deleteModel as serviceDeleteModel, cancelDownload as cancelModelDownload, prepareModelForChat } from '@/services/ai/modelService';
import { saveConversationLocal, getConversationsLocal, deleteConversationLocal, saveMessageLocal, getMessagesLocal, getModelsLocal, saveProjectLocal, getProjectsLocal, deleteProjectLocal } from '@/services/database';
import { combineSystemPrompts, buildPromptPresetNotice, buildToolUseNotice } from '@/services/ai/prompt';
import { API_URL, fetchWithAuth } from '@/services/api';
import { buildToolSystemPrompt, extractToolCalls } from '@/services/ai/tooling';
import { shouldStopToolIteration, toToolCallKeys, toToolIterationSignature } from '@/services/ai/toolChain';
import { generateApiProviderResponse } from '@/services/ai/apiProviders';
import { pullAiSync, pushAiSync } from '@/services/ai/sync';
import { initSocket, getSocket } from '@/services/socket';
import { buildSecurityNoteMap, isReadableWithLocks } from '@/services/ai/security';
import { getLocalConversionCapabilities } from '@/services/ai/native/MLCModule';
import { isAiBackgroundWorkEnabled, setAiBackgroundWorkEnabled } from '@/services/ai/runtimeSettings';
import { getModelInstallBlocker, getLocalAiRuntimeStatus } from '@/services/ai/nativeRuntime';
import IconPickerModal from '@/components/IconPickerModal';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { AI_PROMPT_PRESETS, AiPromptPreset, AiToolAccessMode, MCP_INTEGRATIONS, McpUiSettings, buildAiSessionInsights, buildAiSyncNotice, createEmptyMcpUiSettings, decrypt, encrypt, isMutatingAiTool, normalizeMcpUiSettings, resolveMcpSettings, toEffectiveMcpUiSettings } from '@repo/shared';

const provider = new MobileLlamaProvider();
type LocalConversation = Conversation & { localOnly?: boolean };
type LocalAIProject = AIProject & { localOnly?: boolean; userId?: string };
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

export default function AIScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ openSettings?: string; settingsTab?: string }>();
  const { t } = useTranslation();
  
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'models' | 'instructions'>('models');

  // Chat
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [contextInfo, setContextInfo] = useState('');
  const stopRequestedRef = useRef(false);
  const [tokensPerSecond, setTokensPerSecond] = useState<number | null>(null);
  const [enableToolUse, setEnableToolUse] = useState(true);
  const [toolAccessMode, setToolAccessMode] = useState<AiToolAccessMode>('full');
  const [promptPreset, setPromptPreset] = useState<AiPromptPreset>('balanced');
  const [syncWithBackend, setSyncWithBackend] = useState(true);
  const [toolSettingsVisible, setToolSettingsVisible] = useState(false);
  const [userScopeKey, setUserScopeKey] = useState<string>('anon');
  const [syncPreferenceLoaded, setSyncPreferenceLoaded] = useState(false);
  const [collapsedTool, setCollapsedTool] = useState<Record<string, boolean>>({});

  // Projects
  const [projects, setProjects] = useState<LocalAIProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HFModel[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadDialogVisible, setDownloadDialogVisible] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [processingModels, setProcessingModels] = useState<Record<string, boolean>>({});
  const [downloadStage, setDownloadStage] = useState<Record<string, string>>({});
  const [preferLocalConversion, setPreferLocalConversion] = useState(false);
  const [allowBackgroundAIWork, setAllowBackgroundAIWork] = useState(false);
  const [aiUseApiProviders, setAiUseApiProviders] = useState(false);
  const [apiProvider, setApiProvider] = useState<'openrouter' | 'gemini'>('openrouter');
  const [providerMenuVisible, setProviderMenuVisible] = useState(false);
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [openRouterModel, setOpenRouterModel] = useState('openai/gpt-4o-mini');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [mcpSettings, setMcpSettings] = useState<McpUiSettings>(() => createEmptyMcpUiSettings());
  const [mcpDashboardOpen, setMcpDashboardOpen] = useState(false);
  const [mcpDashboardLoading, setMcpDashboardLoading] = useState(false);
  const [mcpDashboardError, setMcpDashboardError] = useState<string | null>(null);
  const [mcpDashboardRows, setMcpDashboardRows] = useState<any[]>([]);
  const [conversionHealthText, setConversionHealthText] = useState<string>('');
  const [conversionHealthDetailText, setConversionHealthDetailText] = useState<string>('');
  const [deviceConversionHealthText, setDeviceConversionHealthText] = useState<string>('');
  const [searchSizes, setSearchSizes] = useState<Record<string, number | null>>({});

  // History
  const [conversations, setConversations] = useState<LocalConversation[]>([]);
  const [promptPresetMenuVisible, setPromptPresetMenuVisible] = useState(false);
  const [toolAccessMenuVisible, setToolAccessMenuVisible] = useState(false);

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
    navigation.setOptions({
      headerTitle: () => (
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{t('tabs.ai')}</Text>
      ),
      headerLeft: () => (
        <IconButton
          icon="menu"
          onPress={() => setSidebarVisible(true)}
        />
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {tokensPerSecond !== null && (
            <Text style={{ marginRight: 8, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
              {tokensPerSecond.toFixed(1)} tok/s
            </Text>
          )}
          <IconButton icon="plus" onPress={createNewChat} />
          <IconButton
            icon={settingsVisible ? 'close' : 'cog'}
            onPress={() => setSettingsVisible((prev) => !prev)}
          />
        </View>
      ),
    });
  }, [navigation, theme, settingsVisible, activeModel, activeProjectId, tokensPerSecond, t]);

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
      const token = await SecureStore.getItemAsync('token');
      const scopeKey = token
        ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token)
        : 'anon';
      setUserScopeKey(scopeKey);
      const saved = await AsyncStorage.getItem(`ai_system_prompt_${scopeKey}`);
      if (saved) setSystemPrompt(decrypt(saved));
      const savedToolUse = await AsyncStorage.getItem(`ai_tool_use_enabled_${scopeKey}`);
      if (savedToolUse !== null) setEnableToolUse(savedToolUse === 'true');
      const savedToolAccessMode = await AsyncStorage.getItem(`ai_tool_access_mode_${scopeKey}`);
      if (savedToolAccessMode === 'read-only' || savedToolAccessMode === 'full') setToolAccessMode(savedToolAccessMode);
      const savedPromptPreset = await AsyncStorage.getItem(`ai_prompt_preset_${scopeKey}`);
      if (savedPromptPreset === 'balanced' || savedPromptPreset === 'research' || savedPromptPreset === 'execution' || savedPromptPreset === 'concise') {
        setPromptPreset(savedPromptPreset);
      }
      const savedSyncEnabled = await AsyncStorage.getItem(`ai_sync_enabled_${scopeKey}`);
      const resolvedSyncEnabled = savedSyncEnabled !== null ? savedSyncEnabled === 'true' : true;
      setSyncWithBackend(resolvedSyncEnabled);
      const savedLocalConvert = await AsyncStorage.getItem(`ai_local_convert_${scopeKey}`);
      if (savedLocalConvert !== null) setPreferLocalConversion(savedLocalConvert === 'true');
      const savedBackgroundWork = await AsyncStorage.getItem(`ai_background_work_${scopeKey}`);
      if (savedBackgroundWork !== null) {
        setAllowBackgroundAIWork(savedBackgroundWork === 'true');
        await setAiBackgroundWorkEnabled(savedBackgroundWork === 'true');
      } else {
        const globalSetting = await isAiBackgroundWorkEnabled();
        setAllowBackgroundAIWork(globalSetting);
      }
      await refreshRemoteSync(scopeKey, resolvedSyncEnabled);
      const savedApiEnabled = await AsyncStorage.getItem(`ai_api_enabled_${scopeKey}`);
      if (savedApiEnabled !== null) setAiUseApiProviders(savedApiEnabled === 'true');
      const savedApiProvider = await AsyncStorage.getItem(`ai_api_provider_${scopeKey}`);
      if (savedApiProvider === 'openrouter' || savedApiProvider === 'gemini') setApiProvider(savedApiProvider);
      const savedOpenRouterModel = await AsyncStorage.getItem(`ai_openrouter_model_${scopeKey}`);
      if (savedOpenRouterModel) setOpenRouterModel(savedOpenRouterModel);
      const savedGeminiModel = await AsyncStorage.getItem(`ai_gemini_model_${scopeKey}`);
      if (savedGeminiModel) setGeminiModel(savedGeminiModel);
      const openRouterKeyEnc = await SecureStore.getItemAsync(`ai_openrouter_key_${scopeKey}`);
      if (openRouterKeyEnc) setOpenRouterApiKey(decrypt(openRouterKeyEnc) || '');
      const geminiKeyEnc = await SecureStore.getItemAsync(`ai_gemini_key_${scopeKey}`);
      if (geminiKeyEnc) setGeminiApiKey(decrypt(geminiKeyEnc) || '');
      const mcpSettingsRaw = await SecureStore.getItemAsync(`ai_mcp_settings_${scopeKey}`);
      let parsedMcpSettings = createEmptyMcpUiSettings();
      if (mcpSettingsRaw) {
        try {
          parsedMcpSettings = normalizeMcpUiSettings(JSON.parse(decrypt(mcpSettingsRaw) || mcpSettingsRaw || '{}'));
        } catch {}
      }
      const resolvedMcpSettings = resolveMcpSettings(parsedMcpSettings, getMcpEnvValues());
      setMcpSettings(toEffectiveMcpUiSettings(resolvedMcpSettings));
      setSyncPreferenceLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_tool_use_enabled_${userScopeKey}`, enableToolUse ? 'true' : 'false');
  }, [enableToolUse, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_tool_access_mode_${userScopeKey}`, toolAccessMode);
  }, [toolAccessMode, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_prompt_preset_${userScopeKey}`, promptPreset);
  }, [promptPreset, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_sync_enabled_${userScopeKey}`, syncWithBackend ? 'true' : 'false');
  }, [syncWithBackend, userScopeKey]);

  useEffect(() => {
    if (!syncPreferenceLoaded) return;
    refreshRemoteSync(userScopeKey || undefined, syncWithBackend).catch(() => {});
  }, [syncPreferenceLoaded, syncWithBackend, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_local_convert_${userScopeKey}`, preferLocalConversion ? 'true' : 'false');
  }, [preferLocalConversion, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_background_work_${userScopeKey}`, allowBackgroundAIWork ? 'true' : 'false');
    setAiBackgroundWorkEnabled(allowBackgroundAIWork).catch(() => {});
  }, [allowBackgroundAIWork, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_api_enabled_${userScopeKey}`, aiUseApiProviders ? 'true' : 'false');
  }, [aiUseApiProviders, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_api_provider_${userScopeKey}`, apiProvider);
  }, [apiProvider, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_openrouter_model_${userScopeKey}`, openRouterModel);
  }, [openRouterModel, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_gemini_model_${userScopeKey}`, geminiModel);
  }, [geminiModel, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    SecureStore.setItemAsync(`ai_openrouter_key_${userScopeKey}`, openRouterApiKey ? encrypt(openRouterApiKey) : '');
  }, [openRouterApiKey, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    SecureStore.setItemAsync(`ai_gemini_key_${userScopeKey}`, geminiApiKey ? encrypt(geminiApiKey) : '');
  }, [geminiApiKey, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
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

  useEffect(() => {
    if (!syncPreferenceLoaded || !syncWithBackend) {
      return;
    }
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
  }, [syncPreferenceLoaded, syncWithBackend, userScopeKey]);

  const refreshConversionHealth = async () => {
      try {
          const health = await getConversionHealth();
          const details = [health.resolvedCommand ? `MLC: ${health.resolvedCommand}` : '', health.installHint || ''].filter(Boolean).join(' · ');
          setConversionHealthDetailText(details);
          if (health.mode === 'external') {
              setConversionHealthText(t('ai.conversionHealthExternal'));
              return;
          }
          if (health.localBinaryAvailable && health.storageWritable) {
              setConversionHealthText(t('ai.conversionHealthLocalOk'));
              return;
          }
          if (!health.localBinaryAvailable) {
              setConversionHealthText(t('ai.conversionHealthLocalMissing'));
              return;
          }
          if (!health.storageWritable) {
              setConversionHealthText(t('ai.conversionHealthStorageMissing'));
              return;
          }
          setConversionHealthText('');
      } catch {
          setConversionHealthText(t('ai.conversionHealthUnknown'));
          setConversionHealthDetailText('');
      }
      try {
          const deviceCaps = await getLocalConversionCapabilities();
          if (deviceCaps.engineAvailable && deviceCaps.converterAvailable) {
              setDeviceConversionHealthText(t('ai.conversionHealthDeviceReady'));
          } else {
              setDeviceConversionHealthText(t('ai.conversionHealthDeviceMissing'));
          }
      } catch {
          setDeviceConversionHealthText(t('ai.conversionHealthDeviceUnknown'));
      }
  };

  useEffect(() => {
      refreshConversionHealth().catch(() => {});
  }, []);

  const loadModels = async () => {
      const models = await getModelsLocal();
      const normalizedModels = await Promise.all(models.map(async (model) => {
          try {
              const resolvedPath = await prepareModelForChat(model.path);
              return resolvedPath === model.path ? model : { ...model, path: resolvedPath };
          } catch {
              return model;
          }
      }));
      setLocalModels(normalizedModels);
      if (normalizedModels.length > 0 && !activeModel) {
          setActiveModel(normalizedModels[0].path);
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
          if (items.length > 0 && !activeProjectId) {
              setActiveProjectId(items[0].id);
          }
      } catch {}
  };

  const refreshRemoteSync = async (scopeKey?: string, allowRemote = syncWithBackend) => {
      const localConvs = await getConversationsLocal();
      setConversations(localConvs);
      const localProjects = await getProjectsLocal(scopeKey);
      setProjects(localProjects);
      if (!allowRemote) {
          return;
      }
      try {
          const remote = await pullAiSync();
          await mergeRemoteSync(remote, scopeKey);
      } catch {}
  };

  const syncConversationPayload = async (payload: Parameters<typeof pushAiSync>[0]) => {
      if (!syncWithBackend) {
          return;
      }
      await pushAiSync(payload);
  };

  const loadProjects = async (scopeKey?: string) => {
      let items = await getProjectsLocal(scopeKey);
      setProjects(items);
      if (items.length > 0 && !activeProjectId) {
          setActiveProjectId(items[0].id);
      }
  };

  const isConversationLocalOnly = (conversationId: string) =>
      Boolean(conversations.find((item) => item.id === conversationId)?.localOnly);
  const activeModelLabel = aiUseApiProviders
      ? (apiProvider === 'openrouter' ? openRouterModel : geminiModel)
      : (activeModel || '');
  const enabledMcpServices = useMemo(
      () => (Object.keys(mcpSettings) as Array<keyof McpUiSettings>).filter((key) => Boolean(mcpSettings[key]?.enabled)) as string[],
      [mcpSettings]
  );
  const sessionInsights = useMemo(
      () =>
          buildAiSessionInsights({
              providerLabel: aiUseApiProviders ? (apiProvider === 'gemini' ? 'Gemini' : 'OpenRouter') : 'Lokal modell',
              modelLabel: activeModelLabel || t('ai.noModelSelected'),
              syncEnabled: syncWithBackend,
              toolUseEnabled: enableToolUse,
              toolAccessMode,
              promptPreset,
              enabledMcpServices,
          }),
      [activeModelLabel, aiUseApiProviders, apiProvider, enableToolUse, enabledMcpServices, promptPreset, syncWithBackend, t, toolAccessMode]
  );

  const formatError = (error: unknown) => {
      const message = (error as any)?.message ? String((error as any).message) : String(error);
      if (message.includes('Zip module not available')) return 'Zip-stöd saknas i denna build. Installera om den senaste EAS APK:n.';
      if (message.includes('Native filesystem not available')) return 'Filsystem saknas i denna build. Installera om den senaste EAS APK:n.';
      if (message.includes('MLCModule')) return 'MLC‑modulen saknas i denna build. Installera om den senaste EAS APK:n.';
      if (message.includes('Local conversion unsupported')) return 'Lokal konvertering stöds inte i denna build. Server-fallback används.';
      if (message.includes('Failed to download GGUF')) return 'Kunde inte ladda ner GGUF-filen för lokal konvertering.';
      if (message.includes('Invalid model package')) return 'Modellpaketet är ogiltigt eller saknar filer.';
      if (message.includes('Model path not found')) return 'Den nedladdade modellen kunde inte hittas längre. Ladda ner eller välj modellen igen.';
      if (message.includes('Conversion failed')) return 'Konvertering misslyckades på servern.';
      if (message.includes('MLC-binären hittades inte')) return message;
      if (message.includes('job not found')) return 'Konverteringsjobb saknas eller har löpt ut.';
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
          local_conversion_requested: t('ai.downloadStageLocalRequested'),
          local_conversion_unavailable: t('ai.downloadStageLocalUnavailable'),
          local_conversion_failed: t('ai.downloadStageLocalFailed'),
          downloading_gguf: t('ai.downloadStageDownloadingGguf'),
          converting_locally: t('ai.downloadStageConvertingLocally'),
          checking_compiled: t('ai.downloadStageCheckingCompiled'),
          converting_server: t('ai.downloadStageConvertingServer'),
          downloading_compiled: t('ai.downloadStageDownloadingCompiled'),
          downloading: t('ai.downloadStageDownloadingGguf'),
          converting: t('ai.downloadStageConvertingServer'),
          zipping: t('ai.downloadStagePacking'),
          validating: t('ai.downloadStageFinalizing'),
          completed: t('ai.downloadStageCompleted'),
          finalizing: t('ai.downloadStageFinalizing'),
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

  const executeToolCall = async (tool: string, args: Record<string, any>, intentText: string) => {
      if (enableToolUse && toolAccessMode === 'read-only' && isMutatingAiTool(tool)) {
          throw new Error(t('ai.toolWriteBlocked'));
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
              if (args.parentNoteId) {
                  const { ensureReadableNote } = getAISecurityContext();
                  ensureReadableNote(String(args.parentNoteId));
              }
              const query = `mutation($input:TaskInput!){createTask(input:$input){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
              return graphQLRequest(query, { input: withDefaultReminderForDueDate(withNormalizedDueDate(withDefaultPriority(args))) });
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
      if (!enableToolUse) return [];
      const { calls, cleaned } = extractToolCalls(assistantText);
      const newMessages: ChatMessage[] = [];
      if (cleaned !== assistantText) {
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: cleaned } : m));
          const cleanedMsg = { id: assistantId, role: 'assistant', content: cleaned, createdAt: new Date().toISOString() } as ChatMessage;
          await saveMessageLocal(conversationId, cleanedMsg);
          refreshConversationActivity(conversationId, cleanedMsg.createdAt);
          if (!isConversationLocalOnly(conversationId)) {
              syncConversationPayload({ messages: [{ conversationId, message: cleanedMsg }] }).catch(() => {});
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
          refreshConversationActivity(conversationId, toolMsg.createdAt);
          if (!isConversationLocalOnly(conversationId)) {
              syncConversationPayload({ messages: [{ conversationId, message: toolMsg }] }).catch(() => {});
          }
          newMessages.push(toolMsg);
          if (toolMsg.id) setCollapsedTool(prev => ({ ...prev, [toolMsg.id as string]: true }));
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
              const entitiesRead = buildToolReadTrace(call.tool, result);
              const resultMsg: ChatMessage = { id: uuidv4(), role: 'tool', content: `Tool result: ${call.tool} ${safePreview({ entitiesRead, result })}`, createdAt: new Date().toISOString() };
              setMessages(prev => [...prev, resultMsg]);
              await saveMessageLocal(conversationId, resultMsg);
              refreshConversationActivity(conversationId, resultMsg.createdAt);
              if (!isConversationLocalOnly(conversationId)) {
                  syncConversationPayload({ messages: [{ conversationId, message: resultMsg }] }).catch(() => {});
              }
              newMessages.push(resultMsg);
              if (resultMsg.id) setCollapsedTool(prev => ({ ...prev, [resultMsg.id as string]: true }));
          } catch (e: any) {
              const errorText = e?.message || 'Unknown error';
              const errMsg: ChatMessage = { id: uuidv4(), role: 'tool', content: `Tool error: ${call.tool} ${errorText}`, createdAt: new Date().toISOString() };
              setMessages(prev => [...prev, errMsg]);
              await saveMessageLocal(conversationId, errMsg);
              refreshConversationActivity(conversationId, errMsg.createdAt);
              if (!isConversationLocalOnly(conversationId)) {
                  syncConversationPayload({ messages: [{ conversationId, message: errMsg }] }).catch(() => {});
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

  const runAIGeneration = async (conversationId: string, initialHistory: ChatMessage[]) => {
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
                  const requestResponse = async () => generateApiProviderResponse({
                      provider: apiProvider,
                      apiKey: apiProvider === 'openrouter' ? openRouterApiKey : geminiApiKey,
                      model: apiProvider === 'openrouter' ? openRouterModel : geminiModel,
                      history: currentHistory,
                  });
                  let response = '';
                  try {
                      response = await requestResponse();
                  } catch (firstApiError: any) {
                      generationError = firstApiError;
                      await new Promise((resolve) => setTimeout(resolve, 400));
                      response = await requestResponse();
                      generationError = null;
                  }
                  const chunks = response.split(/(\s+)/).filter(Boolean);
                  for (const chunk of chunks) {
                      if (stopRequestedRef.current) break;
                      fullContent += chunk;
                      tokenCount += 1;
                      if (Date.now() - lastUpdate > 300) {
                          updateTps();
                          lastUpdate = Date.now();
                      }
                      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
                  }
                  if (!chunks.length) {
                      fullContent = response;
                      tokenCount = Math.max(tokenCount, 1);
                      updateTps();
                      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
                  }
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

          const extractedBeforeTools = extractToolCalls(fullContent);
          if (!enableToolUse && extractedBeforeTools.cleaned !== fullContent) {
              fullContent = extractedBeforeTools.cleaned;
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
          }

          updateTps();
          const savedMsg: ChatMessage = { ...assistantMsg, content: (fullContent || '').toString() };
          await saveMessageLocal(conversationId, savedMsg);
          refreshConversationActivity(conversationId, savedMsg.createdAt);
          if (!isConversationLocalOnly(conversationId)) {
              syncConversationPayload({ messages: [{ conversationId, message: savedMsg }] }).catch(() => {});
          }

          const newToolMessages = await processToolCalls(conversationId, assistantId, fullContent, intentText);
          if (newToolMessages.length === 0) break;
          const extracted = extractToolCalls(fullContent);
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
      const toolPrompt = enableToolUse ? buildToolSystemPrompt(API_URL.replace(/\/+$/, ''), getEnabledMcpServices()) : '';
      const toolUseNotice = buildToolUseNotice(enableToolUse, toolAccessMode);
      const syncNotice = buildAiSyncNotice(syncWithBackend);
      const presetNotice = buildPromptPresetNotice(promptPreset);
      const combinedPrompt = combineSystemPrompts([presetNotice, systemPrompt, syncNotice, toolUseNotice, toolPrompt].filter(Boolean).join('\n\n'), projectPrompt);
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

  const refreshConversationActivity = (conversationId: string, updatedAt?: string) => {
      const nextUpdatedAt = updatedAt || new Date().toISOString();
      setConversations(prev =>
          [...prev]
              .map((conversation) => conversation.id === conversationId ? { ...conversation, updatedAt: nextUpdatedAt } : conversation)
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      );
  };

  const createNewChat = async () => {
      const newId = uuidv4();
      const newConv: LocalConversation = {
          id: newId,
          title: 'New Chat',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
          model: activeModelLabel || undefined,
          projectId: activeProjectId || undefined,
          localOnly: !syncWithBackend,
      };
      await saveConversationLocal(newConv);
      if (!newConv.localOnly) {
          syncConversationPayload({ conversations: [newConv] }).catch(() => {});
      }
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversationId(newId);
      setMessages([]);
  };

  const loadChat = async (id: string) => {
      const msgs = await getMessagesLocal(id);
      setMessages(msgs);
      setCurrentConversationId(id);
      const conv = conversations.find(c => c.id === id);
      if (conv?.projectId) {
        setActiveProjectId(conv.projectId || null);
      } else {
        setActiveProjectId(null);
      }
  };

  const deleteChat = async (id: string) => {
      await deleteConversationLocal(id);
      syncConversationPayload({ deletedConversationIds: [id] }).catch(() => {});
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
      setProjectDialogLocalOnly(!syncWithBackend);
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
          syncConversationPayload({ projects: [project] }).catch(() => {});
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
      if (updated.localOnly) syncConversationPayload({ deletedProjectIds: [updated.id] }).catch(() => {});
      else syncConversationPayload({ projects: [updated] }).catch(() => {});
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
          syncConversationPayload({ deletedConversationIds: [updated.id] }).catch(() => {});
      } else {
          syncConversationPayload({ conversations: [updated] }).catch(() => {});
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
      setActiveProjectId(projectId);
  };

  const handleDeleteProject = async (projectId: string) => {
      await deleteProjectLocal(projectId);
      syncConversationPayload({ deletedProjectIds: [projectId] }).catch(() => {});
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

  const downloadModel = async (model: HFModel) => {
      try {
        const blocker = getModelInstallBlocker();
        if (blocker) {
            alert(blocker);
            return;
        }
        setProcessingModels(prev => ({ ...prev, [model.id]: true }));
        setDownloadProgress(prev => ({ ...prev, [model.id]: 0 }));
        setDownloadStage(prev => ({ ...prev, [model.id]: 'queued' }));
        
        // Use mobile-specific getModelFiles
        const files = await getModelFiles(model.id);
        const file = getBestQuantization(files);
        
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

        const installedPath = await serviceDownloadModel(model, file, (percent) => {
            setDownloadProgress(prev => ({ ...prev, [model.id]: percent }));
        }, {
            preferLocalConversion,
            onStageChange: (stage) => setDownloadStage(prev => ({ ...prev, [model.id]: stage }))
        });

        await loadModels();
        const preparedPath = await prepareModelForChat(installedPath);
        setActiveModel(preparedPath);
        alert(`Modellen ${model.name} installerades, aktiverades och är redo för chatt.`);
        
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

  const runDeviceLocalConversionCheck = async (model: HFModel) => {
      let localStageObserved = false;
      try {
        const runtime = getLocalAiRuntimeStatus();
        if (!runtime.mlcModuleAvailable) {
          throw new Error('MLCModule not linked');
        }
        setProcessingModels(prev => ({ ...prev, [model.id]: true }));
        setDownloadProgress(prev => ({ ...prev, [model.id]: 0 }));
        setDownloadStage(prev => ({ ...prev, [model.id]: 'queued' }));
        const files = await getModelFiles(model.id);
        const file = getBestQuantization(files);
        if (!file) {
            throw new Error('No suitable GGUF file found for this model');
        }
        await serviceDownloadModel(model, file, (percent) => {
            setDownloadProgress(prev => ({ ...prev, [model.id]: percent }));
        }, {
            preferLocalConversion: true,
            strictLocalConversion: true,
            onStageChange: (stage) => {
              if (stage === 'converting_locally') localStageObserved = true;
              setDownloadStage(prev => ({ ...prev, [model.id]: stage }));
            }
        });
        await loadModels();
        if (!localStageObserved) {
            throw new Error('Local conversion unsupported');
        }
        alert(t('ai.deviceE2ESuccess'));
      } catch (e) {
        alert(`${t('ai.deviceE2EFailed')}: ${formatError(e)}`);
      } finally {
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

  const handleActivateModel = async (path: string) => {
      try {
          const preparedPath = await prepareModelForChat(path);
          setActiveModel(preparedPath);
      } catch (error) {
          alert(formatError(error));
      }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    if (!aiUseApiProviders && !activeModel) {
        alert('Please select a model first');
        setSettingsTab('models');
        setSettingsVisible(true);
        return;
    }
    if (aiUseApiProviders && apiProvider === 'openrouter' && (!openRouterApiKey || !openRouterModel)) {
        alert('Ange OpenRouter API-nyckel och modell först');
        setSettingsVisible(true);
        return;
    }
    if (aiUseApiProviders && apiProvider === 'gemini' && (!geminiApiKey || !geminiModel)) {
        alert('Ange Gemini API-nyckel och modell först');
        setSettingsVisible(true);
        return;
    }

    let conversationId = currentConversationId;
    if (!conversationId) {
        const newId = uuidv4();
        const newConv: LocalConversation = {
            id: newId,
            title: input.substring(0, 30) + '...',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
            model: activeModelLabel,
            projectId: activeProjectId || undefined,
            localOnly: !syncWithBackend,
        };
        await saveConversationLocal(newConv);
        if (!newConv.localOnly) {
            syncConversationPayload({ conversations: [newConv] }).catch(() => {});
        }
        setConversations(prev => [newConv, ...prev]);
        setCurrentConversationId(newId);
        conversationId = newId;
    }
    if (!conversationId) return;
    
    const userMsg: ChatMessage = { 
        id: uuidv4(),
        role: 'user', 
        content: input,
        createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setTokensPerSecond(null);
    stopRequestedRef.current = false;

    try {
      await saveMessageLocal(conversationId, userMsg);
      refreshConversationActivity(conversationId, userMsg.createdAt);
      if (!isConversationLocalOnly(conversationId)) {
          syncConversationPayload({ messages: [{ conversationId, message: userMsg }] }).catch(() => {});
      }
      if (!aiUseApiProviders) {
          const blocker = getModelInstallBlocker();
          if (blocker) {
              throw new Error(blocker);
          }
          const preparedPath = await prepareModelForChat(activeModel as string);
          if (preparedPath !== activeModel) {
              setActiveModel(preparedPath);
          }
          await provider.loadModel(preparedPath);
      }
      await runAIGeneration(conversationId, buildHistory(userMsg));
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: `${t('ai.errorPrefix')}${formatError(error)}`, createdAt: new Date().toISOString() }]);
    } finally {
      setLoading(false);
      setTokensPerSecond(null);
    }
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
                left={() => <List.Icon icon="folder" />}
                right={() => activeProjectId ? null : <List.Icon icon="check" />}
              />
              {projects.map((project) => (
                <List.Item
                  key={project.id}
                  title={project.name}
                  onPress={() => handleSelectProject(project.id)}
                  onLongPress={() => openProjectDialog(project)}
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
          <Dialog.Title>{t('projects.deleteConfirmTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text>{t('projects.deleteConfirmMessage')}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmProjectDeleteId(null)}>{t('common.cancel')}</Button>
            <Button mode="contained" onPress={confirmDeleteProject}>{t('common.delete')}</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!confirmChatDeleteId} onDismiss={() => setConfirmChatDeleteId(null)}>
          <Dialog.Title>{t('ai.deleteChatTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text>{t('ai.deleteChatConfirm')}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmChatDeleteId(null)}>{t('common.cancel')}</Button>
            <Button mode="contained" onPress={confirmDeleteChat}>{t('common.delete')}</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={toolSettingsVisible} onDismiss={() => setToolSettingsVisible(false)}>
          <Dialog.Title>{t('ai.toolUseTitle')}</Dialog.Title>
          <Dialog.Content>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text>{t('ai.toolUseLabel')}</Text>
              <Switch value={enableToolUse} onValueChange={setEnableToolUse} />
            </View>
            <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant }}>
              {t('ai.toolUseHint')}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setToolSettingsVisible(false)}>{t('common.close')}</Button>
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
              {t('ai.models')}
            </Button>
            <Button mode={settingsTab === 'instructions' ? 'contained' : 'text'} onPress={() => setSettingsTab('instructions')} testID="ai-settings-tab-instructions">
              {t('ai.instructions')}
            </Button>
          </View>

          {settingsTab === 'models' && (
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: theme.colors.onSurface }}>{t('ai.useApiProviders')}</Text>
                <Switch value={aiUseApiProviders} onValueChange={setAiUseApiProviders} />
              </View>
              <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                {t('ai.useApiProvidersHint')}
              </Text>
              {aiUseApiProviders ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: theme.colors.onSurface, marginBottom: 6 }}>{t('ai.apiProvider')}</Text>
                  <Menu
                    visible={providerMenuVisible}
                    onDismiss={() => setProviderMenuVisible(false)}
                    anchor={
                      <Button mode="outlined" onPress={() => setProviderMenuVisible(true)} testID="ai-provider-dropdown-button">
                        {apiProvider === 'gemini' ? 'Gemini' : 'OpenRouter'}
                      </Button>
                    }
                  >
                    <Menu.Item onPress={() => { setApiProvider('openrouter'); setProviderMenuVisible(false); }} title="OpenRouter" />
                    <Menu.Item onPress={() => { setApiProvider('gemini'); setProviderMenuVisible(false); }} title="Gemini" />
                  </Menu>
                  {apiProvider === 'openrouter' ? (
                    <>
                      <PaperTextInput
                        mode="outlined"
                        label={t('ai.openRouterApiKey')}
                        value={openRouterApiKey}
                        onChangeText={setOpenRouterApiKey}
                        autoCorrect={false}
                        style={{ marginTop: 8 }}
                      />
                      <PaperTextInput
                        mode="outlined"
                        label={t('ai.openRouterModel')}
                        value={openRouterModel}
                        onChangeText={setOpenRouterModel}
                        autoCorrect={false}
                        style={{ marginTop: 8 }}
                      />
                    </>
                  ) : (
                    <>
                      <PaperTextInput
                        mode="outlined"
                        label={t('ai.geminiApiKey')}
                        value={geminiApiKey}
                        onChangeText={setGeminiApiKey}
                        autoCorrect={false}
                        style={{ marginTop: 8 }}
                      />
                      <PaperTextInput
                        mode="outlined"
                        label={t('ai.geminiModel')}
                        value={geminiModel}
                        onChangeText={setGeminiModel}
                        autoCorrect={false}
                        style={{ marginTop: 8 }}
                      />
                    </>
                  )}
                </View>
              ) : (
                <View style={{ marginTop: 12, flex: 1 }}>
                  <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>{t('ai.downloadedModels')}</Text>
                  {localModels.length === 0 ? (
                    <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>{t('ai.noModels')}</Text>
                  ) : (
                    <FlatList
                      data={localModels}
                      keyExtractor={(item) => item.id}
                      renderItem={({ item: m }) => (
                        <View style={[styles.modelItem, { borderColor: theme.colors.outline }]}>
                          <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>{m.name}</Text>
                            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurfaceVariant }}>{(m.size / 1024 / 1024).toFixed(1)} MB</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Button
                              mode={activeModel === m.path ? 'contained' : 'outlined'}
                              onPress={() => handleActivateModel(m.path)}
                              style={{ marginRight: 8 }}
                            >
                              {activeModel === m.path ? t('ai.active') : t('ai.select')}
                            </Button>
                            <IconButton icon="delete" onPress={() => handleDeleteModel(m.id, m.path)} />
                          </View>
                        </View>
                      )}
                    />
                  )}
                </View>
              )}
              <View style={{ marginTop: 12 }}>
                <Button mode="contained" onPress={() => setDownloadDialogVisible(true)} testID="ai-open-download-models-dialog">
                  {t('ai.downloadNewModels')}
                </Button>
                <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                  {t('ai.downloadBackgroundHint')}
                </Text>
              </View>
            </View>
          )}
          {settingsTab === 'instructions' && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
              <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>{t('ai.instructions')}</Text>
              <TextInput
                style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outline, borderWidth: 1, borderRadius: 8, padding: 8, height: 160, textAlignVertical: 'top' }]}
                placeholder={t('ai.systemPromptPlaceholder')}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                value={systemPrompt}
                onChangeText={setSystemPrompt}
                multiline
              />
              <View style={{ marginTop: 14, padding: 12, borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 10 }}>
                <Text variant="titleSmall" style={{ color: theme.colors.onSurface, marginBottom: 6 }}>{t('ai.sessionInsights')}</Text>
                <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 10 }}>
                  {t('ai.localEncryptionHint')}
                </Text>
                {sessionInsights.map((item) => (
                  <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: 12 }}>
                    <Text style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}>{item.label}</Text>
                    <Text style={{ color: theme.colors.onSurface, flex: 1, textAlign: 'right' }}>{item.value}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <Text style={{ color: theme.colors.onSurface }}>{t('ai.syncWithBackendLabel')}</Text>
                <Switch value={syncWithBackend} onValueChange={setSyncWithBackend} />
              </View>
              <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                {syncWithBackend ? t('ai.syncWithBackendEnabledHint') : t('ai.syncWithBackendDisabledHint')}
              </Text>
              <Text style={{ color: theme.colors.onSurface, marginTop: 12, marginBottom: 6 }}>{t('ai.promptPresetLabel')}</Text>
              <Menu
                visible={promptPresetMenuVisible}
                onDismiss={() => setPromptPresetMenuVisible(false)}
                anchor={
                  <Button mode="outlined" onPress={() => setPromptPresetMenuVisible(true)} testID="ai-prompt-preset-button">
                    {t(`ai.promptPreset.${promptPreset}`)}
                  </Button>
                }
              >
                {AI_PROMPT_PRESETS.map((preset) => (
                  <Menu.Item
                    key={preset.id}
                    onPress={() => {
                      setPromptPreset(preset.id);
                      setPromptPresetMenuVisible(false);
                    }}
                    title={t(`ai.promptPreset.${preset.id}`)}
                  />
                ))}
              </Menu>
              <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                {t('ai.promptPresetHint')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <Text style={{ color: theme.colors.onSurface }}>{t('ai.toolUseLabel')}</Text>
                <Switch value={enableToolUse} onValueChange={setEnableToolUse} />
              </View>
              <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                {t('ai.toolUseHint')}
              </Text>
              <Text style={{ color: theme.colors.onSurface, marginTop: 12, marginBottom: 6 }}>{t('ai.toolAccessModeLabel')}</Text>
              <Menu
                visible={toolAccessMenuVisible}
                onDismiss={() => setToolAccessMenuVisible(false)}
                anchor={
                  <Button mode="outlined" onPress={() => setToolAccessMenuVisible(true)} testID="ai-tool-access-mode-button">
                    {toolAccessMode === 'read-only' ? t('ai.toolAccessModeReadOnly') : t('ai.toolAccessModeFull')}
                  </Button>
                }
              >
                <Menu.Item onPress={() => { setToolAccessMode('read-only'); setToolAccessMenuVisible(false); }} title={t('ai.toolAccessModeReadOnly')} />
                <Menu.Item onPress={() => { setToolAccessMode('full'); setToolAccessMenuVisible(false); }} title={t('ai.toolAccessModeFull')} />
              </Menu>
              <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                {toolAccessMode === 'read-only' ? t('ai.toolAccessModeReadOnlyHint') : t('ai.toolAccessModeFullHint')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <Text style={{ color: theme.colors.onSurface }}>{t('ai.localConversionLabel')}</Text>
                <Switch value={preferLocalConversion} onValueChange={setPreferLocalConversion} />
              </View>
              <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                {t('ai.localConversionHint')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <Text style={{ color: theme.colors.onSurface }}>{t('ai.backgroundWorkLabel')}</Text>
                <Switch value={allowBackgroundAIWork} onValueChange={setAllowBackgroundAIWork} />
              </View>
              <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                {t('ai.backgroundWorkHint')}
              </Text>
              {conversionHealthText ? (
                <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                  {conversionHealthText}
                </Text>
              ) : null}
              {conversionHealthDetailText ? (
                <Text style={{ marginTop: 4, color: theme.colors.onSurfaceVariant }}>
                  {conversionHealthDetailText}
                </Text>
              ) : null}
              {deviceConversionHealthText ? (
                <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                  {deviceConversionHealthText}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', marginTop: 10 }}>
                <Button mode="outlined" onPress={refreshConversionHealth}>
                  {t('ai.checkConversionHealth')}
                </Button>
              </View>
              <View style={{ marginTop: 14, padding: 12, borderWidth: 1, borderColor: theme.colors.outline, borderRadius: 10 }}>
                <Text variant="titleSmall" style={{ color: theme.colors.onSurface, marginBottom: 6 }}>{t('ai.mcpIntegrations')}</Text>
                <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 10 }}>
                  {t('ai.mcpIntegrationsHint')}
                </Text>
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
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurface }}>{t('ai.mcpSecurityDashboard')}</Text>
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
                    {mcpDashboardOpen ? t('common.hide') : t('common.show')}
                  </Button>
                </View>
                <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                  Visar endast aktuell användares auditmetadata från backend.
                </Text>
                {mcpDashboardOpen ? (
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <Button mode="text" onPress={loadMcpDashboard} testID="mcp-dashboard-refresh-mobile">
                        {t('common.retry')}
                      </Button>
                      {mcpDashboardLoading ? <ActivityIndicator size="small" style={{ marginLeft: 8 }} /> : null}
                    </View>
                    {mcpDashboardError ? (
                      <Text style={{ color: theme.colors.error, marginBottom: 8 }}>{mcpDashboardError}</Text>
                    ) : null}
                    <View style={{ maxHeight: 180 }}>
                      <ScrollView testID="mcp-dashboard-list-mobile">
                        {mcpDashboardRows.length === 0 ? (
                          <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('ai.noTrackingFound')}</Text>
                        ) : (
                          mcpDashboardRows.map((row: any, index: number) => (
                            <View key={`${row.at || index}-${row.service || ''}`} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.outlineVariant }}>
                              <Text style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                                {row.service || '-'} · {row.action || '-'} · {row.ok ? t('common.ok') : t('common.off')}
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
                  {t('common.save')}
                </Button>
                <Button
                  mode="outlined"
                  onPress={async () => {
                    setSystemPrompt('');
                    if (!userScopeKey) return;
                    await AsyncStorage.removeItem(`ai_system_prompt_${userScopeKey}`);
                  }}
                >
                  {t('tasks.filter.clear')}
                </Button>
              </View>
            </ScrollView>
          )}
          <Dialog visible={downloadDialogVisible} onDismiss={() => setDownloadDialogVisible(false)}>
            <Dialog.Title>{t('ai.downloadFromHf')}</Dialog.Title>
            <Dialog.Content>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                <TextInput
                  style={[styles.input, { flex: 1, color: theme.colors.onSurface, borderColor: theme.colors.outline, borderWidth: 1, borderRadius: 4, padding: 8 }]}
                  placeholder={t('ai.searchPlaceholder')}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  returnKeyType="search"
                  onSubmitEditing={handleSearch}
                />
                <Button mode="contained" onPress={handleSearch} loading={isSearching}>{t('common.search', 'Search')}</Button>
              </View>
              <ScrollView style={{ maxHeight: 340 }}>
                <View style={{ gap: 10 }}>
                  {searchResults.map((item) => (
                    <View key={item.id} style={[styles.modelItem, { borderColor: theme.colors.outline }]}>
                      <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                        <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>{item.name}</Text>
                        <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurfaceVariant }}>{item.author}</Text>
                        <Text style={{ color: theme.colors.onSurfaceVariant }}>
                          {formatSearchSize(searchSizes[item.id])}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        {processingModels[item.id] ? (
                          <Button mode="outlined" onPress={() => handleCancelDownload(item.id)}>
                            {t('common.cancel')}
                          </Button>
                        ) : (
                          <Button
                            mode="contained-tonal"
                            onPress={() => downloadModel(item)}
                            disabled={!!processingModels[item.id]}
                          >
                            {t('ai.download')}
                          </Button>
                        )}
                        <Button
                          mode="text"
                          onPress={() => runDeviceLocalConversionCheck(item)}
                          disabled={!!processingModels[item.id]}
                          compact
                        >
                          {t('ai.deviceE2ECheck')}
                        </Button>
                        {typeof downloadProgress[item.id] === 'number' && (
                          <View style={{ width: 120, marginTop: 6 }}>
                            <ProgressBar progress={downloadProgress[item.id]} />
                            <Text style={{ fontSize: 11, marginTop: 4, color: theme.colors.onSurfaceVariant }}>
                              {(downloadProgress[item.id] * 100).toFixed(0)}%
                            </Text>
                            <Text style={{ fontSize: 10, marginTop: 2, color: theme.colors.onSurfaceVariant }}>
                              {formatDownloadStage(downloadStage[item.id])}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setDownloadDialogVisible(false)}>{t('common.close')}</Button>
            </Dialog.Actions>
          </Dialog>
        </View>
      ) : (
        <>
            <KeyboardAvoidingView 
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              style={{ flex: 1 }}
              keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 80}
            >
              <FlatList
                data={messages}
                keyExtractor={(item, index) => item.id ?? String(index)}
                contentContainerStyle={styles.listContent}
                renderItem={({ item, index }) => {
                  if (item.role === 'tool') {
                    const key = item.id ?? String(index);
                    const collapsed = collapsedTool[key] ?? true;
                    const label = item.content.startsWith('Tool call:')
                      ? t('ai.toolCall')
                      : item.content.startsWith('Tool result:')
                      ? t('ai.toolResult')
                      : item.content.startsWith('Tool error:')
                      ? t('ai.toolError')
                      : 'Tool';
                    return (
                      <View style={[styles.messageRow, styles.rowLeft]}>
                        <View style={[styles.toolCard, { borderColor: theme.colors.outline }]}>
                          <Pressable
                            style={styles.toolHeader}
                            onPress={() => setCollapsedTool(prev => ({ ...prev, [key]: !collapsed }))}
                          >
                            <View style={styles.toolHeaderLeft}>
                              <FontAwesome5 name="tools" size={14} color={theme.colors.primary} />
                              <Text style={[styles.toolTitle, { color: theme.colors.onSurface }]}>
                                {`${t('ai.toolUseTitle')} · ${label}`}
                              </Text>
                            </View>
                            <FontAwesome5 name={collapsed ? 'chevron-down' : 'chevron-up'} size={12} color={theme.colors.onSurfaceVariant} />
                          </Pressable>
                          {!collapsed && (
                            <Text style={[styles.toolBody, { color: theme.colors.onSurfaceVariant }]}>
                              {item.content}
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  }
                  return (
                    <View style={[styles.messageRow, item.role === 'user' ? styles.rowRight : styles.rowLeft]}>
                      <View style={[
                        styles.bubble,
                        item.role === 'user' ? styles.userBubble : styles.assistantBubble,
                        { backgroundColor: item.role === 'user' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }
                      ]}>
                        <Text style={{ color: item.role === 'user' ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}>
                          {item.content}
                        </Text>
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
                      </View>
                    </View>
                  );
                }}
              />
              {loading && (
                <View style={[styles.messageRow, styles.rowLeft]}>
                  <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: theme.colors.surfaceVariant, flexDirection: 'row', alignItems: 'center' }]}>
                    <ActivityIndicator size="small" />
                    <Text style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}>{t('ai.thinking')}</Text>
                  </View>
                </View>
              )}
              {loading && (
                <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
                  <Button mode="contained-tonal" icon="stop" onPress={handleStop}>
                    {t('ai.stopGeneration')}
                  </Button>
                </View>
              )}
              {contextInfo ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 12, paddingBottom: 6 }}>
                  {`${t('ai.contextLabel')}: ${contextInfo}`}
                </Text>
              ) : null}
              <View style={[styles.inputContainer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outline }]}>
                <IconButton icon="cog" onPress={() => setToolSettingsVisible(true)} />
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
  toolHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolTitle: { fontSize: 12, fontWeight: '600' },
  toolBody: { marginTop: 8, fontSize: 12 }
});
