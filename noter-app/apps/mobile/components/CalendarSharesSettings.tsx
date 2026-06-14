import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { List, Text, Button, Dialog, Portal, TextInput, Checkbox, Divider, useTheme } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { useStore } from '@/stores/useStore';
import { listShareableTaskLists } from '@repo/shared';
import {
  type Share, type MintedDavCredential,
  refreshShares, getCachedShares, createShare, updateShare, deleteShare, mintShareDav, revokeShareDav,
} from '@/services/calendarSubscription';
import { CalDavCredentialDialog } from '@/components/CalDavCredentialDialog';

/**
 * Settings: calendar/CalDAV "delningar" (shares). A share covers a chosen SET of
 * task-lists (or all) under ONE ICS link + ONE CalDAV login. One place to copy,
 * rotate and revoke — single list or any combination. Locked lists aren't selectable.
 */
export function CalendarSharesSettings() {
  const theme = useTheme();
  const notes = useStore((s: any) => s.notes);
  const tasks = useStore((s: any) => s.tasks);
  const unlocked = useStore((s: any) => s.unlockedProtectedNoteIds);

  // Shared, decrypt-aware, task-inference list selection (single source of truth).
  const lists = useMemo(
    () => listShareableTaskLists(notes as any, tasks as any, unlocked || []),
    [notes, tasks, unlocked],
  );
  const nameOf = (id: string) => lists.find((l) => l.id === id)?.name || 'Lista';

  const [shares, setShares] = useState<Share[]>([]);
  const [editing, setEditing] = useState<{ shareId?: string; name: string; listIds: string[] } | null>(null);
  const [cred, setCred] = useState<MintedDavCredential | null>(null);
  const [credVisible, setCredVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getCachedShares().then(setShares).catch(() => {}); refreshShares().then(setShares).catch(() => {}); }, []);
  const reload = useCallback(async () => { try { setShares(await refreshShares()); } catch { /* ignore */ } }, []);

  const scopeLabel = (s: Share) =>
    !s.listIds.length ? 'Alla uppgifter' : `${s.listIds.length} ${s.listIds.length === 1 ? 'lista' : 'listor'}: ${s.listIds.map(nameOf).join(', ')}`;

  const copyIcs = async (s: Share) => { await Clipboard.setStringAsync(s.icsUrl); Alert.alert('Kopierat', 'Kalenderlänken är kopierad. Klistra in i din kalenderapp (prenumerera via URL).'); };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const name = editing.name.trim() || 'Delning';
      if (editing.shareId) await updateShare(editing.shareId, { name, listIds: editing.listIds });
      else await createShare(name, editing.listIds);
      setEditing(null); await reload();
    } catch (e: any) { Alert.alert('Fel', e?.message || 'Kunde inte spara delningen.'); }
    finally { setBusy(false); }
  };
  const remove = (s: Share) => Alert.alert('Ta bort delning', `Ta bort "${s.name}"? Länken och inloggningen slutar fungera.`, [
    { text: 'Avbryt', style: 'cancel' },
    { text: 'Ta bort', style: 'destructive', onPress: async () => { await deleteShare(s.shareId); await reload(); } },
  ]);
  const enableDav = async (s: Share) => {
    setBusy(true);
    try { const c = await mintShareDav(s.shareId); setCred(c); setCredVisible(true); await reload(); }
    catch (e: any) { Alert.alert('Fel', e?.message || 'Kunde inte aktivera CalDAV.'); }
    finally { setBusy(false); }
  };
  const revokeDav = (s: Share) => Alert.alert('Inaktivera CalDAV', `Inloggningen för "${s.name}" slutar fungera direkt.`, [
    { text: 'Avbryt', style: 'cancel' },
    { text: 'Inaktivera', style: 'destructive', onPress: async () => { await revokeShareDav(s.shareId); await reload(); } },
  ]);
  const toggleList = (id: string) => setEditing((e) => e && ({ ...e, listIds: e.listIds.includes(id) ? e.listIds.filter((x) => x !== id) : [...e.listIds, id] }));

  return (
    <View>
      <List.Subheader>Kalender &amp; CalDAV — delningar</List.Subheader>
      <Text variant="bodySmall" style={styles.intro}>Varje delning samlar valda uppgiftslistor under en kalenderlänk och ett CalDAV-inlogg. Låsta listor delas aldrig.</Text>

      {shares.map((s) => (
        <View key={s.shareId} style={[styles.card, { borderColor: theme.colors.outlineVariant }]}>
          <Text variant="titleSmall">{s.name || 'Delning'}</Text>
          <Text variant="bodySmall" style={{ opacity: 0.6, marginBottom: 6 }}>{scopeLabel(s)}</Text>
          <View style={styles.row}>
            <Button compact mode="outlined" icon="calendar" onPress={() => copyIcs(s)}>Kopiera länk</Button>
            <Button compact mode="outlined" icon="sync" onPress={() => enableDav(s)} disabled={busy}>{s.dav ? 'Nytt inlogg' : 'CalDAV-inlogg'}</Button>
          </View>
          <View style={styles.row}>
            <Button compact onPress={() => setEditing({ shareId: s.shareId, name: s.name, listIds: s.listIds })}>Ändra</Button>
            {s.dav ? <Button compact textColor={theme.colors.error} onPress={() => revokeDav(s)}>Inaktivera CalDAV</Button> : null}
            <Button compact textColor={theme.colors.error} onPress={() => remove(s)}>Ta bort</Button>
          </View>
        </View>
      ))}

      <Button mode="contained-tonal" icon="plus" style={{ margin: 12 }} onPress={() => setEditing({ name: '', listIds: [] })}>Ny delning</Button>

      <Portal>
        <Dialog visible={!!editing} onDismiss={() => setEditing(null)}>
          <Dialog.Title>{editing?.shareId ? 'Redigera delning' : 'Ny delning'}</Dialog.Title>
          <Dialog.Content>
            <TextInput mode="outlined" label="Namn" value={editing?.name || ''} onChangeText={(t) => setEditing((e) => e && ({ ...e, name: t }))} style={{ marginBottom: 8 }} />
            <Text variant="bodySmall" style={{ opacity: 0.6, marginBottom: 4 }}>Uppgiftslistor (inga valda = alla uppgifter)</Text>
            <ScrollView style={{ maxHeight: 240 }}>
              {lists.length === 0 ? <Text variant="bodySmall" style={{ opacity: 0.5, padding: 8 }}>Inga uppgiftslistor ännu.</Text> : lists.map((l) => (
                <Checkbox.Item key={l.id} label={l.name} status={editing?.listIds.includes(l.id) ? 'checked' : 'unchecked'} onPress={() => toggleList(l.id)} />
              ))}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditing(null)}>Avbryt</Button>
            <Button onPress={save} loading={busy} disabled={busy}>Spara</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <CalDavCredentialDialog
        visible={credVisible}
        credential={cred}
        scopeLabel="Lägg till som CalDAV-konto i Påminnelser eller Tasks.org"
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
