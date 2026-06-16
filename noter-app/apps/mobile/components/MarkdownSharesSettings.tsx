import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { List, Text, Button, Dialog, Portal, TextInput, Checkbox, Divider, useTheme } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { useStore } from '@/stores/useStore';
import { buildSecurityNoteMap, isReadableWithLocks, normalizeNoteType } from '@repo/shared';
import {
  type MarkdownShare, type MintedDavCredential,
  refreshMarkdownShares, getCachedMarkdownShares, createMarkdownShare, updateMarkdownShare,
  deleteMarkdownShare, mintMarkdownDav, revokeMarkdownDav, mintMarkdownCrdt, revokeMarkdownCrdt,
} from '@/services/markdownShare';
import { CalDavCredentialDialog } from '@/components/CalDavCredentialDialog';

/**
 * Settings: External Markdown "delningar" (shares). A share exposes a chosen SET of
 * notes/project-folders as a Markdown vault reachable from Obsidian, Finder, Android and
 * widgets. Per share you choose the transports (WebDAV and/or Live/CRDT) and which
 * directions are allowed, copy/rotate/revoke the WebDAV login, and revoke instantly.
 * Locked notes are never exposed.
 */
type EditState = {
  shareId?: string;
  name: string;
  folderIds: string[];
  noteIds: string[];
  modes: { webdav: boolean; crdt: boolean };
  direction: { outbound: boolean; inbound: boolean };
};

