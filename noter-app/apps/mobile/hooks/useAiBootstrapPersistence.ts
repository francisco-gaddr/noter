import type React from 'react';
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { encrypt } from '@repo/shared';
import { loadAiBootstrapState } from '@/services/ai/bootstrap';
import { setAiBackgroundWorkEnabled } from '@/services/ai/runtimeSettings';

type Options = {
  isMountedRef: React.MutableRefObject<boolean>;
  refreshRemoteSync: (scopeKey?: string, allowRemote?: boolean) => Promise<void>;
  setUserScopeKey: (value: string) => void;
  setSystemPrompt: (value: string) => void;
  setEnableToolUse: (value: boolean) => void;
  setToolAccessMode: (value: 'read-only' | 'full') => void;
  setPromptPreset: (value: 'balanced' | 'research' | 'execution' | 'concise') => void;
  setSyncWithBackend: (value: boolean) => void;
  setPreferLocalConversion: (value: boolean) => void;
  setAllowBackgroundAIWork: (value: boolean) => void;
  setAiUseApiProviders: (value: boolean) => void;
  setApiProvider: (value: 'openrouter' | 'gemini') => void;
  setOpenRouterModel: (value: string) => void;
  setGeminiModel: (value: string) => void;
  setOpenRouterApiKey: (value: string) => void;
  setGeminiApiKey: (value: string) => void;
  setMcpSettings: (value: any) => void;
  setSyncPreferenceLoaded: (value: boolean) => void;
  enableToolUse: boolean;
  toolAccessMode: 'read-only' | 'full';
  promptPreset: 'balanced' | 'research' | 'execution' | 'concise';
  syncWithBackend: boolean;
  preferLocalConversion: boolean;
  allowBackgroundAIWork: boolean;
  aiUseApiProviders: boolean;
  apiProvider: 'openrouter' | 'gemini';
  openRouterModel: string;
  geminiModel: string;
  openRouterApiKey: string;
  geminiApiKey: string;
  mcpSettings: any;
  userScopeKey: string;
  syncPreferenceLoaded: boolean;
};

export const useAiBootstrapPersistence = ({
  isMountedRef,
  refreshRemoteSync,
  setUserScopeKey,
  setSystemPrompt,
  setEnableToolUse,
  setToolAccessMode,
  setPromptPreset,
  setSyncWithBackend,
  setPreferLocalConversion,
  setAllowBackgroundAIWork,
  setAiUseApiProviders,
  setApiProvider,
  setOpenRouterModel,
  setGeminiModel,
  setOpenRouterApiKey,
  setGeminiApiKey,
  setMcpSettings,
  setSyncPreferenceLoaded,
  enableToolUse,
  toolAccessMode,
  promptPreset,
  syncWithBackend,
  preferLocalConversion,
  allowBackgroundAIWork,
  aiUseApiProviders,
  apiProvider,
  openRouterModel,
  geminiModel,
  openRouterApiKey,
  geminiApiKey,
  mcpSettings,
  userScopeKey,
  syncPreferenceLoaded,
}: Options) => {
  useEffect(() => {
    isMountedRef.current = true;
    void (async () => {
      const bootstrapState = await loadAiBootstrapState();
      if (!isMountedRef.current) return;
      setUserScopeKey(bootstrapState.scopeKey);
      if (bootstrapState.systemPrompt) setSystemPrompt(bootstrapState.systemPrompt);
      if (bootstrapState.enableToolUse !== null) setEnableToolUse(bootstrapState.enableToolUse);
      if (bootstrapState.toolAccessMode) setToolAccessMode(bootstrapState.toolAccessMode);
      if (bootstrapState.promptPreset) setPromptPreset(bootstrapState.promptPreset);
      setSyncWithBackend(bootstrapState.syncWithBackend);
      if (bootstrapState.preferLocalConversion !== null) setPreferLocalConversion(bootstrapState.preferLocalConversion);
      setAllowBackgroundAIWork(bootstrapState.allowBackgroundAIWork);
      await setAiBackgroundWorkEnabled(bootstrapState.allowBackgroundAIWork);
      await refreshRemoteSync(bootstrapState.scopeKey, bootstrapState.syncWithBackend);
      if (!isMountedRef.current) return;
      if (bootstrapState.aiUseApiProviders !== null) setAiUseApiProviders(bootstrapState.aiUseApiProviders);
      if (bootstrapState.apiProvider) setApiProvider(bootstrapState.apiProvider);
      if (bootstrapState.openRouterModel) setOpenRouterModel(bootstrapState.openRouterModel);
      if (bootstrapState.geminiModel) setGeminiModel(bootstrapState.geminiModel);
      if (bootstrapState.openRouterApiKey) setOpenRouterApiKey(bootstrapState.openRouterApiKey);
      if (bootstrapState.geminiApiKey) setGeminiApiKey(bootstrapState.geminiApiKey);
      setMcpSettings(bootstrapState.mcpSettings);
      setSyncPreferenceLoaded(true);
    })();
    return () => {
      isMountedRef.current = false;
    };
  }, [
    isMountedRef,
    refreshRemoteSync,
    setAiUseApiProviders,
    setAllowBackgroundAIWork,
    setApiProvider,
    setEnableToolUse,
    setGeminiApiKey,
    setGeminiModel,
    setMcpSettings,
    setOpenRouterApiKey,
    setOpenRouterModel,
    setPreferLocalConversion,
    setPromptPreset,
    setSyncPreferenceLoaded,
    setSyncWithBackend,
    setSystemPrompt,
    setToolAccessMode,
    setUserScopeKey,
  ]);

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
  }, [refreshRemoteSync, syncPreferenceLoaded, syncWithBackend, userScopeKey]);

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
};
