import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Dialog, Portal, Text, Button, Checkbox, Switch, Divider, useTheme, ActivityIndicator } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';
import {
  type MarkdownShare, type MintedDavCredential,
  refreshMarkdownShares, getCachedMarkdownShares, createMarkdownShare, updateMarkdownShare,
  deleteMarkdownShare, mintMarkdownDav, revokeMarkdownDav, mintMarkdownCrdt, revokeMarkdownCrdt,
} from '@/services/markdownShare';
import { CalDavCredentialDialog } from '@/components/CalDavCredentialDialog';

/**
 * Per-ITEM external Markdown share dialog — the same capability as the Settings list, but
 * scoped to ONE note or ONE project-folder, so it can live on the item itself (the note's
 * 3-dots menu / a project-folder's 3-dots menu). Locked notes are never exposed (enforced
 * server-side + by the lock-aware projection in the service).
 *
 * It finds (or creates) the single-item share for this note/folder and lets the user pick
 * the transports (WebDAV and/or Live/CRDT) + directions, then copy/rotate/revoke the
 * WebDAV login and toggle Live. Toggling "Dela externt" off deletes the share (instant revoke).
 */
export function MarkdownShareItemDialog({
  visible, onDismiss, noteId, folderId, itemName,
}: {
  visible: boolean;
  onDismiss: () => void;
  noteId?: string;
  folderId?: string;
  itemName?: string;
}) {
  const theme = useTheme();
  const [share, setShare] = useState<MarkdownShare | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cred, setCred] = useState<MintedDavCredential | null>(null);
  const [credVisible, setCredVisible] = useState(false);

  // A share is "this item's" when its scope is EXACTLY this one note (or folder).
  const matchesItem = useCallback((s: MarkdownShare): boolean => {
    const folderIds = s.folderIds || [];
    const noteIds = s.noteIds || [];
    if (noteId) return noteIds.length === 1 && noteIds[0] === noteId && folderIds.length === 0;
    if (folderId) return folderIds.length === 1 && folderIds[0] === folderId && noteIds.length === 0;
    return false;
  }, [noteId, folderId]);

  const findShare = useCallback((list: MarkdownShare[]) => list.find(matchesItem) || null, [matchesItem]);

  const reload = useCallback(async () => {
    try { setShare(findShare(await refreshMarkdownShares())); }
    catch { /* offline — keep cached */ }
  }, [findShare]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    getCachedMarkdownShares().then((c) => setShare(findShare(c))).catch(() => {});
    reload().finally(() => setLoading(false));
  }, [visible, reload, findShare]);

  const defaultName = (itemName || (noteId ? 'Anteckning' : 'Projektmapp')).slice(0, 60);

  // Turn external sharing on (create a single-item share) or off (delete it → instant revoke).
  const setEnabled = async (on: boolean) => {
    setBusy(true);
    try {
      if (on && !share) {
        const created = await createMarkdownShare({
          name: defaultName,
          folderIds: folderId ? [folderId] : [],
          noteIds: noteId ? [noteId] : [],
          modes: { webdav: true, crdt: false },
          direction: { outbound: true, inbound: true },
        });
        setShare(created);
      } else if (!on && share) {
        await deleteMarkdownShare(share.shareId);
        setShare(null);
      }
      await reload();
    } catch (e: any) {
      Alert.alert('Fel', e?.message || 'Kunde inte uppdatera delningen.');
    } finally { setBusy(false); }
  };

  const patch = async (p: Partial<Pick<MarkdownShare, 'modes' | 'direction'>>) => {
    if (!share) return;
    setBusy(true);
    try { setShare(await updateMarkdownShare(share.shareId, p as any)); await reload(); }
    catch (e: any) { Alert.alert('Fel', e?.message || 'Kunde inte spara.'); }
    finally { setBusy(false); }
  };

  const toggleMode = (key: 'webdav' | 'crdt') => {
    if (!share) return;
    const modes = { ...(share.modes || { webdav: true, crdt: false }), [key]: !share.modes?.[key] };
    if (!modes.webdav && !modes.crdt) { Alert.alert('Minst en transport', 'Välj WebDAV och/eller Live.'); return; }
    void patch({ modes });
  };
  const toggleDir = (key: 'outbound' | 'inbound') => {
    if (!share) return;
    const direction = { ...(share.direction || { outbound: true, inbound: true }), [key]: !share.direction?.[key] };
    if (!direction.outbound && !direction.inbound) { Alert.alert('Minst en riktning', 'Välj utåt och/eller inåt.'); return; }
    void patch({ direction });
  };

  const copyDav = async () => {
    if (!share?.dav) return;
    await Clipboard.setStringAsync(share.dav.collectionUrl);
    Alert.alert('Kopierat', 'WebDAV-adressen är kopierad. Lägg till den i Obsidian (Remotely Save → WebDAV), Finder eller en Android WebDAV-app.');
  };
  const mintDav = async () => {
    if (!share) return;
    setBusy(true);
    try { const c = await mintMarkdownDav(share.shareId); setCred(c); setCredVisible(true); await reload(); }
    catch (e: any) { Alert.alert('Fel', e?.message || 'Kunde inte skapa WebDAV-inlogg.'); }
    finally { setBusy(false); }
  };
  const revokeDav = () => share && Alert.alert('Inaktivera WebDAV', 'Inloggningen slutar fungera direkt.', [
    { text: 'Avbryt', style: 'cancel' },
    { text: 'Inaktivera', style: 'destructive', onPress: async () => { await revokeMarkdownDav(share.shareId); await reload(); } },
  ]);
  const mintLive = async () => {
    if (!share) return;
    setBusy(true);
    try { const t = await mintMarkdownCrdt(share.shareId); Alert.alert('Live-läge aktiverat', `Token (visas en gång):\n${t.token}\n\nWS: ${t.wsUrl}`); await reload(); }
    catch (e: any) { Alert.alert('Fel', e?.message || 'Kunde inte aktivera Live-läge.'); }
    finally { setBusy(false); }
  };
  const revokeLive = () => share && Alert.alert('Inaktivera Live', 'Live-läget stängs av.', [
    { text: 'Avbryt', style: 'cancel' },
    { text: 'Inaktivera', style: 'destructive', onPress: async () => { await revokeMarkdownCrdt(share.shareId); await reload(); } },
  ]);

  const enabled = !!share;

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={{ maxHeight: '85%' }}>
        <Dialog.Title>Dela som extern Markdown</Dialog.Title>
        <Dialog.ScrollArea>
          <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
            <Text variant="bodySmall" style={{ opacity: 0.7, marginBottom: 10 }}>
              {noteId ? 'Den här anteckningen' : 'Den här projektmappen'} kan exponeras som en Markdown-fil/-vault
              för Obsidian, Mac, Android och widgets. {noteId ? '' : 'Låsta anteckningar i mappen delas aldrig.'}
            </Text>

            <View style={styles.rowBetween}>
              <Text variant="titleSmall">Dela externt</Text>
              {loading ? <ActivityIndicator size="small" /> : (
                <Switch value={enabled} disabled={busy} onValueChange={setEnabled} />
              )}
            </View>

            {enabled && (
              <>
                <Divider style={{ marginVertical: 8 }} />
                <Text variant="labelLarge">Transport</Text>
                <Checkbox.Item label="WebDAV (Obsidian/Finder/Android/widgets)" status={share?.modes?.webdav ? 'checked' : 'unchecked'} disabled={busy} onPress={() => toggleMode('webdav')} />
                <Checkbox.Item label="Live (CRDT) — realtid keystroke-nivå" status={share?.modes?.crdt ? 'checked' : 'unchecked'} disabled={busy} onPress={() => toggleMode('crdt')} />

                <Text variant="labelLarge" style={{ marginTop: 8 }}>Riktning</Text>
                <Checkbox.Item label="Utåt (appen → externt)" status={share?.direction?.outbound ? 'checked' : 'unchecked'} disabled={busy} onPress={() => toggleDir('outbound')} />
                <Checkbox.Item label="Inåt (externt → appen)" status={share?.direction?.inbound ? 'checked' : 'unchecked'} disabled={busy} onPress={() => toggleDir('inbound')} />

                {share?.modes?.webdav && (
                  <>
                    <Divider style={{ marginVertical: 8 }} />
                    <Text variant="labelLarge">WebDAV-inlogg</Text>
                    <View style={styles.row}>
                      {share?.dav ? <Button compact mode="outlined" icon="content-copy" onPress={copyDav}>Kopiera adress</Button> : null}
                      <Button compact mode="outlined" icon="key" onPress={mintDav} disabled={busy}>{share?.dav ? 'Nytt lösenord' : 'Skapa inlogg'}</Button>
                      {share?.dav ? <Button compact textColor={theme.colors.error} onPress={revokeDav} disabled={busy}>Inaktivera</Button> : null}
                    </View>
                  </>
                )}

                {share?.modes?.crdt && (
                  <>
                    <Divider style={{ marginVertical: 8 }} />
                    <Text variant="labelLarge">Live (CRDT)</Text>
                    <View style={styles.row}>
                      {share?.crdt?.enabled
                        ? <Button compact textColor={theme.colors.error} onPress={revokeLive} disabled={busy}>Stäng Live</Button>
                        : <Button compact mode="outlined" icon="lightning-bolt" onPress={mintLive} disabled={busy}>Aktivera Live</Button>}
                    </View>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Klar</Button>
        </Dialog.Actions>
      </Dialog>

      <CalDavCredentialDialog
        visible={credVisible}
        credential={cred}
        scopeLabel="Lägg till i Obsidian (Remotely Save → WebDAV), Finder eller en Android WebDAV-app"
        onDismiss={() => setCredVisible(false)}
      />
    </Portal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
