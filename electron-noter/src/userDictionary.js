/**
 * Pure helpers for the spell-check user dictionary.
 *
 * Electron's spellchecker exposes `session.addWordToSpellCheckerDictionary`
 * but doesn't persist across reinstalls or sync between profiles. We
 * mirror added words into settings.json so they survive reinstalls.
 *
 * Validation rules:
 *   - Word must be 1–64 chars
 *   - Letters / digits / hyphen / apostrophe only (Unicode-aware)
 *   - Stripped of leading/trailing whitespace
 *   - Case-preserving (so "iPhone" doesn't collapse to "iphone")
 *
 * Pure here so tests don't need Electron's session module.
 */

// Letters (any script), digits, hyphen, apostrophe (straight + curly).
const WORD_PATTERN = /^[\p{L}\p{M}\p{N}'’\-]{1,64}$/u;

const sanitiseWord = (raw) => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  if (!WORD_PATTERN.test(trimmed)) return null;
  return trimmed;
};

const addWord = (existingList, word) => {
  const sanitised = sanitiseWord(word);
  if (!sanitised) return { ok: false, reason: 'invalid-word', list: existingList };
  const list = Array.isArray(existingList) ? existingList.slice() : [];
  if (list.includes(sanitised)) return { ok: true, alreadyPresent: true, list };
  list.push(sanitised);
  // Cap at a reasonable size — most native spellcheckers throttle past
  // a few thousand entries.
  if (list.length > 5000) list.splice(0, list.length - 5000);
  return { ok: true, alreadyPresent: false, list };
};

const removeWord = (existingList, word) => {
  const sanitised = sanitiseWord(word);
  if (!sanitised) return { ok: false, reason: 'invalid-word', list: existingList };
  const list = Array.isArray(existingList) ? existingList.filter((w) => w !== sanitised) : [];
  return { ok: true, list };
};

const reconcileWords = (storedList) => {
  if (!Array.isArray(storedList)) return [];
  const out = [];
  const seen = new Set();
  for (const w of storedList) {
    const s = sanitiseWord(w);
    if (s && !seen.has(s)) {
      out.push(s);
      seen.add(s);
    }
  }
  return out.slice(0, 5000);
};

module.exports = { addWord, removeWord, reconcileWords, sanitiseWord, WORD_PATTERN };
