/**
 * The browser vault's pipeline: a source the visitor adds is turned into
 * notes by the AI they connected in the chat, through the desktop's four
 * phases (./phases.ts), one task at a time — the browser's stand-in for the
 * desktop app's workflow engine.
 *
 * It looks for work when the vault changes and every 10 s. The work is the
 * first claim task waiting at a phase, or one this browser holds (a tab
 * closed mid-phase): ADVANCE_PHASE leaves each next phase PENDING and
 * unassigned, so a task resumes at whichever phase it stopped. Per phase:
 * claim, run, hand off, the store's writes held from the phase's first write
 * to its handoff — one IndexedDB write per phase, while the long wait for
 * the AI is never held, so the visitor's own edits meanwhile are saved as
 * they happen.
 */
import type { HostPipeline, HostPipelineState } from "../../editors/shared/host-config.js";
import { isTimeout } from "../../pieces/knowledge-vault/lib/agent/llm.js";
import { advancePipeline, claimPhase, findQueue, PIPELINE_PHASES, type PipelinePhase } from "../../pieces/knowledge-vault/lib/agent/pipeline.js";
import type { KnowledgeVaultClient } from "../../pieces/knowledge-vault/lib/common/client.js";
import { KnowledgeVaultApiError } from "../../pieces/knowledge-vault/lib/common/errors.js";
import type { FlushGate } from "../engine.js";
import { VISITOR } from "../page-subgraph.js";
import { AiRefusedError, AiUnreachableError, CallBudgetError, pipelineAi, type PipelineAi } from "./ai.js";
import { mapTitleFor, runPhase, type PhaseContext, type PhaseOutcome, type TreeNode } from "./phases.js";

/** How often the runner looks for work besides on every vault change. */
export const PICKUP_MS = 10_000;
/**
 * How long an AI that did not answer is left before it is asked again — and the pause after a task
 * the AI failed, so one bad key or a free model's rate limit does not fail a whole file's sections
 * in a row.
 */
export const UNREACHABLE_RETRY_MS = 30_000;
/** Who the handoffs name, beside the model. */
export const RUNNER_NAME = "knowledge-vault-web";

const FAILURES_KEY = "knowledge-vault-web:pipeline-failures";
const FAILURES_KEPT = 50;

export const FAILURE_REASONS = {
  timeout: "Your AI did not answer in time",
  unusable: "Your AI's answer could not be used",
  refused: "Your AI refused the key",
  busy: "Your AI is busy — try again in a minute",
  noText: "This source has no text",
  other: "Something went wrong — try again",
} as const;

/** The plain reason a source shows when its task failed; the error itself goes to the console. */
export function failureReason(error: unknown): string {
  if (error instanceof AiRefusedError) return FAILURE_REASONS.refused;
  if (error instanceof CallBudgetError) return FAILURE_REASONS.unusable;
  if (isTimeout(error)) return FAILURE_REASONS.timeout;
  const message = error instanceof Error ? error.message : "";
  if (/did not answer within/.test(message)) return FAILURE_REASONS.timeout;
  if (error instanceof KnowledgeVaultApiError && error.status === 429) return FAILURE_REASONS.busy;
  if (/has no text to extract from/.test(message)) return FAILURE_REASONS.noText;
  if (/model provider refused|did not answer with JSON|malformed JSON|gave no answer|empty response/.test(message)) return FAILURE_REASONS.unusable;
  return FAILURE_REASONS.other;
}

export type RunnerTask = {
  id: string;
  taskType: string;
  status: string;
  documentRef?: string | null;
  currentPhase?: string | null;
  assignedTo?: string | null;
};

const isPhase = (phase: unknown): phase is PipelinePhase => PIPELINE_PHASES.includes(phase as PipelinePhase);
const heldHere = (assignedTo: string | null | undefined) => !!assignedTo && assignedTo.toLowerCase() === VISITOR.address.toLowerCase();

