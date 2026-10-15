import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@powerhousedao/reactor-browser", () => ({ setSelectedNode: () => {} }));

import { ChatMessage } from "./ChatMessage.js";

const answer = {
  role: "assistant" as const,
  content: "Bitvavo leads on listings [1] and spreads [2].",
  citations: [
    { documentId: "a", title: "A few speculative tokens capture outsized volume.", documentType: "bai/knowledge-note" },
    { documentId: "b", title: "Tighter spreads indicate improving execution quality.", documentType: "bai/knowledge-note" },
  ],
};

describe("ChatMessage", () => {
  it("says how the latest answer was found under what it used, inside the same block — never on top of the chips", () => {
    const html = renderToStaticMarkup(<ChatMessage message={answer} searches={2} />);
    const group = html.slice(html.indexOf('role="group"'));
    // One block: the heading, the chips, then the line — in that order.
    const heading = group.indexOf("From the vault");
    const lastChip = group.lastIndexOf("Tighter spreads");
    const line = group.indexOf("Found with 2 searches of the vault.");
    expect(heading).toBeGreaterThan(-1);
    expect(lastChip).toBeGreaterThan(heading);
    expect(line).toBeGreaterThan(lastChip);
    // Spaced in flow, with no negative margin to pull it up.
    expect(group).toContain("margin:16px 0 0");
    expect(html).not.toMatch(/-mt-/);
    // Without citations the line still says it; without a count, nothing is added.
    expect(renderToStaticMarkup(<ChatMessage message={{ role: "assistant", content: "No notes matched." }} searches={1} />)).toContain(
      "Found with 1 search of the vault.",
    );
    expect(renderToStaticMarkup(<ChatMessage message={answer} />)).not.toContain("Found with");
  });
});
