/**
 * Splits a model's chain-of-thought from its answer so the UI can show the
 * reasoning in a collapsible card and the answer as normal text.
 *
 * Handles reasoning emitted as `<think>...</think>` blocks (DeepSeek-R1, QwQ,
 * many OpenRouter/Groq models). During streaming the closing tag may not have
 * arrived yet — an unclosed `<think>` means everything after it is reasoning
 * still in progress. Pure + tested.
 */
export interface SplitThinking {
  thinking: string;
  answer: string;
}

const THINK_BLOCK = /<think>([\s\S]*?)<\/think>/gi;
const OPEN_TAG_RE = /<think>/gi;
const OPEN_TAG_LEN = '<think>'.length; // same length in any case

export const extractThinking = (text: string): SplitThinking => {
  if (typeof text !== 'string') return { thinking: '', answer: '' };
  if (!/<think>/i.test(text)) return { thinking: '', answer: text };

  const parts: string[] = [];
  // Pull out every completed <think>...</think> block (case-insensitive).
  let answer = text.replace(THINK_BLOCK, (_match, inner) => {
    const trimmed = String(inner).trim();
    if (trimmed) parts.push(trimmed);
    return '';
  });

  // A still-open <think> (mid-stream): treat the tail as in-progress reasoning.
  OPEN_TAG_RE.lastIndex = 0;
  let lastOpen = -1;
  let m: RegExpExecArray | null;
  while ((m = OPEN_TAG_RE.exec(answer)) !== null) lastOpen = m.index;
  if (lastOpen !== -1) {
    const tail = answer.slice(lastOpen + OPEN_TAG_LEN).trim();
    if (tail) parts.push(tail);
    answer = answer.slice(0, lastOpen);
  }

  return { thinking: parts.join('\n').trim(), answer: answer.trim() };
};

/** True if the text contains (or is currently streaming) a reasoning block. */
export const hasThinking = (text: string): boolean =>
  typeof text === 'string' && /<think>/i.test(text);
