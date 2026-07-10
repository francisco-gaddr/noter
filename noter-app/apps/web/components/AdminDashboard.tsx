'use client';

import React from 'react';
import { useStore } from '../stores/useStore';
import { AdminCleanup } from './AdminCleanup';
import { computeTaskInsights, computeNoteInsights, computeProductivityStats, computeAgentStats, toolUsageLabel, type ToolUsageRow } from '@repo/shared';
import { getApiBaseUrl } from '../services/api';
import { readStoredToken } from '../lib/authStorage';
import { getToolUsageRows, getAllUsageRows } from '../services/ai/usageTracker';
import type { UsageSnapshot } from '../services/ai/usageTracker';

interface AdminOverview {
  server: { version: string; securityLevel: string; uptimeSec: number; node: string; env: string };
  db: { ok: boolean; readyState: number };
  counts: { notes: number; tasks: number; openTasks: number; aiConversations: number; aiMessages: number };
  generatedAt: string;
}

const fmtUptime = (sec: number): string => {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'default' }> = ({ label, value, tone = 'default' }) => {
  const toneClass =
    tone === 'ok' ? 'text-green-600 dark:text-green-400'
    : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
    : 'text-gray-900 dark:text-gray-100';
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
};

/**
 * Account admin dashboard: live server posture (version, security level, DB, uptime)
 * from /api/admin/overview, plus client-side insights computed from the already-
 * decrypted notes/tasks via the shared insights module (so no plaintext leaves the
 * device for the "AI/task" metrics).
 */
