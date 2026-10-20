import { describe, expect, it } from "vitest";
import type { StoredMessage } from "./chat-storage.js";
import {
  DESCRIPTION_MAX,
  draftFromAnswer,
  draftProblems,
  fitDescription,
  noteSlug,
  parseTopics,
  plainText,
  sentencesOf,
} from "./save-answer.js";

const answer: StoredMessage = {
  role: "assistant",
  content: [
    "Large-frame gas turbine orders now exceed what manufacturers can build in a year [[n-turbines]].",
    "Backlogs of 220 GW sit against a build rate of 60–70 GW a year [[n-turbines]] [[n-turbines]], so buyers reserve slots years ahead [[src-soa#p3]].",
    "",
    "The vault files this under **AI data-centre power** [[moc-power]], and one contradiction is still open about it [[t-1]].",
  ].join("\n"),
  citations: [
    { documentId: "n-turbines", title: "Large-frame turbine orders exceed build capacity", documentType: "bai/knowledge-note" },
    { documentId: "src-soa", title: "State of AI 2026 — Part 3", documentType: "bai/source" },
    { documentId: "moc-power", title: "AI Data Center Power", documentType: "bai/moc" },
    { documentId: "t-1", title: "Contradiction on turbines", documentType: "bai/tension" },
  ],
  evidence: [
    { documentId: "n-turbines", anchor: null, quote: "orders exceed the global build rate" },
    { documentId: "n-turbines", anchor: null, quote: null },
    { documentId: "n-turbines", anchor: null, quote: null },
    { documentId: "src-soa", anchor: "p3", quote: null },
    { documentId: "moc-power", anchor: null, quote: null },
    { documentId: "t-1", anchor: null, quote: null },
  ],
};

