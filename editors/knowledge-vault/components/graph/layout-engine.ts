/**
 * Where the graph layout runs. Normally in a Web Worker, so a layout step —
 * ~20 ms at 2,000 nodes, ~200 ms at 10,000 — never holds up a frame: the main
 * thread only draws and handles input. Where a worker cannot start (a Content
 * Security Policy without `blob:` workers, or no Worker at all), the same
 * LayoutCore runs on the main thread, stepped once per frame — the behaviour
 * the graph had before the worker.
 */
import {
  LayoutCore,
  type LayoutCommand,
  type LayoutFrame,
} from "./layout-core.js";
import { LAYOUT_WORKER_SOURCE } from "./layout-worker.generated.js";

export interface LayoutEngine {
  readonly kind: "worker" | "inline";
  send(cmd: LayoutCommand): void;
  /** Called once per rendered frame; steps the layout when it runs inline. */
  pump(): void;
  dispose(): void;
}

/** Inline steps get less time than a worker's: they share the frame with drawing. */
const INLINE_BUDGET_MS = 6;

export function createLayoutEngine(
  onFrame: (frame: LayoutFrame) => void,
  options: { inline?: boolean } = {},
): LayoutEngine {
  if (
    !options.inline &&
    typeof Worker !== "undefined" &&
    typeof Blob !== "undefined"
  ) {
    try {
      return new WorkerEngine(onFrame);
    } catch (err) {
      console.warn(
        "[graph] layout worker unavailable, laying out on the main thread:",
        err,
      );
    }
  }
  return new InlineEngine(onFrame);
}

/** Buffers a command hands over; the sender must not use them afterwards. */
function transferables(cmd: LayoutCommand): Transferable[] {
  switch (cmd.type) {
    case "graph":
      return [
        cmd.radii.buffer,
        cmd.positions.buffer,
        cmd.links.buffer,
        cmd.coreIdea.buffer,
      ];
    case "recycle":
      return [cmd.buffer.buffer];
    default:
      return [];
  }
}

class InlineEngine implements LayoutEngine {
  readonly kind = "inline";
  private readonly core = new LayoutCore();
  constructor(private readonly onFrame: (frame: LayoutFrame) => void) {}

  send(cmd: LayoutCommand): void {
    this.core.handle(cmd);
  }

  pump(): void {
    const result = this.core.step(INLINE_BUDGET_MS, () => performance.now());
    if (result === "idle") return;
    const frame = this.core.frame(result === "settled");
    if (frame) this.onFrame(frame);
  }

  dispose(): void {}
}

class WorkerEngine implements LayoutEngine {
  kind: "worker" | "inline" = "worker";
  private readonly url: string;
  private worker: Worker | null;
  /** Takes over if the worker fails; replays the graph and the heat it last had. */
  private fallback: InlineEngine | null = null;
  private lastGraph: Extract<LayoutCommand, { type: "graph" }> | null = null;
  private lastHeat: Extract<LayoutCommand, { type: "heat" }> | null = null;

  constructor(private readonly onFrame: (frame: LayoutFrame) => void) {
    this.url = URL.createObjectURL(
      new Blob([LAYOUT_WORKER_SOURCE], { type: "text/javascript" }),
    );
    try {
      this.worker = new Worker(this.url, { name: "graph-layout" });
    } catch (err) {
      URL.revokeObjectURL(this.url);
      throw err;
    }
    this.worker.onmessage = (event: MessageEvent<LayoutFrame>) =>
      this.onFrame(event.data);
    // A CSP that blocks blob: workers surfaces here, asynchronously.
    this.worker.onerror = (event) => {
      event.preventDefault();
      console.warn(
        "[graph] layout worker failed, laying out on the main thread:",
        event.message,
      );
      this.switchToInline();
    };
  }

  send(cmd: LayoutCommand): void {
    if (this.fallback) {
      this.fallback.send(cmd);
      return;
    }
    if (cmd.type === "graph") {
      // Kept (copied: the originals are transferred) to replay into a fallback.
      this.lastGraph = {
        ...cmd,
        radii: cmd.radii.slice(),
        positions: cmd.positions.slice(),
        links: cmd.links.slice(),
        coreIdea: cmd.coreIdea.slice(),
      };
    } else if (cmd.type === "heat" || cmd.type === "relayout") {
      this.lastHeat = { type: "heat", heat: cmd.heat };
    }
    this.worker?.postMessage(cmd, transferables(cmd));
  }

  pump(): void {
    this.fallback?.pump();
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    URL.revokeObjectURL(this.url);
  }

  private switchToInline(): void {
    if (this.fallback) return;
    this.worker?.terminate();
    this.worker = null;
    this.kind = "inline";
    this.fallback = new InlineEngine(this.onFrame);
    if (this.lastGraph) this.fallback.send(this.lastGraph);
    if (this.lastHeat) this.fallback.send(this.lastHeat);
  }
}
