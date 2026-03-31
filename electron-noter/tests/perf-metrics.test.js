const {
  getElectronPerformanceSnapshot,
  recordAiChatSample,
  recordAiDownloadSample,
  recordSettingsQueueEnqueue,
  recordSettingsQueueFlush,
  recordStartupEvent,
  resetElectronPerformanceSnapshot,
} = require('../src/perfMetrics');

describe('electron performance metrics', () => {
  beforeEach(() => {
    resetElectronPerformanceSnapshot();
  });

  it('records startup, queue and ai samples', () => {
    recordStartupEvent('app-ready', { at: 10 });
    recordStartupEvent('window-created', { at: 20 });
    recordStartupEvent('load-started', { at: 30, source: 'dev-url' });
    recordStartupEvent('did-finish-load', { at: 40 });
    recordStartupEvent('window-shown', { at: 50 });
    recordStartupEvent('renderer-recovery');
    recordStartupEvent('did-fail-load');
    recordSettingsQueueEnqueue({ pendingResolvers: 2, coalesced: true });
    recordSettingsQueueFlush({ durationMs: 14, snapshotKeys: 3 });
    recordAiDownloadSample({ durationMs: 220, progressEventCount: 5, modelId: 'model-1', ok: true });
    recordAiChatSample({ durationMs: 180, tokenCount: 12, chatId: 'chat-1', ok: false });

    const snapshot = getElectronPerformanceSnapshot();

    expect(snapshot.startup).toMatchObject({
      appReadyAt: 10,
      windowCreatedAt: 20,
      firstLoadStartedAt: 30,
      didFinishLoadAt: 40,
      windowShownAt: 50,
      lastLoadSource: 'dev-url',
      recoveryCount: 1,
      didFailLoadCount: 1,
    });
    expect(snapshot.settingsQueue).toMatchObject({
      enqueued: 1,
      flushes: 1,
      coalescedWrites: 1,
      maxPendingResolvers: 2,
      lastPendingResolvers: 0,
      lastFlushDurationMs: 14,
      lastSnapshotKeys: 3,
    });
    expect(snapshot.ai.downloads).toMatchObject({
      count: 1,
      failureCount: 0,
      lastDurationMs: 220,
      lastProgressEventCount: 5,
      lastModelId: 'model-1',
    });
    expect(snapshot.ai.chats).toMatchObject({
      count: 1,
      failureCount: 1,
      lastDurationMs: 180,
      lastTokenCount: 12,
      lastChatId: 'chat-1',
    });
  });
});
