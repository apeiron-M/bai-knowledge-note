import { describe, expect, it } from "vitest";
import {
  applyHighlight,
  buildGraphModel,
  easeFactor,
  easeTowards,
  edgeAlpha,
  edgeAttributes,
  fitView,
  hitTest,
  indexGraph,
  jitter,
  mergePositions,
  MOC_EDGE_COLOR,
  neighbourhood,
  nodeAlpha,
  nodeAttributes,
  packGraph,
  sameStructure,
  type GraphMocInput,
  type GraphNoteInput,
} from "./model.js";
import {
  decodeLayout,
  encodeLayout,
  memoryLayoutStore,
} from "./layout-store.js";

const note = (
  id: string,
  links: { target: string; type?: string }[] = [],
  status: string | null = "CANONICAL",
): GraphNoteInput => ({
  id,
  name: `${id}-slug`,
  title: `Note ${id}`,
  status,
  links: links.map((l, i) => ({
    id: `${id}->${l.target}#${i}`,
    targetDocumentId: l.target,
    targetTitle: null,
    linkType: l.type ?? "RELATES_TO",
    reason: null,
    confidence: null,
  })),
});
const moc = (
  id: string,
  ideas: string[],
  children: string[] = [],
  tier: GraphMocInput["tier"] = "TOPIC",
): GraphMocInput => ({
  id,
  title: `MoC ${id}`,
  tier,
  coreIdeas: ideas.map((noteRef) => ({ noteRef, contextPhrase: "" })),
  childRefs: children,
});

/** a—b (relates), m1 → a, b (core ideas), m1 → m2 (child MoC), m2 → b (secondary), m2 → c. */
const sample = () =>
  buildGraphModel(
    [
      note("a", [
        { target: "b" },
        { target: "source-doc", type: "DERIVED_FROM" },
      ]),
      note("b"),
      note("c"),
    ],
    [moc("m1", ["a", "b"], ["m2"]), moc("m2", ["b", "c", "ghost"])],
  );

const xy = (...pairs: [number, number][]) => Float32Array.from(pairs.flat());

describe("buildGraphModel", () => {
  it("builds notes, MoCs, MoC edges, child-MoC edges and note links, skipping targets that are not nodes", () => {
    const model = sample();
    expect(model.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "m1", "m2"]);
    expect(
      model.links.map((l) => [
        l.source,
        l.target,
        l.linkType,
        l.isPrimaryParent,
      ]),
    ).toEqual([
      ["m1", "a", "CORE_IDEA", true],
      ["m1", "b", "CORE_IDEA", true],
      ["m1", "m2", "CORE_IDEA", true],
      ["m2", "b", "CORE_IDEA", false], // b's first MoC is m1
      ["m2", "c", "CORE_IDEA", true],
      ["a", "b", "RELATES_TO", true],
    ]);
  });

  it("sizes and colours nodes as the view always has", () => {
    const model = buildGraphModel(
      [
        note("lonely"),
        note(
          "busy",
          Array.from({ length: 100 }, (_, i) => ({ target: `x${i}` })),
          "DRAFT",
        ),
        note("odd", [], "WEIRD"),
      ],
      [moc("hub", [], [], "HUB"), moc("topic", ["lonely", "busy"])],
    );
    const by = new Map(model.nodes.map((n) => [n.id, n]));
    expect(by.get("lonely")?.radius).toBe(9);
    expect(by.get("busy")?.radius).toBe(31); // capped
    expect(by.get("busy")?.color).toBe(0xf59e0b);
    expect(by.get("odd")?.color).toBe(0x6b7280); // unknown status: default
    expect(by.get("hub")?.radius).toBe(68);
    expect(by.get("topic")?.radius).toBeCloseTo(22 + Math.sqrt(2) * 3.6);
  });

  it("labels a note without a title by its name", () => {
    const model = buildGraphModel([{ ...note("a"), title: null }], []);
    expect(model.nodes[0].label).toBe("a-slug");
  });
});

describe("sameStructure", () => {
  const model = sample();
  const ids = new Set(model.nodes.map((n) => n.id));
  const linkIds = new Set(model.links.map((l) => l.id));
  it("is true for the same ids", () =>
    expect(sameStructure(ids, linkIds, model)).toBe(true));
  it("is false when a node or a link differs", () => {
    expect(sameStructure(new Set([...ids, "z"]), linkIds, model)).toBe(false);
    const other = new Set(linkIds);
    other.delete(model.links[0].id);
    other.add("other");
    expect(sameStructure(ids, other, model)).toBe(false);
  });
});

