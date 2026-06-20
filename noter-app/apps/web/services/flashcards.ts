import { encrypt, safeDecrypt, scheduleNext, isDue, newCardState, type Flashcard, type Grade } from '@repo/shared'

// Flashcards are note-derived content → stored ENCRYPTED at rest (parity with the E2E model), local to
// the device for now (MVP; sync is a follow-up).
const KEY = 'flashcards_v1'

const uid = (): string => { try { return crypto.randomUUID() } catch { return `fc_${Date.now()}_${Math.random().toString(36).slice(2)}` } }

export const getFlashcards = (): Flashcard[] => {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(safeDecrypt(raw, '') || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

const save = (cards: Flashcard[]): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, encrypt(JSON.stringify(cards)))
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('noter:flashcards-changed'))
  } catch { /* best-effort */ }
}

export const cardsForNote = (noteId: string): Flashcard[] => getFlashcards().filter((c) => c.noteId === noteId)
export const dueCards = (now = new Date()): Flashcard[] => getFlashcards().filter((c) => isDue(c, now))

/** Add freshly-generated {front,back} pairs as new (due-now) cards for a note. Returns how many added. */
export const addCardsForNote = (noteId: string, pairs: Array<{ front: string; back: string }>): number => {
  if (!pairs.length) return 0
  const now = new Date()
  const cards = getFlashcards()
  for (const p of pairs) {
    cards.push({ id: uid(), noteId, front: p.front, back: p.back, createdAt: now.toISOString(), ...newCardState(now) })
  }
  save(cards)
  return pairs.length
}

/** Grade a card → reschedule it (SM-2). */
export const reviewCard = (id: string, grade: Grade, now = new Date()): void => {
  const cards = getFlashcards()
  const i = cards.findIndex((c) => c.id === id)
  if (i < 0) return
  cards[i] = { ...cards[i], ...scheduleNext(cards[i], grade, now) }
  save(cards)
}

export const deleteCardsForNote = (noteId: string): void => save(getFlashcards().filter((c) => c.noteId !== noteId))
