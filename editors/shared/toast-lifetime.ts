/**
 * How long a notice stays, and how many may be on screen — owned by us, not
 * by the toast host.
 *
 * Connect's react-toastify container runs with `pauseOnFocusLoss` (its
 * default): every toast's clock stops the moment the page loses focus, and a
 * package cannot change that from a per-toast option. That is precisely the
 * situation this vault is used in — a person watching an agent work from a
 * terminal — so notices accumulated while the window was blurred and were all
 * still there on return. The host's `autoClose` is therefore off for our
 * toasts, and the lifetime is this module's: wall-clock, paused only while
 * the pointer or keyboard focus is on the card (someone is reading it).
 *
 * The ledger is the other half of "they don't stack up": distinct headlines
 * pass the dedupe in `notify.ts`, so a burst of different failures could still
 * pile up within one lifetime. At most `MAX_VISIBLE_NOTICES` are shown; a new
 * one closes the oldest.
 */
export const MAX_VISIBLE_NOTICES = 3;

/** Injectable for tests; the real one is `globalThis`. */
export type Timers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
};

const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
  now: () => Date.now(),
};

export type DismissTimer = {
  /** Stop the clock, keeping what is left. Idempotent. */
  pause(): void;
  /** Start it again from what was left. Idempotent. */
  resume(): void;
  /** Never fire. */
  cancel(): void;
  /** What is left on the clock, for tests and diagnostics. */
  remainingMs(): number;
};

/** Counts down `ttlMs` of wall-clock time and fires `onExpire` once. Starts running. */
export function createDismissTimer(
  ttlMs: number,
  onExpire: () => void,
  timers: Timers = realTimers,
): DismissTimer {
  let remaining = Math.max(0, ttlMs);
  let startedAt: number | undefined;
  let handle: unknown;
  let done = false;

  const fire = () => {
    if (done) return;
    done = true;
    handle = undefined;
    startedAt = undefined;
    remaining = 0;
    onExpire();
  };

  const resume = () => {
    if (done || startedAt !== undefined) return;
    startedAt = timers.now();
    handle = timers.setTimeout(fire, remaining);
  };

  const pause = () => {
    if (done || startedAt === undefined) return;
    timers.clearTimeout(handle);
    handle = undefined;
    remaining = Math.max(0, remaining - (timers.now() - startedAt));
    startedAt = undefined;
  };

  resume();

  return {
    pause,
    resume,
    cancel() {
      if (done) return;
      done = true;
      timers.clearTimeout(handle);
      handle = undefined;
      startedAt = undefined;
    },
    remainingMs() {
      if (done) return 0;
      if (startedAt === undefined) return remaining;
      return Math.max(0, remaining - (timers.now() - startedAt));
    },
  };
}

export type ToastLedger = {
  /**
   * A notice has appeared; `close` is how to take it down. Returns `leave`,
   * to call when it is gone for any reason. Both idempotent. If this makes
   * more than `max` visible, the oldest is closed — and dropped from the count
   * at once, so a slow exit animation cannot hold a slot.
   */
  enter(close: () => void): () => void;
  size(): number;
};

export function createToastLedger(max: number): ToastLedger {
  const live: { close: () => void }[] = [];
  return {
    enter(close) {
      const entry = { close };
      live.push(entry);
      while (live.length > max) {
        const oldest = live.shift();
        oldest?.close();
      }
      return () => {
        const i = live.indexOf(entry);
        if (i >= 0) live.splice(i, 1);
      };
    },
    size: () => live.length,
  };
}

/** The one ledger every notice host in the vault shares. */
export const noticeLedger: ToastLedger = createToastLedger(MAX_VISIBLE_NOTICES);
