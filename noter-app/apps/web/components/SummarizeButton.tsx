'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { FaWandMagicSparkles } from 'react-icons/fa6'
import { buildNoteSummaryPrompt, hasLockSignal, type Note } from '@repo/shared'
import { useStore } from '../stores/useStore'

/**
 * "Summarize" the current note with AI. Runs the summary prompt through the assistant's EXISTING send
 * pipeline (via a window event) — so it uses whatever model/source the user selected there (local,
 * any API provider, or a custom endpoint) and the summary streams into the chat where AI output lives.
 * No new model-call code, no duplicated provider config.
 *
 * LOCK-SAFETY: hidden for a locked note that hasn't been unlocked this session — locked content is
 * never fed to the model.
 */
export function SummarizeButton() {
  const { t, i18n } = useTranslation()
  const notes = useStore((s) => s.notes)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const unlocked = useStore((s) => s.unlockedProtectedNoteIds)

  const note = notes.find((n) => n._id === selectedNoteId) as Note | undefined
  if (!note) return null
  const isLocked = hasLockSignal(note as any) && !(unlocked || []).includes(note._id)
  if (isLocked) return null

  const onSummarize = () => {
    const { system, prompt } = buildNoteSummaryPrompt(note.title || '', note.content || '', { language: i18n.language })
    // The chat applies its own system prompt, so fold our instruction into the user turn.
    const text = `${system}\n\n${prompt}`
    window.dispatchEvent(new CustomEvent('noter:summarize-note', { detail: { prompt: text } }))
  }

  return (
    <button
      onClick={onSummarize}
      className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 border border-gray-300 dark:border-gray-600 rounded px-2 py-1"
      title={t('summarize.hint')}
    >
      <FaWandMagicSparkles className="w-3 h-3" />
      {t('summarize.action')}
    </button>
  )
}
