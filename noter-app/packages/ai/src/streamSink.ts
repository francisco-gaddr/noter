/**
 * StreamSink — a platform-agnostic, throttled accumulator for streaming LLM tokens.
 *
 * THE mobile-crash fix: the chat UI used to call `setMessages(...)` (a full FlatList re-render) AND
 * schedule work on EVERY streamed token. A fast provider emits 20-60 tok/s, so on a mid/low-end
 * Android device that is hundreds of full-list re-renders per second on the JS thread → ANR / watchdog
 * kill (the "app crashes when chatting" report). The industry fix is to buffer tokens and flush the UI
 * at a bounded rate (~1 frame), never once-per-token.
 *
 * This sink owns that buffering ONCE, for BOTH the mobile app and the Tauri/desktop app (it lives in
 * @repo/ai, imports nothing platform-specific). A consumer feeds it deltas via `push()`; the sink
 * calls `onText(fullText)` at most every `intervalMs`, always fires a final flush on `end()`, and can
 * drive a separate, coarser persistence callback so disk writes are throttled independently.
 *
 * Pure + fully injectable (clock + timer) so it is deterministic under fake timers in unit tests.
 */

export interface StreamSinkOptions {
  /** Throttled UI update — receives the FULL accumulated text so far. */
  onText: (fullText: string) => void;
  /** Minimum ms between `onText` calls. Default 60 (~1 frame at 16ms leaves headroom for render). */
  intervalMs?: number;
  /** Optional persistence callback, throttled on its own (coarser) cadence. */
  onPersist?: (fullText: string) => void;
  /** Minimum ms between `onPersist` calls. Default 1200. */
  persistIntervalMs?: number;
  /** Injected clock (defaults to Date.now) — for deterministic tests. */
  now?: () => number;
  /** Injected timer scheduler (defaults to setTimeout) — for deterministic tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Injected timer canceller (defaults to clearTimeout). */
  clearTimer?: (handle: unknown) => void;
}

export class StreamSink {
  private full = '';
  private readonly onText: (t: string) => void;
  private readonly intervalMs: number;
  private readonly onPersist?: (t: string) => void;
  private readonly persistIntervalMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  // -Infinity so the FIRST token (and first persist) fire immediately (leading edge) — the user sees
  // output start instantly, then subsequent tokens within the window are coalesced.
  private lastTextFlush = Number.NEGATIVE_INFINITY;
  private lastPersist = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;
  /** True between the first trailing flush schedule and the actual flush. */
  private textDirty = false;
  private ended = false;

  constructor(opts: StreamSinkOptions) {
    this.onText = opts.onText;
    this.intervalMs = Math.max(0, opts.intervalMs ?? 60);
    this.onPersist = opts.onPersist;
    this.persistIntervalMs = Math.max(0, opts.persistIntervalMs ?? 1200);
    this.now = opts.now ?? (() => Date.now());
    // Bind the ambient timers by default; the RN/browser signatures are compatible enough here.
    this.setTimer =
      opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** The full text accumulated so far (always current, independent of flush cadence). */
  get text(): string {
    return this.full;
  }

  /** Append a streamed delta. Never throws — a bad callback must not break the stream loop. */
  push(delta: string): void {
    if (this.ended || typeof delta !== 'string' || delta.length === 0) return;
    this.full += delta;
    this.textDirty = true;
    this.maybePersist();

    const elapsed = this.now() - this.lastTextFlush;
    if (elapsed >= this.intervalMs) {
      this.flushText();
    } else if (this.timer == null) {
      // Schedule a single trailing flush for the remainder of the window.
      const wait = Math.max(0, this.intervalMs - elapsed);
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.flushText();
      }, wait);
    }
  }

  private flushText(): void {
    if (!this.textDirty) return;
    this.textDirty = false;
    this.lastTextFlush = this.now();
    try {
      this.onText(this.full);
    } catch {
      /* a UI callback failure must not abort streaming */
    }
  }

  private maybePersist(force = false): void {
    if (!this.onPersist || this.full.length === 0) return;
    if (!force && this.now() - this.lastPersist < this.persistIntervalMs) return;
    this.lastPersist = this.now();
    try {
      this.onPersist(this.full);
    } catch {
      /* persistence is best-effort */
    }
  }

  /** Force an immediate UI + persistence flush (e.g. on a phase boundary). */
  flush(): void {
    if (this.timer != null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.textDirty = true;
    this.flushText();
    this.maybePersist(true);
  }

  /**
   * Finalize the stream: flush the last buffered text + persist, and stop all timers. Idempotent.
   * Call this in a `finally` so the user always sees the complete message even if the stream errored.
   */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.timer != null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.textDirty = true;
    this.flushText();
    this.maybePersist(true);
  }

  /** Abort without a final flush (e.g. the caller is discarding a cancelled stream). Idempotent. */
  cancel(): void {
    this.ended = true;
    if (this.timer != null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.textDirty = false;
  }
}

/** Convenience factory (nicer at call sites than `new`). */
export const createStreamSink = (opts: StreamSinkOptions): StreamSink => new StreamSink(opts);
