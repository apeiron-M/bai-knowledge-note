import { describe, expect, it } from "vitest";
import type {
  CandidateDoc,
  ContextTarget,
  DocumentTarget,
} from "../../editors/knowledge-vault/chat/context/context-frame.js";
import { driveRefContext } from "../../editors/knowledge-vault/chat/core/ref-candidates.js";
import {
  createIntent,
  documentTypeName,
  mentionsCurrentDocument,
  mentionsTitle,
  namedDocuments,
  resolveTargetDocument,
  routeChatTurn,
} from "../../editors/knowledge-vault/chat/core/target-document.js";

const D = "drive-1";
const cand = (id: string, docType: string, title: string, aliases?: string[]): CandidateDoc =>
  aliases ? { id, docType, title, aliases } : { id, docType, title };
const tag = (c: CandidateDoc): DocumentTarget => ({
  kind: "document",
  id: c.id,
  driveId: D,
  title: c.title,
  docType: c.docType,
});
const drive: ContextTarget = { kind: "drive", id: D, name: "Chat E2E Vault" };

const note = cand("n1", "bai/knowledge-note", "CRDT merge semantics");
const moc = cand("m1", "bai/moc", "CRDTs");
const plan = cand("w1", "bai/wbs", "Hive plan");
const source = cand("s1", "bai/source", "A source");
const documents = [note, moc, plan, source];
const supportedTypes = new Set(["bai/knowledge-note", "bai/wbs", "bai/moc"]);
const resolve = (context: ContextTarget, utterance: string, docs = documents) =>
  resolveTargetDocument({ context, documents: docs, supportedTypes, utterance });

describe("resolveTargetDocument (M0, from the tag)", () => {
  it("acts on the viewed document", () => {
    expect(resolve(tag(plan), "mark the suits goal done")).toEqual({
      kind: "document",
      target: tag(plan),
      via: "context",
    });
  });

  it("retargets when exactly one other document is named verbatim", () => {
    expect(resolve(tag(note), "add an open question to CRDTs: what about tombstones?")).toEqual({
      kind: "document",
      target: tag(moc),
      via: "retarget",
      from: tag(note),
    });
  });

  it("does not count the viewed document's own title, or names inside it", () => {
    // "CRDTs" is not inside "CRDT merge semantics", but the own title is ignored
    expect(resolve(tag(note), "tag CRDT merge semantics with sync")).toMatchObject({ via: "context" });
    const crdt = cand("n2", "bai/knowledge-note", "CRDT");
    // "CRDT" only appears inside the viewed note's title
    expect(
      resolve(tag(note), "tag CRDT merge semantics with sync", [note, crdt]),
    ).toMatchObject({ via: "context", target: { id: "n1" } });
  });

  it("acts on the viewed document when several others are named", () => {
    expect(resolve(tag(note), "link CRDTs and Hive plan")).toMatchObject({ via: "context" });
  });

  it("ignores names of unsupported documents", () => {
    expect(resolve(tag(note), "summarise A source")).toMatchObject({ via: "context" });
  });

  it("is drive-level with nothing open and nothing named", () => {
    expect(resolve(drive, "tag it with crdt")).toEqual({ kind: "drive", target: drive });
  });

  it("targets a named document at drive level", () => {
    expect(resolve(drive, "in Hive plan, mark the suits goal done")).toEqual({
      kind: "document",
      target: tag(plan),
      via: "title",
    });
  });

  it("is unsupported on a document without ops, unless another is named", () => {
    expect(resolve(tag(source), "rename it")).toEqual({
      kind: "unsupported",
      target: tag(source),
    });
    expect(resolve(tag(source), "add a core idea to CRDTs")).toMatchObject({ via: "retarget" });
  });

  it("matches a stale node name kept as an alias", () => {
    const renamed = cand("m1", "bai/moc", "CRDT map", ["CRDTs"]);
    expect(resolve(tag(note), "add a question to CRDTs", [note, renamed])).toMatchObject({
      via: "retarget",
      target: { id: "m1", title: "CRDT map" },
    });
  });
});

