/**
 * Account admin dashboard (mobile) — parity with apps/web/components/AdminDashboard.
 * Live server posture from /api/admin/overview, plus client-side insights / productivity
 * / AI-orchestration stats computed from the already-decrypted notes/tasks via the shared
 * insights module (no plaintext leaves the device for the metrics). Embeds AdminCleanup.
 *
 * Everything renders as plain rows (no fixed-height clipping) so it's fully visible inside
 * the settings ScrollView — nothing is cut off.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, useTheme, ActivityIndicator } from 'react-native-paper';
import {
  computeTaskInsights, computeNoteInsights, computeProductivityStats, computeAgentStats,
  toolUsageLabel, type ToolUsageRow,
} from '@repo/shared';
import { useStore } from '@/stores/useStore';
import { API_URL, getAuthToken } from '@/services/api';
import { getToolUsageRows, getAllUsageRows, type UsageSnapshot } from '@/services/ai/usageTracker';
import { AdminCleanup } from './AdminCleanup';

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
  const theme = useTheme();
  const color = tone === 'ok' ? '#16a34a' : tone === 'warn' ? '#d97706' : theme.colors.onSurface;
  return (
    <View style={[styles.stat, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.elevation.level1 }]}>
      <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }} numberOfLines={1}>{label}</Text>
      <Text style={{ fontSize: 16, fontWeight: '700', color }}>{value}</Text>
    </View>
  );
};

const SectionTitle: React.FC<{ children: string }> = ({ children }) => {
  const theme = useTheme();
  return <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.onSurfaceVariant, marginTop: 12, marginBottom: 4 }}>{children}</Text>;
};

export const AdminDashboard: React.FC = () => {
  const theme = useTheme();
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const [overview, setOverview] = React.useState<AdminOverview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toolRows, setToolRows] = React.useState<ToolUsageRow[]>([]);
  const [usageRows, setUsageRows] = React.useState<UsageSnapshot[]>([]);

  const taskInsights = React.useMemo(() => computeTaskInsights(tasks as any, new Date()), [tasks]);
  const noteInsights = React.useMemo(() => computeNoteInsights(notes as any), [notes]);
  const productivity = React.useMemo(() => computeProductivityStats(tasks as any, new Date()), [tasks]);
  const agentStats = React.useMemo(() => computeAgentStats(tasks as any), [tasks]);

  const refreshAiStats = React.useCallback(async () => {
    try { setToolRows(await getToolUsageRows()); setUsageRows(await getAllUsageRows()); } catch { /* local metrics */ }
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/overview`, {
        headers: { 'Content-Type': 'application/json', ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOverview(await res.json());
    } catch (e: any) {
      setError(e?.message || 'Kunde inte hämta serverstatus');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); void refreshAiStats(); }, [load, refreshAiStats]);

  const maxPerDay = Math.max(1, ...productivity.perDay.map((d) => d.completed));

  return (
    <View>
      <View style={styles.rowBetween}>
        <Text variant="titleSmall">Adminöversikt</Text>
        <Button mode="text" compact disabled={loading} onPress={() => { void load(); void refreshAiStats(); }}>
          {loading ? 'Uppdaterar…' : 'Uppdatera'}
        </Button>
      </View>

      <SectionTitle>Server</SectionTitle>
      {error ? (
        <Text style={{ fontSize: 12, color: theme.colors.error }}>{error}</Text>
      ) : !overview && loading ? (
        <ActivityIndicator style={{ alignSelf: 'flex-start', marginVertical: 6 }} />
      ) : (
        <View style={styles.grid}>
          <Stat label="Status" value={overview ? (overview.db.ok ? 'OK' : 'Degraderad') : '—'} tone={overview?.db.ok ? 'ok' : 'warn'} />
          <Stat label="Version" value={overview?.server.version ?? '—'} />
          <Stat label="Säkerhet" value={overview?.server.securityLevel ?? '—'} />
          <Stat label="Upptid" value={overview ? fmtUptime(overview.server.uptimeSec) : '—'} />
          <Stat label="Node" value={overview?.server.node ?? '—'} />
          <Stat label="Miljö" value={overview?.server.env ?? '—'} />
        </View>
      )}

      <SectionTitle>Konto (på servern)</SectionTitle>
      <View style={styles.grid}>
        <Stat label="Anteckningar" value={overview?.counts.notes ?? '—'} />
        <Stat label="Uppgifter" value={overview?.counts.tasks ?? '—'} />
        <Stat label="AI-trådar" value={overview?.counts.aiConversations ?? '—'} />
        <Stat label="AI-meddelanden" value={overview?.counts.aiMessages ?? '—'} />
      </View>

      <SectionTitle>Uppgiftsinsikter (denna enhet)</SectionTitle>
      <View style={styles.grid}>
        <Stat label="Aktiva" value={taskInsights.active} />
        <Stat label="Förfallna" value={taskInsights.overdue} tone={taskInsights.overdue > 0 ? 'warn' : 'default'} />
        <Stat label="Idag" value={taskInsights.dueToday} />
        <Stat label="Denna vecka" value={taskInsights.dueThisWeek} />
        <Stat label="Klart" value={`${Math.round(taskInsights.completionRate * 100)}%`} tone="ok" />
        <Stat label="Hög prio" value={taskInsights.byPriority.high} />
        <Stat label="Projekt" value={noteInsights.projects} />
        <Stat label="Listor" value={noteInsights.taskLists} />
      </View>

      <SectionTitle>Produktivitet (mätbar)</SectionTitle>
      <View style={styles.grid}>
        <Stat label="Klara 7 dgr" value={productivity.completedLast7} tone="ok" />
        <Stat label="Klara 30 dgr" value={productivity.completedLast30} />
        <Stat label="Skapade 7 dgr" value={productivity.createdLast7} />
        <Stat label="Svit (dagar)" value={productivity.currentStreakDays} tone={productivity.currentStreakDays > 0 ? 'ok' : 'default'} />
        <Stat label="Snitt/aktiv dag" value={productivity.avgPerActiveDay ? productivity.avgPerActiveDay.toFixed(1) : '0'} />
        <Stat label="Genomflöde 7d" value={`${Math.round(productivity.throughputRatio7 * 100)}%`} tone={productivity.throughputRatio7 >= 1 ? 'ok' : 'default'} />
      </View>
      <View style={styles.chart}>
        {productivity.perDay.map((d) => (
          <View key={d.date} style={styles.bar}>
            <View style={{ width: '70%', height: Math.max(d.completed ? 4 : 1, (d.completed / maxPerDay) * 40), backgroundColor: theme.colors.primary, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
            <Text style={{ fontSize: 9, color: theme.colors.onSurfaceVariant }}>{d.date.slice(8)}</Text>
          </View>
        ))}
      </View>

      {agentStats.delegated > 0 && (
        <>
          <SectionTitle>AI-orkestrering (delegerade uppgifter)</SectionTitle>
          <View style={styles.grid}>
            <Stat label="Delegerade" value={agentStats.delegated} />
            <Stat label="Klara (AI)" value={agentStats.completedByAi} tone="ok" />
            <Stat label="Väntar" value={agentStats.scheduled} />
            <Stat label="Fel" value={agentStats.errors} tone={agentStats.errors > 0 ? 'warn' : 'default'} />
            <Stat label="Körningar" value={agentStats.totalRuns} />
            <Stat label="Endast lokalt" value={agentStats.localOnly} />
            <Stat label="På Pi" value={agentStats.onBackend} />
            <Stat label="Källor" value={`L${agentStats.bySource.local}·H${agentStats.bySource.hermes}·A${agentStats.bySource.api}`} />
          </View>
          {agentStats.byModel.length > 0 && (
            <View style={[styles.listBox, { borderColor: theme.colors.outlineVariant }]}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.onSurface, marginBottom: 2 }}>Modeller i bruk</Text>
              {agentStats.byModel.slice(0, 10).map((m) => (
                <View key={m.model} style={styles.rowBetween}>
                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }} numberOfLines={1}>{m.model}</Text>
                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{m.count}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      <SectionTitle>AI-användning (denna enhet, krypterat lokalt)</SectionTitle>
      {usageRows.length === 0 && toolRows.length === 0 ? (
        <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant }}>Ingen AI-användning registrerad ännu.</Text>
      ) : (
        <>
          {toolRows.length > 0 && (
            <View style={[styles.listBox, { borderColor: theme.colors.outlineVariant }]}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.onSurface, marginBottom: 2 }}>Verktyg/skills (idag · månad · totalt)</Text>
              {toolRows.slice(0, 12).map((r) => (
                <View key={r.tool} style={styles.rowBetween}>
                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, flex: 1 }} numberOfLines={1}>{toolUsageLabel(r.tool)}</Text>
                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{r.countDay} · {r.countMonth} · {r.total}</Text>
                </View>
              ))}
            </View>
          )}
          {usageRows.length > 0 && (
            <View style={[styles.listBox, { borderColor: theme.colors.outlineVariant }]}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.onSurface, marginBottom: 2 }}>Tokens per modell (idag · månad)</Text>
              {usageRows.slice(0, 12).map((u) => (
                <View key={`${u.provider}:${u.model}`} style={styles.rowBetween}>
                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, flex: 1 }} numberOfLines={1}>{u.provider} · {u.model}</Text>
                  <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>{u.tokensDay.toLocaleString('sv-SE')} · {u.tokensMonth.toLocaleString('sv-SE')}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      <AdminCleanup />
    </View>
  );
};

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stat: { borderWidth: 1, borderRadius: 8, padding: 8, minWidth: '30%', flexGrow: 1 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 56, marginTop: 8 },
  bar: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  listBox: { borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 6, gap: 1 },
});

export default AdminDashboard;
