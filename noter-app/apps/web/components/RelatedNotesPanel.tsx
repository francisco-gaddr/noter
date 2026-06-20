'use client'

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { relatedNotes, type Note, type Task } from '@repo/shared'
import { useStore } from '../stores/useStore'
import { getVectorIndex, getEmbeddingsConfig } from '../services/ai/embeddingsService'

/**
 * "Related notes" — the most semantically similar notes/tasks to the one being edited, from the local
 * embedding index. Pure reuse of the shared lock-safe relatedNotes() (no AI/network call, no cost).
 * Renders nothing when there's no selection, no index yet, or nothing related — so it's invisible
 * until embeddings exist. Locked notes can never appear (enforced in the shared helper).
 */
export function RelatedNotesPanel() {
  const { t } = useTranslation()
  const notes = useStore((s) => s.notes)
  const tasks = useStore((s) => s.tasks)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const selectNote = useStore((s) => s.selectNote)

  const related = useMemo(() => {
    if (!selectedNoteId) return []
    try {
      const index = getVectorIndex(getEmbeddingsConfig().model)
      return relatedNotes(index, selectedNoteId, notes as Note[], tasks as Task[], 5)
    } catch {
      return []
    }
  }, [selectedNoteId, notes, tasks])

  if (!selectedNoteId || related.length === 0) return null

  return (
    <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-3 px-2" aria-label={t('relatedNotes.title')}>
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
        {t('relatedNotes.title')}
      </div>
      <ul className="space-y-1">
        {related.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => selectNote(r.id)}
              className="w-full text-left text-sm text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-between gap-2 py-0.5"
              title={r.snippet || r.title}
            >
              <span className="truncate">{r.title?.trim() || t('relatedNotes.untitled')}</span>
              <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{Math.round(r.score * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
