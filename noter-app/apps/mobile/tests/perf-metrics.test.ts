import {
  getMobilePerformanceSnapshot,
  recordAiGenerationSample,
  recordAiRowRender,
  recordMobileAppReady,
  recordStartupStage,
  recordSyncQueueDrain,
  recordSyncQueueEnqueue,
  recordSyncQueueMergeIntoCreate,
  recordSyncQueueRemoveQueuedCreate,
  resetMobilePerformanceSnapshot,
} from '../services/perfMetrics';

describe('mobile performance metrics', () => {
  beforeEach(() => {
    resetMobilePerformanceSnapshot();
  });

  it('records startup, ai and sync queue snapshots', () => {
    recordMobileAppReady();
    recordStartupStage('databaseInit', 24);
    recordStartupStage('databaseInit', 12);
    recordAiRowRender('chatBubble');
    recordAiRowRender('toolRow');
    recordAiGenerationSample({
      durationMs: 320,
      tokenCount: 48,
      flushCount: 6,
      tokensPerSecond: 150,
      toolMessageCount: 2,
      ok: true,
    });
    recordSyncQueueEnqueue();
    recordSyncQueueMergeIntoCreate();
    recordSyncQueueRemoveQueuedCreate();
    recordSyncQueueDrain({
      batchSize: 4,
      failedItems: 1,
      durationMs: 180,
      oldestItemAgeMs: 2200,
    });

    const snapshot = getMobilePerformanceSnapshot();

    expect(snapshot.appReadySinceLaunchMs).toEqual(expect.any(Number));
    expect(snapshot.startup.stages.databaseInit).toEqual({
      count: 2,
      totalMs: 36,
      maxMs: 24,
      lastMs: 12,
    });
    expect(snapshot.ai.renderCounts).toEqual({
      chatBubble: 1,
      toolRow: 1,
    });
    expect(snapshot.ai.generation).toMatchObject({
      count: 1,
      successCount: 1,
      errorCount: 0,
      lastDurationMs: 320,
      lastTokenCount: 48,
      lastFlushCount: 6,
      lastTokensPerSecond: 150,
      lastToolMessageCount: 2,
    });
    expect(snapshot.syncQueue).toMatchObject({
      enqueued: 1,
      mergedIntoCreate: 1,
      removedQueuedCreate: 1,
      drainedBatches: 1,
      drainedItems: 4,
      failedItems: 1,
      lastBatchSize: 4,
      lastDrainDurationMs: 180,
      lastOldestItemAgeMs: 2200,
      maxBatchSize: 4,
    });
  });
});
