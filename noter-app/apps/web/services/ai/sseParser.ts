/**
 * Pure Server-Sent-Events parsing for streaming AI responses. Kept transport-free
 * so it is unit-tested without a network: the streaming fetch in apiProviders.ts
 * feeds raw decoded text chunks through `SseBuffer` and maps each `data:` payload
 * with the provider-specific delta extractor.
 *
 * Mirrors apps/mobile/services/ai/sseParser.ts so both clients parse streams
 * identically — keep them in sync.
 */

/** Accumulates text chunks and emits only complete lines (keeps the partial tail). */
export class SseBuffer {
  private buffer = '';

  /** Push a decoded chunk; returns the newly-completed lines. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop() ?? ''; // last element is an incomplete line
    return parts;
  }

  /** Flush any trailing buffered line at stream end. */
  flush(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    return rest ? [rest] : [];
  }
}

/** Extract the `data:` payloads from a batch of SSE lines (ignores comments/blank). */
export const sseDataPayloads = (lines: string[]): string[] =>
  lines
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice('data:'.length).trim())
    .filter((p) => p.length > 0);

/**
 * OpenAI-compatible (OpenRouter, Groq) delta. Returns:
 *  - the incremental text (possibly '') for a normal chunk,
 *  - null for the terminal `[DONE]` sentinel or an unparseable payload.
 */
export const openAiDelta = (payload: string): string | null => {
  if (payload === '[DONE]') return null;
  try {
    const json = JSON.parse(payload);
    const delta = json?.choices?.[0]?.delta?.content;
    return typeof delta === 'string' ? delta : '';
  } catch {
    return null;
  }
};

/** Total tokens from an OpenAI stream chunk (present only when usage is included). */
export const openAiUsageTokens = (payload: string): number => {
  if (payload === '[DONE]') return 0;
  try {
    return Number(JSON.parse(payload)?.usage?.total_tokens) || 0;
  } catch {
    return 0;
  }
};

/** Gemini SSE delta — concatenated text parts of the chunk. */
export const geminiDelta = (payload: string): string => {
  try {
    const parts = JSON.parse(payload)?.candidates?.[0]?.content?.parts;
    return Array.isArray(parts) ? parts.map((p: any) => String(p?.text || '')).join('') : '';
  } catch {
    return '';
  }
};

export const geminiUsageTokens = (payload: string): number => {
  try {
    return Number(JSON.parse(payload)?.usageMetadata?.totalTokenCount) || 0;
  } catch {
    return 0;
  }
};

/**
 * Anthropic Messages SSE delta. The `data:` payload is JSON with a `type`; the
 * incremental text lives in `content_block_delta` events with a `text_delta`.
 */
export const anthropicDelta = (payload: string): string => {
  try {
    const json = JSON.parse(payload);
    if (json?.type === 'content_block_delta' && json?.delta?.type === 'text_delta') {
      return typeof json.delta.text === 'string' ? json.delta.text : '';
    }
    return '';
  } catch {
    return '';
  }
};

/**
 * Anthropic usage from a stream event. `message_start` carries `usage.input_tokens`;
 * `message_delta` carries the running `usage.output_tokens`.
 */
export const anthropicUsage = (payload: string): { input?: number; output?: number } => {
  try {
    const json = JSON.parse(payload);
    if (json?.type === 'message_start') {
      const n = Number(json?.message?.usage?.input_tokens);
      return Number.isFinite(n) ? { input: n } : {};
    }
    if (json?.type === 'message_delta') {
      const n = Number(json?.usage?.output_tokens);
      return Number.isFinite(n) ? { output: n } : {};
    }
    return {};
  } catch {
    return {};
  }
};
