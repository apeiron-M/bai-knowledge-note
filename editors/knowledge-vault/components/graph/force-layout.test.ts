import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { describe, expect, it } from "vitest";
import { ForceLayout } from "./force-layout.js";

type D3Node = SimulationNodeDatum & { radius: number };

/** A deterministic graph: clusters around hubs, some cross links, some coincident points. */
function makeGraph(n: number, seed = 7) {
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const radius = Array.from({ length: n }, (_, i) =>
    i % 25 === 0 ? 40 : 9 + rand() * 20,
  );
  const links: [number, number, boolean][] = [];
  for (let i = 1; i < n; i++) {
    const hub = Math.floor(i / 25) * 25;
    if (hub !== i) links.push([hub, i, true]);
    if (rand() < 0.6) links.push([i, Math.floor(rand() * n), false]);
  }
  return { radius, links };
}

function d3Sim(
  n: number,
  preset: Map<number, [number, number]>,
  g: ReturnType<typeof makeGraph>,
) {
  const nodes: D3Node[] = Array.from({ length: n }, (_, i) => {
    const p = preset.get(i);
    return p
      ? { radius: g.radius[i], x: p[0], y: p[1] }
      : { radius: g.radius[i] };
  });
  const links = g.links.map(([source, target, core]) => ({
    source,
    target,
    core,
  }));
  const sim = forceSimulation<D3Node>(nodes)
    .force("charge", forceManyBody<D3Node>().strength(-220))
    .force(
      "link",
      forceLink<
        D3Node,
        { source: number | D3Node; target: number | D3Node; core: boolean }
      >(links)
        .distance((l) => (l.core ? 95 : 75))
        .strength(0.25),
    )
    .force("center", forceCenter<D3Node>(400, 300))
    .force("x", forceX<D3Node>(400).strength(0.06))
    .force("y", forceY<D3Node>(300).strength(0.06))
    .force(
      "collide",
      forceCollide<D3Node>()
        .radius((d) => d.radius + 6)
        .iterations(2)
        .strength(0.9),
    )
    .alphaDecay(0.02)
    .stop();
  return { sim, nodes };
}

function ourSim(
  n: number,
  preset: Map<number, [number, number]>,
  g: ReturnType<typeof makeGraph>,
) {
  const f = new ForceLayout();
  f.resize(n);
  for (let i = 0; i < n; i++) {
    f.radius[i] = g.radius[i];
    const p = preset.get(i);
    if (p) [f.x[i], f.y[i]] = p;
  }
  f.setLinks(
    Uint32Array.from(g.links.map((l) => l[0])),
    Uint32Array.from(g.links.map((l) => l[1])),
    Float64Array.from(g.links.map((l) => (l[2] ? 95 : 75))),
  );
  f.centerX = 400;
  f.centerY = 300;
  f.initialize();
  return f;
}

function maxDiff(f: ForceLayout, nodes: D3Node[]): number {
  let worst = 0;
  nodes.forEach((d, i) => {
    worst = Math.max(
      worst,
      Math.abs((d.x ?? 0) - f.x[i]),
      Math.abs((d.y ?? 0) - f.y[i]),
    );
  });
  return worst;
}

describe("ForceLayout matches d3-force", () => {
  it("places unplaced nodes on d3's spiral", () => {
    const g = makeGraph(60);
    const { nodes } = d3Sim(60, new Map(), g);
    expect(maxDiff(ourSim(60, new Map(), g), nodes)).toBe(0);
  });

  it("steps exactly as d3 does, including coincident points and jiggle", () => {
    const n = 400;
    const g = makeGraph(n);
    // Three nodes stacked on one point and two on another: exercises the
    // quadtree's coincident chains and the shared random stream.
    const preset = new Map<number, [number, number]>([
      [5, [10, 10]],
      [6, [10, 10]],
      [7, [10, 10]],
      [300, [-50.5, 80.25]],
      [301, [-50.5, 80.25]],
    ]);
    const { sim, nodes } = d3Sim(n, preset, g);
    const ours = ourSim(n, preset, g);
    for (let t = 1; t <= 120; t++) {
      sim.tick();
      ours.tick();
      if (t === 1 || t === 10 || t === 120) {
        expect(maxDiff(ours, nodes), `after ${t} ticks`).toBeLessThan(1e-6);
      }
    }
    expect(ours.alpha).toBeCloseTo(sim.alpha(), 12);
  });

  it("holds fixed nodes and follows alphaTarget, as d3 does", () => {
    const n = 120;
    const g = makeGraph(n, 11);
    const { sim, nodes } = d3Sim(n, new Map(), g);
    const ours = ourSim(n, new Map(), g);
    for (let t = 0; t < 30; t++) {
      sim.tick();
      ours.tick();
    }
    nodes[3].fx = 123;
    nodes[3].fy = -45;
    ours.fx[3] = 123;
    ours.fy[3] = -45;
    sim.alphaTarget(0.3);
    ours.alphaTarget = 0.3;
    for (let t = 0; t < 40; t++) {
      sim.tick();
      ours.tick();
    }
    expect(ours.x[3]).toBe(123);
    expect(ours.y[3]).toBe(-45);
    expect(maxDiff(ours, nodes)).toBeLessThan(1e-6);
    expect(ours.alpha).toBeCloseTo(sim.alpha(), 12);
  });

  it("lays out a large graph as d3 does when it walks nodes in space order", { timeout: 60_000 }, () => {
    const n = 800;
    const g = makeGraph(n, 5);
    const { sim, nodes } = d3Sim(n, new Map(), g);
    const ours = ourSim(n, new Map(), g);
    ours.spatialOrder = true;
    for (let t = 0; t < 300; t++) {
      sim.tick();
      ours.tick();
    }
    // Not the same digits (collisions resolve in another order), the same layout.
    const stats = (xs: (i: number) => number, ys: (i: number) => number) => {
      let link = 0;
      for (const [a, b] of g.links)
        link += Math.hypot(xs(a) - xs(b), ys(a) - ys(b));
      let spread = 0;
      for (let i = 0; i < n; i++)
        spread += Math.hypot(xs(i) - 400, ys(i) - 300);
      let overlaps = 0;
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++)
          if (
            Math.hypot(xs(i) - xs(j), ys(i) - ys(j)) <
            (g.radius[i] + g.radius[j]) * 0.5
          )
            overlaps++;
      return { link: link / g.links.length, spread: spread / n, overlaps };
    };
    const theirs = stats(
      (i) => nodes[i].x ?? 0,
      (i) => nodes[i].y ?? 0,
    );
    const mine = stats(
      (i) => ours.x[i],
      (i) => ours.y[i],
    );
    expect(mine.link / theirs.link).toBeGreaterThan(0.97);
    expect(mine.link / theirs.link).toBeLessThan(1.03);
    expect(mine.spread / theirs.spread).toBeGreaterThan(0.97);
    expect(mine.spread / theirs.spread).toBeLessThan(1.03);
    expect(mine.overlaps).toBeLessThanOrEqual(theirs.overlaps + 5);
  });

  it("copes with an empty graph and a single node", () => {
    const empty = new ForceLayout();
    empty.resize(0);
    empty.initialize();
    empty.tick();
    const one = new ForceLayout();
    one.resize(1);
    one.radius[0] = 9;
    one.initialize();
    for (let t = 0; t < 5; t++) one.tick();
    expect(Number.isFinite(one.x[0]) && Number.isFinite(one.y[0])).toBe(true);
  });
});
