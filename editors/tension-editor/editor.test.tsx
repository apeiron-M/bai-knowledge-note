/**
 * Every write the contradiction editor makes, through the real reducer: what each button sends is
 * accepted from the state where the button shows, and a refusal comes back with words the reader gets.
 * The editor is rendered in each state to check which buttons it offers.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type * as TensionModel from "document-models/tension";
import { actions, reducer, utils, type TensionDocument } from "document-models/tension";
import { writeErrorText } from "../shared/use-doc-write.js";

const holder = vi.hoisted(() => ({ doc: null as unknown }));
vi.mock("document-models/tension", async (orig) => ({
  ...(await orig<typeof TensionModel>()),
  useSelectedTensionDocument: () => [holder.doc, () => {}],
}));
vi.mock("@powerhousedao/design-system/connect", () => ({ DocumentToolbar: () => null }));
vi.mock("@powerhousedao/reactor-browser", () => ({ setSelectedNode: () => {} }));
vi.mock("../shared/use-vault-doc-index.js", () => ({
  useVaultDocIndex: () => ({
    byId: new Map([
      ["n1", { id: "n1", title: "Direct expenses dominate", documentType: "bai/knowledge-note", noteType: null }],
      ["n2", { id: "n2", title: "Opex falls can be reclassification", documentType: "bai/knowledge-note", noteType: null }],
    ]),
    knowledgeDocs: [],
    isLoading: false,
    refresh: () => {},
  }),
}));
const { default: Editor } = await import("./editor.js");

const at = "2026-10-15T10:00:00.000Z";
function open(): TensionDocument {
  return reducer(
    utils.createDocument(),
    actions.createTension({
      title: "Contradiction on unit-economics",
      description: "“Direct expenses dominate” contradicts “Opex falls can be reclassification”.",
      content: "## Involved claims",
      involvedRefs: ["n1"],
      observedAt: at,
      observedBy: "graph-indexer",
    }),
  );
}
const lastError = (d: TensionDocument) => d.operations.global.at(-1)?.error ?? null;

describe("tension editor writes", () => {
  it("Resolve and Dissolve close an open contradiction with the reader's words", () => {
    const resolved = reducer(open(), actions.resolveTension({ resolution: "The cut was real", resolvedAt: at }));
    expect(lastError(resolved)).toBeNull();
    expect(resolved.state.global).toMatchObject({ status: "RESOLVED", resolution: "The cut was real", resolvedAt: at });
    const dissolved = reducer(open(), actions.dissolveTension({ resolution: "Both hold, by quarter", resolvedAt: at }));
    expect(lastError(dissolved)).toBeNull();
    expect(dissolved.state.global.status).toBe("DISSOLVED");
  });
  it("closing one that is already closed is refused, and the refusal reads as a sentence", () => {
    const twice = reducer(
      reducer(open(), actions.resolveTension({ resolution: "first", resolvedAt: at })),
      actions.dissolveTension({ resolution: "second", resolvedAt: at }),
    );
    expect(lastError(twice)).toBe("Tension is not open");
    expect(twice.state.global.status).toBe("RESOLVED");
    expect(writeErrorText([new Error(lastError(twice) as string)])).toMatch(/already closed/);
  });
  it("Add links a note once", () => {
    const added = reducer(open(), actions.addInvolvedRef({ ref: "n2" }));
    expect(lastError(added)).toBeNull();
    expect(added.state.global.involvedRefs).toEqual(["n1", "n2"]);
    expect(reducer(added, actions.addInvolvedRef({ ref: "n2" })).state.global.involvedRefs).toEqual(["n1", "n2"]);
  });
});

describe("tension editor screen", () => {
  it("an open contradiction offers Resolve and Dissolve, and links the notes its description quotes", () => {
    holder.doc = open();
    const html = renderToStaticMarkup(<Editor />);
    expect(html).toContain(">Resolve<");
    expect(html).toContain(">Dissolve<");
    expect(html).toMatch(/<button[^>]*class="mention"[^>]*>Direct expenses dominate<\/button>/);
  });
  it("a closed contradiction offers neither", () => {
    holder.doc = reducer(open(), actions.resolveTension({ resolution: "The cut was real", resolvedAt: at }));
    const html = renderToStaticMarkup(<Editor />);
    expect(html).not.toContain(">Resolve<");
    expect(html).not.toContain(">Dissolve<");
    expect(html).toContain("RESOLVED");
  });
});
