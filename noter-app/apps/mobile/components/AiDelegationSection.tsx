/**
 * "Delegate to AI" section shown in the task editor. Lets the user hand a task to
 * the AI agent: pick the model source (API / Hermes / Local), model, local-only
 * flag and extra instructions, run it now, and see a transparent log of exactly
 * what the agent read and did on its last run.
 *
 * The delegation lives in the local encrypted delegation map (services/ai/
 * agentDelegations) — decoupled from the synced task — and the scheduler runs it
 * at the task's dueDate.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Switch, SegmentedButtons, TextInput as PaperTextInput, Button, useTheme, Divider, ActivityIndicator } from 'react-native-paper';
import type { AiTaskDelegation, AiTaskSource, Task, ContextLevel } from '@repo/shared';
import { CONTEXT_LEVELS, contextLevelConfig } from '@repo/shared';
import { API_PROVIDER_LIST } from '@/services/ai/apiProviders';
import { getDelegations, setDelegation, removeDelegation, getRunLog, type AgentRunLogEntry } from '@/services/ai/agentDelegations';
import { runAgentTaskNow } from '@/services/ai/agentScheduler';
import { syncDelegationToBackend, clearBackendDelegation } from '@/services/ai/agentBackendSync';

const SOURCE_BUTTONS = [
  { value: 'api', label: 'API' },
  { value: 'hermes', label: 'Hermes' },
  { value: 'local', label: 'Lokal' },
];

const accessLabel = (kind: string): string => {
  switch (kind) {
    case 'note': return 'Läste anteckning';
    case 'task': return 'Läste uppgift';
    case 'list': return 'Läste uppgiftslista';
    case 'project': return 'Läste projektmapp';
    case 'instruction': return 'Läste instruktion';
    case 'search': return 'Sökte/verktyg';
    default: return 'Åtkomst';
  }
};

export const AiDelegationSection: React.FC<{ task: Task }> = ({ task }) => {
  const theme = useTheme();
  const [delegation, setLocalDelegation] = useState<AiTaskDelegation | null>(null);
  const [runLog, setRunLog] = useState<AgentRunLogEntry | null>(null);
  const [running, setRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [map, logs] = await Promise.all([getDelegations(), getRunLog()]);
    setLocalDelegation(map[task._id] ?? null);
    setRunLog(logs[task._id] ?? null);
    setLoaded(true);
  }, [task._id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const persist = useCallback(async (next: AiTaskDelegation | null) => {
    setLocalDelegation(next);
    if (next && next.assignee === 'ai') {
      await setDelegation(task._id, next);
      // Mirror to the always-on backend when the user opts into server execution.
      if (next.runOnBackend) await syncDelegationToBackend(task._id, next);
      else await clearBackendDelegation(task._id);
    } else {
      await removeDelegation(task._id);
      await clearBackendDelegation(task._id);
    }
  }, [task._id]);

  const enabled = !!delegation && delegation.assignee === 'ai';
  const d: AiTaskDelegation = delegation ?? { assignee: 'user' };

  const toggle = (on: boolean) => {
    if (on) {
      const firstProvider = API_PROVIDER_LIST[0];
      void persist({
        assignee: 'ai', source: 'api', provider: firstProvider?.id, model: firstProvider?.defaultModels[0],
        localOnly: false, toolUse: true, status: 'idle', runCount: 0,
      });
    } else {
      void persist(null);
    }
  };

  const patch = (p: Partial<AiTaskDelegation>) => { if (enabled) void persist({ ...d, ...p }); };

  const providersForSource = (source?: AiTaskSource) =>
    source === 'hermes'
      ? API_PROVIDER_LIST.filter((p) => p.configurableEndpoint)
      : API_PROVIDER_LIST.filter((p) => !p.configurableEndpoint);

  const runNow = async () => {
    setRunning(true);
    try {
      await runAgentTaskNow(task);
      await refresh();
    } finally {
      setRunning(false);
    }
  };

  if (!loaded) return <ActivityIndicator style={{ marginVertical: 16 }} />;

  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text variant="titleMedium">Delegera till AI-agenten</Text>
        <Switch value={enabled} onValueChange={toggle} testID="ai-delegate-toggle" />
      </View>
      <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, marginBottom: 8 }}>
        AI-agenten utför uppgiften vid förfallodatumet enligt titel + beskrivning. Allt lagras krypterat lokalt.
      </Text>

      {enabled ? (
        <>
          <Text style={styles.label}>Modellkälla</Text>
          <SegmentedButtons
            value={d.source ?? 'api'}
            onValueChange={(v) => patch({ source: v as AiTaskSource, provider: providersForSource(v as AiTaskSource)[0]?.id })}
            buttons={SOURCE_BUTTONS}
            density="small"
          />

          {d.source !== 'local' ? (
            <>
              <Text style={styles.label}>Provider</Text>
              <SegmentedButtons
                value={d.provider ?? ''}
                onValueChange={(v) => patch({ provider: v, model: API_PROVIDER_LIST.find((p) => p.id === v)?.defaultModels[0] })}
                buttons={providersForSource(d.source).slice(0, 4).map((p) => ({ value: p.id, label: p.label.split(' ')[0] }))}
                density="small"
                style={{ marginTop: 4 }}
              />
            </>
          ) : null}

          <PaperTextInput
            mode="outlined"
            label="Modell"
            value={d.model ?? ''}
            onChangeText={(v) => patch({ model: v })}
            autoCapitalize="none"
            autoCorrect={false}
            dense
            style={{ marginTop: 8 }}
            testID="ai-delegate-model"
          />

          <PaperTextInput
            mode="outlined"
            label="Extra instruktioner (valfritt)"
            value={d.instructions ?? ''}
            onChangeText={(v) => patch({ instructions: v })}
            multiline
            dense
            style={{ marginTop: 8 }}
          />

          <Text style={styles.label}>Kontextnivå</Text>
          <SegmentedButtons
            value={d.contextLevel ?? 'standard'}
            onValueChange={(v) => patch({ contextLevel: v as ContextLevel })}
            buttons={CONTEXT_LEVELS.map((l) => ({ value: l, label: contextLevelConfig(l).label }))}
            density="small"
          />
          <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
            {contextLevelConfig(d.contextLevel).description}
          </Text>

          <View style={[styles.row, { marginTop: 10 }]}>
            <Text>Endast lokalt (synka inte)</Text>
            <Switch value={!!d.localOnly} onValueChange={(v) => patch({ localOnly: v })} />
          </View>
          <View style={[styles.row, { marginTop: 4 }]}>
            <Text>Tillåt verktyg (skapa/läsa uppgifter)</Text>
            <Switch value={d.toolUse !== false} onValueChange={(v) => patch({ toolUse: v })} />
          </View>
          <View style={[styles.row, { marginTop: 4 }]}>
            <Text>Kör på servern (always-on)</Text>
            <Switch value={!!d.runOnBackend} onValueChange={(v) => patch({ runOnBackend: v })} testID="ai-delegate-run-on-backend" />
          </View>
          {d.source === 'api' && d.runOnBackend ? (
            <Text style={{ fontSize: 11, color: theme.colors.error }}>
              Serverkörning stödjer endast Hermes/lokal (servern saknar din API-nyckel). Välj Hermes-källa.
            </Text>
          ) : null}
          <View style={[styles.row, { marginTop: 4 }]}>
            <Text>Notis när agenten startar</Text>
            <Switch value={!!d.notify?.onStart} onValueChange={(v) => patch({ notify: { ...(d.notify || {}), onStart: v } })} />
          </View>
          <View style={[styles.row, { marginTop: 4 }]}>
            <Text>Notis när agenten är klar</Text>
            <Switch value={d.notify?.onFinish !== false} onValueChange={(v) => patch({ notify: { ...(d.notify || {}), onFinish: v } })} />
          </View>

          <Button
            mode="contained"
            onPress={runNow}
            loading={running}
            disabled={running}
            style={{ marginTop: 12 }}
            icon="robot"
            testID="ai-delegate-run-now"
          >
            {running ? 'Kör…' : 'Kör nu'}
          </Button>

          {d.status && d.status !== 'idle' ? (
            <Text style={{ marginTop: 8, fontSize: 12, color: theme.colors.onSurfaceVariant }}>
              Status: {d.status}{d.lastRunAt ? ` · ${new Date(d.lastRunAt).toLocaleString('sv-SE')}` : ''}
            </Text>
          ) : null}

          {runLog ? (
            <View style={styles.logBox}>
              <Text variant="labelLarge" style={{ marginBottom: 4 }}>Senaste körning ({runLog.stopped})</Text>
              {runLog.summary ? <Text style={{ fontSize: 12, marginBottom: 6 }}>{runLog.summary}</Text> : null}
              {runLog.accesses.length > 0 ? (
                <>
                  <Divider style={{ marginVertical: 6 }} />
                  <Text variant="labelMedium" style={{ marginBottom: 4 }}>Transparent åtkomstlogg:</Text>
                  {runLog.accesses.map((a, i) => (
                    <Text key={`${a.kind}-${i}`} style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>
                      • {accessLabel(a.kind)}{a.title ? `: ${a.title}` : a.id ? ` (${a.id.slice(0, 8)})` : ''}
                    </Text>
                  ))}
                </>
              ) : (
                <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>Ingen läsåtkomst denna körning.</Text>
              )}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginTop: 8, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { marginTop: 10, marginBottom: 4, fontWeight: '600' },
  logBox: { marginTop: 12, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(127,127,127,0.3)' },
});

export default AiDelegationSection;
