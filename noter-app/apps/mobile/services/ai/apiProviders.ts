import { ChatMessage } from '@repo/ai';

export type ApiProviderType = 'openrouter' | 'gemini';

const toOpenRouterMessages = (history: ChatMessage[]) =>
  history.map((message) => ({
    role: message.role === 'tool' ? 'assistant' : message.role,
    content: message.content || '',
  }));

const toGeminiContents = (history: ChatMessage[]) =>
  history.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content || '' }],
  }));

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
      const text = await response.text().catch(() => '');
      throw new Error(text || 'OpenRouter request failed');
    }
    const json = await response.json();
    return String(json?.choices?.[0]?.message?.content || '');
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: toGeminiContents(history),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || 'Gemini request failed');
  }
  const json = await response.json();
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part: any) => String(part?.text || '')).join('');
};
