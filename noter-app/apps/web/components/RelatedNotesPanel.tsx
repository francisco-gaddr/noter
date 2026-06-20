'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentSearchNotes, type Note, type Task } from '@repo/shared'
import { useStore } from '../stores/useStore'
import { getFeatureSettings } from '../services/featureSettings'

/**
 * #1 Inline auto-linking — surfaces related notes/tasks as you write, LIVE. Uses the shared lock-safe
 * agentSearchNotes() (lexical + rerank — no embedding/AI call, no cost, no stale-index issue), keyed
 * off the current note's title + content, so it refreshes as the draft saves. Gated by the
 * `autoLink` feature toggle. Locked notes can never appear (enforced in the shared helper).
 */
export function RelatedNotesPanel() {
  const { t } = useTranslation()
  const notes = useStore((s) => s.notes)
  const tasks = useStore((s) => s.tasks)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const selectNote = useStore((s) => s.selectNote)
  const [settingsTick, setSettingsTick] = useState(0)

  useEffect(() => {
    const h = () => setSettingsTick((n) => n + 1)
    window.addEventListener('noter:feature-settings-changed', h)
    return () => window.removeEventListener('noter:feature-settings-changed', h)
  }, [])

  const enabled = useMemo(() => getFeatureSettings().autoLink.enabled, [settingsTick])

  const related = useMemo(() => {
    if (!enabled || !selectedNoteId) return []
    const note = (notes as Note[]).find((n) => n._id === selectedNoteId)
    if (!note) return []
    const query = `${note.title || ''} ${note.content || ''}`
    return agentSearchNotes(notes as Note[], tasks as Task[], query, 6)
      .filter((r) => r.id !== selectedNoteId)
      .slice(0, 5)
  }, [enabled, selectedNoteId, notes, tasks])

  if (!enabled || related.length === 0) return null

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
              className="w-full text-left text-sm text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-2 py-0.5"
              title={r.snippet || r.title}
            >
              <span className="truncate">{r.title?.trim() || t('relatedNotes.untitled')}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
