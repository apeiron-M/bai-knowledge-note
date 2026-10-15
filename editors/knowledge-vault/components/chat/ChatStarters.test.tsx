/**
 * What the chat can do, as the person meets it: four task cards under an
 * empty composer, an invitation to the whole list until it has been seen,
 * and the list itself — every example a prompt that can be sent as written.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatHelpPanel, ChatStarters, chatAbilities, starterCards } from "./ChatStarters.js";

const noop = () => {};
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("what the chat can do", () => {
  it("covers its whole range, each in a plain sentence", () => {
    const abilities = chatAbilities("Source processing");
    expect(abilities.map((a) => a.title)).toEqual([
      "Ask your notes",
      "Trace where ideas come from",
      "Spot disagreements and gaps",
      "Catch up on changes",
      "Plan and track work",
      "Look beyond the vault",
      "Keep a good answer",
    ]);
    for (const a of abilities) expect(a.does, a.title).toMatch(/^[A-Z“].+\.$/);
    // The one that changes things says how: nothing until Apply.
    expect(abilities.find((a) => a.title === "Plan and track work")!.does).toMatch(/nothing is saved until you press Apply/);
  });

  it("gives examples that can be sent as written — the vault's own topic in them, or none at all", () => {
    for (const topic of ["Source processing", null]) {
      const all = chatAbilities(topic).flatMap((a) => a.examples);
      for (const q of all) expect(q, q).not.toMatch(/[{}<>]|TBD/);
      if (topic) expect(all).toContain("What does the vault say about Source processing?");
      else expect(all.some((q) => q.includes("about "))).toBe(false);
    }
    // A vault without topics still has something to try under every heading but the last.
    expect(chatAbilities(null).filter((a) => a.examples.length === 0).map((a) => a.title)).toEqual(["Look beyond the vault", "Keep a good answer"]);
  });

  it("opens with four tasks across the range, the first about the vault's top topic", () => {
    expect(starterCards("Liquidity")).toEqual([
      { icon: "ask", title: "Ask your notes", prompt: "What does the vault say about Liquidity?" },
      { icon: "work", title: "Plan a project", prompt: "Help me plan a new project" },
      { icon: "contradictions", title: "Find disagreements", prompt: "Where do my notes disagree?" },
      { icon: "clock", title: "Catch up", prompt: "What changed in the vault this week?" },
    ]);
    expect(starterCards(null)[0].prompt).toBe("What are the main ideas in this vault?");
  });
});

describe("under the empty composer", () => {
  const render = (seen: boolean) =>
    renderToStaticMarkup(
      <ChatStarters topic="Liquidity" onAsk={noop} onHelp={noop} seen={seen}>
        <span>#Liquidity</span>
      </ChatStarters>,
    );

  it("shows the four tasks as buttons with their prompts, then the topics", () => {
    const t = text(render(false));
    expect(t).toContain("Ask your notes “What does the vault say about Liquidity?” Plan a project “Help me plan a new project” Find disagreements “Where do my notes disagree?” Catch up “What changed in the vault this week?” #Liquidity");
    expect(render(false).match(/<button/g)).toHaveLength(5); // four tasks and the link
  });

  it("invites a newcomer to the whole list, and quietly offers it to everyone else", () => {
    expect(text(render(false))).toMatch(/New here\? See what the chat can do$/);
    expect(text(render(true))).toMatch(/What can the chat do\?$/);
    expect(text(render(true))).not.toContain("New here");
  });
});

describe("the whole list", () => {
  const html = renderToStaticMarkup(<ChatHelpPanel topic="Liquidity" onAsk={noop} onClose={noop} />);

  it("is a labelled dialog with a close button", () => {
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="[^"]+"/);
    expect(html).toContain('aria-label="Close"');
    expect(text(html)).toMatch(/^What the chat can do Ask in your own words — these are only examples\. Pick one to try it\./);
  });

  it("lists every ability with its examples to try, and says the chat changes nothing on its own", () => {
    const t = text(html);
    for (const a of chatAbilities("Liquidity")) {
      expect(t).toContain(a.title);
      for (const q of a.examples) expect(t).toContain(q);
    }
    expect(t).toMatch(/The chat changes nothing on its own: changes to your work come as a card you review, and only Apply saves them\.$/);
  });
});
