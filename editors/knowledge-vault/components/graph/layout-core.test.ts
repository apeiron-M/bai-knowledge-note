import { describe, expect, it } from "vitest";
import {
  DRAG_ALPHA_TARGET,
  LayoutCore,
  type LayoutCommand,
  type LayoutFrame,
} from "./layout-core.js";

function graphCmd(
  ids: string[],
  links: [number, number][],
  version: number,
  positions?: (number | null)[][],
): Extract<LayoutCommand, { type: "graph" }> {
  const pos = new Float32Array(ids.length * 2).fill(Number.NaN);
  positions?.forEach((p, i) => {
    if (p[0] != null && p[1] != null) {
      pos[i * 2] = p[0];
      pos[i * 2 + 1] = p[1];
    }
  });
  return {
    type: "graph",
    version,
    ids,
    radii: new Float32Array(ids.length).fill(10),
    positions: pos,
    links: Uint32Array.from(links.flat()),
    coreIdea: new Uint8Array(links.length),
    center: [0, 0],
    heat: { alpha: 1, decay: 0.02, target: 0 },
  };
}

const clock = () => 0;

/** Run until settled or `max` steps, recycling frames the way the view does. */
function run(core: LayoutCore, max = 2000): LayoutFrame | null {
  let last: LayoutFrame | null = null;
  for (let s = 0; s < max; s++) {
    const r = core.step(10, clock);
    if (r === "idle") break;
    const f = core.frame(r === "settled");
    if (f) {
      last = f;
      core.handle({ type: "recycle", buffer: f.positions });
    }
    if (r === "settled") break;
  }
  return last;
}

