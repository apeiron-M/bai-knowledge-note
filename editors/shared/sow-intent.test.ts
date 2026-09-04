import "./test/browser-globals.js";
import { beforeEach, describe, expect, it } from "vitest";
import { readSowIntent, writeSowIntent } from "./sow-intent.js";

describe("sow-intent", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips every view kind, exactly once, for the matching document", () => {
    for (const view of [
      { kind: "project", id: "e1" },
      { kind: "deliverables" },
      { kind: "team" },
      { kind: "locate", id: "d7" },
      { kind: "goal", id: "g3" },
    ] as const) {
      writeSowIntent({ documentId: "doc-1", view });
      expect(readSowIntent("doc-1")).toEqual(view);
      // One-shot: the read clears it.
      expect(readSowIntent("doc-1")).toBeNull();
    }
  });

  it("never steers another document, and clears the stale intent", () => {
    writeSowIntent({ documentId: "doc-1", view: { kind: "locate", id: "x" } });
    expect(readSowIntent("doc-2")).toBeNull();
    expect(readSowIntent("doc-1")).toBeNull();
  });

  it("rejects id-bearing kinds without an id and unknown kinds", () => {
    sessionStorage.setItem("bai:sow-open-intent", JSON.stringify({ documentId: "d", view: { kind: "locate" } }));
    expect(readSowIntent("d")).toBeNull();
    sessionStorage.setItem("bai:sow-open-intent", JSON.stringify({ documentId: "d", view: { kind: "nope", id: "1" } }));
    expect(readSowIntent("d")).toBeNull();
    sessionStorage.setItem("bai:sow-open-intent", "not json");
    expect(readSowIntent("d")).toBeNull();
  });
});