describe("indexGraph and neighbourhood", () => {
  it("indexes nodes and links and links both directions", () => {
    const g = indexGraph(sample());
    expect(g.index.get("m2")).toBe(4);
    expect(g.links.length).toBe(6);
    expect([...g.src]).toEqual([3, 3, 3, 4, 4, 0]);
    expect([...g.dst]).toEqual([0, 1, 4, 1, 2, 1]);
    expect(neighbourhood(g, g.index.get("b")!).sort((x, y) => x - y)).toEqual([
      0, 1, 3, 4,
    ]); // b, a, m1, m2
    expect(neighbourhood(g, g.index.get("c")!).sort((x, y) => x - y)).toEqual([
      2, 4,
    ]);
    expect([...g.isMoc]).toEqual([0, 0, 0, 1, 1]);
  });
});

describe("mergePositions", () => {
  it("keeps on-screen positions, restores saved ones, puts new nodes beside a neighbour, leaves the rest to the layout", () => {
    const before = indexGraph(buildGraphModel([note("a"), note("gone")], []));
    const prev = { index: before.index, pos: xy([1, 2], [3, 4]) };
    const g = indexGraph(
      buildGraphModel(
        [
          note("a"),
          note("saved"),
          note("new", [{ target: "a" }]),
          note("alone"),
        ],
        [],
      ),
    );
    const saved = new Map([["saved", { x: 50, y: 60 }]]);
    const { pos, added, removed, restored } = mergePositions(prev, g, saved);
    expect([pos[0], pos[1]]).toEqual([1, 2]); // a kept
    expect([pos[2], pos[3]]).toEqual([50, 60]); // restored
    const j = jitter("new");
    expect(pos[4]).toBeCloseTo(1 + j.x, 4); // beside a
    expect(pos[5]).toBeCloseTo(2 + j.y, 4);
    expect(Number.isNaN(pos[6]) && Number.isNaN(pos[7])).toBe(true); // alone: the layout places it
    expect({ added, removed, restored }).toEqual({
      added: 3,
      removed: 1,
      restored: 1,
    });
  });

  it("jitter is deterministic and bounded", () => {
    expect(jitter("x")).toEqual(jitter("x"));
    const d = Math.hypot(jitter("abc").x, jitter("abc").y);
    expect(d).toBeGreaterThanOrEqual(20);
    expect(d).toBeLessThanOrEqual(40);
  });
});

describe("hitTest", () => {
  const g = indexGraph(
    buildGraphModel([note("a"), note("b"), note("far")], [moc("m", [])]),
  );
  // a and b are radius 9; m is a MoC of radius 22.
  const pos = xy([0, 0], [6, 0], [500, 500], [3, 0]);
  const noMoc = xy([0, 0], [6, 0], [500, 500], [Number.NaN, Number.NaN]);

  it("prefers a MoC drawn above notes, else the nearest centre, among the nodes under the point", () => {
    expect(hitTest(g, pos, 5, 0)).toBe(3); // m covers both notes
    expect(hitTest(g, noMoc, 5, 0)).toBe(1); // b is nearer
    expect(hitTest(g, noMoc, 500, 505)).toBe(2);
  });

  it("falls back to the node whose edge is nearest, within the pad", () => {
    expect(hitTest(g, noMoc, -12, 0)).toBe(0); // 3 outside a, within 9 + 4
    expect(hitTest(g, noMoc, -14, 0)).toBe(-1);
    // Zoomed out (a wide pad): a nearby MoC does not steal a note the point is next to.
    const spread = xy([0, 0], [1000, 0], [2000, 0], [60, 0]);
    expect(hitTest(g, spread, -12, 0, 200)).toBe(0);
    expect(hitTest(g, spread, 50, 0, 200)).toBe(3); // inside m
  });

  it("measures a MoC as the diamond it is drawn as, not a circle", () => {
    // m (radius 22) alone at the origin: its corners are 22 out, its edges 22/√2 ≈ 15.6.
    const alone = xy(
      [Number.NaN, Number.NaN],
      [Number.NaN, Number.NaN],
      [Number.NaN, Number.NaN],
      [0, 0],
    );
    expect(hitTest(g, alone, 21, 0, 0)).toBe(3); // just inside a corner
    expect(hitTest(g, alone, 14, 14, 0)).toBe(-1); // inside the circle, outside the diamond
    expect(hitTest(g, alone, 10, 10, 0)).toBe(3); // inside the diamond
    // Within the pad of its nearest edge: (14,14) is (28 - 22)/√2 ≈ 4.2 from it.
    expect(hitTest(g, alone, 14, 14, 5)).toBe(3);
    expect(hitTest(g, alone, 14, 14, 4)).toBe(-1);
  });

  it("lets a note beside a MoC be hovered where the MoC is not drawn", () => {
    // Note a sits off m's diagonal, in the area a circular MoC used to claim.
    const beside = xy([16, 16], [Number.NaN, Number.NaN], [500, 500], [0, 0]);
    // (15,15) is inside m's old circle (21.2 < 22) but outside its diamond, and on a.
    expect(hitTest(g, beside, 15, 15, 0)).toBe(0);
    expect(hitTest(g, beside, 5, 5, 0)).toBe(3); // over the diamond, the MoC still wins
  });
});

