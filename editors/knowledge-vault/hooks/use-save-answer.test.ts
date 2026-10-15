import "../../shared/test/browser-globals.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reducer, utils } from "document-models/knowledge-note";
import type { AnswerDraft } from "../lib/chat/save-answer.js";

const dispatchActions = vi.fn();
vi.mock("@powerhousedao/reactor-browser", () => ({
  dispatchActions: (...args: unknown[]) => dispatchActions(...args) as unknown,
}));

const { REAL_SAVE_DEPS, saveAnswerAsNote } = await import("./use-save-answer.js");
const { NO_ANSWER, WRITE_TIMEOUT_MS } = await import("../../shared/use-doc-write.js");

afterEach(() => {
  vi.useRealTimers();
  dispatchActions.mockReset();
});

const draft: AnswerDraft = {
  title: "Large-frame turbine orders exceed build capacity",
  description: "Backlogs of 220 GW sit against a build rate of 60–70 GW a year, so buyers reserve slots years ahead.",
  kind: "OBSERVATION",
  topics: ["energy", "AI compute"],
  content: "Orders exceed capacity [[Turbine note]].\n\n*Saved from the vault chat, in answer to: “q”*",
  links: [
    {
      documentId: "n1",
      title: "Turbine note",
      documentType: "bai/knowledge-note",
      linkType: "BUILDS_ON",
      reason: "The saved chat answer cites it for: “Orders exceed capacity”",
      confidence: "grounded",
      include: true,
    },
    {
      documentId: "s1",
      title: "Report part 3",
      documentType: "bai/source",
      linkType: "DERIVED_FROM",
      reason: "The saved chat answer cites it for: “buyers reserve slots years ahead”",
      confidence: "speculative",
      include: true,
    },
    {
      documentId: "n2",
      title: "Unticked",
      documentType: "bai/knowledge-note",
      linkType: "BUILDS_ON",
      reason: "The saved chat answer cites it for: “something the person left out”",
      confidence: "grounded",
      include: false,
    },
  ],
  maps: [],
  notLinked: [],
};
const target = { driveId: "drive-1", author: "liberuum.eth", sessionId: "chat:t-1", mapId: "map-1" };

type Applied = { actions: Record<string, unknown>[]; documentId: string };
function fakeDeps(fail?: { create?: boolean; on?: string }) {
  const applied: Applied[] = [];
  const created: { name: string; driveId: string }[] = [];
  const refresh = vi.fn();
  return {
    applied,
    created,
    refresh,
    deps: {
      createNote: (o: { name: string; driveId: string }) => {
        created.push(o);
        return fail?.create ? Promise.reject(new Error("insufficient permissions to execute operation")) : Promise.resolve("note-new");
      },
      apply: (actions: unknown[], documentId: string) => {
        applied.push({ actions: actions as Record<string, unknown>[], documentId });
        const type = (actions[0] as { type: string }).type;
        return Promise.resolve(fail?.on === type ? ["Description exceeds 200 characters"] : []);
      },
      refresh,
    },
  };
}

