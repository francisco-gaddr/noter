import { ChatMessage } from '@repo/ai';
import { parseDataUrl } from '@repo/shared';
import { fetch as expoFetch } from 'expo/fetch';
import { SseBuffer, sseDataPayloads, openAiDelta, openAiUsageTokens, geminiDelta, geminiUsageTokens, anthropicDelta, anthropicUsage } from './sseParser';

export type ApiProviderType = 'openrouter' | 'openai' | 'anthropic' | 'grok' | 'gemini' | 'groq' | 'hermes';

/** Wire format of a provider's API. 'openai' = OpenAI-compatible /chat/completions
 *  (OpenRouter, Groq, OpenAI, xAI Grok, Hermes); 'gemini' = Google generateContent;
 *  'anthropic' = Anthropic /v1/messages (content blocks + x-api-key). */
export type ApiProviderFormat = 'openai' | 'gemini' | 'anthropic';

export interface ApiProviderMeta {
  id: ApiProviderType;
  label: string;
  /** OpenAI-compatible chat-completions endpoint, or null for bespoke (Gemini)
   *  / for providers whose endpoint the user configures at runtime (Hermes). */
  endpoint: string | null;
  /** Wire format. Defaults to 'openai' when omitted. */
  format?: ApiProviderFormat;
  /** Where the user gets an API key — shown in settings. */
  apiKeyUrl: string;
  /** A couple of sensible default model ids for the picker. */
  defaultModels: string[];
  /** True when the user supplies the base URL at runtime (self-hosted agents).
   *  The endpoint above is ignored; the per-call `baseUrl` is used instead. */
  configurableEndpoint?: boolean;
  /** True when the endpoint may need no API key (LAN/self-hosted servers). */
  apiKeyOptional?: boolean;
  /** Short hint shown in settings for configurable providers. */
  hint?: string;
}

/** Default max output tokens for providers that require it (Anthropic). */
const ANTHROPIC_MAX_TOKENS = 4096;
const ANTHROPIC_VERSION = '2023-06-01';

// Single source of truth for the supported third-party providers. Add a provider
// here (+ to ApiProviderType) and the OpenAI-compatible ones work with no further
// code; only genuinely different APIs (Gemini) need a branch below.
export const API_PROVIDERS: Record<ApiProviderType, ApiProviderMeta> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiKeyUrl: 'https://openrouter.ai/keys',
    defaultModels: [
      'openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-3.7-sonnet',
      'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001',
      'meta-llama/llama-3.3-70b-instruct', 'meta-llama/llama-3.1-8b-instruct',
      'deepseek/deepseek-chat', 'deepseek/deepseek-r1', 'qwen/qwen-2.5-72b-instruct',
      'mistralai/mistral-large', 'x-ai/grok-2',
    ],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKeyUrl: 'https://console.groq.com/keys',
    defaultModels: [
      'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.2-90b-vision-preview',
      'deepseek-r1-distill-llama-70b', 'qwen-2.5-32b', 'gemma2-9b-it', 'mixtral-8x7b-32768',
    ],
  },
  // OpenAI — Chat Completions API (OpenAI-compatible). Bearer auth. (The newer
  // Responses API is agentic but Chat Completions remains the universal contract our
  // streaming path uses; we can add Responses later behind the same provider id.)
  openai: {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    format: 'openai',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    defaultModels: [
      'gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-5', 'gpt-5-mini', 'o4-mini',
    ],
  },
  // Anthropic Claude — Messages API (/v1/messages). x-api-key + anthropic-version,
  // content-block streaming. Needs max_tokens.
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    endpoint: 'https://api.anthropic.com/v1/messages',
    format: 'anthropic',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModels: [
      'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-3-7-sonnet-latest',
      'claude-3-5-haiku-latest',
    ],
  },
  // xAI Grok — OpenAI-compatible at https://api.x.ai/v1. Bearer auth.
  grok: {
    id: 'grok',
    label: 'xAI (Grok)',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    format: 'openai',
    apiKeyUrl: 'https://console.x.ai',
    defaultModels: ['grok-4.3', 'grok-4', 'grok-3', 'grok-3-mini'],
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    endpoint: null,
    format: 'gemini',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    defaultModels: [
      'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite',
      'gemini-1.5-pro', 'gemini-1.5-flash',
    ],
  },
  // Self-hosted Hermes agents on the user's MacBook / Raspberry Pi. These expose
  // an OpenAI-compatible /v1/chat/completions (llama.cpp, Ollama, LM Studio, vLLM,
  // …), so they reuse the OpenAI path entirely — only the base URL is dynamic and
  // the key is optional for LAN servers.
  hermes: {
    id: 'hermes',
    label: 'Hermes (egen server)',
    endpoint: null,
    apiKeyUrl: '',
    defaultModels: ['qwen2.5:3b-instruct', 'qwen3:4b-instruct', 'qwen2.5:1.5b-instruct', 'hermes-3-llama-3.1-8b', 'llama3.2'],
    configurableEndpoint: true,
    apiKeyOptional: true,
    hint: 'Bas-URL till din Hermes-agent, t.ex. http://192.168.50.16:8080 (Pi) eller http://din-mac.local:1234',
  },
};