describe("LayoutCore", () => {
  const ids = ["a", "b", "c", "d"];
  const links: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
  ];

  it("lays a graph out, settles, and reports positions in graph order", () => {
    const core = new LayoutCore();
    core.handle(graphCmd(ids, links, 1));
    const last = run(core);
    expect(last?.settled).toBe(true);
    expect(last?.version).toBe(1);
    expect(last?.positions.length).toBe(8);
    expect([...(last?.positions ?? [])].every(Number.isFinite)).toBe(true);
    expect(core.running).toBe(false);
    expect(core.step(10, clock)).toBe("idle");
  });

  it("keeps a node's position across a refresh and places a new one where the view put it", () => {
    const core = new LayoutCore();
    core.handle(graphCmd(ids, links, 1));
    run(core);
    const before = core.frame(true)!.positions;
    core.handle(
      graphCmd(
        ["e", ...ids],
        [
          [1, 2],
          [2, 3],
          [3, 4],
          [0, 1],
        ],
        2,
        [[500, 500]],
      ),
    );
    expect(core.version).toBe(2);
    const after = core.frame(true)!.positions;
    expect(after[0]).toBe(500); // e, from the view
    expect(after[1]).toBe(500);
    expect([...after.slice(2)]).toEqual([...before]); // a..d, from the layout itself
  });

  it("holds a dragged node where the pointer is and warms the graph toward 0.3 without a jump", () => {
    const core = new LayoutCore();
    const n = 60;
    const many = Array.from({ length: n }, (_, i) => `n${i}`);
    const chain = Array.from(
      { length: n - 1 },
      (_, i) => [i, i + 1] as [number, number],
    );
    core.handle(graphCmd(many, chain, 1));
    run(core);
    const alphaBefore = core.layout.alpha;
    const rest = core.frame(true)!.positions.slice();
    // Pull node 30 200 px away from both of its neighbours.
    const ax = rest[60] - (rest[58] + rest[62]) / 2;
    const ay = rest[61] - (rest[59] + rest[63]) / 2;
    const len = Math.hypot(ax, ay) || 1;
    const px = rest[60] + (ax / len) * 200;
    const py = rest[61] + (ay / len) * 200;
    const toPointer = (q: Float32Array, i: number) =>
      Math.hypot(q[i * 2] - px, q[i * 2 + 1] - py);
    core.handle({ type: "drag", index: 30, x: px, y: py });
    expect(core.dragging).toBe(30);
    expect(core.running).toBe(true);
    expect(core.layout.isLocal).toBe(false); // small and quick: the whole graph swings
    expect(core.layout.alpha).toBe(alphaBefore); // alphaTarget only, as before
    expect(core.layout.alphaTarget).toBe(DRAG_ALPHA_TARGET);
    for (let s = 0; s < 120; s++) core.step(10, clock);
    const p = core.frame(false)!.positions;
    expect([p[60], p[61]]).toEqual([Math.fround(px), Math.fround(py)]);
    // Its neighbours followed it on their springs (left behind, they would be 200+ px away).
    expect(toPointer(rest, 29)).toBeGreaterThan(200);
    expect(toPointer(p, 29)).toBeLessThan(toPointer(rest, 29) - 40);
    expect(toPointer(p, 31)).toBeLessThan(toPointer(rest, 31) - 40);
    // Released: free again, and the layout cools down to rest.
    core.handle({ type: "drop" });
    expect(core.dragging).toBe(-1);
    expect(core.layout.alphaTarget).toBe(0);
    expect(Number.isNaN(core.layout.fx[30])).toBe(true);
    expect(run(core)?.settled).toBe(true);
  });

  it("drags locally when a full step is too slow, then returns to the whole graph", () => {
    const core = new LayoutCore();
    const n = 40;
    const many = Array.from({ length: n }, (_, i) => `n${i}`);
    const chain = Array.from(
      { length: n - 1 },
      (_, i) => [i, i + 1] as [number, number],
    );
    core.handle(graphCmd(many, chain, 1));
    run(core);
    core.stepMs = 80; // as if each full step took 80 ms
    const frozenBefore = core.frame(true)!.positions.slice();
    core.handle({ type: "drag", index: 0, x: 900, y: 900 });
    expect(core.layout.isLocal).toBe(true);
    expect(core.neighbourhood(0).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    // Plus whatever is near a point: the far end of the chain, from where it lies.
    const end = n - 1;
    const near = core.neighbourhood(
      0,
      frozenBefore[end * 2],
      frozenBefore[end * 2 + 1],
    );
    expect(near).toContain(end);
    for (let s = 0; s < 30; s++) core.step(10, clock);
    const p = core.frame(false)!.positions;
    // The neighbourhood swung toward the pointer; the far end did not move at all.
    expect(Math.hypot(p[2] - 900, p[3] - 900)).toBeLessThan(
      Math.hypot(frozenBefore[2] - 900, frozenBefore[3] - 900),
    );
    expect(p[(n - 1) * 2]).toBe(frozenBefore[(n - 1) * 2]);
    core.handle({ type: "drop" });
    run(core);
    expect(core.layout.isLocal).toBe(false);
  });

  it("starts afresh on relayout", () => {
    const core = new LayoutCore();
    core.handle(graphCmd(ids, links, 1));
    run(core);
    core.handle({
      type: "relayout",
      heat: { alpha: 1, decay: 0.02, target: 0, fast: true },
    });
    expect(core.layout.alpha).toBe(1);
    const first = core.frame(true)!.positions;
    // d3's spiral around the origin, before any step.
    expect(first[0]).toBeCloseTo(10 * Math.sqrt(0.5), 5);
    expect(first[1]).toBe(0);
  });

  it("sends at most two frames before the view hands one back, but always the final one", () => {
    const core = new LayoutCore();
    core.handle(graphCmd(ids, links, 1));
    core.step(10, clock);
    const a = core.frame(false);
    const b = core.frame(false);
    expect(a && b).toBeTruthy();
    expect(core.frame(false)).toBeNull();
    expect(core.frame(true)).not.toBeNull();
    core.handle({ type: "recycle", buffer: a!.positions });
    core.handle({ type: "recycle", buffer: b!.positions });
    const c = core.frame(false);
    expect(c?.positions === a?.positions || c?.positions === b?.positions).toBe(
      true,
    ); // reused
  });
});
