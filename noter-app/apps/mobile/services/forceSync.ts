/**
 * Force-sync ALL external sources now (mobile): Nextcloud (two-way) + CalDAV/calendar shares
 * (push projection + drain inbound). Used by the prominent "Synka mot källor" button and on
 * app-foreground. A concurrency guard makes repeated taps / overlapping triggers a no-op so the
 * sync stays stable.
 */
import { listConnections, syncConnection } from '@/services/nextcloud';
import { refreshShares, pushCalendarFeed, drainCalendarMutations } from '@/services/calendarSubscription';

export interface ForceSyncResult {
  nextcloud: { created: number; updated: number; deleted: number; pushed: number; connections: number };
  calendarPushed: number;
  calendarDrained: number;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

let running = false;
export const isForceSyncRunning = (): boolean => running;

export const forceSyncAllSources = async (): Promise<ForceSyncResult> => {
  const base: ForceSyncResult = {
    nextcloud: { created: 0, updated: 0, deleted: 0, pushed: 0, connections: 0 },
    calendarPushed: 0, calendarDrained: 0, ok: true,
  };
  if (running) return { ...base, skipped: true };
  running = true;
  try {
    // 1) Nextcloud — every connection, two-way (each syncConnection pushes local edits first).
    for (const conn of await listConnections()) {
      try {
        const r = await syncConnection(conn.id);
        base.nextcloud.created += r.created;
        base.nextcloud.updated += r.updated;
        base.nextcloud.deleted += r.deleted;
        base.nextcloud.pushed += r.pushed || 0;
        base.nextcloud.connections += 1;
      } catch { /* skip this connection */ }
    }
    // 2) CalDAV / calendar shares — refresh, push the latest projection, drain inbound mutations.
    try { await refreshShares(); } catch { /* */ }
    try { base.calendarPushed = await pushCalendarFeed(); } catch { /* */ }
    try { base.calendarDrained = await drainCalendarMutations(); } catch { /* */ }
    return base;
  } catch (e: any) {
    return { ...base, ok: false, error: e?.message || 'Synk misslyckades' };
  } finally {
    running = false;
  }
};
