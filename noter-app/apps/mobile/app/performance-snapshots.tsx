import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { Button, Divider, List, Text, useTheme } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { getMobilePerformanceSnapshot, resetMobilePerformanceSnapshot } from '@/services/perfMetrics';

export default function PerformanceSnapshotsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState(() => getMobilePerformanceSnapshot());

  const refreshSnapshot = useCallback(() => {
    setSnapshot(getMobilePerformanceSnapshot());
  }, []);

  const resetSnapshot = useCallback(() => {
    resetMobilePerformanceSnapshot();
    refreshSnapshot();
  }, [refreshSnapshot]);

  useEffect(() => {
    refreshSnapshot();
  }, [refreshSnapshot]);

  const startupStageRows = Object.entries(snapshot.startup.stages);

  return (
    <>
      <Stack.Screen options={{ title: t('settings.performanceSnapshotsTitle') }} />
      <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.header}>
          <Text variant="headlineSmall">{t('settings.performanceSnapshotsTitle')}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('settings.performanceSnapshotsHint')}
          </Text>
        </View>

        <View style={styles.actions}>
          <Button mode="contained-tonal" onPress={refreshSnapshot}>
            {t('common.refresh')}
          </Button>
          <Button mode="outlined" onPress={resetSnapshot}>
            {t('settings.performanceSnapshotsReset')}
          </Button>
        </View>

        <List.Section title={t('settings.performanceSnapshotsOverview')}>
          <List.Item
            title={t('settings.performanceAppReady')}
            description={snapshot.appReadySinceLaunchMs == null ? t('settings.performanceNotAvailable') : `${snapshot.appReadySinceLaunchMs} ms`}
            left={(props) => <List.Icon {...props} icon="rocket-launch-outline" />}
          />
        </List.Section>

        <Divider />

        <List.Section title={t('settings.performanceStartup')}>
          <List.Item
            title={t('settings.performanceBootstrapRuns')}
            description={`${snapshot.startup.bootstrapRuns}`}
            left={(props) => <List.Icon {...props} icon="play-circle-outline" />}
          />
          <List.Item
            title={t('settings.performanceStartupLastDuration')}
            description={snapshot.startup.lastDurationMs == null ? t('settings.performanceNotAvailable') : `${snapshot.startup.lastDurationMs} ms`}
            left={(props) => <List.Icon {...props} icon="timer-outline" />}
          />
          <List.Item
            title={t('settings.performanceStartupLastError')}
            description={snapshot.startup.lastError || t('settings.performanceNoErrors')}
            left={(props) => <List.Icon {...props} icon="alert-circle-outline" />}
          />
          {startupStageRows.map(([name, data]) => (
            <List.Item
              key={name}
              title={`${t('settings.performanceStage')} · ${name}`}
              description={`${t('settings.performanceCount')}: ${data.count} · ${t('settings.performanceLast')}: ${data.lastMs} ms · ${t('settings.performanceMax')}: ${data.maxMs} ms`}
              left={(props) => <List.Icon {...props} icon="chart-timeline-variant" />}
            />
          ))}
        </List.Section>

        <Divider />

        <List.Section title={t('settings.performanceAi')}>
          <List.Item
            title={t('settings.performanceAiRenders')}
            description={`${t('settings.performanceChatBubbles')}: ${snapshot.ai.renderCounts.chatBubble} · ${t('settings.performanceToolRows')}: ${snapshot.ai.renderCounts.toolRow}`}
            left={(props) => <List.Icon {...props} icon="message-processing-outline" />}
          />
          <List.Item
            title={t('settings.performanceAiGeneration')}
            description={`${t('settings.performanceCount')}: ${snapshot.ai.generation.count} · ${t('settings.performanceLast')}: ${snapshot.ai.generation.lastDurationMs ?? 0} ms · TPS: ${snapshot.ai.generation.lastTokensPerSecond.toFixed(1)}`}
            left={(props) => <List.Icon {...props} icon="brain" />}
          />
          <List.Item
            title={t('settings.performanceAiTokens')}
            description={`${t('settings.performanceLast')}: ${snapshot.ai.generation.lastTokenCount} · ${t('settings.performanceFlushes')}: ${snapshot.ai.generation.lastFlushCount} · ${t('settings.performanceToolMessages')}: ${snapshot.ai.generation.lastToolMessageCount}`}
            left={(props) => <List.Icon {...props} icon="counter" />}
          />
        </List.Section>

        <Divider />

        <List.Section title={t('settings.performanceSyncQueue')}>
          <List.Item
            title={t('settings.performanceQueueEvents')}
            description={`${t('settings.performanceEnqueued')}: ${snapshot.syncQueue.enqueued} · ${t('settings.performanceMerged')}: ${snapshot.syncQueue.mergedIntoCreate} · ${t('settings.performanceRemoved')}: ${snapshot.syncQueue.removedQueuedCreate}`}
            left={(props) => <List.Icon {...props} icon="database-sync-outline" />}
          />
          <List.Item
            title={t('settings.performanceQueueDrain')}
            description={`${t('settings.performanceBatches')}: ${snapshot.syncQueue.drainedBatches} · ${t('settings.performanceItems')}: ${snapshot.syncQueue.drainedItems} · ${t('settings.performanceFailures')}: ${snapshot.syncQueue.failedItems}`}
            left={(props) => <List.Icon {...props} icon="playlist-check" />}
          />
          <List.Item
            title={t('settings.performanceQueueLatest')}
            description={`${t('settings.performanceBatchSize')}: ${snapshot.syncQueue.lastBatchSize} · ${t('settings.performanceLast')}: ${snapshot.syncQueue.lastDrainDurationMs ?? 0} ms · ${t('settings.performanceOldestAge')}: ${snapshot.syncQueue.lastOldestItemAgeMs ?? 0} ms`}
            left={(props) => <List.Icon {...props} icon="history" />}
          />
        </List.Section>

        <Divider />

        <View style={styles.rawSection}>
          <Text variant="titleMedium">{t('settings.performanceRawSnapshot')}</Text>
          <Text selectable style={[styles.rawText, { color: theme.colors.onSurfaceVariant }]}>
            {JSON.stringify(snapshot, null, 2)}
          </Text>
        </View>
      </ScrollView>
    </>
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
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 12,
  },
  rawSection: {
    padding: 16,
    gap: 10,
  },
  rawText: {
    fontSize: 12,
    lineHeight: 18,
  },
});