export const AdminDashboard: React.FC = () => {
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const [overview, setOverview] = React.useState<AdminOverview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const taskInsights = React.useMemo(() => computeTaskInsights(tasks as any, new Date()), [tasks]);
  const noteInsights = React.useMemo(() => computeNoteInsights(notes as any), [notes]);
  const productivity = React.useMemo(() => computeProductivityStats(tasks as any, new Date()), [tasks]);
  const agentStats = React.useMemo(() => computeAgentStats(tasks as any), [tasks]);
  const [toolRows, setToolRows] = React.useState<ToolUsageRow[]>([]);
  const [usageRows, setUsageRows] = React.useState<UsageSnapshot[]>([]);
  const refreshAiStats = React.useCallback(() => {
    try { setToolRows(getToolUsageRows()); setUsageRows(getAllUsageRows()); } catch { /* local metrics */ }
  }, []);
  React.useEffect(() => { refreshAiStats(); }, [refreshAiStats]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = readStoredToken();
      const res = await fetch(`${getApiBaseUrl()}/admin/overview`, {
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        // A hung backend must reject into the catch/finally (otherwise "Uppdaterar…" spins forever).
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOverview(await res.json());
    } catch (e: any) {
      setError(e?.message || 'Kunde inte hämta serverstatus');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">Adminöversikt</h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-xs disabled:opacity-50"
        >
          {loading ? 'Uppdaterar…' : 'Uppdatera'}
        </button>
      </div>

      <details open>
        <summary className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 cursor-pointer select-none">Server</summary>
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Status" value={overview ? (overview.db.ok ? 'OK' : 'Degraderad') : '—'} tone={overview?.db.ok ? 'ok' : 'warn'} />
            <Stat label="Version" value={overview?.server.version ?? '—'} />
            <Stat label="Säkerhetsnivå" value={overview?.server.securityLevel ?? '—'} />
            <Stat label="Upptid" value={overview ? fmtUptime(overview.server.uptimeSec) : '—'} />
            <Stat label="Node" value={overview?.server.node ?? '—'} />
            <Stat label="Miljö" value={overview?.server.env ?? '—'} />
          </div>
        )}
      </details>

      <details open>
        <summary className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 cursor-pointer select-none">Konto (på servern)</summary>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="Anteckningar" value={overview?.counts.notes ?? '—'} />
          <Stat label="Uppgifter" value={overview?.counts.tasks ?? '—'} />
          <Stat label="AI-trådar" value={overview?.counts.aiConversations ?? '—'} />
          <Stat label="AI-meddelanden" value={overview?.counts.aiMessages ?? '—'} />
        </div>
      </details>

      <details>
        <summary className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 cursor-pointer select-none">Uppgiftsinsikter (denna enhet)</summary>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Aktiva" value={taskInsights.active} />
          <Stat label="Förfallna" value={taskInsights.overdue} tone={taskInsights.overdue > 0 ? 'warn' : 'default'} />
          <Stat label="Idag" value={taskInsights.dueToday} />
          <Stat label="Denna vecka" value={taskInsights.dueThisWeek} />
          <Stat label="Klart" value={`${Math.round(taskInsights.completionRate * 100)}%`} tone="ok" />
          <Stat label="Hög prio" value={taskInsights.byPriority.high} />
          <Stat label="Projekt" value={noteInsights.projects} />
          <Stat label="Uppgiftslistor" value={noteInsights.taskLists} />
        </div>
      </details>

      <details data-testid="admin-ai-stats">
        <summary className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 cursor-pointer select-none">AI-användning (denna enhet, krypterat lokalt)</summary>
        <div className="flex justify-end mb-1">
          <button type="button" onClick={refreshAiStats} className="text-[11px] text-blue-600 dark:text-blue-400">Uppdatera</button>
        </div>
        {usageRows.length === 0 && toolRows.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">Ingen AI-användning registrerad ännu.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-800">
              <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">Verktyg/skills (idag · månad · totalt)</div>
              {toolRows.length === 0 ? <p className="text-[11px] text-gray-400">Inga verktygsanrop ännu.</p> : toolRows.slice(0, 12).map((r) => (
                <div key={r.tool} className="flex justify-between text-[11px] py-0.5">
                  <span className="text-gray-700 dark:text-gray-200 truncate">{toolUsageLabel(r.tool)}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2 tabular-nums">{r.countDay} · {r.countMonth} · {r.total}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-800">
              <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">Tokens per modell (idag · månad)</div>
              {usageRows.length === 0 ? <p className="text-[11px] text-gray-400">Inga API-anrop ännu.</p> : usageRows.slice(0, 12).map((u) => (
                <div key={`${u.provider}:${u.model}`} className="flex justify-between text-[11px] py-0.5">
                  <span className="text-gray-700 dark:text-gray-200 truncate">{u.provider} · {u.model}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2 tabular-nums">{u.tokensDay.toLocaleString('sv-SE')} · {u.tokensMonth.toLocaleString('sv-SE')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </details>

      <details data-testid="admin-productivity">
        <summary className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 cursor-pointer select-none">Produktivitet (mätbar, denna enhet)</summary>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Klara 7 dgr" value={productivity.completedLast7} tone="ok" />
          <Stat label="Klara 30 dgr" value={productivity.completedLast30} />
          <Stat label="Skapade 7 dgr" value={productivity.createdLast7} />
          <Stat label="Svit (dagar)" value={productivity.currentStreakDays} tone={productivity.currentStreakDays > 0 ? 'ok' : 'default'} />
          <Stat label="Snitt/aktiv dag" value={productivity.avgPerActiveDay ? productivity.avgPerActiveDay.toFixed(1) : '0'} />
          <Stat label="Genomflöde 7d" value={`${Math.round(productivity.throughputRatio7 * 100)}%`} tone={productivity.throughputRatio7 >= 1 ? 'ok' : 'default'} />
        </div>
        <div className="mt-2 flex items-end gap-1 h-12" aria-label="Klara uppgifter per dag (7 dagar)">
          {productivity.perDay.map((d) => {
            const max = Math.max(1, ...productivity.perDay.map((x) => x.completed));
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center justify-end" title={`${d.date}: ${d.completed}`}>
                <div className="w-full rounded-t bg-blue-500/70" style={{ height: `${(d.completed / max) * 100}%`, minHeight: d.completed ? 4 : 1 }} />
                <span className="text-[9px] text-gray-400 mt-0.5">{d.date.slice(8)}</span>
              </div>
            );
          })}
        </div>
      </details>

      {agentStats.delegated > 0 && (
        <details data-testid="admin-orchestration">
          <summary className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 cursor-pointer select-none">AI-orkestrering (delegerade uppgifter)</summary>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Delegerade" value={agentStats.delegated} />
            <Stat label="Klara (AI)" value={agentStats.completedByAi} tone="ok" />
            <Stat label="Väntar" value={agentStats.scheduled} />
            <Stat label="Fel" value={agentStats.errors} tone={agentStats.errors > 0 ? 'warn' : 'default'} />
            <Stat label="Körningar totalt" value={agentStats.totalRuns} />
            <Stat label="Endast lokalt" value={agentStats.localOnly} />
            <Stat label="På servern (Pi)" value={agentStats.onBackend} />
            <Stat label="Källor" value={`L${agentStats.bySource.local}·H${agentStats.bySource.hermes}·A${agentStats.bySource.api}`} />
          </div>
          {agentStats.byModel.length > 0 && (
            <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-800">
              <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">Modeller i bruk</div>
              {agentStats.byModel.slice(0, 10).map((m) => (
                <div key={m.model} className="flex justify-between text-[11px] py-0.5">
                  <span className="text-gray-700 dark:text-gray-200 truncate">{m.model}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2 tabular-nums">{m.count}</span>
                </div>
              ))}
            </div>
          )}
        </details>
      )}

      <AdminCleanup />
    </div>
  );
};

export default AdminDashboard;