export const API_PROVIDER_LIST: ApiProviderMeta[] = Object.values(API_PROVIDERS);

/**
 * Resolve the OpenAI-compatible chat-completions URL for a provider. For
 * configurable providers (Hermes) we normalise the user's base URL: accept a
 * full `…/chat/completions`, a `…/v1` root, or a bare host, and always end up at
 * `<base>/v1/chat/completions`. Trailing slashes are tolerated.
 */
export const resolveChatCompletionsUrl = (meta: ApiProviderMeta, baseUrl?: string): string => {
  if (!meta.configurableEndpoint) return meta.endpoint || '';
  const raw = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('Bas-URL saknas för egen server');
  if (/\/chat\/completions$/.test(raw)) return raw;
  if (/\/v1$/.test(raw)) return `${raw}/chat/completions`;
  return `${raw}/v1/chat/completions`;
};

// Index of the last user turn, so images attach to the message the user just sent.
const lastUserIndex = (history: ChatMessage[]): number => {
  for (let i = history.length - 1; i >= 0; i -= 1) if (history[i].role === 'user') return i;
  return -1;
};

const toOpenAiMessages = (history: ChatMessage[], images: string[] = []) => {
  const imgIdx = images.length ? lastUserIndex(history) : -1;
  return history.map((message, i) => {
    const role = message.role === 'tool' ? 'assistant' : message.role;
    if (i === imgIdx) {
      // Vision: content-parts array (text + image_url data URLs).
      return {
        role,
        content: [
          { type: 'text', text: message.content || '' },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      };
    }
    return { role, content: message.content || '' };
  });
};

const toGeminiContents = (history: ChatMessage[], images: string[] = []) => {
  const imgIdx = images.length ? lastUserIndex(history) : -1;
  return history.map((message, i) => {
    const parts: any[] = [{ text: message.content || '' }];
    if (i === imgIdx) {
      for (const url of images) {
        const parsed = parseDataUrl(url);
        if (parsed) parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } });
      }
    }
    return { role: message.role === 'assistant' ? 'model' : 'user', parts };
  });
};

/** Effective wire format for a provider (defaults to OpenAI-compatible). */
export const providerFormat = (meta?: ApiProviderMeta): ApiProviderFormat =>
  meta?.format || (meta?.endpoint || meta?.configurableEndpoint ? 'openai' : 'gemini');

/**
 * Anthropic Messages format. The system prompt is a top-level `system` field (not a
 * message role), and user/assistant turns use content blocks. Images attach to the last
 * user turn as base64 `image` source blocks. Tool messages collapse into assistant text.
 */
const toAnthropicMessages = (history: ChatMessage[], images: string[] = []): { system: string; messages: any[] } => {
  const systemParts: string[] = [];
  const turns: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === 'system') { if (m.content) systemParts.push(m.content); continue; }
    turns.push(m);
  }
  const imgIdx = images.length ? (() => { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'user') return i; return -1; })() : -1;
  const messages = turns.map((m, i) => {
    const role = m.role === 'assistant' || m.role === 'tool' ? 'assistant' : 'user';
    if (i === imgIdx && images.length) {
      const blocks: any[] = [{ type: 'text', text: m.content || '' }];
      for (const url of images) {
        const parsed = parseDataUrl(url);
        if (parsed) blocks.push({ type: 'image', source: { type: 'base64', media_type: parsed.mimeType, data: parsed.base64 } });
      }
      return { role, content: blocks };
    }
    return { role, content: m.content || '' };
  });
  return { system: systemParts.join('\n\n'), messages };
};

/** Headers for an Anthropic Messages request. The browser-access header lets the web/
 *  Electron renderer call the API directly (mobile/RN ignores CORS entirely). */
const anthropicHeaders = (apiKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': ANTHROPIC_VERSION,
  'anthropic-dangerous-direct-browser-access': 'true',
});

const anthropicBody = (model: string, history: ChatMessage[], images: string[], stream: boolean): string => {
  const { system, messages } = toAnthropicMessages(history, images);
  return JSON.stringify({ model, max_tokens: ANTHROPIC_MAX_TOKENS, ...(system ? { system } : {}), messages, stream });
};

export interface ApiProviderResult {
  text: string;
  /** Total tokens the provider reported for this call (0 if not reported). */
  totalTokens: number;
}

