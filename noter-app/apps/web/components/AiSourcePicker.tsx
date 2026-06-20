'use client'

import React, { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FeatureAiConfig } from '@repo/shared'
import { listAiOptions, type AiOption } from '../services/ai/featureCompletion'

/** Source + model picker for an AI feature. Lists the sources the user already configured (local /
 *  each API provider with a key / custom Hermes) and lets them pick a model. Reused by every AI
 *  feature's settings row. */
export function AiSourcePicker({ value, onChange }: { value: FeatureAiConfig; onChange: (c: FeatureAiConfig) => void }) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<AiOption[]>([])
  const listId = useId()

  useEffect(() => { listAiOptions().then(setOptions).catch(() => setOptions([])) }, [])

  const current = options.find((o) => o.id === value.provider)

  return (
    <div className="flex flex-wrap items-center gap-2 mt-1">
      <select
        value={value.provider || ''}
        onChange={(e) => {
          const o = options.find((x) => x.id === e.target.value)
          if (o) onChange({ source: o.source, provider: o.id, model: o.model })
        }}
        className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      >
        {options.length === 0 && <option value="">{t('features.ai.none')}</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <input
        value={value.model || ''}
        onChange={(e) => onChange({ ...value, model: e.target.value })}
        placeholder={t('features.ai.model')}
        list={listId}
        className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-44"
      />
      <datalist id={listId}>
        {(current?.models || []).map((m) => <option key={m} value={m} />)}
      </datalist>
    </div>
  )
}