describe("resolveTargetDocument: a pointer at the open document plus a name asks", () => {
  const other = cand("n3", "bai/knowledge-note", "Gossip protocols");
  const docs = [...documents, other];

  it("asks which document to change when the request says this note, this, it or here", () => {
    for (const u of [
      "link this note to Gossip protocols",
      "link this to Gossip protocols",
      "link this one to Gossip protocols",
      "add a link from this doc to Gossip protocols",
      "link it to Gossip protocols",
      "add Gossip protocols as a related note here",
    ])
      expect(resolve(tag(note), u, docs), u).toEqual({
        kind: "ask",
        open: tag(note),
        named: tag(other),
      });
  });

  it("asks for add this to X too: the intent decides which document changes", () => {
    // "add this to CRDTs" puts the open note into the MOC; the rule cannot tell
    expect(resolve(tag(note), "add this to CRDTs", docs)).toEqual({
      kind: "ask",
      open: tag(note),
      named: tag(moc),
    });
  });

  it("still retargets when only the other document is named", () => {
    expect(resolve(tag(note), "add the topic sync to Gossip protocols", docs)).toEqual({
      kind: "document",
      target: tag(other),
      via: "retarget",
      from: tag(note),
    });
  });

  it("asks on a pronoun after a name, and stays put when the name is ambiguous", () => {
    // a name, then a pronoun that may point back at it: ask
    expect(
      resolve(tag(note), "add a question to Gossip protocols and tag it", docs),
    ).toMatchObject({ kind: "ask", open: { id: "n1" }, named: { id: "n3" } });
    // two documents share the named title
    const twin = cand("n4", "bai/knowledge-note", "Gossip protocols");
    expect(
      resolve(tag(note), "add the topic sync to Gossip protocols", [...docs, twin]),
    ).toMatchObject({ via: "context", target: { id: "n1" } });
    // two different documents named
    expect(resolve(tag(note), "link Gossip protocols and CRDTs", docs)).toMatchObject({
      via: "context",
    });
  });

  it("retargets from an open document without ops: only the named one can change", () => {
    expect(resolve(tag(source), "link this to CRDTs", docs)).toEqual({
      kind: "document",
      target: tag(moc),
      via: "retarget",
      from: tag(source),
    });
    expect(resolve(tag(source), "rename this", docs)).toEqual({
      kind: "unsupported",
      target: tag(source),
    });
  });

  it("treats this <item> as an item, not the document", () => {
    expect(resolve(tag(note), "in Hive plan, mark this goal done", docs)).toMatchObject({
      via: "retarget",
      target: { id: "w1" },
    });
  });

  it("ignores pointer words inside a document's title", () => {
    const titled = cand("m3", "bai/moc", "Make it work");
    expect(
      resolve(tag(note), "add a core idea to Make it work", [...docs, titled]),
    ).toMatchObject({ via: "retarget", target: { id: "m3" } });
  });

  it("does not ask at drive level: nothing is open to point at", () => {
    expect(resolve(drive, "link it to Gossip protocols", docs)).toMatchObject({
      via: "title",
      target: { id: "n3" },
    });
  });

  it("keeps the other document as a ref candidate whichever one is chosen", () => {
    const u = "link this note to Gossip protocols";
    expect(resolve(tag(note), u, docs)).toMatchObject({ kind: "ask" });
    // the open note chosen: the named one ranks by its name
    const viewed = { id: note.id, docType: note.docType, title: note.title, state: {} };
    expect(driveRefContext(viewed, docs, { utterance: u }).find((c) => c.kind === "note")).toEqual({
      id: "n3",
      title: "Gossip protocols",
      kind: "note",
    });
    // the named one chosen: the open note is kept even where the cap would drop it
    const named = { id: other.id, docType: other.docType, title: other.title, state: {} };
    const v = "add this to Gossip protocols";
    expect(driveRefContext(named, docs, { utterance: v, cap: 0 })).toEqual([]);
    const kept = driveRefContext(named, docs, { utterance: v, cap: 0, keepIds: [note.id] });
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((c) => c.id === note.id)).toBe(true);
  });
});

