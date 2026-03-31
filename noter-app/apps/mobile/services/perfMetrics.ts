type DurationAggregate = {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
};

type MobilePerformanceSnapshot = {
  appStartedAt: number;
  appReadySinceLaunchMs: number | null;
  startup: {
    bootstrapRuns: number;
    successCount: number;
    failureCount: number;
    lastDurationMs: number | null;
    lastError: string | null;
    stages: Record<string, DurationAggregate>;
  };
  ai: {
    renderCounts: {
      chatBubble: number;
      toolRow: number;
    };
    generation: {
      count: number;
      successCount: number;
      errorCount: number;
      lastDurationMs: number | null;
      maxDurationMs: number;
      totalDurationMs: number;
      lastTokenCount: number;
      lastFlushCount: number;
      lastTokensPerSecond: number;
      lastToolMessageCount: number;
    };
  };
  syncQueue: {
    enqueued: number;
    mergedIntoCreate: number;
    removedQueuedCreate: number;
    drainedBatches: number;
    drainedItems: number;
    failedItems: number;
    lastBatchSize: number;
    lastDrainDurationMs: number | null;
    lastOldestItemAgeMs: number | null;
    maxBatchSize: number;
  };
};

const appStartedAt = Date.now();

const createDurationAggregate = (): DurationAggregate => ({
  count: 0,
  totalMs: 0,
  maxMs: 0,
  lastMs: 0,
});

const createSnapshot = (): MobilePerformanceSnapshot => ({
  appStartedAt,
  appReadySinceLaunchMs: null,
  startup: {
    bootstrapRuns: 0,
    successCount: 0,
    failureCount: 0,
    lastDurationMs: null,
    lastError: null,
    stages: {},
  },
  ai: {
    renderCounts: {
      chatBubble: 0,
      toolRow: 0,
    },
    generation: {
      count: 0,
      successCount: 0,
      errorCount: 0,
      lastDurationMs: null,
      maxDurationMs: 0,
      totalDurationMs: 0,
      lastTokenCount: 0,
      lastFlushCount: 0,
      lastTokensPerSecond: 0,
      lastToolMessageCount: 0,
    },
  },
  syncQueue: {
    enqueued: 0,
    mergedIntoCreate: 0,
    removedQueuedCreate: 0,
    drainedBatches: 0,
    drainedItems: 0,
    failedItems: 0,
    lastBatchSize: 0,
    lastDrainDurationMs: null,
    lastOldestItemAgeMs: null,
    maxBatchSize: 0,
  },
});

let snapshot = createSnapshot();

const updateDurationAggregate = (target: DurationAggregate, durationMs: number) => {
  target.count += 1;
  target.totalMs += durationMs;
  target.lastMs = durationMs;
  target.maxMs = Math.max(target.maxMs, durationMs);
};

export const recordMobileAppReady = () => {
  if (snapshot.appReadySinceLaunchMs !== null) return;
  snapshot.appReadySinceLaunchMs = Date.now() - snapshot.appStartedAt;
};

export const recordStartupBootstrap = (ok: boolean, durationMs: number, errorMessage?: string) => {
  snapshot.startup.bootstrapRuns += 1;
  snapshot.startup.lastDurationMs = durationMs;
  snapshot.startup.lastError = ok ? null : (errorMessage || 'unknown');
  if (ok) {
    snapshot.startup.successCount += 1;
  } else {
    snapshot.startup.failureCount += 1;
  }
};

export const recordStartupStage = (name: string, durationMs: number) => {
  const current = snapshot.startup.stages[name] || createDurationAggregate();
  updateDurationAggregate(current, durationMs);
  snapshot.startup.stages[name] = current;
};

export const recordAiRowRender = (kind: 'chatBubble' | 'toolRow') => {
  snapshot.ai.renderCounts[kind] += 1;
};

export const recordAiGenerationSample = (sample: {
  durationMs: number;
  tokenCount: number;
  flushCount: number;
  tokensPerSecond: number;
  toolMessageCount: number;
  ok: boolean;
}) => {
  snapshot.ai.generation.count += 1;
  snapshot.ai.generation.totalDurationMs += sample.durationMs;
  snapshot.ai.generation.lastDurationMs = sample.durationMs;
  snapshot.ai.generation.maxDurationMs = Math.max(snapshot.ai.generation.maxDurationMs, sample.durationMs);
  snapshot.ai.generation.lastTokenCount = sample.tokenCount;
  snapshot.ai.generation.lastFlushCount = sample.flushCount;
  snapshot.ai.generation.lastTokensPerSecond = sample.tokensPerSecond;
  snapshot.ai.generation.lastToolMessageCount = sample.toolMessageCount;
  if (sample.ok) {
    snapshot.ai.generation.successCount += 1;
  } else {
    snapshot.ai.generation.errorCount += 1;
  }
};

export const recordSyncQueueEnqueue = () => {
  snapshot.syncQueue.enqueued += 1;
};

export const recordSyncQueueMergeIntoCreate = () => {
  snapshot.syncQueue.mergedIntoCreate += 1;
};

export const recordSyncQueueRemoveQueuedCreate = () => {
  snapshot.syncQueue.removedQueuedCreate += 1;
};

export const recordSyncQueueDrain = (sample: {
  batchSize: number;
  failedItems: number;
  durationMs: number;
  oldestItemAgeMs: number | null;
}) => {
  snapshot.syncQueue.drainedBatches += 1;
  snapshot.syncQueue.drainedItems += sample.batchSize;
  snapshot.syncQueue.failedItems += sample.failedItems;
  snapshot.syncQueue.lastBatchSize = sample.batchSize;
  snapshot.syncQueue.lastDrainDurationMs = sample.durationMs;
  snapshot.syncQueue.lastOldestItemAgeMs = sample.oldestItemAgeMs;
  snapshot.syncQueue.maxBatchSize = Math.max(snapshot.syncQueue.maxBatchSize, sample.batchSize);
};

export const getMobilePerformanceSnapshot = () => JSON.parse(JSON.stringify(snapshot)) as MobilePerformanceSnapshot;

export const resetMobilePerformanceSnapshot = () => {
  snapshot = createSnapshot();
};
