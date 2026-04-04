describe('ai bootstrap loader', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('loads scoped AI bootstrap settings from encrypted local storage', async () => {
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      getItem: jest.fn(async (key: string) => {
        if (key.includes('ai_system_prompt_')) return 'plain prompt';
        if (key.includes('ai_tool_use_enabled_')) return 'true';
        if (key.includes('ai_tool_access_mode_')) return 'read-only';
        if (key.includes('ai_prompt_preset_')) return 'research';
        if (key.includes('ai_sync_enabled_')) return 'false';
        if (key.includes('ai_local_convert_')) return 'true';
        if (key.includes('ai_background_work_')) return 'false';
        if (key.includes('ai_api_enabled_')) return 'true';
        if (key.includes('ai_api_provider_')) return 'gemini';
        if (key.includes('ai_openrouter_model_')) return 'openrouter/model';
        if (key.includes('ai_gemini_model_')) return 'gemini-pro';
        return null;
      }),
    }));
    jest.doMock('expo-secure-store', () => ({
      getItemAsync: jest.fn(async (key: string) => {
        if (key === 'token') return 'token-1';
        if (key.includes('ai_openrouter_key_')) return 'open-router-key';
        if (key.includes('ai_gemini_key_')) return 'gemini-key';
        if (key.includes('ai_mcp_settings_')) return JSON.stringify({ notion: { enabled: true } });
        return null;
      }),
    }));
    jest.doMock('expo-crypto', () => ({
      CryptoDigestAlgorithm: { SHA256: 'sha256' },
      digestStringAsync: jest.fn(async () => 'scope-1'),
    }));
    jest.doMock('@repo/shared', () => {
      const actual = jest.requireActual('@repo/shared');
      return {
        ...actual,
        decrypt: (value: string) => value,
        normalizeMcpUiSettings: (value: any) => value,
        resolveMcpSettings: (settings: any, env: any) => ({ ...settings, env }),
        toEffectiveMcpUiSettings: (value: any) => value,
      };
    });
    jest.doMock('../services/ai/runtimeSettings', () => ({
      isAiBackgroundWorkEnabled: jest.fn(async () => true),
    }));

    const { loadAiBootstrapState } = require('../services/ai/bootstrap');
    const result = await loadAiBootstrapState();

    expect(result.scopeKey).toBe('scope-1');
    expect(result.systemPrompt).toBe('plain prompt');
    expect(result.enableToolUse).toBe(true);
    expect(result.toolAccessMode).toBe('read-only');
    expect(result.promptPreset).toBe('research');
    expect(result.syncWithBackend).toBe(false);
    expect(result.allowBackgroundAIWork).toBe(false);
    expect(result.apiProvider).toBe('gemini');
    expect(result.geminiModel).toBe('gemini-pro');
    expect(result.mcpSettings.env).toEqual({});
  });
});
