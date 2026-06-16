/**
 * Nextcloud ingestion + selective Neo4j settings (mobile) — parity with the web
 * NextcloudSettings. Connect a self-hosted Nextcloud, choose folders to sync in (files become
 * E2E-encrypted, indexable notes), and choose which project folders / task-lists / file-folders
 * mirror to a self-hosted Neo4j. Credentials are stored in SecureStore and never sent to the
 * Noter backend. See Doc/nextcloud-ingestion.md.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Linking } from 'react-native';
import { List, Switch, Text, Button, TextInput, Checkbox, Divider, Menu, useTheme } from 'react-native-paper';
import { normalizeNoteType, normalizeNextcloudBaseUrl, type WebdavConnection, type WebdavEntry, type Neo4jConfig } from '@repo/shared';
import { useStore } from '@/stores/useStore';
import {
  listConnections, saveConnection, deleteConnection, testConnection, syncConnection, browseFolders,
  syncDueConnections, getNeo4jConfig, saveNeo4jConfig, neo4jStatus, pushNeo4j, startNextcloudOAuth,
  getTargetFolderId, setTargetFolderId,
} from '@/services/nextcloud';

const INTERVALS: Array<{ v: number; label: string }> = [
  { v: 0, label: 'Manuell' }, { v: 15, label: '15 min' }, { v: 60, label: '1 tim' }, { v: 360, label: '6 tim' },
];

const newId = (): string => 'nc_' + Math.abs(Date.now()).toString(36) + Math.floor(Math.random() * 1e6).toString(36);

export const NextcloudSettings: React.FC = () => {
  const theme = useTheme();
  const notes = useStore((s) => s.notes);

  const [conns, setConns] = React.useState<WebdavConnection[]>([]);
  const [neo4j, setNeo4j] = React.useState<Neo4jConfig | null>(null);
  const [neo4jAvailable, setNeo4jAvailable] = React.useState(false);
  const [neo4jAdvanced, setNeo4jAdvanced] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', host: '', username: '', password: '', roots: '' });
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [picker, setPicker] = React.useState<{ connId: string; path: string; entries: WebdavEntry[]; loading: boolean } | null>(null);
  const [targetFolderId, setTargetFolderIdState] = React.useState<string | null>(null);
  const [targetMenu, setTargetMenu] = React.useState(false);

  const targetFolders = (notes || []).filter((n: any) => !n.deleted && normalizeNoteType(n.type) === 'project' && !n.source);
  const targetLabel = targetFolderId ? (targetFolders.find((f: any) => f._id === targetFolderId)?.title || 'Vald mapp') : 'Auto ("Nextcloud")';
  const chooseTarget = async (id: string | null) => { await setTargetFolderId(id); setTargetFolderIdState(id); setTargetMenu(false); };

  const hostFromBaseUrl = (baseUrl: string): string =>
    (baseUrl || '').replace(/^https?:\/\//i, '').split('/')[0];

  const startEdit = (c: WebdavConnection) => {
    setEditingId(c.id);
    setForm({ name: c.name, host: hostFromBaseUrl(c.baseUrl), username: c.username, password: '', roots: (c.rootPaths || []).join(', ') });
    setMsg('Redigerar — ändra och tryck "Uppdatera anslutning". Lämna lösenordet tomt för att behålla det.');
  };
  const cancelEdit = () => { setEditingId(null); setForm({ name: '', host: '', username: '', password: '', roots: '' }); setMsg(''); };
  const toggleIncludeInChat = async (c: WebdavConnection) => {
    await saveConnection({ ...c, includeInChat: c.includeInChat === false ? true : false });
    await refresh();
  };

  const openPicker = async (conn: WebdavConnection, path = '') => {
    setPicker({ connId: conn.id, path, entries: [], loading: true });
    try { const entries = await browseFolders(conn, path); setPicker({ connId: conn.id, path, entries, loading: false }); }
    catch (e: any) { setMsg(e?.message || 'Kunde inte lista mappar'); setPicker(null); }
  };
  const toggleRoot = async (conn: WebdavConnection, p: string) => {
    const set = new Set(conn.rootPaths);
    if (set.has(p)) set.delete(p); else set.add(p);
    await saveConnection({ ...conn, rootPaths: Array.from(set) });
    await refresh();
  };
  const cycleInterval = async (conn: WebdavConnection) => {
    const cur = INTERVALS.findIndex((i) => i.v === (conn.intervalMinutes || 0));
    const next = INTERVALS[(cur + 1) % INTERVALS.length];
    await saveConnection({ ...conn, intervalMinutes: next.v });
    await refresh();
  };
  const cycleMinLevel = async (conn: WebdavConnection) => {
    const order = ['', 'standard', 'deep'];
    const cur = order.indexOf(conn.minContextLevel || '');
    await saveConnection({ ...conn, minContextLevel: order[(cur + 1) % order.length] || undefined });
    await refresh();
  };
  const minLevelLabel = (v?: string) => (v === 'deep' ? 'Endast deep' : v === 'standard' ? 'Från standard' : 'Alltid');

  React.useEffect(() => {
    (async () => {
      setConns(await listConnections());
      setTargetFolderIdState(await getTargetFolderId());
      setNeo4j(await getNeo4jConfig());
      try { setNeo4jAvailable(!!(await neo4jStatus()).enabled); } catch { /* */ }
      try { const n = await syncDueConnections(); if (n > 0) setConns(await listConnections()); } catch { /* */ }
    })();
  }, []);

  const refresh = async () => setConns(await listConnections());
  const updateNeo4j = async (patch: Partial<Neo4jConfig>) => {
    if (!neo4j) return;
    const next = { ...neo4j, ...patch };
    setNeo4j(next);
    await saveNeo4jConfig(next);
  };

  const saveConnectionForm = async () => {
    setMsg('');
    try {
      const baseUrl = normalizeNextcloudBaseUrl(form.host.trim(), form.username.trim());
      const rootPaths = form.roots.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      if (editingId) {
        const existing = (await listConnections()).find((c) => c.id === editingId);
        if (!existing) { setMsg('Anslutningen hittades inte'); setEditingId(null); return; }
        const updated: WebdavConnection = {
          ...existing,
          name: form.name.trim() || form.host.trim(),
          baseUrl,
          username: form.username.trim(),
          rootPaths,
        };
        // Only overwrite the stored app-password if a new one was typed.
        await saveConnection(updated, form.password.trim() ? form.password : undefined);
        setMsg('✓ Anslutning uppdaterad');
      } else {
        const conn: WebdavConnection = {
          id: newId(),
          name: form.name.trim() || form.host.trim(),
          baseUrl,
          username: form.username.trim(),
          rootPaths,
          includeInChat: true,
          createdAt: new Date().toISOString(),
        };
        await saveConnection(conn, form.password);
      }
      setForm({ name: '', host: '', username: '', password: '', roots: '' });
      setEditingId(null);
      await refresh();
    } catch (e: any) {
      setMsg(e?.message || 'Kunde inte spara anslutningen');
    }
  };

  const onOAuth = async () => {
    if (!form.host.trim()) return;
    setBusy(true); setMsg('Öppnar Nextcloud-inloggning — slutför i webbläsaren…');
    const r = await startNextcloudOAuth(form.host.trim(), (u) => { Linking.openURL(u).catch(() => {}); }, { name: form.name.trim() || undefined });
    setMsg(r.ok ? '✓ Inloggning klar — anslutning tillagd' : `✗ ${r.error}`);
    if (r.ok) { setForm({ name: '', host: '', username: '', password: '', roots: '' }); await refresh(); }
    setBusy(false);
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
          Anslut din egenhostade Nextcloud och välj mappar att synka in. Redigerbara filer (MD/text) blir
          anteckningar du kan ändra — ändringar synkas tillbaka (tvåvägs). Bilder/PDF/Word/Excel synkas + indexeras
          men visas inte bland anteckningarna. Använd ett app-lösenord, inte kontolösenordet.
        </Text>
        <View style={styles.row}>
          <Text variant="bodySmall">Projektmapp för synkat innehåll:</Text>
          <Menu
            visible={targetMenu}
            onDismiss={() => setTargetMenu(false)}
            anchor={<Button compact mode="outlined" onPress={() => setTargetMenu(true)}>{targetLabel}</Button>}
          >
            <Menu.Item onPress={() => chooseTarget(null)} title={'Auto ("Nextcloud")'} />
            {targetFolders.map((f: any) => (
              <Menu.Item key={f._id} onPress={() => chooseTarget(f._id)} title={f.title || '(namnlös)'} />
            ))}
          </Menu>
        </View>

        {conns.map((c) => (
          <View key={c.id} style={styles.conn}>
            <Text variant="titleSmall">{c.name}</Text>
            <Text variant="bodySmall" style={{ opacity: 0.6 }} numberOfLines={1}>{c.baseUrl}</Text>
            <Text variant="bodySmall" style={{ opacity: 0.6 }}>Mappar: {c.rootPaths.join(', ') || '(inga)'}</Text>
            <View style={styles.row}>
              <Button compact mode="outlined" disabled={busy} onPress={() => onTest(c)}>Testa</Button>
              <Button compact mode="outlined" disabled={busy} onPress={() => (picker?.connId === c.id ? setPicker(null) : openPicker(c))}>
                {picker?.connId === c.id ? 'Stäng' : 'Mappar'}
              </Button>
              <Button compact mode="contained" disabled={busy} onPress={() => onSync(c)}>Synka nu</Button>
            </View>
            <View style={styles.row}>
              <Switch value={c.includeInChat !== false} onValueChange={() => toggleIncludeInChat(c)} />
              <Text variant="bodySmall" style={{ flex: 1 }}>Använd dessa filer i AI-chatten</Text>
            </View>
            {c.includeInChat !== false && (
              <Button compact mode="text" onPress={() => cycleMinLevel(c)}>Endast på nivå: {minLevelLabel(c.minContextLevel)}</Button>
            )}
            <View style={styles.row}>
              <Button compact mode="text" onPress={() => cycleInterval(c)}>
                Auto: {INTERVALS.find((i) => i.v === (c.intervalMinutes || 0))?.label || 'Manuell'}
              </Button>
              <Button compact mode="text" onPress={() => startEdit(c)}>Redigera</Button>
              <Button compact mode="text" textColor={theme.colors.error} disabled={busy} onPress={() => onDelete(c)}>Ta bort</Button>
            </View>

            {picker?.connId === c.id && (
              <View style={styles.picker}>
                <View style={styles.row}>
                  <Button compact mode="text" onPress={() => openPicker(c, '')}>Roten</Button>
                  {!!picker.path && <Text variant="bodySmall" style={{ opacity: 0.6 }}>/ {picker.path}</Text>}
                </View>
                {picker.loading ? <Text variant="bodySmall" style={{ opacity: 0.6 }}>Laddar…</Text>
                  : picker.entries.length === 0 ? <Text variant="bodySmall" style={{ opacity: 0.6 }}>Inga undermappar.</Text>
                  : picker.entries.map((e) => (
                    <View key={e.path} style={styles.pickerRow}>
                      <Checkbox status={c.rootPaths.includes(e.path) ? 'checked' : 'unchecked'} onPress={() => toggleRoot(c, e.path)} />
                      <Button compact mode="text" onPress={() => openPicker(c, e.path)} style={{ flex: 1 }} contentStyle={{ justifyContent: 'flex-start' }}>{e.name}/</Button>
                    </View>
                  ))}
              </View>
            )}
          </View>
        ))}

        <Divider style={{ marginVertical: 8 }} />
        <Text variant="labelMedium" style={{ marginBottom: 4 }}>{editingId ? 'Redigera anslutning' : 'Lägg till anslutning'}</Text>
        <TextInput dense mode="outlined" label="Namn (valfritt)" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} style={styles.input} />
        <TextInput dense mode="outlined" label="Värd (cloud.exempel.se)" autoCapitalize="none" value={form.host} onChangeText={(t) => setForm({ ...form, host: t })} style={styles.input} />
        <TextInput dense mode="outlined" label="Användarnamn" autoCapitalize="none" value={form.username} onChangeText={(t) => setForm({ ...form, username: t })} style={styles.input} />
        <TextInput dense mode="outlined" label={editingId ? 'App-lösenord (lämna tomt = behåll)' : 'App-lösenord'} secureTextEntry value={form.password} onChangeText={(t) => setForm({ ...form, password: t })} style={styles.input} />
        <TextInput dense mode="outlined" label="Mappar (eller använd Mappar-knappen ovan)" value={form.roots} onChangeText={(t) => setForm({ ...form, roots: t })} style={styles.input} />
        <View style={styles.row}>
          <Button mode="contained-tonal" onPress={saveConnectionForm} style={{ marginTop: 4 }}>{editingId ? 'Uppdatera anslutning' : 'Spara anslutning'}</Button>
          {editingId && <Button mode="text" onPress={cancelEdit} style={{ marginTop: 4 }}>Avbryt</Button>}
        </View>
        {!editingId && <Button mode="outlined" disabled={busy || !form.host.trim()} onPress={onOAuth} style={{ marginTop: 4 }}>Logga in via Nextcloud (OAuth)</Button>}
        {!editingId && <Text variant="bodySmall" style={{ opacity: 0.6, marginTop: 2 }}>OAuth: ange bara värden ovan, logga in i webbläsaren och bevilja — inget lösenord behöver skrivas. Efteråt: tryck "Mappar" på anslutningen för att kryssa i mappar att synka.</Text>}

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

            <Button compact mode="text" onPress={() => setNeo4jAdvanced((v) => !v)} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
              {neo4jAdvanced ? 'Dölj avancerat' : 'Avancerat (egen URL / databas)…'}
            </Button>
            {neo4jAdvanced && (
              <View style={{ marginTop: 4 }}>
                <Text variant="bodySmall" style={{ opacity: 0.7, marginBottom: 4 }}>
                  Standard = serverns konfigurerade Neo4j (via din vanliga server-URL). Fyll bara i nedan om du vill peka mot en egen Neo4j.
                </Text>
                <TextInput dense mode="outlined" label="Neo4j HTTP-URL (valfritt, t.ex. http://neo4j:7474)" autoCapitalize="none"
                  value={neo4j.httpUrl || ''} onChangeText={(t) => updateNeo4j({ httpUrl: t })} style={styles.input} />
                <TextInput dense mode="outlined" label="Databas (standard: neo4j)" autoCapitalize="none"
                  value={neo4j.database || ''} onChangeText={(t) => updateNeo4j({ database: t })} style={styles.input} />
              </View>
            )}

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
  picker: { marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#8884', paddingTop: 4 },
  pickerRow: { flexDirection: 'row', alignItems: 'center' },
  input: { marginBottom: 6 },
});

export default NextcloudSettings;
