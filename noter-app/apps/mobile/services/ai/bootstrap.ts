import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { McpUiSettings, createEmptyMcpUiSettings, decrypt, normalizeMcpUiSettings, resolveMcpSettings, toEffectiveMcpUiSettings } from '@repo/shared';
import { isAiBackgroundWorkEnabled } from './runtimeSettings';

const GLOBAL_SYSTEM_PROMPT_KEY = 'ai_system_prompt_local';

export type AiBootstrapState = {
  scopeKey: string;
  systemPrompt: string;
  enableToolUse: boolean | null;
  toolAccessMode: 'read-only' | 'full' | null;
  promptPreset: 'balanced' | 'research' | 'execution' | 'concise' | null;
  syncWithBackend: boolean;
  preferLocalConversion: boolean | null;
  allowBackgroundAIWork: boolean;
  aiUseApiProviders: boolean | null;
  apiProvider: 'openrouter' | 'gemini' | null;
  openRouterModel: string | null;
  geminiModel: string | null;
  openRouterApiKey: string;
  geminiApiKey: string;
  mcpSettings: McpUiSettings;
};

export const getMobileMcpEnvValues = (): Record<string, string | undefined> => ({});

export const loadAiBootstrapState = async (): Promise<AiBootstrapState> => {
  const token = await SecureStore.getItemAsync('token');
  const scopeKey = token
    ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token)
    : 'anon';
  const [
    savedSystemPrompt,
    savedGlobalSystemPrompt,
    savedToolUse,
    savedToolAccessMode,
    savedPromptPreset,
    savedSyncEnabled,
    savedLocalConvert,
    savedBackgroundWork,
    savedApiEnabled,
    savedApiProvider,
    savedOpenRouterModel,
    savedGeminiModel,
    openRouterKeyEnc,
    geminiKeyEnc,
    mcpSettingsRaw,
    globalBackgroundWork,
  ] = await Promise.all([
    AsyncStorage.getItem(`ai_system_prompt_${scopeKey}`),
    AsyncStorage.getItem(GLOBAL_SYSTEM_PROMPT_KEY),
    AsyncStorage.getItem(`ai_tool_use_enabled_${scopeKey}`),
    AsyncStorage.getItem(`ai_tool_access_mode_${scopeKey}`),
    AsyncStorage.getItem(`ai_prompt_preset_${scopeKey}`),
    AsyncStorage.getItem(`ai_sync_enabled_${scopeKey}`),
    AsyncStorage.getItem(`ai_local_convert_${scopeKey}`),
    AsyncStorage.getItem(`ai_background_work_${scopeKey}`),
    AsyncStorage.getItem(`ai_api_enabled_${scopeKey}`),
    AsyncStorage.getItem(`ai_api_provider_${scopeKey}`),
    AsyncStorage.getItem(`ai_openrouter_model_${scopeKey}`),
    AsyncStorage.getItem(`ai_gemini_model_${scopeKey}`),
    SecureStore.getItemAsync(`ai_openrouter_key_${scopeKey}`),
    SecureStore.getItemAsync(`ai_gemini_key_${scopeKey}`),
    SecureStore.getItemAsync(`ai_mcp_settings_${scopeKey}`),
    isAiBackgroundWorkEnabled(),
  ]);

  let parsedMcpSettings = createEmptyMcpUiSettings();
  if (mcpSettingsRaw) {
    try {
      parsedMcpSettings = normalizeMcpUiSettings(JSON.parse(decrypt(mcpSettingsRaw) || mcpSettingsRaw || '{}'));
    } catch {}
  }

  return {
    scopeKey,
    systemPrompt: savedSystemPrompt ? decrypt(savedSystemPrompt) : (savedGlobalSystemPrompt ? decrypt(savedGlobalSystemPrompt) : ''),
    enableToolUse: savedToolUse !== null ? savedToolUse === 'true' : null,
    toolAccessMode: savedToolAccessMode === 'read-only' || savedToolAccessMode === 'full' ? savedToolAccessMode : null,
    promptPreset: savedPromptPreset === 'balanced' || savedPromptPreset === 'research' || savedPromptPreset === 'execution' || savedPromptPreset === 'concise' ? savedPromptPreset : null,
    syncWithBackend: savedSyncEnabled !== null ? savedSyncEnabled === 'true' : true,
    preferLocalConversion: savedLocalConvert !== null ? savedLocalConvert === 'true' : null,
    allowBackgroundAIWork: savedBackgroundWork !== null ? savedBackgroundWork === 'true' : globalBackgroundWork,
    aiUseApiProviders: savedApiEnabled !== null ? savedApiEnabled === 'true' : null,
    apiProvider: savedApiProvider === 'openrouter' || savedApiProvider === 'gemini' ? savedApiProvider : null,
    openRouterModel: savedOpenRouterModel || null,
    geminiModel: savedGeminiModel || null,
    openRouterApiKey: openRouterKeyEnc ? decrypt(openRouterKeyEnc) || '' : '',
    geminiApiKey: geminiKeyEnc ? decrypt(geminiKeyEnc) || '' : '',
    mcpSettings: toEffectiveMcpUiSettings(resolveMcpSettings(parsedMcpSettings, getMobileMcpEnvValues())),
  };
};
