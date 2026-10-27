import { describe, expect, it } from "vitest";
import type {
  CandidateDoc,
  ContextTarget,
  DocumentTarget,
} from "../../editors/knowledge-vault/chat/context/context-frame.js";
import {
  createIntent,
  documentTypeName,
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