export const generateApiProviderResponse = async (params: {
  provider: ApiProviderType;
  apiKey: string;
  model: string;
  history: ChatMessage[];
  /** Base URL for configurable providers (Hermes self-hosted agents). */
  baseUrl?: string;
  /** Image data URLs to attach to the last user turn (vision models). */
  images?: string[];
}): Promise<ApiProviderResult> => {
  const { provider, apiKey, model, history, baseUrl, images = [] } = params;
  const meta = API_PROVIDERS[provider];
  if (!apiKey && !meta?.apiKeyOptional) throw new Error('API-nyckel saknas');
  if (!model) throw new Error('API-modell saknas');
  const format = providerFormat(meta);

  // Anthropic Messages API — content blocks, x-api-key, system as a top-level field.
  if (format === 'anthropic') {
    const response = await fetch(meta.endpoint || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders(apiKey),
      body: anthropicBody(model, history, images, false),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `${meta?.label ?? 'Anthropic'} request failed`);
    }
    const json = await response.json();
    const blocks = Array.isArray(json?.content) ? json.content : [];
    const text = blocks.filter((b: any) => b?.type === 'text').map((b: any) => String(b?.text || '')).join('');
    const usage = json?.usage || {};
    return { text, totalTokens: (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0) };
  }

  // OpenAI-compatible providers (OpenRouter, Groq, OpenAI, Grok, Hermes, …) share one path.
  if (format === 'openai') {
    const url = resolveChatCompletionsUrl(meta, baseUrl);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: toOpenAiMessages(history, images),
        stream: false,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `${meta?.label ?? provider} request failed`);
    }
    const json = await response.json();
    return {
      text: String(json?.choices?.[0]?.message?.content || ''),
      totalTokens: Number(json?.usage?.total_tokens) || 0,
    };
  }

  // Gemini has a bespoke request/response shape.
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: toGeminiContents(history, images),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || 'Gemini request failed');
  }
  const json = await response.json();
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((part: any) => String(part?.text || '')).join('') : '';
  return { text, totalTokens: Number(json?.usageMetadata?.totalTokenCount) || 0 };
};

/**
 * Streaming variant: invokes `onToken` with each incremental delta as it arrives
 * and resolves with the full text + token count. Uses expo/fetch (a real
 * ReadableStream). On any streaming failure it transparently falls back to the
 * non-streaming call so the chat never breaks. Pass an AbortSignal to cancel.
 */
export const streamApiProviderResponse = async (params: {
  provider: ApiProviderType;
  apiKey: string;
  model: string;
  history: ChatMessage[];
  onToken: (delta: string) => void;
  signal?: AbortSignal;
  /** Base URL for configurable providers (Hermes self-hosted agents). */
  baseUrl?: string;
  /** Image data URLs to attach to the last user turn (vision models). */
  images?: string[];
}): Promise<ApiProviderResult> => {
  const { provider, apiKey, model, history, onToken, signal, baseUrl, images = [] } = params;
  const meta = API_PROVIDERS[provider];
  if (!apiKey && !meta?.apiKeyOptional) throw new Error('API-nyckel saknas');
  if (!model) throw new Error('API-modell saknas');

  const format = providerFormat(meta);

  const url = format === 'anthropic'
    ? (meta.endpoint || 'https://api.anthropic.com/v1/messages')
    : format === 'openai'
      ? resolveChatCompletionsUrl(meta, baseUrl)
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const headers: Record<string, string> = format === 'anthropic'
    ? anthropicHeaders(apiKey)
    : format === 'openai'
      ? { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }
      : { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  const body = format === 'anthropic'
    ? anthropicBody(model, history, images, true)
    : format === 'openai'
      ? JSON.stringify({ model, messages: toOpenAiMessages(history, images), stream: true, stream_options: { include_usage: true } })
      : JSON.stringify({ contents: toGeminiContents(history, images) });

  try {
    const response = await expoFetch(url, { method: 'POST', headers, body, signal });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `${meta?.label ?? provider} stream failed`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseBuffer();
    let full = '';
    let totalTokens = 0;
    let inTok = 0;
    let outTok = 0;

    const handlePayloads = (payloads: string[]) => {
      for (const payload of payloads) {
        if (format === 'anthropic') {
          const delta = anthropicDelta(payload);
          if (delta) { full += delta; onToken(delta); }
          const u = anthropicUsage(payload);
          if (typeof u.input === 'number') inTok = u.input;
          if (typeof u.output === 'number') outTok = u.output;
          totalTokens = inTok + outTok || totalTokens;
        } else if (format === 'openai') {
          const delta = openAiDelta(payload);
          if (delta) { full += delta; onToken(delta); }
          totalTokens = openAiUsageTokens(payload) || totalTokens;
        } else {
          const delta = geminiDelta(payload);
          if (delta) { full += delta; onToken(delta); }
          totalTokens = geminiUsageTokens(payload) || totalTokens;
        }
      }
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) { try { await reader.cancel(); } catch {} break; }
      const { done, value } = await reader.read();
      if (done) break;
      handlePayloads(sseDataPayloads(sse.push(decoder.decode(value, { stream: true }))));
    }
    handlePayloads(sseDataPayloads(sse.flush()));

    return { text: full, totalTokens };
  } catch (err) {
    if (signal?.aborted) throw err;
    // Streaming unsupported / network hiccup → fall back to a single response.
    const result = await generateApiProviderResponse({ provider, apiKey, model, history, baseUrl, images });
    if (result.text) onToken(result.text);
    return result;
  }
};
