const appStartedAt = Date.now();

const createSnapshot = () => ({
  appStartedAt,
  startup: {
    appReadyAt: null,
    windowCreatedAt: null,
    firstLoadStartedAt: null,
    didFinishLoadAt: null,
    windowShownAt: null,
    lastLoadSource: null,
    lastUrl: null,
    lastError: null,
    recoveryCount: 0,
    didFailLoadCount: 0,
    recentEvents: [],
  },
  settingsQueue: {
    enqueued: 0,
    flushes: 0,
    coalescedWrites: 0,
    maxPendingResolvers: 0,
    lastPendingResolvers: 0,
    lastFlushDurationMs: null,
    lastSnapshotKeys: 0,
  },
  ai: {
    downloads: {
      count: 0,
      failureCount: 0,
      lastDurationMs: null,
      lastProgressEventCount: 0,
      lastModelId: null,
    },
    chats: {
      count: 0,
      failureCount: 0,
      lastDurationMs: null,
      lastTokenCount: 0,
      lastChatId: null,
    },
  },
});

let snapshot = createSnapshot();

const ensureTimestamp = (value) => value ?? Date.now();

const recordStartupEvent = (event, extra = {}) => {
  const at = ensureTimestamp(extra.at);
  if (event === 'app-ready') snapshot.startup.appReadyAt = at;
  if (event === 'window-created') snapshot.startup.windowCreatedAt = at;
  if (event === 'load-started') snapshot.startup.firstLoadStartedAt = at;
  if (event === 'did-finish-load') snapshot.startup.didFinishLoadAt = at;
  if (event === 'window-shown') snapshot.startup.windowShownAt = at;
  if (event === 'did-fail-load') snapshot.startup.didFailLoadCount += 1;
  if (event === 'renderer-recovery') snapshot.startup.recoveryCount += 1;
  if (extra.source) snapshot.startup.lastLoadSource = extra.source;
  if (typeof extra.url === 'string') snapshot.startup.lastUrl = extra.url;
  if (typeof extra.error === 'string') snapshot.startup.lastError = extra.error;
  snapshot.startup.recentEvents.push({
    event,
    at,
    source: extra.source || null,
    url: typeof extra.url === 'string' ? extra.url : null,
    error: typeof extra.error === 'string' ? extra.error : null,
  });
  if (snapshot.startup.recentEvents.length > 20) {
    snapshot.startup.recentEvents.shift();
  }
};

const recordSettingsQueueEnqueue = ({ pendingResolvers, coalesced }) => {
  snapshot.settingsQueue.enqueued += 1;
  snapshot.settingsQueue.lastPendingResolvers = pendingResolvers;
  snapshot.settingsQueue.maxPendingResolvers = Math.max(snapshot.settingsQueue.maxPendingResolvers, pendingResolvers);
  if (coalesced) snapshot.settingsQueue.coalescedWrites += 1;
};

const recordSettingsQueueFlush = ({ durationMs, snapshotKeys }) => {
  snapshot.settingsQueue.flushes += 1;
  snapshot.settingsQueue.lastFlushDurationMs = durationMs;
  snapshot.settingsQueue.lastSnapshotKeys = snapshotKeys;
  snapshot.settingsQueue.lastPendingResolvers = 0;
};

const recordAiDownloadSample = ({ durationMs, progressEventCount, modelId, ok }) => {
  snapshot.ai.downloads.count += 1;
  snapshot.ai.downloads.lastDurationMs = durationMs;
  snapshot.ai.downloads.lastProgressEventCount = progressEventCount;
  snapshot.ai.downloads.lastModelId = modelId || null;
  if (!ok) snapshot.ai.downloads.failureCount += 1;
};

const recordAiChatSample = ({ durationMs, tokenCount, chatId, ok }) => {
  snapshot.ai.chats.count += 1;
  snapshot.ai.chats.lastDurationMs = durationMs;
  snapshot.ai.chats.lastTokenCount = tokenCount;
  snapshot.ai.chats.lastChatId = chatId || null;
  if (!ok) snapshot.ai.chats.failureCount += 1;
};

const getElectronPerformanceSnapshot = () => JSON.parse(JSON.stringify(snapshot));

const resetElectronPerformanceSnapshot = () => {
  snapshot = createSnapshot();
};

module.exports = {
  getElectronPerformanceSnapshot,
  recordAiChatSample,
  recordAiDownloadSample,
  recordSettingsQueueEnqueue,
  recordSettingsQueueFlush,
  recordStartupEvent,
  resetElectronPerformanceSnapshot,
};
