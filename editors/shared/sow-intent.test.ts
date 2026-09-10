import "./test/browser-globals.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSowIntent,
  peekSowIntent,
  SOW_INTENT_TTL_MS,
  writeSowIntent,
} from "./sow-intent.js";

describe("sow-intent", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips every view kind for the matching document", () => {
    for (const view of [
      { kind: "project", id: "e1" },
      { kind: "deliverables" },
      { kind: "team" },
      { kind: "locate", id: "d7" },
      { kind: "goal", id: "g3" },
    ] as const) {
      writeSowIntent({ documentId: "doc-1", view });
      expect(peekSowIntent("doc-1")).toEqual(view);
      clearSowIntent("doc-1");
    }
  });

  it("peeking does NOT consume — a discarded render can read it again", () => {
    writeSowIntent({ documentId: "doc-1", view: { kind: "project", id: "e1" } });
    expect(peekSowIntent("doc-1")).toEqual({ kind: "project", id: "e1" });
    expect(peekSowIntent("doc-1")).toEqual({ kind: "project", id: "e1" });
  });

  it("clearing consumes it", () => {
    writeSowIntent({ documentId: "doc-1", view: { kind: "team" } });
    clearSowIntent("doc-1");
    expect(peekSowIntent("doc-1")).toBeNull();
  });

  it("never steers another document, and leaves that document's intent alone", () => {
    writeSowIntent({ documentId: "doc-1", view: { kind: "locate", id: "x" } });
    expect(peekSowIntent("doc-2")).toBeNull();
    // doc-2 mounting must not consume doc-1's intent either.
    clearSowIntent("doc-2");
    expect(peekSowIntent("doc-1")).toEqual({ kind: "locate", id: "x" });
  });

  it("ignores and drops an intent older than the TTL", () => {
    writeSowIntent({ documentId: "doc-1", view: { kind: "team" } }, 1_000);
    expect(peekSowIntent("doc-1", 1_000 + SOW_INTENT_TTL_MS)).toEqual({ kind: "team" });
    expect(peekSowIntent("doc-1", 1_000 + SOW_INTENT_TTL_MS + 1)).toBeNull();
    // dropped, not merely hidden
    expect(peekSowIntent("doc-1", 1_000)).toBeNull();
  });

  it("rejects id-bearing kinds without an id, unknown kinds, and malformed entries", () => {
    const key = "bai:sow-open-intent";
    sessionStorage.setItem(key, JSON.stringify({ documentId: "d", at: Date.now(), view: { kind: "locate" } }));
    expect(peekSowIntent("d")).toBeNull();
    sessionStorage.setItem(key, JSON.stringify({ documentId: "d", at: Date.now(), view: { kind: "nope", id: "1" } }));
    expect(peekSowIntent("d")).toBeNull();
    // An entry from before the timestamp existed is not trusted.
    sessionStorage.setItem(key, JSON.stringify({ documentId: "d", view: { kind: "team" } }));
    expect(peekSowIntent("d")).toBeNull();
    sessionStorage.setItem(key, "not json");
    expect(peekSowIntent("d")).toBeNull();
  });
});
