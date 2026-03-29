import { ChatMessage } from '@repo/ai';

export type ApiProviderType = 'openrouter' | 'gemini';

const normalizeHistory = (history: ChatMessage[]) =>
  history.filter((message) => typeof message.content === 'string' && message.content.trim().length > 0);

const toOpenRouterMessages = (history: ChatMessage[]) =>
  normalizeHistory(history).map((message) => ({
    role: message.role === 'system'
      ? 'system'
      : message.role === 'assistant'
        ? 'assistant'
        : 'user',
    content: message.role === 'tool' ? `Tool result:\n${message.content}` : message.content,
  }));

const toGeminiPayload = (history: ChatMessage[]) => {
  const normalized = normalizeHistory(history);
  const systemPrompt = normalized
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');

  const contents = normalized
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.role === 'tool' ? `Tool result:\n${message.content}` : message.content }],
    }));

  return { systemPrompt, contents };
};

const readErrorBody = async (response: Response) => {
  const text = await response.text().catch(() => '');
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || parsed?.message || text;
  } catch {
    return text;
  }
};

export const generateApiProviderResponse = async (params: {
  provider: ApiProviderType;
  apiKey: string;
  model: string;
  history: ChatMessage[];
}) => {
  const { provider, apiKey, model, history } = params;
  if (!apiKey) throw new Error('API-nyckel saknas');
  if (!model) throw new Error('API-modell saknas');

  if (provider === 'openrouter') {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: toOpenRouterMessages(history),
        stream: false,
      }),
    });
    if (!response.ok) {
      const text = await readErrorBody(response);
      throw new Error(text || 'OpenRouter request failed');
    }
    const json = await response.json();
    return String(json?.choices?.[0]?.message?.content || '');
  }

  const { systemPrompt, contents } = toGeminiPayload(history);

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents,
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    }),
  });
  if (!response.ok) {
    const text = await readErrorBody(response);
    throw new Error(text || 'Gemini request failed');
  }
  const json = await response.json();
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part: any) => String(part?.text || '')).join('');
};
