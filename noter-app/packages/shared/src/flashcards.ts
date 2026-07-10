/**
 * Spaced-repetition flashcards (#2). Pure + shared: the prompt to generate cards, a tolerant parser
 * for the model's reply, and an SM-2-style review scheduler. The apps own storage + the AI call (via
 * the user's selected source/model) and the review UI; this module holds the testable logic.
 */

export interface Flashcard {
  id: string;
  noteId: string;
  front: string;
  back: string;
  /** SM-2 state. */
  ease: number;          // ease factor (>= 1.3)
  intervalDays: number;  // current interval in days
  reps: number;          // consecutive successful reviews
  /** ISO timestamp the card is next due. */
  due: string;
  createdAt: string;
}

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export const buildFlashcardsPrompt = (
  title: string,
  body: string,
  opts: { count?: number; language?: string; maxChars?: number } = {},
): { system: string; prompt: string } => {
  const count = Math.max(1, Math.min(20, opts.count || 8));
  const maxChars = opts.maxChars && opts.maxChars > 0 ? opts.maxChars : 12000;
  const trimmed = (body || '').slice(0, maxChars);
  const langLine = opts.language ? `Write the cards in this language: ${opts.language}.` : 'Write the cards in the same language as the note.';
  return {
    system: [
      'You generate study flashcards from a note.',
      `Produce up to ${count} cards. Output ONLY a JSON array of objects with "front" (a question/prompt) and "back" (the answer).`,
      'Each card tests ONE fact. Keep fronts short and unambiguous. Use only information in the note — do not invent facts.',
      langLine,
      'No preamble, no markdown fences — just the JSON array.',
    ].join(' '),
    prompt: `Title: ${title || '(untitled)'}\n\n${trimmed}`,
  };
};

/** Parse the model reply into {front, back} pairs. Accepts a JSON array (preferred), a fenced JSON
 *  block, or a loose "Q: … / A: …" fallback. Never throws. */
export const parseFlashcards = (raw: string): Array<{ front: string; back: string }> => {
  if (!raw) return [];
  const out: Array<{ front: string; back: string }> = [];
  const pushValid = (f: unknown, b: unknown) => {
    const front = typeof f === 'string' ? f.trim() : '';
    const back = typeof b === 'string' ? b.trim() : '';
    if (front && back) out.push({ front, back });
  };
  // 1) JSON array (optionally inside ```json fences or surrounded by prose).
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr)) {
        for (const c of arr) pushValid(c?.front ?? c?.q ?? c?.question, c?.back ?? c?.a ?? c?.answer);
        if (out.length) return out;
      }
    } catch { /* fall through to line parse */ }
  }
  // 2) Loose "Q:/A:" or "Front:/Back:" pairs.
  const lines = raw.split('\n');
  let front = '';
  for (const line of lines) {
    const q = line.match(/^\s*(?:Q|Question|Front)\s*[:.)-]\s*(.+)/i);
    const a = line.match(/^\s*(?:A|Answer|Back)\s*[:.)-]\s*(.+)/i);
    if (q) front = q[1].trim();
    else if (a && front) { pushValid(front, a[1].trim()); front = ''; }
  }
  return out;
};

const DAY_MS = 86_400_000;

/**
 * SM-2-style scheduler. Returns the next review state for a card given the user's grade.
 * - again: reset; due in ~10 minutes (relearn this session).
 * - hard/good/easy: grow the interval by the ease factor; ease adjusts; floored at 1.3.
 */
export const scheduleNext = (
  card: Pick<Flashcard, 'ease' | 'intervalDays' | 'reps'>,
  grade: Grade,
  now: Date,
): Pick<Flashcard, 'ease' | 'intervalDays' | 'reps' | 'due'> => {
  let ease = card.ease || 2.5;
  let reps = card.reps || 0;
  let intervalDays = card.intervalDays || 0;

  if (grade === 'again') {
    return { ease: Math.max(1.3, ease - 0.2), intervalDays: 0, reps: 0, due: new Date(now.getTime() + 10 * 60_000).toISOString() };
  }
  if (grade === 'hard') ease = Math.max(1.3, ease - 0.15);
  if (grade === 'easy') ease += 0.15;

  reps += 1;
  if (reps === 1) intervalDays = grade === 'easy' ? 3 : 1;
  else if (reps === 2) intervalDays = grade === 'hard' ? 4 : 6;
  else intervalDays = Math.round(intervalDays * (grade === 'hard' ? Math.max(1.2, ease - 0.4) : grade === 'easy' ? ease * 1.3 : ease));
  intervalDays = Math.max(1, intervalDays);

  return { ease, intervalDays, reps, due: new Date(now.getTime() + intervalDays * DAY_MS).toISOString() };
};

/** A card with a corrupt/unparsable `due` is treated as DUE (it surfaces for review and gets a
 *  fresh valid date on answer) instead of silently dropping out of every session forever. */
export const isDue = (card: { due: string }, now: Date): boolean => {
  const t = new Date(card.due).getTime();
  return Number.isNaN(t) ? true : t <= now.getTime();
};

/** Newly-created card defaults (due immediately). */
export const newCardState = (now: Date): Pick<Flashcard, 'ease' | 'intervalDays' | 'reps' | 'due'> => ({
  ease: 2.5, intervalDays: 0, reps: 0, due: now.toISOString(),
});
