'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaLayerGroup } from 'react-icons/fa'
import { buildFlashcardsPrompt, parseFlashcards, hasLockSignal, type Flashcard, type Grade, type Note } from '@repo/shared'
import { useStore } from '../stores/useStore'
import { getFeatureSettings } from '../services/featureSettings'
import { runFeatureCompletion } from '../services/ai/featureCompletion'
import { addCardsForNote, cardsForNote, reviewCard } from '../services/flashcards'

/** #2 Spaced-repetition flashcards. Gated by the `flashcards` feature toggle; generates cards from the
 *  current note via the user's chosen source/model, then reviews them with SM-2 scheduling. */
export function FlashcardsPanel() {
  const { t, i18n } = useTranslation()
  const notes = useStore((s) => s.notes)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const unlocked = useStore((s) => s.unlockedProtectedNoteIds)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    const h = () => setTick((n) => n + 1)
    window.addEventListener('noter:feature-settings-changed', h)
    window.addEventListener('noter:flashcards-changed', h)
    return () => { window.removeEventListener('noter:feature-settings-changed', h); window.removeEventListener('noter:flashcards-changed', h) }
  }, [])

  const enabled = useMemo(() => getFeatureSettings().flashcards.enabled, [tick])
  const note = (notes as Note[]).find((n) => n._id === selectedNoteId)
  const locked = note ? hasLockSignal(note as any) && !(unlocked || []).includes(note._id) : true
  const cards = useMemo(() => (selectedNoteId ? cardsForNote(selectedNoteId) : []), [selectedNoteId, tick])

  if (!enabled || !note || locked) return null

  const generate = async () => {
    setBusy(true); setMsg('')
    try {
      const ai = getFeatureSettings().flashcards.ai
      const { system, prompt } = buildFlashcardsPrompt(note.title || '', note.content || '', { language: i18n.language })
      const text = await runFeatureCompletion(ai, system, prompt)
      const pairs = parseFlashcards(text)
      const n = addCardsForNote(note._id, pairs)
      setMsg(n > 0 ? t('flashcards.created', { count: n }) : t('flashcards.none'))
    } catch (e) {
      setMsg((e as Error)?.message || t('flashcards.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 px-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={generate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 disabled:opacity-50"
        >
          <FaLayerGroup className="w-3 h-3" />
          {busy ? t('flashcards.generating') : t('flashcards.create')}
        </button>
        {cards.length > 0 && (
          <button onClick={() => setReviewing(true)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
            {t('flashcards.review', { count: cards.length })}
          </button>
        )}
        {msg && <span className="text-xs text-gray-500 dark:text-gray-400">{msg}</span>}
      </div>
      {reviewing && <ReviewModal cards={cards} onClose={() => { setReviewing(false); setTick((n) => n + 1) }} />}
    </div>
  )
}

function ReviewModal({ cards, onClose }: { cards: Flashcard[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [queue, setQueue] = useState<Flashcard[]>(cards)
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const card = queue[idx]

  const grade = (g: Grade) => {
    if (card) reviewCard(card.id, g)
    setFlipped(false)
    if (idx + 1 >= queue.length) onClose()
    else setIdx(idx + 1)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{idx + 1} / {queue.length}</div>
        {!card ? (
          <div className="text-center text-gray-600 dark:text-gray-300 py-8">{t('flashcards.done')}</div>
        ) : (
          <>
            <div className="min-h-[6rem] flex items-center justify-center text-center text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
              {flipped ? card.back : card.front}
            </div>
            {!flipped ? (
              <button onClick={() => setFlipped(true)} className="mt-4 w-full bg-blue-500 text-white rounded py-2 hover:bg-blue-600">
                {t('flashcards.show')}
              </button>
            ) : (
              <div className="mt-4 grid grid-cols-4 gap-2">
                <button onClick={() => grade('again')} className="rounded py-2 text-sm bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">{t('flashcards.again')}</button>
                <button onClick={() => grade('hard')} className="rounded py-2 text-sm bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">{t('flashcards.hard')}</button>
                <button onClick={() => grade('good')} className="rounded py-2 text-sm bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">{t('flashcards.good')}</button>
                <button onClick={() => grade('easy')} className="rounded py-2 text-sm bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">{t('flashcards.easy')}</button>
              </div>
            )}
          </>
        )}
        <button onClick={onClose} className="mt-4 w-full text-xs text-gray-500 dark:text-gray-400 hover:underline">{t('flashcards.close')}</button>
      </div>
    </div>
  )
}
