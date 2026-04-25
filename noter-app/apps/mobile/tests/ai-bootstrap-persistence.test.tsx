import React, { useEffect, useRef, useState } from 'react';
import renderer, { act } from 'react-test-renderer';
import { clearEncryptionKey, setEncryptionKey } from '@repo/shared';

const mockGetItem = jest.fn(async (_key: string) => null);
const mockSetItem = jest.fn(async (_key: string, _value: string) => undefined);
const mockRemoveItem = jest.fn(async (_key: string) => undefined);
const mockSecureSetItemAsync = jest.fn(async (_key: string, _value: string) => undefined);
const mockRefreshRemoteSync = jest.fn(async () => undefined);

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
  removeItem: (key: string) => mockRemoveItem(key),
}));

jest.mock('expo-secure-store', () => ({
  setItemAsync: (key: string, value: string) => mockSecureSetItemAsync(key, value),
}));

jest.mock('../services/ai/bootstrap', () => ({
  loadAiBootstrapState: jest.fn(async () => ({
    scopeKey: 'scope-1',
    systemPrompt: '',
    enableToolUse: null,
    toolAccessMode: null,
    promptPreset: null,
    syncWithBackend: true,
    preferLocalConversion: null,
    allowBackgroundAIWork: false,
    aiUseApiProviders: null,
    apiProvider: null,
    openRouterModel: null,
    geminiModel: null,
    openRouterApiKey: '',
    geminiApiKey: '',
    mcpSettings: {},
  })),
}));

jest.mock('../services/ai/runtimeSettings', () => ({
  setAiBackgroundWorkEnabled: jest.fn(async () => undefined),
}));

const Harness = ({ prompt }: { prompt: string }) => {
  const isMountedRef = useRef(false);
  const [userScopeKey, setUserScopeKey] = useState('scope-1');
  const [systemPrompt, setSystemPrompt] = useState(prompt);
  const [enableToolUse, setEnableToolUse] = useState(false);
  const [toolAccessMode, setToolAccessMode] = useState<'read-only' | 'full'>('read-only');
  const [promptPreset, setPromptPreset] = useState<'balanced' | 'research' | 'execution' | 'concise'>('balanced');
  const [syncWithBackend, setSyncWithBackend] = useState(true);
  const [preferLocalConversion, setPreferLocalConversion] = useState(false);
  const [allowBackgroundAIWork, setAllowBackgroundAIWork] = useState(false);
  const [aiUseApiProviders, setAiUseApiProviders] = useState(false);
  const [apiProvider, setApiProvider] = useState<'openrouter' | 'gemini'>('openrouter');
  const [openRouterModel, setOpenRouterModel] = useState('openai/gpt-4o-mini');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [mcpSettings, setMcpSettings] = useState({});
  const [syncPreferenceLoaded, setSyncPreferenceLoaded] = useState(false);

  useEffect(() => {
    setSystemPrompt(prompt);
  }, [prompt]);

  const { useAiBootstrapPersistence } = require('../hooks/useAiBootstrapPersistence');

  useAiBootstrapPersistence({
    isMountedRef,
    refreshRemoteSync: mockRefreshRemoteSync,
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
    systemPrompt,
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
  });

  return null;
};

describe('AI bootstrap persistence', () => {
  beforeEach(() => {
    mockGetItem.mockClear();
    mockSetItem.mockClear();
    mockRemoveItem.mockClear();
    mockSecureSetItemAsync.mockClear();
    mockRefreshRemoteSync.mockClear();
    setEncryptionKey('a'.repeat(64));
  });

  afterEach(() => {
    clearEncryptionKey();
  });

  it('autosparar systemprompt lokalt och rensar den när den töms', async () => {
    let tree: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<Harness prompt="Min systemprompt" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      mockSetItem.mock.calls.some(
        (call: unknown[]) =>
          call[0] === 'ai_system_prompt_local' &&
          typeof call[1] === 'string' &&
          (call[1] as string).startsWith('U2FsdGVkX1')
      )
    ).toBe(true);
    expect(
      mockSetItem.mock.calls.some(
        (call: unknown[]) =>
          call[0] === 'ai_system_prompt_scope-1' &&
          typeof call[1] === 'string' &&
          (call[1] as string).startsWith('U2FsdGVkX1')
      )
    ).toBe(true);

    await act(async () => {
      tree!.update(<Harness prompt="" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRemoveItem).toHaveBeenCalledWith('ai_system_prompt_scope-1');
    expect(mockRemoveItem).toHaveBeenCalledWith('ai_system_prompt_local');
  });
});
