import type { Server as HttpServer } from 'node:http';
import type { Server as SocketIOServer } from 'socket.io';
import mongoose from 'mongoose';
import logger from './logger';

const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS) || 30_000;
const SHUTDOWN_HARD_KILL_MS = 5_000;

let shuttingDown = false;

export interface ShutdownHandles {
  httpServer: HttpServer;
  io?: SocketIOServer;
  /**
   * Additional async-disposable resources to close in order. Each gets a
   * `Promise.race(closer, timeout)` so a stuck dependency cannot block the
   * shutdown indefinitely.
   */
  extras?: Array<{ name: string; close: () => Promise<void> }>;
}

const withTimeout = async <T>(name: string, fn: () => Promise<T>, ms: number): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn().then(() => undefined),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} close timed out after ${ms}ms`)), ms);
      }),
    ]);
  } catch (err) {
    logger.warn('shutdown.step-failed', { name, error: (err as Error)?.message });
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const installGracefulShutdown = (handles: ShutdownHandles): void => {
  const trigger = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      logger.warn('shutdown.duplicate-signal', { signal });
      return;
    }
    shuttingDown = true;
    logger.info('shutdown.started', { signal, graceMs: SHUTDOWN_GRACE_MS });

    // Set a hard-kill timer so a misbehaving dependency cannot prevent exit.
    const hardKill = setTimeout(() => {
      logger.error('shutdown.hard-kill', { graceMs: SHUTDOWN_GRACE_MS });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS + SHUTDOWN_HARD_KILL_MS);
    // unref so it doesn't itself prevent exit when everything closes cleanly.
    hardKill.unref();

    // 1. Stop accepting new HTTP connections; existing requests can drain.
    await withTimeout('http-server', () => new Promise<void>((resolve, reject) => {
      handles.httpServer.close((err) => err ? reject(err) : resolve());
    }), SHUTDOWN_GRACE_MS);

    // 2. Disconnect socket.io clients gracefully so the browser reconnects
    //    against the new pod instead of getting a TCP RST.
    if (handles.io) {
      await withTimeout('socket-io', async () => {
        // Send disconnect to all connected clients.
        handles.io!.sockets.sockets.forEach((s) => s.disconnect(true));
        // Close the io server.
        await new Promise<void>((resolve) => handles.io!.close(() => resolve()));
      }, 5_000);
    }

    // 3. Run user-supplied extras in declared order.
    for (const extra of handles.extras || []) {
      await withTimeout(extra.name, extra.close, 5_000);
    }

    // 4. Close mongoose AFTER the HTTP layer so in-flight queries finish.
    await withTimeout('mongoose', async () => { await mongoose.connection.close(); }, 5_000);

    logger.info('shutdown.complete');
    clearTimeout(hardKill);
    process.exit(0);
  };

  // Signals we expect from k8s (SIGTERM), docker stop, and Ctrl+C (SIGINT).
  process.once('SIGTERM', () => { void trigger('SIGTERM'); });
  process.once('SIGINT', () => { void trigger('SIGINT'); });

  // Surface uncaught failures as a shutdown rather than silently leaking.
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { error: err.message, stack: err.stack });
    void trigger('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { reason: String(reason) });
    // Do NOT trigger shutdown on unhandledRejection — log it and let the
    // operator decide; killing a pod for a stray rejected promise is rude.
  });
};

export const isShuttingDown = (): boolean => shuttingDown;
