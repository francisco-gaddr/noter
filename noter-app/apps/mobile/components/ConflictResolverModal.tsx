import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, RadioButton, Text, useTheme } from 'react-native-paper';
import { applyConflictChoices } from '@/services/syncConflict';

/**
 * UI for the `requires-prompt` outcome of resolveConflict.
 *
 * Shows each conflicting field with the local + remote values side-by-side
 * and a radio-group to pick which to keep. Caller passes `onResolve` with
 * the merged record once the user accepts. Cancel returns null.
 *
 * Designed to be safe with very long values: each preview is clamped to
 * 200 chars + ellipsis so an enormous note body doesn't blow out the
 * modal.
 */

const PREVIEW_MAX_LEN = 200;
const valuePreview = (v: unknown): string => {
  if (v === null) return '∅';
  if (v === undefined) return '(missing)';
  if (typeof v === 'string') return v.length > PREVIEW_MAX_LEN ? `${v.slice(0, PREVIEW_MAX_LEN)}…` : v;
  try {
    const j = JSON.stringify(v);
    return j.length > PREVIEW_MAX_LEN ? `${j.slice(0, PREVIEW_MAX_LEN)}…` : j;
  } catch {
    return String(v);
  }
};

export interface ConflictResolverModalProps<T extends Record<string, unknown>> {
  visible: boolean;
  base: T;
  local: T;
  remote: T;
  conflicts: Array<{ field: string; base: unknown; local: unknown; remote: unknown }>;
  onResolve: (merged: T) => void;
  onCancel: () => void;
}

export function ConflictResolverModal<T extends Record<string, unknown>>(props: ConflictResolverModalProps<T>) {
  const { visible, base, local, remote, conflicts, onResolve, onCancel } = props;
  const theme = useTheme();
  const initialChoices = useMemo<Record<string, 'local' | 'remote'>>(() => {
    // Default to 'local' for every field — matches the offline-first bias
    // in applyConflictChoices.
    const out: Record<string, 'local' | 'remote'> = {};
    for (const c of conflicts) out[c.field] = 'local';
    return out;
  }, [conflicts]);
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>(initialChoices);

  const accept = () => {
    const merged = applyConflictChoices<T>({ base, local, remote }, conflicts, choices);
    onResolve(merged);
  };

  return (
    <Modal visible={visible} onRequestClose={onCancel} animationType="fade" transparent>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
        <Card style={[styles.card, { backgroundColor: theme.colors.elevation.level3 }]}
          accessibilityViewIsModal accessibilityRole="none" accessibilityLabel="Sync conflict">
          <Card.Title title="Resolve sync conflict" subtitle={`${conflicts.length} field(s) need a decision`} />
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {conflicts.map((c) => (
              <Card key={c.field} mode="outlined" style={styles.field}>
                <Card.Title title={c.field} />
                <Card.Content>
                  <RadioButton.Group
                    onValueChange={(v) => setChoices((prev) => ({ ...prev, [c.field]: v as 'local' | 'remote' }))}
                    value={choices[c.field] ?? 'local'}
                  >
                    <View style={styles.option}>
                      <RadioButton value="local" />
                      <View style={styles.optionLabel}>
                        <Text variant="labelLarge">On this device</Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                          {valuePreview(c.local)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.option}>
                      <RadioButton value="remote" />
                      <View style={styles.optionLabel}>
                        <Text variant="labelLarge">From server</Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                          {valuePreview(c.remote)}
                        </Text>
                      </View>
                    </View>
                  </RadioButton.Group>
                </Card.Content>
              </Card>
            ))}
          </ScrollView>
          <Card.Actions>
            <Button onPress={onCancel} accessibilityLabel="Cancel without resolving">Cancel</Button>
            <Button mode="contained" onPress={accept} accessibilityLabel="Apply selected resolutions">Apply</Button>
          </Card.Actions>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  body: {
    maxHeight: 480,
  },
  bodyContent: {
    padding: 12,
  },
  field: {
    marginBottom: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 6,
  },
  optionLabel: {
    flex: 1,
    marginLeft: 4,
  },
});
