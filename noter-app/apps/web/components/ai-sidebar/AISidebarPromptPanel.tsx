'use client';

import React from 'react';
import { AiPromptPreset } from '@repo/shared';

type SessionInsight = {
  id: string;
  label: string;
  value: string;
};

export const AISidebarPromptPanel = ({
  systemPrompt,
  setSystemPrompt,
  syncWithBackend,
  setSyncWithBackend,
  promptPreset,
  setPromptPreset,
  promptPresets,
  sessionInsights,
  refreshConversionHealth,
  conversionHealthLoading,
  conversionHealthText,
  conversionHealthDetailText,
}: {
  systemPrompt: string;
  setSystemPrompt: (value: string) => void;
  syncWithBackend: boolean;
  setSyncWithBackend: (value: boolean) => void;
  promptPreset: AiPromptPreset;
  setPromptPreset: (value: AiPromptPreset) => void;
  promptPresets: ReadonlyArray<{ id: AiPromptPreset }>;
  sessionInsights: SessionInsight[];
  refreshConversionHealth: () => void | Promise<void>;
  conversionHealthLoading: boolean;
  conversionHealthText: string;
  conversionHealthDetailText: string;
}) => (
  <div>
    <h4 className="font-bold mb-2">Systemprompt</h4>
    <textarea
      className="w-full border rounded p-2 text-sm dark:bg-gray-900"
      rows={4}
      value={systemPrompt}
      onChange={(e) => setSystemPrompt(e.target.value)}
      placeholder="Skriv huvudprompten för AI här"
      data-testid="ai-system-prompt"
    />
    <div className="mt-4 rounded border p-3 bg-gray-50 dark:bg-gray-800">
      <h5 className="font-bold text-sm mb-2">AI-läge och lagring</h5>
      <div className="text-xs text-gray-500 dark:text-gray-300 mb-3">
        AI-historik lagras alltid krypterat lokalt. När backend-sync är avstängd stannar chattar och projekt endast på denna enhet.
      </div>
      <label className="text-sm flex items-center gap-2">
        <input
          type="checkbox"
          checked={syncWithBackend}
          onChange={(e) => setSyncWithBackend(e.target.checked)}
        />
        Synka AI-chattar med backend
      </label>
      <div className="text-xs text-gray-500 dark:text-gray-300 mt-1">
        {syncWithBackend ? 'Krypterad ciphertext kan synkas till backend.' : 'Endast lokal krypterad lagring används.'}
      </div>
      <div className="mt-3">
        <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">Promptprofil</label>
        <select
          value={promptPreset}
          onChange={(e) => setPromptPreset(e.target.value as AiPromptPreset)}
          className="w-full p-2 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
          data-testid="ai-prompt-preset-select"
        >
          {promptPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.id === 'balanced' ? 'Balanserad' : preset.id === 'research' ? 'Research' : preset.id === 'execution' ? 'Utförande' : 'Kortfattad'}
            </option>
          ))}
        </select>
        <div className="text-xs text-gray-500 dark:text-gray-300 mt-1">
          Profilen läggs ovanpå din systemprompt och projektprompt.
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
        {sessionInsights.map((item) => (
          <div key={item.id} className="rounded border bg-white dark:bg-slate-900 p-2">
            <div className="text-[11px] uppercase tracking-wider text-gray-500">{item.label}</div>
            <div className="text-sm font-medium break-words">{item.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded border bg-white dark:bg-slate-900 p-3" data-testid="ai-conversion-health-panel">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">GGUF- och MLC-diagnostik</div>
          <button
            type="button"
            onClick={() => refreshConversionHealth()}
            className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700"
          >
            {conversionHealthLoading ? 'Kontrollerar…' : 'Uppdatera'}
          </button>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-300 mt-2">
          Visar om MLC-binären kan hittas, vilken kommando-upplösning som används och om GGUF → MLC-konvertering är redo.
        </div>
        {conversionHealthText ? (
          <div className="text-sm mt-2">{conversionHealthText}</div>
        ) : null}
        {conversionHealthDetailText ? (
          <div className="text-xs text-gray-500 dark:text-gray-300 mt-1 break-words">{conversionHealthDetailText}</div>
        ) : null}
      </div>
    </div>
  </div>
);
