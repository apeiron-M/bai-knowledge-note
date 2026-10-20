import "./test/browser-globals.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSowIntent,
  peekSowIntent,
  type SowIntentView,
  releaseSowIntent,
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

  it("round-trips a wbs view, keyed by the envelope id", () => {
    // `viewOf` is a validating parser, so a kind absent from it is dropped
    // and the deep link lands on the overview with no error. Adding the
    // variant to the type alone did exactly that.
    writeSowIntent({ documentId: "doc-2", view: { kind: "wbs", projectId: "e1" } });
    expect(peekSowIntent("doc-2")).toEqual({ kind: "wbs", projectId: "e1" });
  });

  it("drops a view whose kind it does not know", () => {
    // Written through the module's own writer so the storage key cannot
    // drift out of sync with the test — a wrong key here would make this
    // pass by reading nothing at all.
    writeSowIntent({
      documentId: "doc-3",
      view: { kind: "teleport", id: "x" } as unknown as SowIntentView,
    });
    expect(peekSowIntent("doc-3")).toBeNull();
    // and a known kind through the same path still round-trips, proving the
    // null above came from the parser and not from an empty store
    writeSowIntent({ documentId: "doc-3", view: { kind: "team" } });
    expect(peekSowIntent("doc-3")).toEqual({ kind: "team" });
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

  it("is kept across a remount while the document is still selected", () => {
    // Connect re-keys the editor when the package version resolves on a cold
    // start; the remount must find the intent the first mount saw.
    writeSowIntent({ documentId: "doc-1", view: { kind: "project", id: "e1" } });
    releaseSowIntent("doc-1", true);
    expect(peekSowIntent("doc-1")).toEqual({ kind: "project", id: "e1" });
  });

  it("is released when the document is left", () => {
    writeSowIntent({ documentId: "doc-1", view: { kind: "project", id: "e1" } });
    releaseSowIntent("doc-1", false);
    expect(peekSowIntent("doc-1")).toBeNull();
  });

  it("leaving one document never releases another's intent", () => {
    writeSowIntent({ documentId: "doc-2", view: { kind: "team" } });
    releaseSowIntent("doc-1", false);
    expect(peekSowIntent("doc-2")).toEqual({ kind: "team" });
  });
});
