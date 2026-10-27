/**
 * wllama adapters for configuration C's DecisionBackend (shapes observed in
 * Phase 0): top-n and forced next-token logprobs over raw completions, the
 * System One response guard, and the native-log capture that makes wllama
 * errors diagnosable (they surface as "Invalid typed array length").
 */
import type { NextDist } from "./decision-backend.js";
import type { SystemOneResponse } from "./kev-request.js";
import type {
  WllamaInstance,
  WllamaLogger,
  WllamaTokenLogprob,
} from "./wllama-types.js";

/** The last native log lines, attached to errors. */
export class NativeLog {
  private lines: { n: number; line: string }[] = [];
  private count = 0;
  /** The last `offloaded N/M layers to GPU` line (kept past the ring). */
  offloadLine: string | null = null;

  constructor(
    private readonly max = 60,
    private readonly forward?: (level: string, line: string) => void,
  ) {}

  push(level: string, args: unknown[]): void {
    const line = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    if (/offloaded \d+\/\d+ layers to GPU/.test(line)) this.offloadLine = line;
    this.lines.push({ n: this.count++, line: `${level} ${line}`.slice(0, 500) });
    if (this.lines.length > this.max) this.lines.shift();
    this.forward?.(level, line);
  }

  logger(): WllamaLogger {
    return {
      debug: (...a: unknown[]) => this.push("debug", a),
      log: (...a: unknown[]) => this.push("log", a),
      warn: (...a: unknown[]) => this.push("warn", a),
      error: (...a: unknown[]) => this.push("error", a),
    };
  }

  /** A mark to read lines logged after it. */
  mark(): number {
    return this.count;
  }

  /** Warning / error lines (or every line) logged since `mark` and kept. */
  since(mark: number, onlyProblems = true): string[] {
    const tail = this.lines.filter((l) => l.n >= mark).map((l) => l.line);
    return onlyProblems
      ? tail.filter((l) => /^(warn|error)|error|fail|exception/i.test(l))
      : tail;
  }
}

/** Run `fn`; on failure rethrow with the native lines logged meanwhile. */
export async function withNativeLog<T>(
  log: NativeLog,
  what: string,
  fn: () => Promise<T>,
): Promise<T> {
  const mark = log.mark();
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const native = log.since(mark).slice(-3);
    throw new Error(
      `${what}: ${msg}${native.length ? ` (native: ${native.join(" | ")})` : ""}`,
      { cause: err },
    );
  }
}

/** Parse llama.cpp's `offloaded N/M layers to GPU` load line. */
export function gpuOffload(
  line: string | null,
): { offloaded: number; total: number } | null {
  const m = line ? /offloaded (\d+)\/(\d+) layers to GPU/.exec(line) : null;
  return m ? { offloaded: Number(m[1]), total: Number(m[2]) } : null;
}

/** One-token completion's top-n logprobs (`choices[0].logprobs`). */
export async function wllamaNextDist(
  w: WllamaInstance,
  prompt: string,
  nProbs: number,
): Promise<NextDist> {
  const res = await w.createCompletion({
    prompt,
    stream: false,
    n_predict: 1,
    temperature: 0,
    n_probs: nProbs,
    cache_prompt: true,
  });
  const tops: WllamaTokenLogprob[] =
    res.choices[0]?.logprobs?.content?.[0]?.top_logprobs ?? [];
  const lp = new Map<number, number>();
  let minLp = 0;
  for (const t of tops) {
    lp.set(t.id, t.logprob);
    minLp = Math.min(minLp, t.logprob);
  }
  return { lp, minLp };
}

/**
 * The raw logprob of next token `id`, forced with `logit_bias`; the
 * sampled token's logprob is the pre-sampler softmax (bit-exact against
 * top-64 values in Phase 0).
 */
export async function wllamaForcedLogprob(
  w: WllamaInstance,
  prompt: string,
  id: number,
): Promise<number> {
  const res = await w.createCompletion({
    prompt,
    stream: false,
    n_predict: 1,
    temperature: 0,
    n_probs: 1,
    logit_bias: [[id, 100]],
    cache_prompt: true,
  });
  const c = res.choices[0]?.logprobs?.content?.[0];
  if (c?.id !== id || typeof c.logprob !== "number")
    throw new Error(`forced token ${id} sampled ${String(c?.id)}`);
  return c.logprob;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate a System One response (wllama returns the server JSON as is). */
export function asSystemOneResponse(v: unknown): SystemOneResponse {
  if (!isRecord(v) || !isRecord(v.answers))
    throw new Error(`System One returned no answers: ${JSON.stringify(v).slice(0, 200)}`);
  const answers: SystemOneResponse["answers"] = {};
  for (const [k, a] of Object.entries(v.answers)) {
    if (!isRecord(a)) continue;
    const probabilities: Record<string, number> = {};
    if (isRecord(a.probabilities))
      for (const [n, p] of Object.entries(a.probabilities))
        if (typeof p === "number") probabilities[n] = p;
    answers[k] = {
      type: typeof a.type === "string" ? a.type : undefined,
      choice: typeof a.choice === "string" ? a.choice : undefined,
      probabilities,
    };
  }
  const u = isRecord(v.usage) ? v.usage : {};
  return {
    answers,
    usage: {
      input_tokens: typeof u.input_tokens === "number" ? u.input_tokens : undefined,
      output_tokens: typeof u.output_tokens === "number" ? u.output_tokens : undefined,
    },
  };
}
