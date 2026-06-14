import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Portal, Dialog, Text, Button, IconButton, useTheme } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';

export interface CalDavCredential {
  serverUrl: string;
  username: string;
  password?: string;
  displayName?: string | null;
}

/**
 * Shows a freshly-minted CalDAV credential with a SEPARATE copy button per field
 * (server-URL, username, password). The password is shown only once, so copying each
 * piece independently must be effortless. Used for both the all-tasks scope (Settings)
 * and a single task-list (Tasks screen).
 */
export function CalDavCredentialDialog({
  visible,
  credential,
  onDismiss,
  scopeLabel,
}: {
  visible: boolean;
  credential: CalDavCredential | null;
  onDismiss: () => void;
  scopeLabel?: string;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (field: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(field);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600);
  };

  const copyAll = async () => {
    if (!credential) return;
    const block = `Server: ${credential.serverUrl}\nAnvändarnamn: ${credential.username}\nLösenord: ${credential.password || ''}`;
    await Clipboard.setStringAsync(block);
    setCopied('all');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600);
  };

  if (!credential) return null;

  const rows: { key: string; label: string; value: string }[] = [
    { key: 'server', label: 'Server-URL', value: credential.serverUrl },
    { key: 'user', label: 'Användarnamn', value: credential.username },
    { key: 'pass', label: 'Lösenord (visas bara nu)', value: credential.password || '' },
  ];

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>CalDAV-koppling</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodySmall" style={{ marginBottom: 12, opacity: 0.7 }}>
            {scopeLabel ? `${scopeLabel}. ` : ''}Lägg till som CalDAV-konto i Påminnelser (Mac/iOS) eller Tasks.org (Android). Kopiera varje fält separat nedan — lösenordet visas bara den här gången.
          </Text>
          {rows.map((r) => (
            <View key={r.key} style={styles.row}>
              <View style={styles.textCol}>
                <Text variant="labelSmall" style={{ opacity: 0.6 }}>{r.label}</Text>
                <Text selectable style={styles.value}>{r.value || '—'}</Text>
              </View>
              <IconButton
                icon={copied === r.key ? 'check' : 'content-copy'}
                size={20}
                accessibilityLabel={`Kopiera ${r.label}`}
                iconColor={copied === r.key ? theme.colors.primary : undefined}
                onPress={() => copy(r.key, r.value)}
                disabled={!r.value}
              />
            </View>
          ))}
        </Dialog.Content>
        <Dialog.Actions>
          <Button icon={copied === 'all' ? 'check' : 'content-copy'} onPress={copyAll}>
            {copied === 'all' ? 'Kopierat' : 'Kopiera alla'}
          </Button>
          <Button onPress={onDismiss}>Klar</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  textCol: { flex: 1, paddingRight: 8 },
  value: { fontFamily: 'monospace', fontSize: 13 },
});
