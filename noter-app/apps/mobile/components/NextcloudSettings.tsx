/**
 * Nextcloud ingestion + selective Neo4j settings (mobile) — parity with the web
 * NextcloudSettings. Connect a self-hosted Nextcloud, choose folders to sync in (files become
 * E2E-encrypted, indexable notes), and choose which project folders / task-lists / file-folders
 * mirror to a self-hosted Neo4j. Credentials are stored in SecureStore and never sent to the
 * Noter backend. See Doc/nextcloud-ingestion.md.
 */
import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { List, Switch, Text, Button, TextInput, Checkbox, Divider, useTheme } from 'react-native-paper';
import { normalizeNoteType, normalizeNextcloudBaseUrl, type WebdavConnection, type Neo4jConfig } from '@repo/shared';
import { useStore } from '@/stores/useStore';
import {
  listConnections, saveConnection, deleteConnection, testConnection, syncConnection,
  getNeo4jConfig, saveNeo4jConfig, neo4jStatus, pushNeo4j,
} from '@/services/nextcloud';

const newId = (): string => 'nc_' + Math.abs(Date.now()).toString(36) + Math.floor(Math.random() * 1e6).toString(36);

export const NextcloudSettings: React.FC = () => {
  const theme = useTheme();
  const notes = useStore((s) => s.notes);

  const [conns, setConns] = React.useState<WebdavConnection[]>([]);
  const [neo4j, setNeo4j] = React.useState<Neo4jConfig | null>(null);
  const [neo4jAvailable, setNeo4jAvailable] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', host: '', username: '', password: '', roots: '' });

  React.useEffect(() => {
    (async () => {
      setConns(await listConnections());
      setNeo4j(await getNeo4jConfig());
      try { setNeo4jAvailable(!!(await neo4jStatus()).enabled); } catch { /* */ }
    })();
  }, []);

  const refresh = async () => setConns(await listConnections());
  const updateNeo4j = async (patch: Partial<Neo4jConfig>) => {
    if (!neo4j) return;
    const next = { ...neo4j, ...patch };
    setNeo4j(next);
    await saveNeo4jConfig(next);
  };

  const addConnection = async () => {
    setMsg('');
    try {
      const baseUrl = normalizeNextcloudBaseUrl(form.host.trim(), form.username.trim());
      const conn: WebdavConnection = {
        id: newId(),
        name: form.name.trim() || form.host.trim(),
        baseUrl,
        username: form.username.trim(),
        rootPaths: form.roots.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
        createdAt: new Date().toISOString(),
      };
      await saveConnection(conn, form.password);
      setForm({ name: '', host: '', username: '', password: '', roots: '' });
      await refresh();
    } catch (e: any) {
      setMsg(e?.message || 'Kunde inte spara anslutningen');
    }
  };

  const onTest = async (conn: WebdavConnection) => {
    setBusy(true); setMsg('');
    const r = await testConnection(conn);
    setMsg(r.ok ? `✓ Anslutning OK: ${conn.name}` : `✗ ${r.error}`);
    setBusy(false);
  };
  const onSync = async (conn: WebdavConnection) => {
    setBusy(true); setMsg(`Synkar ${conn.name}…`);
    const r = await syncConnection(conn.id);
    setMsg(r.ok ? `✓ ${conn.name}: ${r.created} nya, ${r.updated} uppdaterade, ${r.deleted} borttagna` : `✗ ${r.error}`);
    setBusy(false);
  };
  const onDelete = async (conn: WebdavConnection) => { await deleteConnection(conn.id); await refresh(); };

  const live = (notes || []).filter((n: any) => !n.deleted);
  const projectFolders = live.filter((n: any) => normalizeNoteType(n.type) === 'project' && !n.source);
  const taskLists = live.filter((n: any) => normalizeNoteType(n.type) === 'task_list');
  const fileFolders = live.filter((n: any) => normalizeNoteType(n.type) === 'project' && !!n.source);

  const toggleId = (key: 'projectFolderIds' | 'taskListIds' | 'fileFolderIds', id: string) => {
    if (!neo4j) return;
    const set = new Set(neo4j[key]);
    if (set.has(id)) set.delete(id); else set.add(id);
    updateNeo4j({ [key]: Array.from(set) } as any);
  };

  const onPushNeo4j = async () => {
    setBusy(true); setMsg('Synkar till Neo4j…');
    const r = await pushNeo4j();
    setMsg(r.ok ? `✓ Neo4j: ${r.applied ?? 0} satser` : `✗ ${r.error}`);
    setBusy(false);
  };

  const FolderList = ({ title, pool, sel, k }: { title: string; pool: any[]; sel: string[]; k: 'projectFolderIds' | 'taskListIds' | 'fileFolderIds' }) => (
    <View style={{ marginBottom: 8 }}>
      <Text variant="labelSmall" style={{ marginBottom: 2 }}>{title} ({pool.length})</Text>
      {pool.length === 0 ? <Text variant="bodySmall" style={{ opacity: 0.6 }}>Inga ännu.</Text> : pool.map((n) => (
        <Checkbox.Item
          key={n._id}
          label={n.title || '(namnlös)'}
          status={sel.includes(n._id) ? 'checked' : 'unchecked'}
          onPress={() => toggleId(k, n._id)}
          style={{ paddingVertical: 0 }}
        />
      ))}
    </View>
  );

  return (
    <List.Section title="Nextcloud & kunskapsgraf (Neo4j)">
      <View style={styles.box}>
        <Text variant="bodySmall" style={{ opacity: 0.7, marginBottom: 8 }}>
          Anslut din egenhostade Nextcloud och välj mappar att synka in. Filerna blir krypterade, sökbara
          anteckningar. Använd ett app-lösenord (Nextcloud → Säkerhet), inte ditt kontolösenord — det lagras
          krypterat på enheten och skickas aldrig till servern.
        </Text>

        {conns.map((c) => (
          <View key={c.id} style={styles.conn}>
            <Text variant="titleSmall">{c.name}</Text>
            <Text variant="bodySmall" style={{ opacity: 0.6 }} numberOfLines={1}>{c.baseUrl}</Text>
            <Text variant="bodySmall" style={{ opacity: 0.6 }}>Mappar: {c.rootPaths.join(', ') || '(inga)'}</Text>
            <View style={styles.row}>
              <Button compact mode="outlined" disabled={busy} onPress={() => onTest(c)}>Testa</Button>
              <Button compact mode="contained" disabled={busy} onPress={() => onSync(c)}>Synka nu</Button>
              <Button compact textColor={theme.colors.error} disabled={busy} onPress={() => onDelete(c)}>Ta bort</Button>
            </View>
          </View>
        ))}

        <Divider style={{ marginVertical: 8 }} />
        <Text variant="labelMedium" style={{ marginBottom: 4 }}>Lägg till anslutning</Text>
        <TextInput dense mode="outlined" label="Namn (valfritt)" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} style={styles.input} />
        <TextInput dense mode="outlined" label="Värd (cloud.exempel.se)" autoCapitalize="none" value={form.host} onChangeText={(t) => setForm({ ...form, host: t })} style={styles.input} />
        <TextInput dense mode="outlined" label="Användarnamn" autoCapitalize="none" value={form.username} onChangeText={(t) => setForm({ ...form, username: t })} style={styles.input} />
        <TextInput dense mode="outlined" label="App-lösenord" secureTextEntry value={form.password} onChangeText={(t) => setForm({ ...form, password: t })} style={styles.input} />
        <TextInput dense mode="outlined" label="Mappar (komma/rad)" value={form.roots} onChangeText={(t) => setForm({ ...form, roots: t })} style={styles.input} />
        <Button mode="contained-tonal" onPress={addConnection} style={{ marginTop: 4 }}>Spara anslutning</Button>

        <Divider style={{ marginVertical: 12 }} />
        <View style={styles.row}>
          <Switch value={!!neo4j?.enabled} onValueChange={(v) => updateNeo4j({ enabled: v })} />
          <Text variant="titleSmall" style={{ flex: 1 }}>Spegla valda mappar till self-hostad Neo4j</Text>
        </View>
        <Text variant="bodySmall" style={{ opacity: 0.7, marginTop: 4 }}>
          Välj exakt vilka mappar som mirroras till din egen Neo4j. Endast titlar + struktur som standard; låsta
          mappar speglas aldrig.{neo4jAvailable ? '' : ' OBS: servern rapporterar Neo4j inte aktiverad.'}
        </Text>

        {neo4j?.enabled && (
          <View style={{ marginTop: 8 }}>
            <FolderList title="Projektmappar" pool={projectFolders} sel={neo4j.projectFolderIds} k="projectFolderIds" />
            <FolderList title="Uppgiftslistor" pool={taskLists} sel={neo4j.taskListIds} k="taskListIds" />
            <FolderList title="Filmappar (Nextcloud)" pool={fileFolders} sel={neo4j.fileFolderIds} k="fileFolderIds" />
            <View style={styles.row}>
              <Switch value={neo4j.includeBody} onValueChange={(v) => updateNeo4j({ includeBody: v })} />
              <Text variant="bodySmall" style={{ flex: 1 }}>Inkludera brödtext (annars bara titlar + struktur)</Text>
            </View>
            <Button mode="contained" disabled={busy} onPress={onPushNeo4j} style={{ marginTop: 8 }}>Synka till Neo4j</Button>
          </View>
        )}

        {!!msg && <Text variant="bodySmall" style={{ marginTop: 8 }}>{msg}</Text>}
      </View>
    </List.Section>
  );
};

const styles = StyleSheet.create({
  box: { paddingHorizontal: 16, paddingBottom: 8 },
  conn: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#8884', borderRadius: 8, padding: 8, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  input: { marginBottom: 6 },
});

export default NextcloudSettings;
