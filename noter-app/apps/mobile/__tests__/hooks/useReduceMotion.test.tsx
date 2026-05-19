import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

// Capture the listener so we can fire reduceMotionChanged manually.
let capturedListener: ((v: boolean) => void) | null = null;

jest.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)),
    addEventListener: jest.fn((event: string, cb: (v: boolean) => void) => {
      if (event === 'reduceMotionChanged') capturedListener = cb;
      return { remove: () => { capturedListener = null; } };
    }),
  },
}));

import { useReduceMotion } from '../../hooks/useReduceMotion';

describe('useReduceMotion', () => {
  beforeEach(() => {
    capturedListener = null;
  });

  it('initial value is false when OS is initially disabled', async () => {
    const { result } = renderHook(() => useReduceMotion());
    // Initial sync render: false.
    expect(result.current).toBe(false);
    // Let the resolved promise flush; it stays false because OS reports false.
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(false);
  });

  it('updates when reduceMotionChanged fires', async () => {
    const { result } = renderHook(() => useReduceMotion());
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(false);

    await act(async () => {
      capturedListener?.(true);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      capturedListener?.(false);
    });
    expect(result.current).toBe(false);
  });
});
