/**
 * The observation lifecycle (PENDING → PROMOTED → IMPLEMENTED, or ARCHIVED from any state but ARCHIVED)
 * through the real reducer, and the buttons the editor offers in each state — only the moves the model accepts.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type * as ObservationModel from "document-models/observation";
import { actions, reducer, utils, type ObservationDocument } from "document-models/observation";

const holder = vi.hoisted(() => ({ doc: null as unknown }));
vi.mock("document-models/observation", async (orig) => ({
  ...(await orig<typeof ObservationModel>()),
  useSelectedObservationDocument: () => [holder.doc, () => {}],
}));
vi.mock("@powerhousedao/design-system/connect", () => ({ DocumentToolbar: () => null }));
vi.mock("@powerhousedao/reactor-browser", () => ({ setSelectedNode: () => {} }));
vi.mock("../shared/use-vault-doc-index.js", () => ({
  useVaultDocIndex: () => ({
    byId: new Map([["n1", { id: "n1", title: "Atomic notes give links a target", documentType: "bai/knowledge-note", noteType: null }]]),
    knowledgeDocs: [],
    isLoading: false,
    refresh: () => {},
  }),
}));
const { default: Editor } = await import("./editor.js");

const at = "2026-10-15T10:00:00.000Z";
const pending = (): ObservationDocument =>
  reducer(
    utils.createDocument(),
    actions.createObservation({ title: "Linking by id is slow", description: "People do not know note ids", category: "FRICTION", observedAt: at }),
  );
const promoted = () => reducer(pending(), actions.promoteObservation({ promotedTo: "n1", promotedAt: at }));
const implemented = () => reducer(promoted(), actions.implementObservation({ updatedAt: at }));
const archived = () => reducer(pending(), actions.archiveObservation({ updatedAt: at }));
const lastError = (d: ObservationDocument) => d.operations.global.at(-1)?.error ?? null;
const screen = (doc: ObservationDocument) => {
  holder.doc = doc;
  return renderToStaticMarkup(<Editor />);
};

describe("observation lifecycle", () => {
  it("each move the editor offers is accepted", () => {
    expect([promoted(), implemented(), archived()].map(lastError)).toEqual([null, null, null]);
    expect(implemented().state.global.status).toBe("IMPLEMENTED");
    expect(lastError(reducer(promoted(), actions.archiveObservation({ updatedAt: at })))).toBeNull();
    expect(lastError(reducer(implemented(), actions.archiveObservation({ updatedAt: at })))).toBeNull();
  });
  it("implementing a pending observation is refused — which is why a pending one is not offered it", () => {
    expect(lastError(reducer(pending(), actions.implementObservation({ updatedAt: at })))).toMatch(/Only a PROMOTED observation/);
  });
});

describe("observation editor buttons", () => {
  it("pending: Promote… and Archive, not Mark implemented", () => {
    const html = screen(pending());
    expect(html).toContain(">Promote…<");
    expect(html).toContain(">Archive<");
    expect(html).not.toContain("Mark implemented");
  });
  it("promoted: Mark implemented and Archive, and the note it became by its title", () => {
    const html = screen(promoted());
    expect(html).toContain(">Mark implemented<");
    expect(html).toContain(">Archive<");
    expect(html).not.toContain(">Promote…<");
    expect(html).toContain(">Atomic notes give links a target<");
  });
  it("implemented: only Archive", () => {
    const html = screen(implemented());
    expect(html).toContain(">Archive<");
    expect(html).not.toContain("Mark implemented");
    expect(html).not.toContain(">Promote…<");
  });
  it("archived: nothing left to do", () => {
    const html = screen(archived());
    expect(html).not.toContain(">Archive<");
    expect(html).toContain("nothing left to do");
  });
});
