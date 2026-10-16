/**
 * Loads per key (a vault), coalesced. While one load runs, a refresh does not
 * join it — whatever changed after it began is not in its answer — but waits
 * for it and then runs once more. Any number of refreshes during one load
 * share that single follow-up, so a burst of changes costs two loads, not N.
 * A view that merely opens joins the newest load instead (`join`): nothing
 * changed for it, so the running load's answer is as fresh as it needs.
 */
export interface LoadCoalescer {
  request(key: string, load: () => Promise<void>, opts?: { join?: boolean }): Promise<void>;
}

const ignore = () => undefined;

export function createLoadCoalescer(): LoadCoalescer {
  const running = new Map<string, Promise<void>>();
  const queued = new Map<string, Promise<void>>();

  function request(key: string, load: () => Promise<void>, opts: { join?: boolean } = {}): Promise<void> {
    const current = running.get(key);
    if (!current) {
      const started: Promise<void> = load().finally(() => {
        if (running.get(key) === started) running.delete(key);
      });
      running.set(key, started);
      return started;
    }
    const waiting = queued.get(key);
    if (waiting) return waiting;
    if (opts.join) return current;
    // After the running load settles, failed or not, run once more.
    const next = current.then(ignore, ignore).then(() => {
      queued.delete(key);
      return request(key, load);
    });
    queued.set(key, next);
    return next;
  }

  return { request };
}