describe("fitView", () => {
  const g = indexGraph(buildGraphModel([note("a"), note("b")], []));
  it("frames every placed node with padding, centred, at most 2×", () => {
    const fit = fitView(g, xy([0, 0], [182, 0]), 400, 400)!;
    // width 182 + 2 × 9 = 200 → (400 − 80) / 200 = 1.6
    expect(fit.scale).toBeCloseTo(1.6);
    expect(fit.x).toBeCloseTo(40 + 9 * 1.6);
    // height 18 → 28.8 px tall, centred vertically: the centre line y = 0 lands at 200.
    expect(fit.y).toBeCloseTo(200);
    expect(fitView(g, xy([0, 0], [10, 0]), 400, 400)!.scale).toBe(2);
    expect(
      fitView(g, xy([Number.NaN, 0], [Number.NaN, 0]), 400, 400),
    ).toBeNull();
  });

  it("keeps clear of per-side insets, centred in what is left, at a share of the tight fit", () => {
    // 200 world units wide in a 400 × 400 canvas, 100 px reserved on the right.
    const fit = fitView(
      g,
      xy([0, 0], [182, 0]),
      400,
      400,
      { top: 0, right: 100, bottom: 0, left: 20 },
      2,
      0.8,
    )!;
    // (400 − 20 − 100) / 200 = 1.4, × 0.8 = 1.12
    expect(fit.scale).toBeCloseTo(1.12);
    // 224 px of graph centred in the 280 px between the insets: starts at 20 + 28.
    expect(fit.x - 9 * fit.scale).toBeCloseTo(48);
    expect(fit.x + 191 * fit.scale).toBeLessThanOrEqual(300);
    // A canvas smaller than its insets still yields a usable view.
    const tiny = fitView(g, xy([0, 0], [182, 0]), 50, 50, 40)!;
    expect(tiny.scale).toBeGreaterThan(0);
  });
});

describe("packGraph", () => {
  it("sends ids, radii, positions and links by index, MoC edges flagged", () => {
    const g = indexGraph(sample());
    const pos = new Float32Array(10).fill(Number.NaN);
    pos[0] = 7;
    const cmd = packGraph(g, pos, 3, [100, 50], null);
    expect(cmd.version).toBe(3);
    expect(cmd.ids).toEqual(["a", "b", "c", "m1", "m2"]);
    expect([...cmd.links.slice(0, 4)]).toEqual([3, 0, 3, 1]);
    expect([...cmd.coreIdea]).toEqual([1, 1, 1, 1, 1, 0]);
    expect(cmd.positions[0]).toBe(7);
    expect(cmd.positions).not.toBe(pos); // a copy: the original is transferred
    expect(cmd.center).toEqual([100, 50]);
  });
});

describe("easing between layout frames", () => {
  it("jumps when frames come every rendered frame and glides when they are slow", () => {
    expect(easeFactor(16, 16)).toBe(1);
    const k = easeFactor(16, 200);
    expect(k).toBeGreaterThan(0.1);
    expect(k).toBeLessThan(0.5);
  });

  it("moves every node but the held one, snaps when close, reports when done", () => {
    const pos = xy([0, 0], [0, 0], [Number.NaN, Number.NaN]);
    const target = xy([10, 0], [10, 0], [5, 5]);
    expect(easeTowards(pos, target, 1, 0.5)).toBe(true);
    expect([...pos]).toEqual([5, 0, 0, 0, 5, 5]); // held node 1 untouched; unplaced one lands
    for (let i = 0; i < 20; i++) easeTowards(pos, target, 1, 0.5);
    expect(easeTowards(pos, target, 1, 0.5)).toBe(false);
    expect(pos[0]).toBe(10);
  });
});