describe("saveAnswerAsNote", () => {
  it("creates the note, writes it, links it, files it — in that order, each on the right document", async () => {
    const f = fakeDeps();
    const steps: string[] = [];
    const out = await saveAnswerAsNote(draft, target, f.deps, (s) => steps.push(s));
    expect(out).toEqual({ ok: true, noteId: "note-new", linked: 2, placed: true });
    expect(steps).toEqual(["create", "content", "links", "map"]);
    expect(f.created).toEqual([{ name: "large-frame-turbine-orders-exceed-build-capacity", driveId: "drive-1" }]);
    expect(f.applied.map((a) => [a.documentId, a.actions.map((x) => x.type)])).toEqual([
      ["note-new", ["SET_TITLE", "SET_DESCRIPTION", "SET_NOTE_TYPE", "SET_CONTENT", "ADD_TOPIC", "ADD_TOPIC", "SET_PROVENANCE"]],
      ["note-new", ["ADD_RELATIONSHIP", "ADD_RELATIONSHIP"]],
      ["map-1", ["ADD_RELATIONSHIP"]],
    ]);
    expect(f.refresh).toHaveBeenCalledOnce();
  });

  it("links the way the note editor does: on the note, document scope, with the reason on the edge", async () => {
    const f = fakeDeps();
    await saveAnswerAsNote(draft, target, f.deps);
    const [, links, map] = f.applied;
    expect(links.actions.map((a) => ({ scope: a.scope, input: a.input }))).toEqual([
      {
        scope: "document",
        input: {
          sourceId: "note-new",
          targetId: "n1",
          relationshipType: "BUILDS_ON",
          metadata: { reason: "The saved chat answer cites it for: “Orders exceed capacity”", confidence: "grounded" },
        },
      },
      {
        scope: "document",
        input: {
          sourceId: "note-new",
          targetId: "s1",
          relationshipType: "DERIVED_FROM",
          metadata: { reason: "The saved chat answer cites it for: “buyers reserve slots years ahead”", confidence: "speculative" },
        },
      },
    ]);
    // Membership is the map's edge to the note, as the map editor adds it.
    expect(map.actions[0]).toMatchObject({
      type: "ADD_RELATIONSHIP",
      scope: "document",
      input: { sourceId: "map-1", targetId: "note-new", relationshipType: "CORE_IDEA" },
    });
    expect(map.actions[0].input).not.toHaveProperty("metadata");
  });

  it("writes content the knowledge-note model accepts, every action of it", async () => {
    const f = fakeDeps();
    await saveAnswerAsNote(draft, target, f.deps);
    let doc = utils.createDocument();
    for (const action of f.applied[0].actions) doc = reducer(doc, action as never);
    expect(doc.operations.global.filter((op) => op.error)).toEqual([]);
    const s = doc.state.global;
    expect(s.title).toBe(draft.title);
    expect(s.description).toBe(draft.description);
    expect(s.noteType).toBe("OBSERVATION");
    expect(s.content).toBe(draft.content);
    expect(s.topics.map((t) => t.name)).toEqual(["energy", "AI compute"]);
    expect(s.provenance).toMatchObject({ author: "liberuum.eth", sourceOrigin: "SESSION_MINE", sessionId: "chat:t-1" });
    expect(s.status).toBe("DRAFT");
  });

  it("skips the links and the map when there are none to make", async () => {
    const f = fakeDeps();
    const out = await saveAnswerAsNote(
      { ...draft, links: draft.links.map((l) => ({ ...l, include: false })) },
      { ...target, mapId: null, sessionId: null },
      f.deps,
    );
    expect(out).toEqual({ ok: true, noteId: "note-new", linked: 0, placed: false });
    expect(f.applied).toHaveLength(1);
    expect(f.applied[0].actions.at(-1)?.input).not.toHaveProperty("sessionId");
  });

  it("stops at the first step that fails, says which, and keeps what was made", async () => {
    const refused = fakeDeps({ create: true });
    expect(await saveAnswerAsNote(draft, target, refused.deps)).toEqual({
      ok: false,
      step: "create",
      noteId: null,
      error:
        "The note could not be created. You don't have permission to change this vault. Ask its administrator for write access.",
    });
    expect(refused.applied).toEqual([]);

    const content = fakeDeps({ on: "SET_TITLE" });
    const out = await saveAnswerAsNote(draft, target, content.deps);
    expect(out).toMatchObject({ ok: false, step: "content", noteId: "note-new" });
    expect(out.ok ? "" : out.error).toBe(
      "The note was created, but its title, description and body did not save. Description exceeds 200 characters",
    );
    expect(content.applied).toHaveLength(1);
    expect(content.refresh).not.toHaveBeenCalled();

    const links = fakeDeps({ on: "ADD_RELATIONSHIP" });
    expect(await saveAnswerAsNote(draft, target, links.deps)).toMatchObject({ ok: false, step: "links", noteId: "note-new" });
    expect(links.applied).toHaveLength(2);
  });
});

describe("the real write: dispatchActions, waited for", () => {
  it("is done when every action landed", async () => {
    dispatchActions.mockResolvedValue({ header: { id: "note-new" } });
    expect(await REAL_SAVE_DEPS.apply([{ type: "SET_TITLE" }], "note-new")).toEqual([]);
    expect(dispatchActions.mock.calls[0][1]).toBe("note-new");
  });

  it("reports a refusal in plain words", async () => {
    dispatchActions.mockImplementation((_a: unknown, _id: string, onErrors: (e: Error[]) => void) => {
      onErrors([new Error("Forbidden: insufficient permissions to execute operation \"SET_TITLE\"")]);
      return Promise.resolve({ header: { id: "note-new" } });
    });
    expect(await REAL_SAVE_DEPS.apply([{ type: "SET_TITLE" }], "note-new")).toEqual([
      "You don't have permission to change this vault. Ask its administrator for write access.",
    ]);
  });

  it("says when the document could not be found", async () => {
    dispatchActions.mockResolvedValue(undefined);
    expect(await REAL_SAVE_DEPS.apply([{ type: "SET_TITLE" }], "gone")).toEqual([
      "The vault could not find the document to change.",
    ]);
  });

  it("says so when the vault does not answer in time", async () => {
    vi.useFakeTimers();
    dispatchActions.mockReturnValue(new Promise(() => {}));
    const pending = REAL_SAVE_DEPS.apply([{ type: "SET_TITLE" }], "note-new");
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    expect(await pending).toEqual([NO_ANSWER]);
  });
});
