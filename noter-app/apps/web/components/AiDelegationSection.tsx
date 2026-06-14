'use client';
/**
 * "Delegate to AI" section for the web/Electron task modal. Mirrors the mobile
 * AiDelegationSection: pick model source/provider/model, local-only, instructions,
 * run now, and see a transparent log of what the agent read/did last run.
 */
import React, { useEffect, useState, useCallback } from 'react';
import type { AiTaskDelegation, AiTaskSource, Task } from '@repo/shared';
import { API_PROVIDER_LIST } from '../services/ai/apiProviders';
import { getDelegations, setDelegation, removeDelegation, getRunLog, type AgentRunLogEntry } from '../services/ai/agentDelegations';
import { runAgentTaskNow } from '../services/ai/agentScheduler';
import { graphqlRequest } from '../services/apiClient';
import { serializeAiDelegation } from '@repo/shared';
import { useStore } from '../stores/useStore';

const UPDATE_TASK_MUT = 'mutation($id:String!,$input:TaskInput!){updateTask(id:$id,input:$input){_id}}';
const syncBackend = (taskId: string, aiAgent: string) =>
  graphqlRequest(UPDATE_TASK_MUT, { id: taskId, input: { aiAgent } }).catch(() => undefined);

const accessLabel = (kind: string): string => ({
  note: 'Läste anteckning', task: 'Läste uppgift', list: 'Läste uppgiftslista',
  project: 'Läste projektmapp', instruction: 'Läste instruktion', search: 'Sökte/verktyg',
}[kind] || 'Åtkomst');

