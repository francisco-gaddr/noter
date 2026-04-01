import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { McpUiSettings, createEmptyMcpUiSettings, decrypt, normalizeMcpUiSettings, resolveMcpSettings, toEffectiveMcpUiSettings } from '@repo/shared';
import { isAiBackgroundWorkEnabled } from './runtimeSettings';

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

export const getMobileMcpEnvValues = (env = process.env as Record<string, string | undefined>): Record<string, string | undefined> => ({
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
});

export const loadAiBootstrapState = async (): Promise<AiBootstrapState> => {
  const token = await SecureStore.getItemAsync('token');
  const scopeKey = token
    ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token)
    : 'anon';
  const [
    savedSystemPrompt,
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
    systemPrompt: savedSystemPrompt ? decrypt(savedSystemPrompt) : '',
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