/** The first claim task waiting at a phase, or one this browser holds. */
export function nextTask<T extends RunnerTask>(tasks: readonly T[]): T | undefined {
  return tasks.find(
    (t) => t.taskType === "claim" && !!t.documentRef && isPhase(t.currentPhase) && (t.status === "PENDING" || (t.status === "IN_PROGRESS" && heldHere(t.assignedTo))),
  );
}

/** The failures that are the AI's, not the source's: after one, the next task waits a while. */
const AI_FAILURES: ReadonlySet<string> = new Set([FAILURE_REASONS.timeout, FAILURE_REASONS.unusable, FAILURE_REASONS.refused, FAILURE_REASONS.busy]);

const NEXT_PHASE: Record<PipelinePhase, PipelinePhase | null> = { create: "reflect", reflect: "reweave", reweave: "verify", verify: null };

/** What the page hosting the vault is told: facts only, no words to show. */
export type PipelineEvent =
  /** Sources queued since the runner's first look (a file's sections arrive together). */
  | { type: "source-added"; count: number }
  /** A source became notes; `notes` is the vault's count after it. */
  | { type: "source-processed"; notes: number; partial: boolean }
  | { type: "source-failed"; reason: string };

export type RunnerDeps = {
  client: KnowledgeVaultClient;
  driveId: string;
  flushes: FlushGate;
  /** Work starts once this resolves: the vault is written and its writes released. */
  ready: Promise<void>;
  /** The vault's live changes; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  /** After each task that ran (done or failed): the vault changed, so its health report is written again. */
  afterTask(): Promise<void>;
  /** The visitor's AI, asked once per task; the chat's connection by default. */
  ai?: (stop: AbortSignal) => Promise<PipelineAi | null>;
  /** One phase; ./phases.ts by default. */
  runPhase?: (phase: PipelinePhase, ctx: PhaseContext) => Promise<PhaseOutcome>;
  /** Where failure reasons outlive a reload; localStorage by default. */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** The page's own hearing of what happened: see {@link PipelineEvent}. */
  onEvent?: (event: PipelineEvent) => void;
};

export type PipelineRunner = HostPipeline & {
  /** Stops looking, ends the AI's calls, and resolves once nothing more will be written. */
  stop(): Promise<void>;
};

/** Thrown from `beforeWrites` once the runner stopped: the phase ends before writing anything. */
class RunnerStoppedError extends Error {
  constructor() {
    super("The pipeline stopped");
    this.name = "RunnerStoppedError";
  }
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return "localStorage" in globalThis ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function startPipelineRunner(deps: RunnerDeps): PipelineRunner {
  const { client, driveId: drive, flushes } = deps;
  const askAi = deps.ai ?? pipelineAi;
  const phaseRunner = deps.runPhase ?? runPhase;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const failures = new Map<string, string>(readFailures(storage));
  const listeners = new Set<() => void>();
  const stopping = new AbortController();
  let state: HostPipelineState = { kind: "ready" };
  /** Tasks already in the queue at a look: only those after the first look were added now. */
  const known = new Set<string>();
  let looked = false;
  /** The queue is a singleton: found once. */
  let queueId: string | null = null;
  let running: Promise<void> | null = null;
  /** Counts the calls to look for work, so one that came during a pass gets a pass of its own. */
  let wakes = 0;
  let waiting = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stopped = () => stopping.signal.aborted;
  const setState = (next: HostPipelineState) => {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of listeners) listener();
  };

  function remember(taskId: string, reason: string) {
    failures.set(taskId, reason);
    try {
      storage?.setItem(FAILURES_KEY, JSON.stringify([...failures].slice(-FAILURES_KEPT)));
    } catch {
      // Storage full or refused: the reason still shows until the page reloads.
    }
  }

  /** The queue and its tasks; null in a vault without one. */
  async function readQueue(): Promise<{ id: string; tasks: RunnerTask[] } | null> {
    queueId ??= await findQueue(client, drive);
    if (!queueId) return null;
    const doc = await client.request<{ state: { global: { tasks: RunnerTask[] } } }>({ path: `notes/${encodeURIComponent(queueId)}`, query: { drive } });
    return { id: queueId, tasks: doc.state.global.tasks };
  }

