import { describe, expect, it } from "vitest";
import { leafFields } from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import {
  documentTitle,
  driveRefContext,
  REF_EXTRACTORS,
  refCandidatesFor,
  type ChatDocument,
} from "../../editors/knowledge-vault/chat/core/ref-candidates.js";
import { buildTrainingCatalog } from "../../training/gen/prompt-format.js";
import { THEMES } from "../../training/gen/ref-pools.js";
import {
  candidatesFor,
  mulberry32,
  RECIPES,
  stateOf,
} from "../../training/gen/ref-scenarios.js";
import {
  IdSource,
  replayers,
  replayFixture,
} from "../../training/gen/replay.js";

const catalog = buildTrainingCatalog();
const byKey = new Map(catalog.map((e) => [e.key, e]));
const reps = replayers();

describe("runtime ref candidates vs the training recipes", () => {
  it("covers exactly the recipes' ops and paths", () => {
    expect(Object.keys(REF_EXTRACTORS).sort()).toEqual(
      Object.keys(RECIPES).sort(),
    );
    for (const [op, recipe] of Object.entries(RECIPES))
      expect(Object.keys(REF_EXTRACTORS[op]).sort()).toEqual(
        Object.keys(recipe.paths).sort(),
      );
  });

  it("every path is a ref-id field of the op", () => {
    for (const [op, paths] of Object.entries(REF_EXTRACTORS)) {
      const entry = byKey.get(op);
      expect(entry, op).toBeDefined();
      const refs = leafFields(entry?.fields ?? [])
        .filter((f) => f.fieldClass === "ref-id")
        .map((f) => f.path.join("."));
      for (const p of Object.keys(paths)) expect(refs, `${op} ${p}`).toContain(p);
    }
  });

  // Seeded states from the recipes' own builders, three seeds each.
  for (const op of Object.keys(RECIPES))
    it(`gives the training labels for ${op}`, () => {
      const entry = byKey.get(op);
      if (!entry) throw new Error(op);
      for (const seed of [1, 7, 42]) {
        const r = mulberry32(seed);
        const theme = THEMES[Math.floor(r() * THEMES.length)];
        const built = RECIPES[op].build(r, theme);
        const rep = replayFixture(
          byKey,
          reps,
          entry.docType,
          built.fixture,
          new IdSource(),
        );
        expect(rep.error, op).toBeUndefined();
        const state = stateOf(rep.doc);
        const ours = refCandidatesFor(op, state, built.ctx);
        expect(ours).toEqual(candidatesFor(op, state, built.ctx));
      }
    });

  it("gives no candidates for an op without refs", () => {
    expect(refCandidatesFor("knowledge-note:SET_TITLE", {}, [])).toEqual({});
  });
});

describe("drive ref context", () => {
  const doc = (
    id: string,
    docType: string,
    title: string,
    state: Record<string, unknown> = {},
  ): ChatDocument => ({ id, docType, title, state });

  const names = (docs: ChatDocument[]) =>
    docs.map(({ id, docType, title }) => ({ id, docType, title }));

  it("lists the other documents by kind and a linked plan's goals", () => {
    const project = doc("p1", "bai/project", "Hive project", {
      wbsRef: "w1",
    });
    const wbs = doc("w1", "bai/wbs", "Hive plan", {
      goals: [{ id: "g1", description: "Order suits" }],
    });
    const docs = [
      project,
      doc("n1", "bai/knowledge-note", "Mite counts"),
      wbs,
      doc("p2", "bai/project", "Other project"),
      doc("s1", "bai/source", "A source"),
    ];
    expect(driveRefContext(project, names(docs), { linkedWbs: wbs })).toEqual([
      { id: "n1", title: "Mite counts", kind: "note" },
      { id: "n1", title: "Mite counts", kind: "knowledge" },
      { id: "w1", title: "Hive plan", kind: "wbs" },
      { id: "p2", title: "Other project", kind: "project" },
      { id: "g1", title: "Order suits", kind: "wbs-goal" },
    ]);
    // a plan that is not the linked one adds no goals
    expect(
      driveRefContext({ ...project, state: {} }, names(docs), { linkedWbs: wbs }).some(
        (c) => c.kind === "wbs-goal",
      ),
    ).toBe(false);
  });

  it("feeds unlinked notes to ADD_LINK and skips the target itself", () => {
    const note = doc("n1", "bai/knowledge-note", "Mite counts", {
      links: [{ id: "l1", targetDocumentId: "n2", targetTitle: "Old" }],
    });
    const docs = [
      note,
      doc("n2", "bai/knowledge-note", "Old"),
      doc("n3", "bai/knowledge-note", "New"),
    ];
    const ctx = driveRefContext(note, names(docs));
    expect(
      refCandidatesFor("knowledge-note:ADD_LINK", note.state, ctx),
    ).toEqual({ targetDocumentId: [{ id: "n3", label: "New" }] });
  });

  it("caps each kind at 10, ranked by the request, keeping referenced items", () => {
    const notes = Array.from({ length: 30 }, (_, i) =>
      doc(`n${i}`, "bai/knowledge-note", `Note ${i} filler`),
    );
    const plans = Array.from({ length: 3 }, (_, i) => doc(`w${i}`, "bai/wbs", `Plan ${i}`));
    const project = doc("p1", "bai/project", "Hive project", {
      knowledgeRefs: ["n29"],
    });
    const hives = doc("nh", "bai/knowledge-note", "Rooftop beehives");
    const all = [project, ...notes, hives, ...plans];
    const ctx = driveRefContext(project, names(all), {
      utterance: "link the rooftop beehives note",
      recentIds: ["n7"],
    });
    const knowledge = ctx.filter((c) => c.kind === "knowledge");
    // the linked n29 (for its label) plus 10 ranked; the match first, then recent
    expect(knowledge).toHaveLength(11);
    expect(knowledge[0].id).toBe("n29");
    expect(knowledge[1].id).toBe("nh");
    expect(knowledge[2].id).toBe("n7");
    expect(ctx.filter((c) => c.kind === "wbs")).toHaveLength(3);
    // step 2 sees at most 10 choices on a ref path
    const refs = refCandidatesFor("project:ADD_KNOWLEDGE_REF", project.state, ctx);
    expect(refs.ref).toHaveLength(10);
    expect(refs.ref[0]).toEqual({ id: "nh", label: "Rooftop beehives" });
    expect(
      refCandidatesFor("project:REMOVE_KNOWLEDGE_REF", project.state, ctx).ref,
    ).toEqual([{ id: "n29", label: "Note 29 filler" }]);
  });

  it("titles a document from its state, else the fallback", () => {
    expect(documentTitle({ title: "T" }, "f")).toBe("T");
    expect(documentTitle({ name: "N" }, "f")).toBe("N");
    expect(documentTitle({ title: "" }, "f")).toBe("f");
  });
});
