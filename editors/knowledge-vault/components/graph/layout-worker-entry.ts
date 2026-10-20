/**
 * The layout worker's entry point. Not imported by the app: it is bundled with
 * d3-force into layout-worker.generated.ts by `node scripts/build-graph-worker.mjs`
 * and started from that source as a Blob URL (see layout-engine.ts).
 */
import { LayoutCore, type LayoutCommand } from "./layout-core.js";

/** The slice of DedicatedWorkerGlobalScope this file uses (the project's lib is DOM). */
type WorkerScope = {
  onmessage: ((event: MessageEvent<LayoutCommand>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

const scope = globalThis as unknown as WorkerScope;
const core = new LayoutCore();
/** One frame of the view: the layout posts at most this often. */
const FRAME_MS = 16;
/** Time a batch of steps may take before the worker yields to its messages. */
const BUDGET_MS = 12;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(delay: number): void {
  if (timer === null) timer = setTimeout(pump, delay);
}

function pump(): void {
  timer = null;
  const t0 = performance.now();
  const result = core.step(BUDGET_MS, () => performance.now());
  if (result === "idle") return;
  const frame = core.frame(result === "settled");
  if (frame) scope.postMessage(frame, [frame.positions.buffer]);
  if (result === "moved")
    schedule(Math.max(0, FRAME_MS - (performance.now() - t0)));
}

scope.onmessage = (event) => {
  core.handle(event.data);
  if (core.running) schedule(0);
};
