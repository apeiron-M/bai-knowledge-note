import { describe, expect, it } from "vitest";
import type { ChatDocument } from "../../editors/knowledge-vault/chat/core/ref-candidates.js";
import {
  askForDocumentText,
  documentTypeName,
  mentionsTitle,
  resolveTargetDocument,
  routeChatTurn,
} from "../../editors/knowledge-vault/chat/core/target-document.js";

const doc = (id: string, docType: string, title: string): ChatDocument => ({
  id,
  docType,
  title,
  state: {},
});
const note = doc("n1", "bai/knowledge-note", "CRDT merge semantics");
const plan = doc("w1", "bai/wbs", "Hive plan");
const other = doc("x1", "powerhouse/document-drive", "Drive");
const documents = [note, plan, other];
const supportedTypes = new Set(["bai/knowledge-note", "bai/wbs"]);
const resolve = (selectedId: string | null, utterance: string) =>
  resolveTargetDocument({ selectedId, documents, supportedTypes, utterance });

describe("resolveTargetDocument", () => {
  it("uses the picked document", () => {
    expect(resolve("w1", "mark the suits goal done")).toEqual({
      kind: "document",
      doc: plan,
      via: "selected",
    });
  });

  it("asks when the picked document has no ops", () => {
    expect(resolve("x1", "rename it")).toEqual({
      kind: "ask",
      reason: "unsupported",
      options: [note, plan],
    });
  });

  it("asks when nothing is picked and no title is named", () => {
    expect(resolve(null, "mark the suits goal done")).toEqual({
      kind: "ask",
      reason: "none",
      options: [note, plan],
    });
    expect(resolve("", "x").kind).toBe("ask");
    expect(resolve("gone", "x").kind).toBe("ask");
  });

  it("ties the request to the one document it names", () => {
    expect(resolve(null, "in hive plan, mark the suits goal done")).toEqual({
      kind: "document",
      doc: plan,
      via: "title",
    });
  });

  it("asks among the named documents when several match", () => {
    const docs = [plan, doc("w2", "bai/wbs", "Hive plan B")];
    const r = resolveTargetDocument({
      selectedId: null,
      documents: docs,
      supportedTypes,
      utterance: "compare hive plan and hive plan b",
    });
    expect(r).toEqual({ kind: "ask", reason: "ambiguous", options: docs });
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
    expect(
      routeChatTurn("what is this?", {
        kind: "document",
        doc: note,
        via: "selected",
      }),
    ).toEqual({ kind: "run", doc: note, via: "selected" });
  });

  it("answers a question without a document", () => {
    expect(routeChatTurn("what is a CRDT?", resolve(null, "what is a CRDT?"))).toEqual({
      kind: "answer",
    });
  });

  it("asks for a document for a request without one", () => {
    const r = routeChatTurn("tag it with crdt", resolve(null, "tag it with crdt"));
    expect(r.kind).toBe("ask");
    // A polite command is not a question.
    expect(
      routeChatTurn("can you tag it?", resolve(null, "can you tag it?")).kind,
    ).toBe("ask");
  });
});

describe("ask text", () => {
  it("lists the documents with their type", () => {
    expect(askForDocumentText("none", [note, plan])).toBe(
      "Which document should this change? Pick one in the Target menu:\n" +
        "• CRDT merge semantics (Knowledge note)\n• Hive plan (WBS)",
    );
    expect(askForDocumentText("none", [])).toContain("no supported documents");
    expect(documentTypeName("bai/pipeline-queue")).toBe("Pipeline queue");
  });
});
