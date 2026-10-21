/**
 * The document store's flush gate (see {@link FlushGate}): its own module so it
 * is tested without the engine.
 */
/**
 * Holds the document store's flushes to IndexedDB, then writes everything held
 * in one go.
 *
 * PGlite keeps its files in memory and copies every changed file to IndexedDB
 * on a flush, whole. The reactor flushes once per job, so writing the guide —
 * about seventy jobs — rewrote the same 1 MB write-ahead-log segment seventy
 * times: ~120 MB to store a vault of ~30 MB. Held, the guide is written once.
 *
 * What a held flush skips is not on disk until `release`: a vault whose writes
 * were held must not be trusted after a reload that came before the release.
 * The boot only marks a vault complete once `release` has resolved.
 */
export type FlushGate = {
  readonly held: boolean;
  /** Skip flushes from now on, until {@link release}. */
  hold(): void;
  /** Write everything skipped while held, and flush normally from then on. */
  release(): Promise<void>;
  /**
   * Another tab took the vault: drop what is held and never write again. The
   * store on disk is that tab's now, and this tab's writes would overwrite it.
   */
  freeze(): void;
};

/**
 * Lets the browser paint and take input before the caller goes on.
 *
 * A held flush must not resolve at once. PGlite runs a statement synchronously
 * inside its promise, so with nothing on disk to wait for, the reactor ran a
 * whole batch of jobs as one unbroken chain of microtasks: one 2.6 s task in
 * which the page could not paint the app it had just been told to show. A
 * real flush yields on its IndexedDB request; a held one yields here.
 */
export function yieldToBrowser(): Promise<void> {
  // A plain task, queued behind the page's own work — the render React has
  // scheduled. Not scheduler.yield(): Chrome runs its continuations ahead of
  // queued tasks, so the writing kept the app from rendering until it was done.
  // Not setTimeout(0): nested timeouts are clamped to 4 ms each.
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * Installed as the instance's own `syncToFs` straight after construction, so
 * it also sees PGlite's start-up flush, and it is the function the reactor's
 * group commit captures and calls at each job's flush.
 */
export function gateFlushes(pg: { syncToFs(): Promise<void> }, held: boolean): FlushGate {
  const flush = pg.syncToFs.bind(pg);
  let holding = held;
  let skipped = false;
  let frozen = false;
  (pg as unknown as { syncToFs: () => Promise<void> }).syncToFs = () => {
    if (!holding) return flush();
    skipped = true;
    return yieldToBrowser();
  };
  return {
    get held() {
      return holding;
    },
    hold() {
      holding = true;
    },
    async release() {
      if (frozen || !holding) return;
      holding = false;
      if (skipped) {
        skipped = false;
        await flush();
      }
    },
    freeze() {
      frozen = true;
      holding = true;
      skipped = false;
    },
  };
}

