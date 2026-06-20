/**
 * Build the prompt for a one-shot note summary. Pure + shared so web and mobile summarize identically
 * and the token-bounding/language logic is unit-tested in one place. The caller feeds {system, prompt}
 * into its existing provider call (generateApiProviderResponse) — the paid call uses the USER's own
 * client-side key, so there's no operator cost.
 *
 * LOCK-SAFETY: never call this with locked-note content. The caller must gate on readability first
 * (the UI only offers Summarize on an unlocked note); this helper just shapes the text.
 */
export interface SummaryPrompt {
  system: string;
  prompt: string;
}

export interface SummaryOptions {
  /** Natural language for the summary, e.g. 'sv' or 'en'. Defaults to matching the note's language. */
  language?: string;
  /** Cap the note body fed to the model (bounds token cost on huge notes). Default 12000 chars. */
  maxChars?: number;
}

export const NOTE_SUMMARY_MAX_CHARS = 12000;

export const buildNoteSummaryPrompt = (
  title: string,
  body: string,
  opts: SummaryOptions = {},
): SummaryPrompt => {
  const maxChars = opts.maxChars && opts.maxChars > 0 ? opts.maxChars : NOTE_SUMMARY_MAX_CHARS;
  const trimmed = (body || '').slice(0, maxChars);
  const truncatedNote = (body || '').length > maxChars ? '\n\n[note truncated for length]' : '';
  const langLine = opts.language
    ? `Write the summary in this language: ${opts.language}.`
    : 'Write the summary in the same language as the note.';

  return {
    system: [
      'You are a concise note summarizer.',
      'Produce a short summary: 1 short sentence of gist, then 2–5 bullet points of the key items/actions.',
      langLine,
      'Use only the information in the note. Do not invent facts. No preamble.',
    ].join(' '),
    prompt: `Title: ${title || '(untitled)'}\n\n${trimmed}${truncatedNote}`,
  };
};