describe("mentionsCurrentDocument", () => {
  it("reads this, this <doc noun>, it and here", () => {
    for (const u of ["tag this", "what is this?", "tag this note", "tag this MOC", "rename it", "add one here"])
      expect(mentionsCurrentDocument(u), u).toBe(true);
  });

  it("skips items, it's, its and other words", () => {
    for (const u of [
      "mark this goal done",
      "it's about sync",
      "fix its title",
      "add a topic to CRDTs",
      "there is history",
      "edit item 3",
    ])
      expect(mentionsCurrentDocument(u), u).toBe(false);
  });

  it("masks document names first", () => {
    expect(mentionsCurrentDocument("open Start here", ["Start here"])).toBe(false);
    expect(mentionsCurrentDocument("link Start here to this", ["Start here"])).toBe(true);
  });
});

describe("namedDocuments", () => {
  it("drops a name that only appears inside a longer mentioned name", () => {
    const long = cand("m2", "bai/moc", "CRDTs in practice");
    expect(namedDocuments("open CRDTs in practice", [moc, long]).map((d) => d.id)).toEqual([
      "m2",
    ]);
  });
});

describe("mentionsTitle", () => {
  it("matches whole phrases only, in any case", () => {
    expect(mentionsTitle("tag CRDT Merge Semantics", note.title)).toBe(true);
    expect(mentionsTitle("hive planning", "Hive plan")).toBe(false);
    expect(mentionsTitle("an ab note", "ab")).toBe(false);
  });
});

describe("routeChatTurn", () => {
  it("passes a target question through, even for a question", () => {
    const u = "is this note linked to CRDTs?";
    expect(routeChatTurn(u, resolve(tag(note), u))).toMatchObject({
      kind: "ask",
      open: { id: "n1" },
      named: { id: "m1" },
    });
  });

  it("runs the pipeline on a document, even for a question", () => {
    expect(routeChatTurn("what is this?", resolve(tag(note), "what is this?"))).toMatchObject({
      kind: "document",
      via: "context",
    });
  });

  it("answers a question with no runnable document", () => {
    expect(routeChatTurn("what is a CRDT?", resolve(drive, "what is a CRDT?"))).toEqual({
      kind: "answer",
      because: "drive",
    });
    expect(routeChatTurn("what is this?", resolve(tag(source), "what is this?"))).toEqual({
      kind: "answer",
      because: "unsupported",
    });
  });

  it("explains drive-level and unsupported requests", () => {
    const r = routeChatTurn("tag it with crdt", resolve(drive, "tag it with crdt"));
    expect(r).toMatchObject({ kind: "explain", create: null });
    if (r.kind === "explain") expect(r.text).toContain("drive-level changes are not supported");
    // a polite command is not a question
    expect(routeChatTurn("can you tag it?", resolve(drive, "can you tag it?")).kind).toBe(
      "explain",
    );
    const u = routeChatTurn("rename it", resolve(tag(source), "rename it"));
    if (u.kind === "explain") expect(u.text).toContain("no operations for Source");
  });

  it("offers the New dialog for a drive-level create", () => {
    expect(routeChatTurn("create a new note", resolve(drive, "create a new note"))).toMatchObject({
      kind: "explain",
      create: { docType: "bai/knowledge-note" },
    });
  });
});

describe("helpers", () => {
  it("reads create intents", () => {
    expect(createIntent("make a map of content for sync")?.docType).toBe("bai/moc");
    expect(createIntent("start a project")?.docType).toBe("bai/project");
    expect(createIntent("tag this note")).toBeNull();
  });

  it("names document types", () => {
    expect(documentTypeName("bai/pipeline-queue")).toBe("Pipeline queue");
    expect(documentTypeName("bai/moc")).toBe("MOC");
    expect(documentTypeName("bai/wbs")).toBe("WBS");
    expect(documentTypeName("")).toBe("Document");
  });
});