export const AiDelegationSection: React.FC<{ task: Task }> = ({ task }) => {
  const user = useStore((s) => s.user) as any;
  const userId: string | undefined = user?._id || user?.id || undefined;
  const [delegation, setLocalDelegation] = useState<AiTaskDelegation | null>(null);
  const [runLog, setRunLog] = useState<AgentRunLogEntry | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(() => {
    setLocalDelegation(getDelegations(userId)[task._id] ?? null);
    setRunLog(getRunLog(userId)[task._id] ?? null);
  }, [task._id, userId]);
  useEffect(() => { refresh(); }, [refresh]);

  const enabled = !!delegation && delegation.assignee === 'ai';
  const d: AiTaskDelegation = delegation ?? { assignee: 'user' };

  const persist = (next: AiTaskDelegation | null) => {
    setLocalDelegation(next);
    if (next && next.assignee === 'ai') {
      setDelegation(task._id, next, userId);
      // Mirror to the always-on backend when opted into server execution.
      void syncBackend(task._id, next.runOnBackend ? serializeAiDelegation(next) : '');
    } else {
      removeDelegation(task._id, userId);
      void syncBackend(task._id, '');
    }
  };
  const patch = (p: Partial<AiTaskDelegation>) => { if (enabled) persist({ ...d, ...p }); };

  const providersForSource = (source?: AiTaskSource) =>
    source === 'hermes' ? API_PROVIDER_LIST.filter((p) => p.configurableEndpoint) : API_PROVIDER_LIST.filter((p) => !p.configurableEndpoint);

  const toggle = (on: boolean) => {
    if (on) {
      const fp = providersForSource('api')[0];
      persist({ assignee: 'ai', source: 'api', provider: fp?.id, model: fp?.defaultModels[0], localOnly: false, toolUse: true, status: 'idle', runCount: 0 });
    } else persist(null);
  };

  const runNow = async () => {
    setRunning(true);
    try { await runAgentTaskNow(task); refresh(); } finally { setRunning(false); }
  };

  const inputCls = 'w-full border rounded p-2 text-sm dark:bg-gray-900 dark:border-gray-700';

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
      <label className="flex items-center justify-between mb-1">
        <span className="font-semibold text-gray-800 dark:text-gray-100">Delegera till AI-agenten</span>
        <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} data-testid="ai-delegate-toggle" />
      </label>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">AI-agenten utför uppgiften vid förfallodatumet enligt titel + beskrivning. Lagras krypterat lokalt.</p>

      {enabled && (
        <div className="space-y-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">Modellkälla</label>
            <select className={inputCls} value={d.source ?? 'api'} onChange={(e) => patch({ source: e.target.value as AiTaskSource, provider: providersForSource(e.target.value as AiTaskSource)[0]?.id })}>
              <option value="api">API</option>
              <option value="hermes">Hermes</option>
              <option value="local">Lokal</option>
            </select>
          </div>
          {d.source !== 'local' && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">Provider</label>
              <select className={inputCls} value={d.provider ?? ''} onChange={(e) => patch({ provider: e.target.value, model: API_PROVIDER_LIST.find((p) => p.id === e.target.value)?.defaultModels[0] })}>
                {providersForSource(d.source).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">Modell</label>
            <input className={inputCls} value={d.model ?? ''} onChange={(e) => patch({ model: e.target.value })} data-testid="ai-delegate-model" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">Extra instruktioner (valfritt)</label>
            <textarea className={inputCls} rows={2} value={d.instructions ?? ''} onChange={(e) => patch({ instructions: e.target.value })} />
          </div>
          <label className="flex items-center justify-between text-sm">
            <span>Endast lokalt (synka inte)</span>
            <input type="checkbox" checked={!!d.localOnly} onChange={(e) => patch({ localOnly: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span>Tillåt verktyg (skapa/läsa uppgifter)</span>
            <input type="checkbox" checked={d.toolUse !== false} onChange={(e) => patch({ toolUse: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span>Kör på servern (always-on)</span>
            <input type="checkbox" checked={!!d.runOnBackend} onChange={(e) => patch({ runOnBackend: e.target.checked })} data-testid="ai-delegate-run-on-backend" />
          </label>
          {d.source === 'api' && d.runOnBackend && (
            <p className="text-[11px] text-red-600 dark:text-red-400">Serverkörning stödjer endast Hermes/lokal (servern saknar din API-nyckel). Välj Hermes-källa.</p>
          )}
          <label className="flex items-center justify-between text-sm">
            <span>Notis när agenten startar</span>
            <input type="checkbox" checked={!!d.notify?.onStart} onChange={(e) => patch({ notify: { ...(d.notify || {}), onStart: e.target.checked } })} />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span>Notis när agenten är klar</span>
            <input type="checkbox" checked={d.notify?.onFinish !== false} onChange={(e) => patch({ notify: { ...(d.notify || {}), onFinish: e.target.checked } })} />
          </label>

          <button type="button" onClick={runNow} disabled={running} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50" data-testid="ai-delegate-run-now">
            {running ? 'Kör…' : '▶ Kör nu'}
          </button>
          {d.status && d.status !== 'idle' && (
            <div className="text-xs text-gray-500 dark:text-gray-400">Status: {d.status}{d.lastRunAt ? ` · ${new Date(d.lastRunAt).toLocaleString('sv-SE')}` : ''}</div>
          )}

          {runLog && (
            <div className="mt-2 p-2 rounded border border-gray-200 dark:border-gray-700">
              <div className="text-xs font-semibold mb-1">Senaste körning ({runLog.stopped})</div>
              {runLog.summary && <div className="text-xs mb-1">{runLog.summary}</div>}
              {runLog.accesses.length > 0 ? (
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  <div className="font-semibold mb-0.5">Transparent åtkomstlogg:</div>
                  {runLog.accesses.map((a, i) => (
                    <div key={`${a.kind}-${i}`}>• {accessLabel(a.kind)}{a.title ? `: ${a.title}` : a.id ? ` (${a.id.slice(0, 8)})` : ''}</div>
                  ))}
                </div>
              ) : <div className="text-[11px] text-gray-500 dark:text-gray-400">Ingen läsåtkomst denna körning.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AiDelegationSection;
