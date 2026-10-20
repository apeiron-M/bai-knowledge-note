/**
 * Opt-in network instrumentation for the vault.
 *
 * Diagnosing "the network tab exploded" from a screenshot is guesswork: the
 * waterfall shows sizes and timings but not WHICH hook asked, and a burst
 * that is a cold start looks identical to a burst that is a refetch loop.
 * This module answers that question with data — it groups every request the
 * app makes by GraphQL operation name and reports counts, bytes and the
 * interval between repeats, so a loop is visible as "same key, N times, every
 * ~M ms" rather than inferred from an average.
 *
 * It is OFF by default and costs nothing until switched on: `startRequestMetrics`
 * is what installs the `fetch` wrapper, and until then this module is a few
 * pure functions nobody calls. Turn it on from the console:
 *
 *   vaultMetrics.start(); // ... reproduce ... then:
 *   vaultMetrics.table();
 *
 * The pure core (`operationKeyFromBody`, `summarize`) is separated from the
 * global wiring so it is unit-testable without touching `window`.
 */

export type RequestSample = {
  /** Grouping key: GraphQL operation name, else `METHOD /path`. */
  key: string;
  /** Response size in bytes; 0 when it could not be determined. */
  bytes: number;
  /** ms since epoch. */
  at: number;
};

export type RequestGroup = {
  key: string;
  count: number;
  bytes: number;
  firstAt: number;
  lastAt: number;
  /**
   * Median ms between consecutive calls of this key, or null with < 2 calls.
   * A tight, regular gap is the signature of a loop; a poll shows its period.
   */
  medianGapMs: number | null;
};

export type MetricsReport = {
  totalRequests: number;
  totalBytes: number;
  windowMs: number;
  groups: RequestGroup[];
  /** Keys called enough times, tightly enough, to look like a loop. */
  suspects: RequestGroup[];
};

/** Calls of one key within this gap look like a loop rather than a poll. */
const LOOP_GAP_MS = 2_000;
/** Below this many repeats, a tight gap is just a burst. */
const LOOP_MIN_COUNT = 5;

