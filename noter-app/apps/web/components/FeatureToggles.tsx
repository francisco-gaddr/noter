'use client'

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FeatureSettings } from '@repo/shared'
import { getFeatureSettings, saveFeatureSettings } from '../services/featureSettings'

/** Settings panel for the creative features. Each row toggles a feature on/off; AI features also get
 *  a source/model picker (added per feature as they land). Persists to feature_settings_v1. */
export default function FeatureToggles() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<FeatureSettings>(() => getFeatureSettings())

  const update = (patch: Partial<FeatureSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveFeatureSettings(next)
  }

  return (
    <div className="space-y-3">
      <ToggleRow
        checked={settings.autoLink.enabled}
        onChange={(v) => update({ autoLink: { enabled: v } })}
        label={t('features.autoLink.label')}
        hint={t('features.autoLink.hint')}
      />
      {/* flashcards / dailyReview / voice / canvas toggles + AI pickers added as each feature lands */}
    </div>
  )
}

function ToggleRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-sm text-gray-800 dark:text-gray-100">{label}</span>
        {hint && <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`shrink-0 mt-0.5 w-10 h-6 rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span className={`block w-5 h-5 bg-white rounded-full transform transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </label>
  )
}
