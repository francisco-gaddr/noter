import { renderHook, act } from '@testing-library/react-native';
import { useOptimisticMutation } from '../../hooks/useOptimisticMutation';

describe('useOptimisticMutation', () => {
  it('applies locally before the network call', async () => {
    const calls: string[] = [];
    let serverResolve!: () => void;
    const remotePromise = new Promise<void>((r) => { serverResolve = r; });

    const { result } = renderHook(() => useOptimisticMutation<{ v: number }, number>({
      snapshot: () => 0,
      applyLocally: () => { calls.push('local'); },
      commitRemote: async () => { calls.push('remote-start'); await remotePromise; calls.push('remote-done'); },
      rollback: () => { calls.push('rollback'); },
    }));

    let resolveMutate!: () => void;
    await act(async () => {
      const p = result.current.mutate({ v: 1 });
      p.then(() => { resolveMutate(); }, () => { resolveMutate(); });
      // local apply should already have happened
      expect(calls).toEqual(['local', 'remote-start']);
    });
    await act(async () => {
      serverResolve();
      await new Promise<void>((r) => { resolveMutate = r; });
    });
    expect(calls).toEqual(['local', 'remote-start', 'remote-done']);
  });

  it('rolls back on server failure', async () => {
    const cfg = {
      snapshot: jest.fn().mockReturnValue('PREV'),
      applyLocally: jest.fn(),
      commitRemote: jest.fn().mockRejectedValue(new Error('500')),
      rollback: jest.fn(),
    };
    const { result } = renderHook(() => useOptimisticMutation(cfg));
    await act(async () => {
      await expect(result.current.mutate({ x: 1 })).rejects.toThrow('500');
    });
    expect(cfg.snapshot).toHaveBeenCalled();
    expect(cfg.applyLocally).toHaveBeenCalled();
    expect(cfg.rollback).toHaveBeenCalledWith({ x: 1 }, 'PREV');
    expect(result.current.state.error?.message).toBe('500');
  });

  it('skips rollback when shouldRollback returns false (e.g., queued for offline retry)', async () => {
    const rollback = jest.fn();
    const cfg = {
      snapshot: () => null,
      applyLocally: jest.fn(),
      commitRemote: jest.fn().mockRejectedValue(new Error('network')),
      rollback,
      shouldRollback: () => false,
    };
    const { result } = renderHook(() => useOptimisticMutation(cfg));
    await act(async () => {
      await expect(result.current.mutate({ y: 2 })).rejects.toThrow('network');
    });
    expect(rollback).not.toHaveBeenCalled();
  });

  it('reset() clears the error state', async () => {
    const cfg = {
      snapshot: () => null,
      applyLocally: jest.fn(),
      commitRemote: jest.fn().mockRejectedValue(new Error('x')),
      rollback: jest.fn(),
    };
    const { result } = renderHook(() => useOptimisticMutation(cfg));
    await act(async () => { await expect(result.current.mutate(1 as any)).rejects.toBeTruthy(); });
    expect(result.current.state.error).not.toBeNull();
    act(() => { result.current.reset(); });
    expect(result.current.state.error).toBeNull();
  });
});