export function MarkdownSharesSettings() {
  const theme = useTheme();
  const notes = useStore((s: any) => s.notes);
  const unlocked = useStore((s: any) => s.unlockedProtectedNoteIds);

  // Settings manages PROJECT-FOLDER shares only. Individual notes are shared from each
  // note's own 3-dots menu (otherwise this becomes an unwieldy list of every note).
  const { folders } = useMemo(() => {
    const all = (notes || []) as any[];
    const noteMap = buildSecurityNoteMap(all as any);
    const u = new Set<string>(unlocked || []);
    const readable = all.filter((n) => isReadableWithLocks(n as any, noteMap as any, u));
    return {
      folders: readable.filter((n) => normalizeNoteType(n.type) === 'project'),
    };
  }, [notes, unlocked]);

  const [shares, setShares] = useState<MarkdownShare[]>([]);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [cred, setCred] = useState<MintedDavCredential | null>(null);
  const [credVisible, setCredVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getCachedMarkdownShares().then(setShares).catch(() => {}); refreshMarkdownShares().then(setShares).catch(() => {}); }, []);
  const reload = useCallback(async () => { try { setShares(await refreshMarkdownShares()); } catch { /* ignore */ } }, []);

  const scopeLabel = (s: MarkdownShare) => {
    const f = s.folderIds?.length ? `${s.folderIds.length} ${s.folderIds.length === 1 ? 'mapp' : 'mappar'}` : '';
    const n = s.noteIds?.length ? `${s.noteIds.length} ${s.noteIds.length === 1 ? 'anteckning' : 'anteckningar'}` : '';
    const both = [f, n].filter(Boolean).join(' + ');
    return both || 'Inget valt än';
  };
  const transportLabel = (s: MarkdownShare) => {
    const parts: string[] = [];
    if (s.modes?.webdav) parts.push('WebDAV');
    if (s.modes?.crdt) parts.push('Live (CRDT)');
    const dir = s.direction?.outbound && s.direction?.inbound ? '↔' : s.direction?.outbound ? '→' : s.direction?.inbound ? '←' : '—';
    return `${parts.join(' + ') || 'Inget'} ${dir}`;
  };

  const copyDav = async (s: MarkdownShare) => {
    if (!s.dav) return;
    await Clipboard.setStringAsync(s.dav.collectionUrl);
    Alert.alert('Kopierat', 'WebDAV-adressen är kopierad. Lägg till den i Obsidian (Remotely Save → WebDAV), Finder eller en Android WebDAV-app.');
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const name = editing.name.trim() || 'Markdown-delning';
      const payload = { name, folderIds: editing.folderIds, noteIds: editing.noteIds, modes: editing.modes, direction: editing.direction };
      if (editing.shareId) await updateMarkdownShare(editing.shareId, payload);
      else await createMarkdownShare(payload);
      setEditing(null); await reload();
    } catch (e: any) { Alert.alert('Fel', e?.message || 'Kunde inte spara delningen.'); }
    finally { setBusy(false); }
  };
  const remove = (s: MarkdownShare) => Alert.alert('Ta bort delning', `Ta bort "${s.name}"? Extern åtkomst slutar fungera direkt.`, [
    { text: 'Avbryt', style: 'cancel' },
    { text: 'Ta bort', style: 'destructive', onPress: async () => { await deleteMarkdownShare(s.shareId); await reload(); } },
  ]);
  const enableDav = async (s: MarkdownShare) => {
    setBusy(true);
    try { const c = await mintMarkdownDav(s.shareId); setCred(c); setCredVisible(true); await reload(); }
    catch (e: any) { Alert.alert('Fel', e?.message || 'Kunde inte skapa WebDAV-inlogg.'); }
    finally { setBusy(false); }
  };
  const revokeDav = (s: MarkdownShare) => Alert.alert('Inaktivera WebDAV', `Inloggningen för "${s.name}" slutar fungera direkt.`, [
    { text: 'Avbryt', style: 'cancel' },
    { text: 'Inaktivera', style: 'destructive', onPress: async () => { await revokeMarkdownDav(s.shareId); await reload(); } },
  ]);
  const enableLive = async (s: MarkdownShare) => {
    setBusy(true);
    try { const t = await mintMarkdownCrdt(s.shareId); Alert.alert('Live-läge aktiverat', `Token (visas en gång):\n${t.token}\n\nWS: ${t.wsUrl}`); await reload(); }
    catch (e: any) { Alert.alert('Fel', e?.message || 'Kunde inte aktivera Live-läge.'); }
    finally { setBusy(false); }
  };
  const revokeLive = (s: MarkdownShare) => Alert.alert('Inaktivera Live', `Live-läget för "${s.name}" stängs av.`, [
    { text: 'Avbryt', style: 'cancel' },
    { text: 'Inaktivera', style: 'destructive', onPress: async () => { await revokeMarkdownCrdt(s.shareId); await reload(); } },
  ]);

  const toggleFolder = (id: string) => setEditing((e) => e && ({ ...e, folderIds: e.folderIds.includes(id) ? e.folderIds.filter((x) => x !== id) : [...e.folderIds, id] }));

  // Settings lists PROJECT-FOLDER shares only. A pure single-note share (created from a
  // note's 3-dots menu) is managed from that note, not here — keeps this list short.
  const folderShares = shares.filter((s) => (s.folderIds?.length || 0) > 0);

  return (
    <View>
      <List.Subheader>Extern Markdown-delning (projektmappar)</List.Subheader>
      <Text variant="bodySmall" style={styles.intro}>
        Exponera valda projektmappar som en Markdown-vault för Obsidian, Mac, Android och widgets.
        Välj WebDAV och/eller Live (CRDT), och vilka riktningar som tillåts. Låsta anteckningar delas aldrig.
        {'\n'}Enskilda anteckningar delas från anteckningens egen meny (de tre prickarna).
      </Text>

      {folderShares.map((s) => (
        <View key={s.shareId} style={[styles.card, { borderColor: theme.colors.outlineVariant }]}>
          <Text variant="titleSmall">{s.name || 'Delning'}</Text>
          <Text variant="bodySmall" style={{ opacity: 0.6 }}>{scopeLabel(s)} · {s.count ?? 0} filer</Text>
          <Text variant="bodySmall" style={{ opacity: 0.6, marginBottom: 6 }}>{transportLabel(s)}</Text>
          <View style={styles.row}>
            {s.dav ? <Button compact mode="outlined" icon="content-copy" onPress={() => copyDav(s)}>Kopiera WebDAV</Button> : null}
            {s.modes?.webdav ? <Button compact mode="outlined" icon="key" onPress={() => enableDav(s)} disabled={busy}>{s.dav ? 'Nytt lösenord' : 'WebDAV-inlogg'}</Button> : null}
            {s.modes?.crdt ? (
              s.crdt?.enabled
                ? <Button compact textColor={theme.colors.error} onPress={() => revokeLive(s)}>Stäng Live</Button>
                : <Button compact mode="outlined" icon="lightning-bolt" onPress={() => enableLive(s)} disabled={busy}>Aktivera Live</Button>
            ) : null}
          </View>
          <View style={styles.row}>
            <Button compact onPress={() => setEditing({ shareId: s.shareId, name: s.name, folderIds: s.folderIds || [], noteIds: s.noteIds || [], modes: s.modes || { webdav: true, crdt: false }, direction: s.direction || { outbound: true, inbound: true } })}>Ändra</Button>
            {s.dav ? <Button compact textColor={theme.colors.error} onPress={() => revokeDav(s)}>Inaktivera WebDAV</Button> : null}
            <Button compact textColor={theme.colors.error} onPress={() => remove(s)}>Ta bort</Button>
          </View>
        </View>
      ))}

      <Button mode="contained-tonal" icon="plus" style={{ margin: 12 }} onPress={() => setEditing({ name: '', folderIds: [], noteIds: [], modes: { webdav: true, crdt: false }, direction: { outbound: true, inbound: true } })}>Ny Markdown-delning</Button>

      <Portal>
        <Dialog visible={!!editing} onDismiss={() => setEditing(null)} style={{ maxHeight: '85%' }}>
          <Dialog.Title>{editing?.shareId ? 'Redigera delning' : 'Ny delning'}</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
              <TextInput mode="outlined" label="Namn" value={editing?.name || ''} onChangeText={(t) => setEditing((e) => e && ({ ...e, name: t }))} style={{ marginBottom: 10 }} />

              <Text variant="labelLarge" style={{ marginTop: 4 }}>Transport</Text>
              <Checkbox.Item label="WebDAV (Obsidian/Finder/Android/widgets)" status={editing?.modes.webdav ? 'checked' : 'unchecked'} onPress={() => setEditing((e) => e && ({ ...e, modes: { ...e.modes, webdav: !e.modes.webdav } }))} />
              <Checkbox.Item label="Live (CRDT) — realtid keystroke-nivå" status={editing?.modes.crdt ? 'checked' : 'unchecked'} onPress={() => setEditing((e) => e && ({ ...e, modes: { ...e.modes, crdt: !e.modes.crdt } }))} />

              <Text variant="labelLarge" style={{ marginTop: 8 }}>Riktning</Text>
              <Checkbox.Item label="Utåt (appen → externt)" status={editing?.direction.outbound ? 'checked' : 'unchecked'} onPress={() => setEditing((e) => e && ({ ...e, direction: { ...e.direction, outbound: !e.direction.outbound } }))} />
              <Checkbox.Item label="Inåt (externt → appen)" status={editing?.direction.inbound ? 'checked' : 'unchecked'} onPress={() => setEditing((e) => e && ({ ...e, direction: { ...e.direction, inbound: !e.direction.inbound } }))} />

              <Divider style={{ marginVertical: 8 }} />
              <Text variant="labelLarge">Projektmappar</Text>
              {folders.length === 0 ? <Text variant="bodySmall" style={{ opacity: 0.5, padding: 8 }}>Inga projektmappar ännu.</Text> : folders.map((f) => (
                <Checkbox.Item key={f._id} label={f.title || 'Mapp'} status={editing?.folderIds.includes(f._id) ? 'checked' : 'unchecked'} onPress={() => toggleFolder(f._id)} />
              ))}
              <Text variant="bodySmall" style={{ opacity: 0.5, paddingHorizontal: 8, marginTop: 6 }}>
                Vill du dela en enskild anteckning? Öppna anteckningen → de tre prickarna → "Dela externt".
              </Text>
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setEditing(null)}>Avbryt</Button>
            <Button onPress={save} loading={busy} disabled={busy}>Spara</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <CalDavCredentialDialog
        visible={credVisible}
        credential={cred}
        scopeLabel="Lägg till i Obsidian (Remotely Save → WebDAV), Finder eller en Android WebDAV-app"
        onDismiss={() => setCredVisible(false)}
      />
      <Divider style={{ marginTop: 8 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { opacity: 0.6, paddingHorizontal: 16, marginBottom: 8 },
  card: { marginHorizontal: 12, marginBottom: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
});
