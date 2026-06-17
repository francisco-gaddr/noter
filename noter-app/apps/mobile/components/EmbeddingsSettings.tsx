/**
 * Embeddings / semantic-search settings (mobile) — parity with the web EmbeddingsSettings.
 * Lets the user regulate semantic search: on/off, source (local Ollama / Hermes / API),
 * model, base URL, API key, auto-index, and an "Indexera nu" action that (re)builds the
 * encrypted on-device vector index over READABLE notes/tasks only (locked content is
 * filtered out in the shared layer). Settings persist per-user via embeddingsService.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { List, Switch, Text, Button, TextInput, Menu, useTheme, ActivityIndicator } from 'react-native-paper';
import {
  DEFAULT_EMBEDDING_MODEL, DEFAULT_LOCAL_EMBEDDINGS_URL,
  type EmbeddingSource, type EmbeddingsConfig,
} from '@repo/shared';
import { useStore } from '@/stores/useStore';
import { useGuardedMenu } from '@/hooks/useGuardedMenu';
import {
  getEmbeddingsConfig, saveEmbeddingsConfig, getEmbeddingsApiKey, saveEmbeddingsApiKey,
  indexEntities, clearVectorIndex, getIndexInfo, type IndexResult,
} from '@/services/ai/embeddingsService';

const SOURCE_LABELS: Record<EmbeddingSource, string> = {
  local: 'Lokal (Ollama på enheten)',
  hermes: 'Hermes (egen server, t.ex. Pi)',
  api: 'API (OpenAI-kompatibel)',
};

export const EmbeddingsSettings: React.FC = () => {
  const theme = useTheme();
  const notes = useStore((s) => s.notes);
  const tasks = useStore((s) => s.tasks);
  const unlockedIds = useStore((s) => s.unlockedProtectedNoteIds);

  const [config, setConfig] = React.useState<EmbeddingsConfig | null>(null);
  const [apiKey, setApiKey] = React.useState('');
  const sourceMenuCtl = useGuardedMenu();
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; toDo: number } | null>(null);
  const [result, setResult] = React.useState<IndexResult | null>(null);
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    (async () => {
      setConfig(await getEmbeddingsConfig());
      setApiKey(await getEmbeddingsApiKey());
      setCount((await getIndexInfo()).total);
    })();
  }, []);

  if (!config) return null;

  const update = async (patch: Partial<EmbeddingsConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    await saveEmbeddingsConfig(next);
  };

  const onKeyBlur = () => { saveEmbeddingsApiKey(apiKey.trim()); };

  const baseUrlPlaceholder = config.source === 'local'
    ? DEFAULT_LOCAL_EMBEDDINGS_URL
    : config.source === 'hermes' ? 'http://192.168.50.16:11434' : 'https://api.openai.com';

  const handleIndex = async () => {
    setBusy(true); setResult(null); setProgress({ done: 0, toDo: 0 });
    try {
      // SECURITY: the search index NEVER contains locked-folder notes — empty unlock set,
      // even if the user currently has a folder open. (buildIndexableEntities is lock-aware.)
      const res = await indexEntities(notes as any, tasks as any, new Set<string>(), (done, toDo) => setProgress({ done, toDo }));
      setResult(res);
      setCount((await getIndexInfo()).total);
    } finally {
      setBusy(false); setProgress(null);
    }
  };

  const handleClear = async () => { await clearVectorIndex(); setCount(0); setResult(null); };

  return (
    <List.Section title="Semantisk sök">
      <List.Item
        title="Aktivera semantisk sök"
        description="Vektorer + RRF-fusion. Låsta anteckningar indexeras aldrig."
        left={(p) => <List.Icon {...p} icon="brain" />}
        right={() => <Switch value={config.enabled} onValueChange={(v) => update({ enabled: v })} testID="embeddings-enabled" />}
      />

      {config.enabled && (
        <View style={styles.body}>
          <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
            Rekommenderat: en egen modell (Ollama på Pi/enheten) med nomic-embed-text så innehållet aldrig lämnar dina enheter.
          </Text>

          <Menu
            visible={sourceMenuCtl.visible}
            onDismiss={sourceMenuCtl.dismiss}
            anchor={
              <Button mode="outlined" onPress={sourceMenuCtl.open} style={styles.row} testID="embeddings-source">
                {SOURCE_LABELS[config.source]}
              </Button>
            }
          >
            {(Object.keys(SOURCE_LABELS) as EmbeddingSource[]).map((s) => (
              <Menu.Item key={s} onPress={() => { update({ source: s }); sourceMenuCtl.dismiss(); }} title={SOURCE_LABELS[s]} />
            ))}
          </Menu>

          <TextInput
            mode="outlined" dense label="Modell" value={config.model}
            onChangeText={(v) => update({ model: v })}
            placeholder={DEFAULT_EMBEDDING_MODEL} style={styles.row} testID="embeddings-model"
            autoCapitalize="none" autoCorrect={false}
          />

          <TextInput
            mode="outlined" dense
            label={config.source === 'local' ? 'Bas-URL (valfritt)' : 'Bas-URL'}
            value={config.baseUrl || ''} onChangeText={(v) => update({ baseUrl: v })}
            placeholder={baseUrlPlaceholder} style={styles.row} testID="embeddings-baseurl"
            autoCapitalize="none" autoCorrect={false} keyboardType="url"
          />

          {config.source !== 'local' && (
            <TextInput
              mode="outlined" dense
              label={config.source === 'hermes' ? 'API-nyckel (valfritt för LAN)' : 'API-nyckel'}
              value={apiKey} onChangeText={setApiKey} onBlur={onKeyBlur}
              placeholder="sk-…" secureTextEntry style={styles.row} testID="embeddings-apikey"
              autoCapitalize="none" autoCorrect={false}
            />
          )}

          <View style={styles.switchRow}>
            <Text style={{ color: theme.colors.onSurface }}>Indexera om automatiskt vid sparning</Text>
            <Switch value={config.autoIndex} onValueChange={(v) => update({ autoIndex: v })} testID="embeddings-autoindex" />
          </View>

          <View style={styles.actions}>
            <Button mode="contained" onPress={handleIndex} disabled={busy} testID="embeddings-index-now">
              {busy ? (progress ? `Indexerar ${progress.done}/${progress.toDo}` : 'Indexerar…') : 'Indexera nu'}
            </Button>
            <Button mode="outlined" onPress={handleClear} disabled={busy || count === 0} testID="embeddings-clear">Rensa</Button>
            {busy && <ActivityIndicator size="small" />}
          </View>
          <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]} testID="embeddings-index-count">{count} indexerade</Text>

          {result && (
            <Text style={[styles.hint, { color: result.ok ? theme.colors.primary : theme.colors.error }]}>
              {result.ok
                ? `Klart: ${result.indexed} nya, ${result.kept} oförändrade, ${result.removed} borttagna · totalt ${result.total}.`
                : `Fel: ${result.error}`}
            </Text>
          )}
        </View>
      )}
    </List.Section>
  );
};

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  row: { marginTop: 4 },
  hint: { fontSize: 12, marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
});

export default EmbeddingsSettings;
