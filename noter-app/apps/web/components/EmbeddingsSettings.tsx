'use client';
/**
 * Embeddings / semantic-search settings (web + Electron). Lets the user regulate how
 * semantic search works: on/off, where the embedding model runs (local Ollama /
 * self-hosted Hermes / API), which model + base URL + key, and auto-index. The
 * "Indexera nu" button (re)builds the encrypted on-device vector index over the
 * READABLE notes/tasks only — locked content is filtered out in the shared layer.
 *
 * Settings + key + index are stored encrypted at rest via embeddingsService.
 */
import React from 'react';
import { useStore } from '../stores/useStore';
import {
  DEFAULT_EMBEDDING_MODEL, DEFAULT_LOCAL_EMBEDDINGS_URL,
  type EmbeddingSource, type EmbeddingsConfig,
} from '@repo/shared';
import {
  getEmbeddingsConfig, saveEmbeddingsConfig, getEmbeddingsApiKey, saveEmbeddingsApiKey,
  indexEntities, clearVectorIndex, getIndexInfo, type IndexResult,
} from '../services/ai/embeddingsService';

const SOURCE_LABELS: Record<EmbeddingSource, string> = {
  local: 'Lokal (Ollama på denna enhet)',
  hermes: 'Hermes (egen server, t.ex. Pi)',
  api: 'API (OpenAI-kompatibel)',
};

const MODEL_SUGGESTIONS = ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm', 'text-embedding-3-small'];

export const EmbeddingsSettings: React.FC = () => {
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const unlockedIds = useStore((s) => s.unlockedProtectedNoteIds);

  const [config, setConfig] = React.useState<EmbeddingsConfig>(() => getEmbeddingsConfig());
  const [apiKey, setApiKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; toDo: number } | null>(null);
  const [result, setResult] = React.useState<IndexResult | null>(null);
  const [info, setInfo] = React.useState(() => getIndexInfo());

  React.useEffect(() => {
    setConfig(getEmbeddingsConfig());
    setApiKey(getEmbeddingsApiKey());
    setInfo(getIndexInfo());
  }, []);

  const update = (patch: Partial<EmbeddingsConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveEmbeddingsConfig(next);
    setInfo(getIndexInfo());
  };

  const onKeyBlur = () => saveEmbeddingsApiKey(apiKey.trim());

  const baseUrlPlaceholder = config.source === 'local'
    ? DEFAULT_LOCAL_EMBEDDINGS_URL
    : config.source === 'hermes'
      ? 'http://192.168.50.16:11434'
      : 'https://api.openai.com';

  const handleIndex = async () => {
    setBusy(true);
    setResult(null);
    setProgress({ done: 0, toDo: 0 });
    try {
      const res = await indexEntities(notes as any, tasks as any, new Set(unlockedIds), (done, toDo) => setProgress({ done, toDo }));
      setResult(res);
      setInfo(getIndexInfo());
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleClear = () => {
    clearVectorIndex();
    setInfo(getIndexInfo());
    setResult(null);
  };

  return (
    <div className="space-y-3" data-testid="embeddings-settings">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={config.enabled} onChange={(e) => update({ enabled: e.target.checked })} data-testid="embeddings-enabled" />
        <span className="text-sm text-gray-700 dark:text-gray-200">Aktivera semantisk sök (vektorer + RRF-fusion)</span>
      </label>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Bäddar in dina anteckningar lokalt och söker på betydelse, inte bara exakta ord. Rekommenderat: en egen modell (Ollama på Pi/denna enhet) med <code>nomic-embed-text</code> så innehållet aldrig lämnar dina enheter. Låsta anteckningar indexeras aldrig.
      </p>

      {config.enabled && (
        <div className="space-y-2 pl-1 border-l-2 border-gray-200 dark:border-gray-700">
          <div className="pl-2 space-y-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Källa</label>
              <select
                value={config.source}
                onChange={(e) => update({ source: e.target.value as EmbeddingSource })}
                className="w-full p-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                data-testid="embeddings-source"
              >
                {(Object.keys(SOURCE_LABELS) as EmbeddingSource[]).map((s) => (
                  <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Modell</label>
              <input
                list="embeddings-model-list"
                value={config.model}
                onChange={(e) => update({ model: e.target.value || DEFAULT_EMBEDDING_MODEL })}
                placeholder={DEFAULT_EMBEDDING_MODEL}
                className="w-full p-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                data-testid="embeddings-model"
              />
              <datalist id="embeddings-model-list">
                {MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                Bas-URL {config.source === 'local' && <span className="text-gray-400">(valfritt, standard {DEFAULT_LOCAL_EMBEDDINGS_URL})</span>}
              </label>
              <input
                value={config.baseUrl || ''}
                onChange={(e) => update({ baseUrl: e.target.value })}
                placeholder={baseUrlPlaceholder}
                className="w-full p-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                data-testid="embeddings-baseurl"
              />
            </div>

            {config.source !== 'local' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                  API-nyckel {config.source === 'hermes' && <span className="text-gray-400">(valfritt för LAN)</span>}
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onBlur={onKeyBlur}
                  placeholder="sk-…"
                  autoComplete="off"
                  className="w-full p-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                  data-testid="embeddings-apikey"
                />
              </div>
            )}

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={config.autoIndex} onChange={(e) => update({ autoIndex: e.target.checked })} data-testid="embeddings-autoindex" />
              <span className="text-xs text-gray-600 dark:text-gray-300">Indexera om automatiskt vid sparning</span>
            </label>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleIndex}
                disabled={busy}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
                data-testid="embeddings-index-now"
              >
                {busy ? (progress ? `Indexerar… ${progress.done}/${progress.toDo}` : 'Indexerar…') : 'Indexera nu'}
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={busy || info.total === 0}
                className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50"
                data-testid="embeddings-clear"
              >
                Rensa index
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400" data-testid="embeddings-index-count">
                {info.total} indexerade
              </span>
            </div>

            {result && (
              <p className={`text-xs ${result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {result.ok
                  ? `Klart: ${result.indexed} nya, ${result.kept} oförändrade, ${result.removed} borttagna · totalt ${result.total}.`
                  : `Fel: ${result.error}`}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmbeddingsSettings;