describe("render attributes and highlight", () => {
  const g = indexGraph(sample());
  it("gives each node its radius, kind and colour, and each edge its colour, width and role", () => {
    const { meta, color } = nodeAttributes(g);
    expect(meta[6]).toBeCloseTo(g.nodes[3].radius, 4);
    expect(meta[7]).toBe(1); // m1 is a MoC
    expect([...color.slice(0, 4)]).toEqual([0x10, 0xb9, 0x81, 255]); // CANONICAL
    const e = edgeAttributes(g);
    expect([e.color[0], e.color[1], e.color[2]]).toEqual([
      (MOC_EDGE_COLOR >> 16) & 0xff,
      (MOC_EDGE_COLOR >> 8) & 0xff,
      MOC_EDGE_COLOR & 0xff,
    ]);
    expect(e.width[0]).toBeCloseTo(1.4); // primary MoC edge
    expect(e.width[3]).toBeCloseTo(0.8); // secondary
    expect(e.width[5]).toBeCloseTo(1.0); // note link
    expect([...e.primary]).toEqual([1, 1, 1, 0, 1, 1]);
  });

  it("dims outside the neighbourhood and shows a secondary edge only when it touches it", () => {
    expect(nodeAlpha(null)).toBe(1);
    expect(nodeAlpha(false)).toBe(0.15);
    expect(edgeAlpha(true, null, null)).toBe(0.55);
    expect(edgeAlpha(false, null, null)).toBe(0);
    expect(edgeAlpha(false, true, true)).toBe(0.9);
    expect(edgeAlpha(false, false, false)).toBe(0);
    expect(edgeAlpha(false, true, false)).toBe(0.04);
    expect(edgeAlpha(true, false, false)).toBe(0.04);

    const { color: nodeColor } = nodeAttributes(g);
    const e = edgeAttributes(g);
    applyHighlight(g, null, nodeColor, e.color, e.primary);
    expect(e.color[3 * 4 + 3]).toBe(0); // the secondary m2→b is hidden
    expect(e.color[0 * 4 + 3]).toBe(140); // 0.55
    const flags = new Uint8Array(5);
    for (const i of neighbourhood(g, g.index.get("c")!)) flags[i] = 1; // c, m2
    applyHighlight(g, flags, nodeColor, e.color, e.primary);
    expect(nodeColor[0 * 4 + 3]).toBe(38); // a dimmed to 0.15
    expect(nodeColor[2 * 4 + 3]).toBe(255); // c
    expect(e.color[4 * 4 + 3]).toBe(230); // m2→c, inside: 0.9
    expect(e.color[3 * 4 + 3]).toBe(10); // m2→b, secondary but touching m2: 0.04
    expect(e.color[5 * 4 + 3]).toBe(10); // a→b, outside: 0.04
  });
});

describe("saved layout", () => {
  it("encodes placed nodes only and round-trips", () => {
    const enc = encodeLayout(
      ["a", "b", "c"],
      xy([1.5, 2], [Number.NaN, 0], [3, -4]),
    );
    expect(enc.ids).toEqual(["a", "c"]);
    const dec = decodeLayout(enc)!;
    expect(dec.get("a")).toEqual({ x: 1.5, y: 2 });
    expect(dec.get("c")).toEqual({ x: 3, y: -4 });
    expect(dec.has("b")).toBe(false);
  });

  it("ignores anything that is not a layout", () => {
    expect(decodeLayout(null)).toBeNull();
    expect(decodeLayout({ v: 1, p: {} })).toBeNull(); // the old localStorage format
    expect(
      decodeLayout({ v: 2, ids: ["a"], xy: new Float32Array(4) }),
    ).toBeNull();
  });

  it("keeps layouts per key in memory where IndexedDB is unavailable", async () => {
    const store = memoryLayoutStore();
    store.save("drive-1", ["a"], xy([1, 2]));
    expect((await store.load("drive-1"))?.get("a")).toEqual({ x: 1, y: 2 });
    expect(await store.load("drive-2")).toBeNull();
    store.clear("drive-1");
    expect(await store.load("drive-1")).toBeNull();
  });
});
