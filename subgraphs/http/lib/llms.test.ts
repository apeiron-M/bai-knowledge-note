import { describe, expect, it } from "vitest";
import { renderLlmsFull, renderLlmsTxt } from "./llms.js";

describe("renderLlmsTxt", () => {
  it("orders HUB, DOMAIN, TOPIC and links to markdown notes", () => {
    const text = renderLlmsTxt(
      {
        title: "Vault",
        description: "Institutional memory",
        mocs: [
          { tier: "TOPIC", title: "Reactor", id: "t1" },
          { tier: "HUB", title: "Everything", id: "h1" },
          { tier: "DOMAIN", title: "Storage", id: "d1" },
        ],
      },
      "drive-1",
      "http://h/api/x",
    );
    const hub = text.indexOf("h1.md");
    const domain = text.indexOf("d1.md");
    const topic = text.indexOf("t1.md");
    expect(hub).toBeLessThan(domain);
    expect(domain).toBeLessThan(topic);
    expect(text).toContain(
      "[Everything](http://h/api/x/notes/h1.md?drive=drive-1) (HUB)",
    );
  });
});

describe("renderLlmsFull", () => {
  it("separates sections", () => {
    const text = renderLlmsFull({
      sections: [
        { title: "A", body: "first" },
        { title: "B", body: "second" },
      ],
    });
    expect(text).toBe("# A\n\nfirst\n\n---\n\n# B\n\nsecond");
  });
});