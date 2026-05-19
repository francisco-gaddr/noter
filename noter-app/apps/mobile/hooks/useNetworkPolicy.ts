import { useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export type NetworkPolicy = 'wifi' | 'cellular' | 'metered' | 'offline' | 'unknown';

interface ResolvedPolicy {
  policy: NetworkPolicy;
  /** Minimum interval (ms) between background syncs. */
  syncIntervalMs: number;
  /** Whether large attachments/sync-batches should be deferred until wifi. */
  preferDeferLargeUploads: boolean;
  /** Whether the app is online at all. */
  isOnline: boolean;
}

const OFFLINE: ResolvedPolicy = {
  policy: 'offline',
  syncIntervalMs: Number.POSITIVE_INFINITY,
  preferDeferLargeUploads: true,
  isOnline: false,
};

const WIFI: ResolvedPolicy = {
  policy: 'wifi',
  syncIntervalMs: 30_000,
  preferDeferLargeUploads: false,
  isOnline: true,
};

const CELLULAR: ResolvedPolicy = {
  policy: 'cellular',
  // 5 min — keeps notifications/incremental sync alive but doesn't burn
  // cellular data. iOS Low Data Mode + Android Data Saver bump us further.
  syncIntervalMs: 5 * 60_000,
  preferDeferLargeUploads: true,
  isOnline: true,
};

const METERED: ResolvedPolicy = {
  // Cellular when isConnectionExpensive=true OR carrier reports metered link.
  policy: 'metered',
  syncIntervalMs: 15 * 60_000,
  preferDeferLargeUploads: true,
  isOnline: true,
};

const UNKNOWN: ResolvedPolicy = {
  policy: 'unknown',
  // Behave like cellular — conservative until we know better.
  syncIntervalMs: 5 * 60_000,
  preferDeferLargeUploads: true,
  isOnline: true,
};

const resolve = (state: NetInfoState | null): ResolvedPolicy => {
  if (!state || state.isConnected !== true) return OFFLINE;
  // isConnectionExpensive is the right signal for cellular-style links + iOS
  // Low Data Mode + Android Data Saver. Honour it even on wifi (some hotspots
  // are billed by GB).
  const expensive = (state.details as any)?.isConnectionExpensive === true;
  if (expensive) return METERED;
  if (state.type === 'wifi' || state.type === 'ethernet') return WIFI;
  if (state.type === 'cellular') return CELLULAR;
  return UNKNOWN;
};

/**
 * Live network policy. Subscribes to NetInfo and re-emits a derived policy
 * object: { syncIntervalMs, preferDeferLargeUploads, isOnline }. Sync code
 * reads from this hook rather than NetInfo directly so policy logic stays
 * centralised + testable.
 */
export const useNetworkPolicy = (): ResolvedPolicy => {
  const [policy, setPolicy] = useState<ResolvedPolicy>(UNKNOWN);

  useEffect(() => {
    let mounted = true;
    NetInfo.fetch().then((s) => { if (mounted) setPolicy(resolve(s)); }).catch(() => undefined);
    const sub = NetInfo.addEventListener((s) => { if (mounted) setPolicy(resolve(s)); });
    return () => {
      mounted = false;
      sub();
    };
  }, []);

  return policy;
};

// Pure helpers exported for unit tests.
export const _resolveNetworkPolicy = resolve;
export const _PRESETS = { OFFLINE, WIFI, CELLULAR, METERED, UNKNOWN };
