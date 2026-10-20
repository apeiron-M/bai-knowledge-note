import { describe, expect, it } from "vitest";
import { mentionParts } from "./mentions.js";

const a = { id: "n1", title: "Direct expenses have become the dominant expense category for the protocol." };
const b = { id: "n2", title: "A headline fall in operating expenses can be an accounting reclassification rather than a real spending cut." };

describe("mentionParts", () => {
  it("makes each quoted note in a contradiction's description a mention, and keeps the rest as text", () => {
    const text = `“${a.title}” contradicts “${b.title}”. Opened automatically from a CONTRADICTS link.`;
    expect(mentionParts(text, [a, b])).toEqual([
      "“",
      { id: "n1", text: a.title },
      "” contradicts “",
      { id: "n2", text: b.title },
      "”. Opened automatically from a CONTRADICTS link.",
    ]);
  });
  it("returns the text unchanged when no note is named", () => {
    expect(mentionParts("Nothing to link here.", [a])).toEqual(["Nothing to link here."]);
  });
  it("prefers the longest title when one title contains another", () => {
    const short = { id: "s", title: "Direct expenses" };
    expect(mentionParts(a.title, [short, a])).toEqual([{ id: "n1", text: a.title }]);
  });
  it("ignores titles too short to be a meaningful mention", () => {
    expect(mentionParts("an AI note", [{ id: "x", title: "AI" }])).toEqual(["an AI note"]);
  });
});
