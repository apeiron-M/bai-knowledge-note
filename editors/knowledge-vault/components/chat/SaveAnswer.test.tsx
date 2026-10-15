import "../../../shared/test/browser-globals.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AnswerDraft } from "../../lib/chat/save-answer.js";
import type { SaveOptions, SaveState } from "../../hooks/use-save-answer.js";
import type { TopicMapRow } from "../../lib/chat/vault-structure.js";

vi.mock("@powerhousedao/reactor-browser", () => ({
  useRenownAuth: () => ({ address: "0xadbA7C2F82139031D7564D18aC22D09B12A0BcA4", ensName: "liberuum.eth" }),
  setSelectedNode: vi.fn(),
  dispatchActions: vi.fn(),
}));

const { SaveAnswer, SaveAnswerForm } = await import("./SaveAnswer.js");

const draft: AnswerDraft = {
  title: "Large-frame turbine orders exceed build capacity",
  description: "Backlogs of 220 GW sit against a build rate of 60–70 GW a year.",
  kind: "CONCEPT",
  topics: [],
  content: "Orders exceed capacity [[Turbine note]].",
  links: [
    {
      documentId: "n1",
      title: "Turbine note",
      documentType: "bai/knowledge-note",
      linkType: "BUILDS_ON",
      reason: "The saved chat answer cites it for: “Orders exceed capacity”",
      confidence: "grounded",
      include: true,
    },
    {
      documentId: "s1",
      title: "State of AI 2026 — Part 3",
      documentType: "bai/source",
      linkType: "DERIVED_FROM",
      reason: "The saved chat answer cites it for: “buyers reserve slots”",
      confidence: "speculative",
      include: false,
    },
  ],
  maps: [],
  notLinked: [{ documentId: "t1", title: "Contradiction on turbines", documentType: "bai/tension" }],
};
const map = (documentId: string, title: string, depth: number): TopicMapRow => ({
  documentId,
  title,
  documentType: "bai/moc",
  tier: depth === 0 ? "HUB" : "TOPIC",
  depth,
  parentId: null,
  notes: 3,
  notesBeneath: 3,
  childMaps: 0,
  description: null,
});
const options: SaveOptions = {
  maps: [map("hub", "My Vault", 0), map("power", "AI Data Center Power", 1)],
  suggestedTopics: ["energy", "AI compute"],
  loading: false,
};
const idle: SaveState = { status: "idle" };
const noop = () => {};

function form(over: Partial<Parameters<typeof SaveAnswerForm>[0]> = {}) {
  return renderToStaticMarkup(
    <SaveAnswerForm
      draft={draft}
      onDraft={noop}
      topicsText=""
      onTopicsText={noop}
      mapId=""
      onMapId={noop}
      options={options}
      state={idle}
      touched={false}
      onSubmit={noop}
      onClose={noop}
      {...over}
    />,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Save as note, closed", () => {
  it("is one quiet button under the answer", () => {
    const html = renderToStaticMarkup(
      <SaveAnswer message={{ role: "assistant", content: "A claim." }} question="q" driveId="drive-1" threadId="t-1" />,
    );
    expect(text(html).trim()).toBe("Save as note");
    expect(html).toMatch(/^<div class="mt-3"><button type="button"/);
  });
});

describe("Save as note, open", () => {
  it("asks for the claim and a description, with the limit counted as you type", () => {
    const html = form();
    expect(html).toContain(">Save this answer as a note<");
    expect(html).toContain("A note holds one claim. Make the title say exactly the one thing worth keeping.");
    expect(html).toMatch(/<label[^>]*>Claim<\/label>/);
    expect(html).toContain(">Large-frame turbine orders exceed build capacity</textarea>");
    expect(html).toContain(`>${draft.description.length}/200<`);
    expect(html).toContain("What the claim leaves out. Search and the chat read it before the body.");
  });

  it("lists each link with what it is and why, and the one left out", () => {
    const t = text(form());
    expect(t).toContain("Links · 1 of 2");
    expect(t).toContain("Builds on Turbine note The saved chat answer cites it for: “Orders exceed capacity”");
    expect(t).toContain("From source State of AI 2026 — Part 3");
    expect(t).toContain("One cited document is named in the text only: Contradiction on turbines.");
  });

  it("offers the cited notes' topics and the vault's maps, indented by depth", () => {
    const html = form();
    expect(html).toContain('aria-label="Add topic energy"');
    expect(html).toContain(">+ #AI compute<");
    expect(html).toContain('<option value="" selected="">Nowhere yet</option>');
    expect(html).toContain('<option value="power"> AI Data Center Power</option>');
  });

  it("says what saving changes, and what it does not, beside the button", () => {
    expect(text(form({ mapId: "power" }))).toContain(
      "Adds one draft note and 1 link, filed under AI Data Center Power. The documents it cites are not edited. Cancel Save note",
    );
  });

  it("marks a description over the limit before anything is sent", () => {
    const html = form({ draft: { ...draft, description: "x".repeat(203) } });
    expect(html).toContain(">203/200<");
    expect(html).toContain("3 characters over the 200 a description can hold.");
    expect(html).toContain('aria-invalid="true"');
  });

  it("asks for the claim once a save was tried without one", () => {
    expect(form({ draft: { ...draft, title: "" }, touched: true })).toContain("Give the note its claim, in one sentence.");
  });

  it("says which step it is on while saving, and cannot be closed or sent twice", () => {
    const html = form({ state: { status: "saving", step: "links" } });
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Linking it…<\/button>/);
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Cancel<\/button>/);
  });

  it("after a failed step, says what happened and opens the note instead of saving a second one", () => {
    const html = form({
      state: {
        status: "done",
        outcome: {
          ok: false,
          step: "links",
          noteId: "note-new",
          error: "The note was saved, but its links to the cited documents did not. No answer from the vault yet.",
        },
      },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain(">Open the note to finish it<");
    // The note exists: no second save is offered, and the footer says why.
    expect(html).not.toContain("Save note");
    expect(html).not.toContain("Try again");
    expect(html).toMatch(/<button type="button"[^>]*>Close<\/button>/);
    expect(text(html)).toContain("The note exists as a draft with what did save. Open it to finish; saving again would make a second note.");
  });

  it("offers to try again when nothing was created", () => {
    const html = form({
      state: { status: "done", outcome: { ok: false, step: "create", noteId: null, error: "The note could not be created." } },
    });
    expect(html).toMatch(/<button type="button"[^>]*>Try again<\/button>/);
    expect(html).not.toContain("Open the note");
  });
});
