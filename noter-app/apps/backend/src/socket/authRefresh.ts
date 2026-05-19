import jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io';
import { getJwtSecret, getJwtVerifyOptions, isDemoTokenEnabled } from '../utils/security';
import { getUserIdFromDecodedToken } from '../middleware/authMiddleware';
import logger from '../utils/logger';

/**
 * Keep a long-lived Socket.IO connection authenticated as the user's JWT
 * rotates.
 *
 * Why: our access tokens expire (intentionally short-lived, say 15min).
 * A naive socket disconnects on expiry, forcing the client to reconnect —
 * which breaks active note-collab sessions and re-queues every pending
 * delta.
 *
 * Flow:
 *   1. Client sends a new token via `auth:refresh` event when their HTTP
 *      flow obtains a fresh access token.
 *   2. We verify the new token. If valid AND it's the same user, we update
 *      `socket.data.expiresAt` and ack `{ ok: true }`. Otherwise we ack
 *      `{ ok: false, reason }` and let the client decide (disconnect &
 *      retry, log out, etc.).
 *   3. Independently, a timer fires when the current token is about to
 *      expire. We notify the client via `auth:expiring` (so they can
 *      pre-emptively refresh) and disconnect 30s after expiry if no
 *      refresh arrived.
 *
 * This module exports the wire-in helpers; main.js attaches them in the
 * `io.on('connection')` handler.
 */

interface SocketData {
  userId?: string;
  expiresAt?: number; // unix ms
  refreshTimer?: NodeJS.Timeout;
  expiringNotified?: boolean;
}

const PRE_EXPIRY_WARN_MS = 60_000; // tell the client 1 min before expiry
const HARD_DISCONNECT_GRACE_MS = 30_000; // disconnect 30s after expiry if not refreshed

const decodeAndExtractExp = (token: string): { userId: string | undefined; expMs: number | null } => {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), getJwtVerifyOptions());
    const userId = getUserIdFromDecodedToken(decoded);
    const exp = typeof decoded === 'object' && decoded && typeof (decoded as { exp?: number }).exp === 'number'
      ? (decoded as { exp: number }).exp * 1000
      : null;
    return { userId, expMs: exp };
  } catch {
    return { userId: undefined, expMs: null };
  }
};

/**
 * Set up expiry tracking + refresh-listener for a freshly-connected socket.
 * Caller has already verified the initial token; pass the userId + the
 * raw token so we can read its `exp`.
 */
export const installAuthRefresh = (socket: Socket, initialToken: string, userId: string): void => {
  const data = socket.data as SocketData;
  data.userId = userId;
  data.expiringNotified = false;

  const setExpiryTracking = (token: string): void => {
    if (token === 'demo-token') {
      // Demo flow has no real expiry; skip timer machinery entirely.
      data.expiresAt = undefined;
      return;
    }
    const { expMs } = decodeAndExtractExp(token);
    if (!expMs) return;
    data.expiresAt = expMs;
    if (data.refreshTimer) clearTimeout(data.refreshTimer);

    const now = Date.now();
    const msUntilWarn = Math.max(0, expMs - now - PRE_EXPIRY_WARN_MS);
    data.refreshTimer = setTimeout(() => {
      if (!socket.connected) return;
      data.expiringNotified = true;
      socket.emit('auth:expiring', { expiresAt: expMs });
      // After warning, schedule hard disconnect.
      const msUntilHard = Math.max(0, expMs - Date.now() + HARD_DISCONNECT_GRACE_MS);
      data.refreshTimer = setTimeout(() => {
        if (!socket.connected) return;
        if (data.expiresAt && Date.now() > data.expiresAt + HARD_DISCONNECT_GRACE_MS) {
          logger.info('socket.auth-expired-disconnect', { sid: socket.id, userId: data.userId });
          socket.disconnect(true);
        }
      }, msUntilHard);
    }, msUntilWarn);
  };

  setExpiryTracking(initialToken);

  socket.on('auth:refresh', (payload: unknown, ack?: (res: { ok: boolean; reason?: string }) => void) => {
    const token = typeof payload === 'object' && payload && typeof (payload as { token?: string }).token === 'string'
      ? (payload as { token: string }).token
      : undefined;
    if (!token) {
      ack?.({ ok: false, reason: 'missing-token' });
      return;
    }
    if (token === 'demo-token') {
      if (!isDemoTokenEnabled()) {
        ack?.({ ok: false, reason: 'demo-disabled' });
        return;
      }
      data.expiresAt = undefined;
      data.expiringNotified = false;
      ack?.({ ok: true });
      return;
    }
    const { userId: nextUserId, expMs } = decodeAndExtractExp(token);
    if (!nextUserId) {
      ack?.({ ok: false, reason: 'invalid-token' });
      return;
    }
    if (nextUserId !== data.userId) {
      // Account-swap mid-socket is suspicious — refuse.
      ack?.({ ok: false, reason: 'user-mismatch' });
      return;
    }
    if (expMs) data.expiresAt = expMs;
    data.expiringNotified = false;
    setExpiryTracking(token);
    ack?.({ ok: true });
  });

  socket.on('disconnect', () => {
    if (data.refreshTimer) clearTimeout(data.refreshTimer);
  });
};

// Test helpers
export const _PRE_EXPIRY_WARN_MS = PRE_EXPIRY_WARN_MS;
export const _HARD_DISCONNECT_GRACE_MS = HARD_DISCONNECT_GRACE_MS;
