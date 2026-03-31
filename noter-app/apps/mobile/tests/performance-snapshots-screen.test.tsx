import React from 'react';
import renderer, { act } from 'react-test-renderer';
import PerformanceSnapshotsScreen from '../app/performance-snapshots';

const mockGetMobilePerformanceSnapshot = jest.fn(() => ({
  appStartedAt: 100,
  appReadySinceLaunchMs: 250,
  startup: {
    bootstrapRuns: 1,
    successCount: 1,
    failureCount: 0,
    lastDurationMs: 120,
    lastError: null,
    stages: {
      databaseInit: { count: 1, totalMs: 12, maxMs: 12, lastMs: 12 },
    },
  },
  ai: {
    renderCounts: { chatBubble: 2, toolRow: 1 },
    generation: {
      count: 1,
      successCount: 1,
      errorCount: 0,
      lastDurationMs: 400,
      maxDurationMs: 400,
      totalDurationMs: 400,
      lastTokenCount: 30,
      lastFlushCount: 4,
      lastTokensPerSecond: 75,
      lastToolMessageCount: 1,
    },
  },
  syncQueue: {
    enqueued: 3,
    mergedIntoCreate: 1,
    removedQueuedCreate: 1,
    drainedBatches: 1,
    drainedItems: 3,
    failedItems: 0,
    lastBatchSize: 3,
    lastDrainDurationMs: 90,
    lastOldestItemAgeMs: 1000,
    maxBatchSize: 3,
  },
}));
const mockResetMobilePerformanceSnapshot = jest.fn();

jest.mock('@/services/perfMetrics', () => ({
  getMobilePerformanceSnapshot: () => mockGetMobilePerformanceSnapshot(),
  resetMobilePerformanceSnapshot: () => mockResetMobilePerformanceSnapshot(),
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-paper', () => ({
  Button: (props: any) => require('react').createElement('Button', props, props.children),
  Divider: (props: any) => require('react').createElement('Divider', props),
  List: {
    Section: (props: any) => require('react').createElement('ListSection', props, props.children),
    Item: (props: any) => require('react').createElement('ListItem', props),
    Icon: (props: any) => require('react').createElement('ListIcon', props),
  },
  Text: (props: any) => require('react').createElement('Text', props, props.children),
  useTheme: () => ({ colors: { background: '#fff', onSurfaceVariant: '#666' } }),
}));

jest.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  StyleSheet: { create: () => ({}) },
  View: 'View',
}));

describe('PerformanceSnapshotsScreen', () => {
  beforeEach(() => {
    mockGetMobilePerformanceSnapshot.mockClear();
    mockResetMobilePerformanceSnapshot.mockClear();
  });

  it('renders snapshot sections and resets metrics', () => {
    let tree: renderer.ReactTestRenderer | undefined;
    act(() => {
      tree = renderer.create(<PerformanceSnapshotsScreen />);
    });
    if (!tree) throw new Error('Missing renderer instance');

    const listItems = (tree.root as any).findAll((node: any) => node.type === 'ListItem');
    expect(listItems.some((node: any) => node.props?.title === 'settings.performanceAppReady')).toBe(true);
    expect(listItems.some((node: any) => node.props?.title === 'settings.performanceAiGeneration')).toBe(true);

    const resetButton = (tree.root as any)
      .findAll((node: any) => node.type === 'Button')
      .find((node: any) => node.props?.children === 'settings.performanceSnapshotsReset');
    expect(resetButton).toBeTruthy();

    act(() => {
      resetButton.props.onPress();
    });

    expect(mockResetMobilePerformanceSnapshot).toHaveBeenCalled();
    expect(mockGetMobilePerformanceSnapshot).toHaveBeenCalled();
  });
});
