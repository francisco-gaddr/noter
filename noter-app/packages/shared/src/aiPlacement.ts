/**
 * Where should an AI-created note / task land?
 *
 * Priority (used by the chat + agent executors):
 *   1. An explicit target the user/model chose (parentId / parentNoteId).
 *   2. The best-matching EXISTING project folder / task list (token overlap heuristic — works even
 *      for weak local models that don't set a folder themselves).
 *   3. Fallback: a default, clearly-AI-named container that we find-or-create.
 *
 * Pure + dependency-free so it's unit-testable and shared across mobile/web/backend.
 */

/** Default container titles — short + clearly indicate the note/task was created by the AI. */
export const AI_DEFAULT_NOTE_FOLDER_TITLE = 'AI-anteckningar';
export const AI_DEFAULT_TASKLIST_TITLE = 'AI-uppgifter';

const STOPWORDS = new Set([
  // sv
  'och', 'eller', 'att', 'en', 'ett', 'den', 'det', 'de', 'som', 'för', 'med', 'på', 'av', 'i',
  'till', 'om', 'är', 'var', 'har', 'jag', 'du', 'vi', 'min', 'mitt', 'mina', 'ny', 'nytt',
  // en
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'my', 'new',
  'note', 'task', 'anteckning', 'uppgift', 'lista', 'mapp', 'projekt',
]);

const tokenize = (s: string): string[] =>
  String(s || '')
    .toLowerCase()
    // Split on runs of non-letter/digit. `à-öø-ÿ` keeps accented + Swedish åäö without needing the
    // unicode `u` flag (which isn't available under the shared package's es5 target).
    .split(/[^a-z0-9à-öø-ÿ]+/i)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

export interface PlacementContainer { id: string; title: string }

/**
 * Pick the existing container whose title best overlaps the note/task text. Returns its id, or
 * null when nothing clears a minimum-confidence bar (→ caller uses the default AI container).
 */
export const pickBestContainer = (
  text: string,
  containers: PlacementContainer[],
): string | null => {
  const words = new Set(tokenize(text));
  if (words.size === 0 || !Array.isArray(containers) || containers.length === 0) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  for (const c of containers) {
    if (!c || !c.id) continue;
    const titleTokens = tokenize(c.title);
    if (titleTokens.length === 0) continue;
    let hits = 0;
    for (const t of titleTokens) if (words.has(t)) hits += 1;
    // Score = overlap normalised by the folder title length, so a tight 1-word folder that fully
    // matches beats a long folder with one incidental hit.
    const score = hits / Math.max(1, titleTokens.length);
    // Require at least one real token hit AND a reasonable fraction of the title to match.
    if (hits >= 1 && score > bestScore && score >= 0.34) {
      bestScore = score;
      bestId = c.id;
    }
  }
  return bestId;
};