const OPERATION_NAME = /\b(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/;
/** First field of an anonymous operation, e.g. `{ knowledgeGraphNodes(... }`. */
const FIRST_FIELD = /\{\s*([A-Za-z_]\w*)/;

/**
 * Derive a stable grouping key from a request. GraphQL bodies collapse to
 * their operation name so that the same query with different variables is one
 * row; everything else falls back to method + path (never the query string,
 * which would scatter one endpoint across dozens of rows).
 */
export function operationKeyFromBody(
  url: string,
  method: string,
  body: unknown,
): string {
  if (typeof body === "string" && body.length > 0) {
    try {
      const parsed = JSON.parse(body) as {
        operationName?: unknown;
        query?: unknown;
      };
      if (typeof parsed.operationName === "string" && parsed.operationName) {
        return parsed.operationName;
      }
      if (typeof parsed.query === "string") {
        const named = OPERATION_NAME.exec(parsed.query);
        if (named) return named[1];
        const field = FIRST_FIELD.exec(parsed.query);
        if (field) return field[1];
      }
    } catch {
      // Not JSON — fall through to the URL key.
    }
  }
  let path = url;
  try {
    path = new URL(url, "http://local").pathname;
  } catch {
    // Keep the raw string if it will not parse as a URL.
  }
  return `${method.toUpperCase()} ${path}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/** Group raw samples into a report. Pure — the unit under test. */
export function summarize(samples: readonly RequestSample[]): MetricsReport {
  const byKey = new Map<string, RequestSample[]>();
  for (const s of samples) {
    const list = byKey.get(s.key);
    if (list) list.push(s);
    else byKey.set(s.key, [s]);
  }

  const groups: RequestGroup[] = [];
  for (const [key, list] of byKey) {
    const times = list.map((s) => s.at).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    groups.push({
      key,
      count: list.length,
      bytes: list.reduce((sum, s) => sum + s.bytes, 0),
      firstAt: times[0],
      lastAt: times[times.length - 1],
      medianGapMs: gaps.length > 0 ? median(gaps) : null,
    });
  }
  groups.sort((a, b) => b.count - a.count || b.bytes - a.bytes);

  const all = samples.map((s) => s.at);
  return {
    totalRequests: samples.length,
    totalBytes: samples.reduce((sum, s) => sum + s.bytes, 0),
    windowMs: all.length > 1 ? Math.max(...all) - Math.min(...all) : 0,
    groups,
    suspects: groups.filter(
      (g) =>
        g.count >= LOOP_MIN_COUNT &&
        g.medianGapMs !== null &&
        g.medianGapMs <= LOOP_GAP_MS,
    ),
  };
}

/** A bounded sample buffer, so a long session cannot grow without limit. */
export function createRecorder(limit = 2_000) {
  const samples: RequestSample[] = [];
  return {
    samples,
    record(sample: RequestSample): void {
      samples.push(sample);
      if (samples.length > limit) samples.splice(0, samples.length - limit);
    },
    clear(): void {
      samples.length = 0;
    },
  };
}

type Recorder = ReturnType<typeof createRecorder>;

let installed: { restore: () => void; recorder: Recorder } | null = null;

/**
 * Read a response's size without consuming it for the real caller.
 * `content-length` is absent under compression, so fall back to measuring a
 * clone — acceptable because this only runs while metrics are switched on.
 */
async function sizeOf(response: Response): Promise<number> {
  const declared = response.headers.get("content-length");
  if (declared) {
    const n = Number(declared);
    if (Number.isFinite(n)) return n;
  }
  try {
    const buf = await response.clone().arrayBuffer();
    return buf.byteLength;
  } catch {
    return 0;
  }
}

/** Begin recording. Idempotent; returns the active recorder. */
export function startRequestMetrics(scope: {
  fetch: typeof fetch;
} = globalThis as unknown as { fetch: typeof fetch }): Recorder {
  if (installed) return installed.recorder;
  const recorder = createRecorder();
  // Keep the original REFERENCE for restore, and a bound copy for calling:
  // restoring a bound wrapper would leave `scope.fetch` permanently changed.
  const original = scope.fetch;
  const invoke = original.bind(scope);

  scope.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const at = Date.now();
    const response = await invoke(input, init);
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = init?.method ?? "GET";
      const key = operationKeyFromBody(url, method, init?.body);
      recorder.record({ key, bytes: await sizeOf(response), at });
    } catch {
      // Instrumentation must never break the request it is measuring.
    }
    return response;
  };

  installed = {
    recorder,
    restore: () => {
      scope.fetch = original;
    },
  };
  return recorder;
}

export function stopRequestMetrics(): void {
  installed?.restore();
  installed = null;
}

export function currentReport(): MetricsReport {
  return summarize(installed?.recorder.samples ?? []);
}

/**
 * Expose the controls on `window.vaultMetrics` so a user can capture a
 * repro from the console without a rebuild. Safe to call more than once.
 */
export function installMetricsConsole(): void {
  if (typeof window === "undefined") return;
  (window as unknown as { vaultMetrics?: unknown }).vaultMetrics = {
    start: () => {
      startRequestMetrics();
      console.info("[vaultMetrics] recording — reproduce, then vaultMetrics.table()");
    },
    stop: stopRequestMetrics,
    report: currentReport,
    clear: () => installed?.recorder.clear(),
    table: () => {
      const report = currentReport();
      console.info(
        `[vaultMetrics] ${report.totalRequests} requests, ${(report.totalBytes / 1e6).toFixed(2)} MB over ${(report.windowMs / 1000).toFixed(1)}s`,
      );
      console.table(
        report.groups.map((g) => ({
          operation: g.key,
          count: g.count,
          MB: +(g.bytes / 1e6).toFixed(3),
          medianGapMs: g.medianGapMs,
        })),
      );
      if (report.suspects.length > 0) {
        console.warn(
          "[vaultMetrics] loop suspects (tight, repeated):",
          report.suspects.map((s) => `${s.key} ×${s.count} every ~${s.medianGapMs}ms`),
        );
      }
      return report;
    },
  };
}