  async function titleForMap(sourceId: string): Promise<string> {
    const [tree, source] = await Promise.all([
      client.request<{ state: { global: { nodes: TreeNode[] } } }>({ path: `notes/${encodeURIComponent(drive)}`, query: { drive } }),
      client.request<{ name: string; state: { global: { title?: string | null } } }>({ path: `notes/${encodeURIComponent(sourceId)}`, query: { drive } }),
    ]);
    // A source that was never given its text has no title yet: its name is what the visitor typed.
    return mapTitleFor(tree.state.global.nodes, sourceId, source.state.global.title || source.name);
  }

  function tell(event: PipelineEvent) {
    try {
      deps.onEvent?.(event);
    } catch (error) {
      console.warn("[BrowserVault] pipeline: the page's event handler failed.", error);
    }
  }

  /** Sources the visitor queued since the last look. */
  function noticeAdded(tasks: readonly RunnerTask[]) {
    const fresh = tasks.filter((t) => t.taskType === "claim" && !known.has(t.id));
    for (const t of fresh) known.add(t.id);
    if (looked && fresh.length > 0) tell({ type: "source-added", count: fresh.length });
    looked = true;
  }

  async function noteCount(): Promise<number> {
    const stats = await client.request<{ noteCount?: number }>({ path: "stats", query: { drive } }).catch(() => null);
    return stats?.noteCount ?? 0;
  }

  async function fail(queue: string, task: RunnerTask, error: unknown): Promise<void> {
    const reason = failureReason(error);
    tell({ type: "source-failed", reason });
    console.warn(`[BrowserVault] pipeline: task ${task.id} failed (${reason}).`, error);
    remember(task.id, reason);
    if (AI_FAILURES.has(reason)) pause();
    try {
      await client.request({
        method: "POST",
        path: "actions",
        json: { documentId: queue, actions: [{ type: "FAIL_TASK", input: { taskId: task.id, reason, updatedAt: new Date().toISOString() } }] },
      });
    } catch (failed) {
      console.warn(`[BrowserVault] pipeline: task ${task.id} could not be marked failed.`, failed);
    }
  }

  /** No new pass until the retry: the vault's changes and the 10 s look skip meanwhile. */
  function pause() {
    waiting = true;
    clearTimeout(retry);
    retry = setTimeout(() => {
      waiting = false;
      wake();
    }, UNREACHABLE_RETRY_MS);
  }

  function unreachable(error: unknown) {
    console.warn("[BrowserVault] pipeline: the AI does not answer; trying again in 30 s.", error);
    setState({ kind: "unreachable" });
    pause();
  }

  /** The store's writes for one phase: held from its first write, released after its handoff. */
  function phaseWrites() {
    let held = false;
    return {
      hold() {
        if (stopped()) throw new RunnerStoppedError();
        if (held) return;
        held = true;
        flushes.hold();
      },
      async release() {
        if (!held) return;
        held = false;
        await flushes.release();
      },
    };
  }

