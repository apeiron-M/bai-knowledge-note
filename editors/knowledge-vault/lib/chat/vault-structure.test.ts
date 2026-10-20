import { describe, expect, it } from "vitest";
import {
  buildTopicMap,
  findMatch,
  queryPhrase,
  queryWords,
  rarestWord,
  resolveMap,
  shapeContradictions,
  tierOf,
  type MocLinks,
  type MocNode,
  type TensionNode,
} from "./vault-structure.js";

describe("exact text", () => {
  it("reads a query the way the index matches it", () => {
    expect(queryPhrase('  "Gas  turbine" backlog ')).toBe("gas turbine backlog");
    expect(queryWords('"Gas turbine" backlog? (220 GW)')).toEqual(["gas", "turbine", "backlog", "220", "gw"]);
    expect(rarestWord("the PD-L1 binder")).toBe("binder");
    expect(rarestWord("   ")).toBeNull();
  });

  it("prefers a match in the title, and quotes the whole title", () => {
    expect(
      findMatch({ title: "Bitvavo leads EUR volume", content: "… Bitvavo again …" }, "bitvavo"),
    ).toEqual({ matchedIn: "title", snippet: "Bitvavo leads EUR volume", match: "phrase" });
  });

  it("cuts a snippet around a match in the body, on word boundaries", () => {
    const content = `${"lorem ipsum ".repeat(30)}the backlog reached 220 GW of turbines${" dolor sit".repeat(30)}`;
    const m = findMatch({ title: "Turbines", content }, "220 gw");
    expect(m?.matchedIn).toBe("content");
    expect(m?.match).toBe("phrase");
    // Whole words at both cuts, the match in the middle.
    expect(m?.snippet).toMatch(/^…(lorem|ipsum) .*the backlog reached 220 GW of turbines .*(dolor|sit)…$/);
    expect(m?.snippet.length).toBeLessThan(260);
  });

  it("falls back to every word appearing somewhere, and says so", () => {
    const m = findMatch(
      { title: "Offers that convert", description: "A customer pays when the problem is named", content: "money follows" },
      "customer money offers",
    );
    expect(m).toEqual({ matchedIn: "title", snippet: "Offers that convert", match: "all words" });
  });

  it("does not match when a word is missing", () => {
    expect(findMatch({ title: "Offers", content: "money" }, "offers money customer")).toBeNull();
    expect(findMatch({ title: "Offers" }, "pricing")).toBeNull();
  });
});

