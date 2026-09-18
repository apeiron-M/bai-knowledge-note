import {
  approveNote,
  reducer,
  setContent,
  setMetadataField,
  setProvenance,
  setTitle,
  submitForReview,
  utils,
} from "document-models/knowledge-note/v2";
import { describe, expect, it } from "vitest";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

describe("top-level updatedAt", () => {
  it("is stamped by content and lifecycle operations even without provenance", () => {
    let doc = reducer(utils.createDocument(), setTitle({ title: "t", updatedAt: T1 }));
    expect(doc.state.global.updatedAt).toBe(T1);
    expect(doc.state.global.provenance).toBeNull();

    doc = reducer(doc, setContent({ content: "c", updatedAt: T2 }));
    expect(doc.state.global.updatedAt).toBe(T2);

    doc = reducer(doc, submitForReview({ id: "e1", actor: "a", timestamp: T3 }));
    expect(doc.state.global.updatedAt).toBe(T3);
  });

  it("survives provenance being set last — the edits before it are no longer discarded", () => {
    let doc = reducer(utils.createDocument(), setTitle({ title: "t", updatedAt: T2 }));
    doc = reducer(
      doc,
      setProvenance({ author: "agent", sourceOrigin: "DERIVED", createdAt: T1 }),
    );
    expect(doc.state.global.updatedAt).toBe(T2);
    expect(doc.state.global.provenance?.createdAt).toBe(T1);
    expect(doc.state.global.provenance?.updatedAt).toBe(T2);
  });
});

describe("provenance.createdAt is immutable", () => {
  const withProvenance = () =>
    reducer(
      utils.createDocument(),
      setProvenance({ author: "agent", sourceOrigin: "DERIVED", createdAt: T1 }),
    );

  it("lets author and origin be corrected when createdAt is passed back unchanged", () => {
    const doc = reducer(
      withProvenance(),
      setProvenance({ author: "human", sourceOrigin: "MANUAL", createdAt: T1 }),
    );
    expect(doc.operations.global[1].error).toBeUndefined();
    expect(doc.state.global.provenance?.author).toBe("human");
    expect(doc.state.global.provenance?.createdAt).toBe(T1);
  });

  it("rejects a different createdAt and leaves provenance unchanged", () => {
    const doc = reducer(
      withProvenance(),
      setProvenance({ author: "human", sourceOrigin: "MANUAL", createdAt: T2 }),
    );
    expect(doc.operations.global[1].error).toBe(
      `provenance.createdAt is ${T1} and cannot be changed`,
    );
    expect(doc.state.global.provenance?.author).toBe("agent");
  });

  it("still lets a different actor approve and still refuses self-approval", () => {
    let doc = reducer(withProvenance(), submitForReview({ id: "e1", actor: "agent", timestamp: T2 }));
    const self = reducer(doc, approveNote({ id: "e2", actor: "agent", timestamp: T3 }));
    expect(self.operations.global[2].error).toBe("Actor cannot approve their own note");
    doc = reducer(doc, approveNote({ id: "e2", actor: "reviewer", timestamp: T3 }));
    expect(doc.state.global.status).toBe("CANONICAL");
  });
});

describe("metadata values with a closed vocabulary", () => {
  it("rejects a confidence, severity or decisionStatus outside the set", () => {
    let doc = reducer(
      utils.createDocument(),
      setMetadataField({ field: "confidence", value: "high", updatedAt: T1 }),
    );
    expect(doc.operations.global[0].error).toBe(
      '"high" is not a valid confidence; expected one of grounded, established, speculative',
    );
    expect(doc.state.global.confidence).toBeNull();

    doc = reducer(doc, setMetadataField({ field: "severity", value: "sev1", updatedAt: T1 }));
    expect(doc.operations.global[1].error).toMatch(/not a valid severity/);
    doc = reducer(doc, setMetadataField({ field: "decisionStatus", value: "maybe", updatedAt: T1 }));
    expect(doc.operations.global[2].error).toMatch(/not a valid decisionStatus/);
  });

  it("accepts the vocabulary, clears with an empty value, and leaves free-text fields free", () => {
    let doc = reducer(
      utils.createDocument(),
      setMetadataField({ field: "confidence", value: "speculative", updatedAt: T1 }),
    );
    expect(doc.state.global.confidence).toBe("speculative");
    doc = reducer(doc, setMetadataField({ field: "confidence", value: "", updatedAt: T2 }));
    expect(doc.state.global.confidence).toBeNull();
    doc = reducer(doc, setMetadataField({ field: "scope", value: "anything goes", updatedAt: T2 }));
    expect(doc.operations.global[2].error).toBeUndefined();
    expect(doc.state.global.scope).toBe("anything goes");
  });
});