  /**
   * One task, from its current phase to its end (or a stop, or an AI that went away). Returns how it
   * ended: done (and whether only the first part was read), failed, or not at all.
   */
  async function work(
    queue: string,
    task: RunnerTask & { documentRef: string; currentPhase: PipelinePhase },
    ai: PipelineAi,
  ): Promise<{ ended: "done"; partial: boolean } | { ended: "failed" } | null> {
    let partial = false;
    const sourceId = task.documentRef;
    const mapTitle = await titleForMap(sourceId);
    setState({ kind: "working", taskId: task.id });
    let phase: PipelinePhase | null = task.currentPhase;
    while (phase) {
      if (stopped()) return null;
      // Held from the phase's first write to its handoff: one IndexedDB write per phase.
      const writes = phaseWrites();
      try {
        await claimPhase(client, { drive, sourceId, phase });
        const outcome = await phaseRunner(phase, { client, drive, sourceId, ai, mapTitle, beforeWrites: () => writes.hold() });
        if (outcome.partial) partial = true;
        writes.hold();
        // What did not land is said in the handoff; the task still moves on. Kept at its phase, the
        // 10 s pickup would run the phase again and again.
        const workDone = outcome.incomplete ? `${outcome.workDone.replace(/\.$/, "")} — ${outcome.incomplete}.` : outcome.workDone;
        const result = await advancePipeline(client, { drive, sourceId, phase, workDone, filesModified: outcome.filesModified, completedBy: `${RUNNER_NAME} · ${ai.model}` });
        const next: PipelinePhase | null = NEXT_PHASE[phase];
        if (result.to !== (next ?? "done")) {
          // Refused by the queue: failed rather than run again on the next look.
          await fail(queue, task, new Error(result.summary));
          return { ended: "failed" };
        }
        phase = next;
      } catch (error) {
        if (stopped() || error instanceof RunnerStoppedError) return null;
        if (error instanceof AiUnreachableError) {
          unreachable(error);
          return null;
        }
        await fail(queue, task, error);
        return { ended: "failed" };
      } finally {
        await writes.release();
      }
    }
    return { ended: "done", partial };
  }

  /** Looks for work and does one task. Returns whether a task ran, so the next waiting one starts at once. */
  async function pass(): Promise<boolean> {
    const queue = await readQueue();
    if (queue) noticeAdded(queue.tasks);
    // A task failed here is never taken again, even when the vault could not record the failure:
    // held by this browser, it would otherwise fail again on every look. "Process again" adds a new one.
    const task = queue && nextTask(queue.tasks.filter((t) => !failures.has(t.id)));
    if (stopped()) return false;
    if (!task) {
      setState({ kind: "ready" });
      return false;
    }
    const ai = await askAi(stopping.signal);
    if (stopped()) return false;
    if (!ai) {
      setState({ kind: "no-ai" });
      return false;
    }
    try {
      await ai.reach();
    } catch (error) {
      if (stopped()) return false;
      if (error instanceof AiUnreachableError) {
        unreachable(error);
        return false;
      }
      await fail(queue.id, task, error);
      await afterTask();
      return true;
    }
    const ended = await work(queue.id, task as RunnerTask & { documentRef: string; currentPhase: PipelinePhase }, ai);
    if (!ended) return false;
    await afterTask();
    if (ended.ended === "done" && !stopped()) tell({ type: "source-processed", notes: await noteCount(), partial: ended.partial });
    setState({ kind: "ready" });
    return true;
  }

  async function afterTask() {
    if (stopped()) return;
    try {
      await deps.afterTask();
    } catch (error) {
      console.warn("[BrowserVault] pipeline: the health report was not written.", error);
    }
  }

  function wake() {
    if (stopped() || waiting) return;
    wakes++;
    running ??= drain();
  }

  /** Passes until there is nothing to do: the next task starts as soon as one ends. */
  async function drain(): Promise<void> {
    try {
      for (;;) {
        const seen = wakes;
        const worked = await pass();
        if (stopped() || waiting || (!worked && wakes === seen)) return;
      }
    } catch (error) {
      if (!stopped()) console.warn("[BrowserVault] pipeline: looking for work failed; trying again shortly.", error);
    } finally {
      running = null;
    }
  }

  void deps.ready.then(
    () => {
      if (stopped()) return;
      unsubscribe = deps.onChange(wake);
      interval = setInterval(wake, PICKUP_MS);
      wake();
    },
    () => undefined,
  );

  return {
    state: () => state,
    failureReason: (taskId) => failures.get(taskId) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async stop() {
      stopping.abort();
      clearInterval(interval);
      clearTimeout(retry);
      unsubscribe?.();
      unsubscribe = undefined;
      await running;
    },
  };
}

function readFailures(storage: Pick<Storage, "getItem"> | null): [string, string][] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(FAILURES_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string") : [];
  } catch {
    return [];
  }
}