describe("topic map", () => {
  const moc = (documentId: string, title: string, tier: string): MocNode => ({
    documentId,
    title,
    description: `${title} — what it gathers`,
    noteType: `MOC (${tier})`,
  });
  const mocs = [
    moc("t-up", "Upsell Offers", "TOPIC"),
    moc("hub", "My Vault", "HUB"),
    moc("d-money", "Money Models", "DOMAIN"),
    moc("t-down", "Downsell Offers", "TOPIC"),
    moc("d-ai", "AI Reports", "DOMAIN"),
    moc("t-loose", "Loose ends", "TOPIC"),
  ];
  const links = new Map<string, MocLinks>([
    ["hub", { children: ["d-money", "d-ai"], notes: [] }],
    ["d-money", { children: ["t-up", "t-down"], notes: [{ documentId: "n1", title: "N1" }] }],
    ["t-up", { children: [], notes: [{ documentId: "n1", title: "N1" }, { documentId: "n2", title: "N2" }] }],
    ["t-down", { children: [], notes: [{ documentId: "n3", title: "N3" }] }],
    // Two parents: listed once, under the first it is reached from.
    ["d-ai", { children: ["t-down"], notes: [{ documentId: "n4", title: "N4" }] }],
    ["t-loose", { children: [], notes: [{ documentId: "n5", title: "N5" }] }],
  ]);
  const tree = buildTopicMap(mocs, links);

  it("lists the hierarchy flat, top first, areas before topics, each map once", () => {
    expect(tree.maps.map((m) => [m.title, m.depth, m.parentId])).toEqual([
      ["My Vault", 0, null],
      ["AI Reports", 1, "hub"],
      ["Downsell Offers", 2, "d-ai"],
      ["Money Models", 1, "hub"],
      ["Upsell Offers", 2, "d-money"],
      ["Loose ends", 0, null],
    ]);
  });

  it("counts notes held directly and, without double counting, beneath", () => {
    const row = (id: string) => tree.maps.find((m) => m.documentId === id)!;
    expect(row("d-money")).toMatchObject({ notes: 1, notesBeneath: 3, childMaps: 2, tier: "DOMAIN" });
    expect(row("hub")).toMatchObject({ notes: 0, notesBeneath: 4, childMaps: 2, tier: "HUB" });
    expect(tree.notesInMaps).toBe(5);
    expect(tree.hubs).toBe(1);
  });

  it("names the maps unreachable from the hub", () => {
    expect(tree.unattached).toEqual([{ documentId: "t-loose", title: "Loose ends" }]);
  });

  it("survives a cycle with no top", () => {
    const cyc = buildTopicMap(
      [moc("a", "A", "TOPIC"), moc("b", "B", "TOPIC")],
      new Map([
        ["a", { children: ["b"], notes: [] }],
        ["b", { children: ["a"], notes: [] }],
      ]),
    );
    expect(cyc.maps.map((m) => m.title)).toEqual(["A", "B"]);
  });

  it("reads the tier, defaulting to TOPIC as the index does", () => {
    expect(tierOf("MOC (hub)")).toBe("HUB");
    expect(tierOf(null)).toBe("TOPIC");
  });

  it("finds a map by id, exact title, or a title only it contains", () => {
    expect(resolveMap(tree.maps, "d-ai")).toMatchObject({ map: { title: "AI Reports" } });
    expect(resolveMap(tree.maps, "money models")).toMatchObject({ map: { documentId: "d-money" } });
    expect(resolveMap(tree.maps, "upsell")).toMatchObject({ map: { documentId: "t-up" } });
    expect(resolveMap(tree.maps, "offers")).toEqual({
      error: '"offers" matches 2 maps: Downsell Offers; Upsell Offers. Pass one title exactly, or its documentId.',
    });
    expect(resolveMap(tree.maps, "biology")).toEqual({
      error: 'No map of content called "biology". The top of the hierarchy is: My Vault; AI Reports; Money Models; Loose ends.',
    });
  });
});

describe("contradictions", () => {
  const t = (documentId: string, status: string | null, updatedAt: string): TensionNode => ({
    documentId,
    title: `Contradiction ${documentId}`,
    description: null,
    status,
    author: "graph-indexer",
    createdAt: null,
    updatedAt,
  });
  const tensions = [
    t("old-open", "OPEN", "2026-09-01"),
    t("resolved", "RESOLVED", "2026-10-10"),
    t("new-open", "OPEN", "2026-10-01"),
    t("dissolved", "dissolved", "2026-09-15"),
    t("unset", null, "2026-08-01"),
  ];

  it("counts every status and lists the ones asked for, newest first", () => {
    const r = shapeContradictions(tensions, new Map([["new-open", [{ documentId: "n1", title: "N1" }]]]), "OPEN");
    expect(r.counts).toEqual({ OPEN: 3, RESOLVED: 1, DISSOLVED: 1 });
    expect(r.rows.map((x) => x.documentId)).toEqual(["new-open", "old-open", "unset"]);
    expect(r.rows[0]).toMatchObject({ documentType: "bai/tension", notes: [{ documentId: "n1", title: "N1" }] });
  });

  it("puts open ones first when every status is asked for", () => {
    const r = shapeContradictions(tensions, new Map(), "ALL");
    expect(r.rows.map((x) => x.status)).toEqual(["OPEN", "OPEN", "OPEN", "RESOLVED", "DISSOLVED"]);
  });
});
