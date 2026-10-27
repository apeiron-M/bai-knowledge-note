import { describe, expect, it } from "vitest";
import {
  lexicalScore,
  rankCandidates,
  referencedIds,
} from "../../editors/knowledge-vault/chat/context/candidates.js";
import { candidateDocs } from "../../editors/knowledge-vault/chat/context/chat-document.js";
import {
  cardTargetNotice,
  chatSessionReducer,
  confirmTargetId,
  createSessionStore,
  initialSession,
  type ChatSessionState,
} from "../../editors/knowledge-vault/chat/context/chat-session.js";
import {
  contextTargetFrom,
  type ContextTarget,
  type DocumentTarget,
} from "../../editors/knowledge-vault/chat/context/context-frame.js";
import type { HistoryEntry } from "../../editors/knowledge-vault/chat/context/history-store.js";

const D = "drive-1";
const docT = (id: string, title: string, docType = "bai/knowledge-note"): DocumentTarget => ({
  kind: "document",
  id,
  driveId: D,
  title,
  docType,
});
const A = docT("a", "CRDTs", "bai/moc");
const B = docT("b", "CRDT merge semantics");
const DRIVE: ContextTarget = { kind: "drive", id: D, name: "Vault" };

describe("the tag follows the selection", () => {
  const node = { name: "crdt-merge.phd", documentType: "bai/knowledge-note" };
  it("shows the open document, loaded title first", () => {
    expect(
      contextTargetFrom({
        driveId: D,
        driveName: "Vault",
        selectedId: "b",
        node,
        loaded: { docType: "bai/knowledge-note", title: "CRDT merge semantics" },
      }),
    ).toEqual(B);
    // before the document loads: the node name
    expect(contextTargetFrom({ driveId: D, driveName: "Vault", selectedId: "b", node })).toEqual({
      ...B,
      title: "crdt-merge.phd",
    });
  });

  it("moves when the selection moves", () => {
    const frames = ["a", "b"].map((id) =>
      contextTargetFrom({
        driveId: D,
        driveName: "Vault",
        selectedId: id,
        loaded: { docType: id === "a" ? "bai/moc" : "bai/knowledge-note", title: id === "a" ? "CRDTs" : "CRDT merge semantics" },
      }),
    );
    expect(frames).toEqual([A, B]);
  });

  it("shows the drive when nothing is open", () => {
    expect(contextTargetFrom({ driveId: D, driveName: "Vault", selectedId: undefined })).toEqual(
      DRIVE,
    );
    expect(contextTargetFrom({ driveId: D, driveName: "", selectedId: undefined })).toEqual({
      ...DRIVE,
      name: "this drive",
    });
  });
});

describe("candidate documents", () => {
  it("prefers a known title over a stale node name, keeping it as an alias", () => {
    const nodes = [
      { id: "a", name: "CRDTs", documentType: "bai/moc" },
      { id: "b", name: "Untitled", documentType: "bai/knowledge-note" },
    ];
    expect(candidateDocs(nodes, [B])).toEqual([
      { id: "a", docType: "bai/moc", title: "CRDTs" },
      { id: "b", docType: "bai/knowledge-note", title: "CRDT merge semantics", aliases: ["Untitled"] },
    ]);
  });

  it("ranks by shared words, then recency, and caps", () => {
    const docs = [
      { id: "1", docType: "x", title: "Mite counts" },
      { id: "2", docType: "x", title: "Rooftop beehives" },
      { id: "3", docType: "x", title: "Queen rearing" },
      { id: "4", docType: "x", title: "Hive inspections" },
    ];
    expect(lexicalScore("the rooftop beehives", docs[1])).toBe(2.5);
    expect(lexicalScore("hives", docs[3])).toBe(1);
    expect(rankCandidates("link the beehives note", docs, { recentIds: ["3"] }).map((d) => d.id)).toEqual(
      ["2", "3", "4", "1"],
    );
    expect(rankCandidates("x", docs, { cap: 2 })).toHaveLength(2);
  });

  it("collects the ids a state refers to", () => {
    expect([...referencedIds({ a: ["x", { b: "y" }], n: 1 })]).toEqual(["x", "y"]);
  });
});

describe("a pending card keeps its target", () => {
  type P = { op: string };
  const entry = (id: string): HistoryEntry => ({ id, at: 1, turnId: "t", role: "user", text: id });

  it("does not move when the tag moves, and Confirm goes to it", () => {
    let s: ChatSessionState<P> = initialSession();
    s = chatSessionReducer(s, { type: "pending", card: { payload: { op: "ADD_TOPIC" }, target: A, context: A } });
    // the user navigates to B: the frame changes, the session does not
    const viewing = contextTargetFrom({
      driveId: D,
      driveName: "Vault",
      selectedId: "b",
      loaded: { docType: B.docType, title: B.title },
    });
    const card = s.pending;
    if (!card) throw new Error("no pending card");
    expect(card.target).toEqual(A);
    expect(confirmTargetId(s)).toBe("a");
    expect(cardTargetNotice(card, viewing)).toEqual({ switchedFrom: undefined, nowViewing: B });
    expect(cardTargetNotice(card, A)).toEqual({ switchedFrom: undefined, nowViewing: undefined });
    s = chatSessionReducer(s, { type: "settle" });
    expect(confirmTargetId(s)).toBeNull();
  });

  it("names both documents on a retarget, while the tag stays on the viewed one", () => {
    const card = { target: A, retargetedFrom: B };
    expect(cardTargetNotice(card, B)).toEqual({ switchedFrom: B, nowViewing: undefined });
    expect(cardTargetNotice(card, DRIVE)).toEqual({ switchedFrom: B, nowViewing: DRIVE });
  });

  it("merges a late history load with entries appended meanwhile", () => {
    let s: ChatSessionState<P> = initialSession();
    s = chatSessionReducer(s, { type: "append", entry: entry("new") });
    s = chatSessionReducer(s, { type: "loaded", entries: [entry("old")], recent: [A] });
    expect(s.entries.map((e) => e.id)).toEqual(["old", "new"]);
    expect(s.loaded).toBe(true);
    s = chatSessionReducer(s, { type: "recent", doc: B });
    s = chatSessionReducer(s, { type: "recent", doc: A });
    expect(s.recent.map((d) => d.id)).toEqual(["a", "b"]);
    s = chatSessionReducer(s, { type: "clear" });
    expect(s).toMatchObject({ entries: [], pending: null, recent: [] });
  });

  it("keeps sessions per drive in the module store", () => {
    const store = createSessionStore<P>();
    let calls = 0;
    store.subscribe(() => calls++);
    store.dispatch("d1", { type: "pending", card: { payload: { op: "X" }, target: A, context: A } });
    expect(store.get("d1").pending?.target.id).toBe("a");
    expect(store.get("d2").pending).toBeNull();
    expect(calls).toBe(1);
  });
});
