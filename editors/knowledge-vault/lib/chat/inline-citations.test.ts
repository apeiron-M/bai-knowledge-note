import { describe, expect, it } from "vitest";
import { markerOccurrences, numberCitations } from "./inline-citations.js";

describe("numberCitations", () => {
  const citations = [{ documentId: "a" }, { documentId: "b" }];

  it("numbers markers by document and positions them by occurrence, consuming one leading space", () => {
    expect(numberCitations("First [[a]]. Second[[b]], again [[a]].", citations)).toBe(
      "First [[cite:1:0]]. Second [[cite:2:1]], again [[cite:1:2]].",
    );
  });

  it("keeps the anchor out of the token but counts the position, and removes unknown markers", () => {
    expect(numberCitations("Envelope [[a#e1]] and gone [[zzz]] then [[b]].", citations)).toBe(
      "Envelope [[cite:1:0]] and gone then [[cite:2:2]].",
    );
  });

  it("removes every marker while streaming (no citations yet)", () => {
    expect(numberCitations("Draft [[a]] text", [])).toBe("Draft text");
  });
});

describe("markerOccurrences", () => {
  it("reads document and anchor back from the stored text, in order", () => {
    expect(markerOccurrences("x [[a]] y [[b#g2]] z [[a#e1]]")).toEqual([
      { documentId: "a", anchor: null },
      { documentId: "b", anchor: "g2" },
      { documentId: "a", anchor: "e1" },
    ]);
  });
});