describe("reading the answer", () => {
  it("drops markdown and markers to plain prose", () => {
    expect(plainText("**Bold** and *this* [link](https://x.y) `code` [[n1]] done")).toBe("Bold and this link code done");
  });

  it("splits sentences at full stops, and treats each list item as one", () => {
    expect(sentencesOf("## Heading\nOne claim here. A second, 3.5 times larger.\n- An item\n1. Another")).toEqual([
      "Heading",
      "One claim here.",
      "A second, 3.5 times larger.",
      "An item",
      "Another",
    ]);
  });

  it("fits whole sentences under the limit, counting as JavaScript counts", () => {
    expect(fitDescription(["Short one.", "Another short one."], 40)).toBe("Short one. Another short one.");
    expect(fitDescription(["Short one.", "This one would not fit at all."], 25)).toBe("Short one.");
    // An emoji is two UTF-16 units: the reducer counts 2, so must we.
    const emoji = "😀".repeat(101);
    expect(emoji.length).toBe(202);
    expect(fitDescription([emoji]).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("cuts a single over-long sentence at a word, and marks the cut", () => {
    const long = `${"word ".repeat(60)}end.`;
    const cut = fitDescription([long]);
    expect(cut.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(cut.endsWith("word…")).toBe(true);
  });
});

describe("draftFromAnswer", () => {
  const d = draftFromAnswer(answer, "Can turbine makers keep up with AI demand?");

  it("takes the first sentence as the claim and the next ones as the description", () => {
    expect(d.title).toBe("Large-frame gas turbine orders now exceed what manufacturers can build in a year");
    expect(d.description).toBe(
      "Backlogs of 220 GW sit against a build rate of 60–70 GW a year, so buyers reserve slots years ahead.",
    );
    expect(d.kind).toBe("CONCEPT");
  });

  it("links notes it builds on and sources it derives from, each with the sentence it supports", () => {
    expect(d.links).toEqual([
      {
        documentId: "n-turbines",
        title: "Large-frame turbine orders exceed build capacity",
        documentType: "bai/knowledge-note",
        linkType: "BUILDS_ON",
        reason:
          "The saved chat answer cites it for: “Large-frame gas turbine orders now exceed what manufacturers can build in a year”",
        confidence: "grounded",
        include: true,
      },
      {
        documentId: "src-soa",
        title: "State of AI 2026 — Part 3",
        documentType: "bai/source",
        linkType: "DERIVED_FROM",
        reason:
          "The saved chat answer cites it for: “Backlogs of 220 GW sit against a build rate of 60–70 GW a year, so buyers reserve slots years ahead”",
        confidence: "speculative",
        include: true,
      },
    ]);
  });

  it("offers a cited map as the place to file it, and names what it does not link", () => {
    expect(d.maps.map((m) => m.documentId)).toEqual(["moc-power"]);
    expect(d.notLinked.map((c) => c.documentId)).toEqual(["t-1"]);
  });

  it("writes the body with citations as [[Title]] in parentheses, repeats collapsed, and the question it answered", () => {
    expect(d.content).toContain("can build in a year ([[Large-frame turbine orders exceed build capacity]]).");
    expect(d.content).toContain("60–70 GW a year ([[Large-frame turbine orders exceed build capacity]]), so");
    expect(d.content).not.toMatch(/\]\]\s*\[\[Large-frame/);
    expect(d.content).toContain("years ahead ([[State of AI 2026 — Part 3]]).");
    expect(d.content).toContain("under **AI data-centre power** ([[AI Data Center Power]]), and one contradiction is still open about it ([[Contradiction on turbines]]).");
    expect(d.content).not.toMatch(/n-turbines|src-soa|moc-power/);
    expect(d.content.endsWith("*Saved from the vault chat, in answer to: “Can turbine makers keep up with AI demand?”*")).toBe(true);
  });

  it("takes the description from the next paragraph when the claim stands alone", () => {
    const alone = draftFromAnswer(
      { role: "assistant", content: "One claim.\n\nWhy it holds. And a caveat.\n\nSomething else entirely.", citations: [] },
      "q",
    );
    expect(alone.title).toBe("One claim");
    expect(alone.description).toBe("Why it holds. And a caveat.");
  });

  it("falls back to the question as a reason when no sentence carries the citation", () => {
    const bare = draftFromAnswer(
      { role: "assistant", content: "See [[n1]].", citations: [{ documentId: "n1", title: "N1" }] },
      "What does the vault say about pricing?",
    );
    expect(bare.links[0]).toMatchObject({
      linkType: "BUILDS_ON",
      reason: "Cited by the chat answer to “What does the vault say about pricing?”, which this note keeps",
      confidence: "speculative",
    });
  });

  it("keeps brackets and pipes out of a [[Title]] reference", () => {
    const odd = draftFromAnswer(
      { role: "assistant", content: "Odd [[x]].", citations: [{ documentId: "x", title: "A [draft] | B", documentType: "bai/knowledge-note" }] },
      "q",
    );
    expect(odd.content).toContain("Odd ([[A draft B]]).");
  });
});

describe("before saving", () => {
  it("asks for a claim and a description that fits", () => {
    expect(draftProblems({ title: " ", description: "" }).map((p) => p.field)).toEqual(["title", "description"]);
    expect(draftProblems({ title: "A claim", description: "x".repeat(201) })).toEqual([
      { field: "description", message: "1 characters over the 200 a description can hold." },
    ]);
    expect(draftProblems({ title: "A claim", description: "Says what the title leaves out." })).toEqual([]);
  });

  it("names the document the way the pipeline names notes", () => {
    expect(noteSlug("Large-frame turbine orders exceed build capacity!")).toBe("large-frame-turbine-orders-exceed-build-capacity");
    expect(noteSlug("Café — über 220 GW")).toBe("cafe-uber-220-gw");
    expect(noteSlug("   ")).toBe("saved-chat-answer");
    expect(noteSlug("x".repeat(200)).length).toBe(80);
  });

  it("reads topics from a comma list, without repeats or #", () => {
    expect(parseTopics("pricing, #Retention,\nPricing , ")).toEqual(["pricing", "Retention"]);
  });
});
