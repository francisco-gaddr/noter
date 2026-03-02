'use client';

export type LmStudioModel = {
  key: string;
  displayName: string;
};

export const normalizeLmStudioBaseUrl = (value: string) => {
  let next = value.trim();
  next = next.replace(/[.]+$/, '');
  next = next.replace(/\/+$/, '');
  next = next.replace(/\/api\/v1\/(models|chat)$/i, '');
  next = next.replace(/\/api\/v1$/i, '');
  return next;
};

export const buildLmStudioHeaders = (token?: string) => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

export const splitSseBuffer = (buffer: string, chunk: string) => {
  const combined = buffer + chunk;
  const lines = combined.split(/\r?\n/);
  const nextBuffer = lines.pop() ?? '';
  return { lines, buffer: nextBuffer };
};

export const extractLmStudioText = (payload: any, previous: string) => {
  let text = '';
  if (payload?.output && Array.isArray(payload.output)) {
    text = payload.output
      .filter((item: any) => item?.type === 'message')
      .map((item: any) => String(item?.content ?? ''))
      .join('');
  } else if (payload?.delta?.content) {
    text = String(payload.delta.content);
  } else if (payload?.content) {
    text = String(payload.content);
  }

  if (!text) return { delta: '', nextText: previous };
  if (text.startsWith(previous)) return { delta: text.slice(previous.length), nextText: text };
  return { delta: text, nextText: previous + text };
};
