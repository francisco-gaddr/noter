import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { List, Text, useTheme } from 'react-native-paper';
import { WHATS_NEW_ENTRIES } from '@repo/shared';
import { useTranslation } from 'react-i18next';

export default function WhatsNewScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const latestKey = useMemo(
    () => `${WHATS_NEW_ENTRIES[0]?.version ?? 'latest'}-${WHATS_NEW_ENTRIES[0]?.build ?? 'build'}`,
    []
  );
  const [expanded, setExpanded] = useState<string>(latestKey);

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text variant="headlineSmall">{t('settings.whatsNewTitle')}</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {t('whatsNew.latestExpanded')}
        </Text>
      </View>
      <List.Section>
        {WHATS_NEW_ENTRIES.map((entry) => {
          const key = `${entry.version}-${entry.build}`;
          return (
            <List.Accordion
              key={key}
              expanded={expanded === key}
              onPress={() => setExpanded((prev) => (prev === key ? '' : key))}
              title={`v${entry.version} (${entry.build})`}
              description={entry.date}
              left={(props) => <List.Icon {...props} icon="new-box" />}
            >
              {entry.highlights.map((item, idx) => (
                <List.Item
                  key={`${key}-${idx}`}
                  title={`• ${item}`}
                  titleNumberOfLines={4}
                  style={styles.item}
                />
              ))}
            </List.Accordion>
          );
        })}
      </List.Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 6,
  },
  item: {
    paddingLeft: 16,
  },
});
