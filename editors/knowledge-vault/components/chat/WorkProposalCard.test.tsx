/**
 * The card under an answer that proposed changes to work, in each state:
 * waiting for the person's word, applying, applied, stopped partway, refused
 * outright, and cancelled.
 */
import "../../../shared/test/browser-globals.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProposalState } from "../../hooks/use-work-proposal.js";
import type { EditingState } from "./WorkProposalCard.js";

vi.mock("@powerhousedao/reactor-browser", () => ({
  setSelectedNode: () => {},
  useSelectedDriveId: () => "drive-1",
  dispatchActions: vi.fn(),
}));

const { WorkProposalView, scopesDeletedBy } = await import("./WorkProposalCard.js");
const { checkProposal, formToChanges, SCOPE_TYPE, WBS_TYPE } = await import("../../lib/chat/work-changes.js");
const { linkedWorkDocs, loadedWorkDocs } = await import("../../lib/chat/test/work-fixtures.js");

const checked = checkProposal(
  {
    summary: "Close the Build branch and start operations.",
    changes: [
      { kind: "create_scope", ref: "new:ops", title: "Operations 2027" },
      { kind: "operation", document: "scope-1", type: "UPDATE_PROJECT", input: { id: "proj-kv", title: "Vault" } },
      { kind: "operation", document: "wbs-1", type: "DELETE_GOAL", input: { id: "g-b" } },
    ],
  },
  loadedWorkDocs(),
  () => "2026-10-15T12:00:00.000Z",
  () => "p-card",
);
if (!checked.ok) throw new Error(checked.errors.join(" | "));
const proposal = checked.proposal;

const noop = () => {};
const view = (state: ProposalState) =>
  renderToStaticMarkup(<WorkProposalView proposal={proposal} state={state} onApply={noop} onCancel={noop} onReopen={noop} onOpen={noop} />);
/** The card's words, tags stripped. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const at = "2026-10-15T12:01:00.000Z";

describe("the proposal card", () => {
  it("waits for the person: what the chat proposes, each change in a sentence, what the removal takes with it, and two buttons", () => {
    const html = view({ phase: "pending" });
    expect(html).toMatch(/<section aria-labelledby="[^"]+"/);
    expect(words(html)).toBe(
      [
        "Proposed changes to your work 3 changes",
        "Close the Build branch and start operations.",
        "1 Create scope of work “Operations 2027” in /projects",
        "2 Update project KV “Knowledge Vault”: title → “Vault”",
        "3 ⚠ Delete goal “Build” also deletes the 1 goal beneath it",
        "Nothing changes until you apply. One of them removes something, marked ⚠.",
        "Cancel Apply 3 changes",
      ].join(" "),
    );
  });

  it("while applying, ticks what is made, marks what is being made, and offers no button", () => {
    const html = view({ phase: "applying", from: 1, to: 2 });
    expect(words(html)).toContain("Applying changes 2–3 of 3…");
    expect(html).toContain('aria-label="done"');
    expect(html.match(/aria-label="in progress"/g)).toHaveLength(2);
    expect(html).not.toContain("<button");
  });

  it("once applied, says so and opens what was made and changed, by title", () => {
    const html = view({
      phase: "settled",
      outcome: {
        status: "applied",
        results: [{ status: "done" }, { status: "done" }, { status: "done" }],
        created: [{ documentId: "doc-1", documentType: SCOPE_TYPE, title: "Operations 2027" }],
        touched: [
          { documentId: "scope-1", documentType: SCOPE_TYPE, title: "Powerhouse 2026" },
          { documentId: "wbs-1", documentType: WBS_TYPE, title: "Knowledge Vault breakdown" },
        ],
        at,
      },
    });
    const text = words(html);
    expect(text).toContain("✓ Applied all 3 changes.");
    expect(text).toContain("Open “Operations 2027” Open “Powerhouse 2026” Open “Knowledge Vault breakdown”");
    expect(html.match(/aria-label="done"/g)).toHaveLength(3);
    expect(text).not.toContain("Apply 3 changes");
  });

  it("when stopped partway, says which change stopped it, why, and what was made", () => {
    const text = words(
      view({
        phase: "settled",
        outcome: {
          status: "partial",
          results: [{ status: "done" }, { status: "failed", error: "You don't have permission to change this vault. Ask its administrator for write access." }, { status: "skipped" }],
          created: [{ documentId: "doc-1", documentType: SCOPE_TYPE, title: "Operations 2027" }],
          touched: [],
          at,
        },
      }),
    );
    expect(text).toContain("✓ Create scope of work “Operations 2027” in /projects ✗ Update project KV “Knowledge Vault”: title → “Vault” You don't have permission to change this vault. Ask its administrator for write access. 3 ⚠ Delete goal “Build”");
    expect(text).toContain("Stopped at change 2. Change 1 was made; the rest were not. Open “Operations 2027”");
  });

  it("when the first change is refused, says nothing was changed", () => {
    const text = words(
      view({
        phase: "settled",
        outcome: { status: "failed", results: [{ status: "failed", error: "No answer from the vault yet." }, { status: "skipped" }, { status: "skipped" }], created: [], touched: [], at },
      }),
    );
    expect(text).toContain("Stopped at change 1. Nothing was changed.");
  });

  it("once cancelled, says nothing changed, and can still be applied", () => {
    const text = words(view({ phase: "settled", outcome: { status: "cancelled", results: [], created: [], touched: [], at } }));
    expect(text).toContain("Cancelled — nothing was changed. Apply after all");
  });

  it("words a single change, and a proposal that removes nothing, without filler", () => {
    const one = checkProposal({ summary: "Add a deliverable.", changes: [{ kind: "operation", document: "scope-1", type: "REMOVE_DELIVERABLE", input: { id: "del-1" } }] }, loadedWorkDocs());
    if (!one.ok) throw new Error(one.errors.join());
    const html = renderToStaticMarkup(<WorkProposalView proposal={one.proposal} state={{ phase: "pending" }} onApply={noop} onCancel={noop} onReopen={noop} onOpen={noop} />);
    expect(words(html)).toContain("Proposed changes to your work 1 change");
    expect(words(html)).toContain("Nothing changes until you apply. It removes something, marked ⚠. Cancel Apply 1 change");
    // "a deletion" is said by the mark alone, not repeated under the line.
    expect(words(html)).not.toContain("a deletion");
  });
});

describe("editing on the card", () => {
  const form = {
    summary: "Set up operations.",
    scopes: [{ ref: "new:ops", title: "Operations 2027" }],
    projects: [{ scope: "new:ops", ref: "new:infra", code: "INF", title: "Infrastructure", owner: "Bob", budgetType: "OPEX" }],
    deletions: ["wbs-1"],
  };
  const checkedForm = checkProposal({ summary: form.summary, changes: formToChanges(form) }, linkedWorkDocs(), () => "t", () => "p-form");
  if (!checkedForm.ok) throw new Error(checkedForm.errors.join(" | "));
  const editable = { ...checkedForm.proposal, form, edited: ["scopes[0]"] };
  const render = (editing: EditingState | null, state: ProposalState = { phase: "pending" }) =>
    renderToStaticMarkup(
      <WorkProposalView proposal={editable} state={state} onApply={noop} onCancel={noop} onReopen={noop} onOpen={noop} editing={editing} onStartEdit={noop} onEditField={noop} onDoneEdit={noop} onCancelEdit={noop} onRemove={noop} />,
    );

  it("offers Edit on every change the model wrote, not on the unlink the checker added, and marks the edited ones", () => {
    const html = render(null);
    expect(html.match(/aria-label="Edit change \d+"/g)).toEqual(['aria-label="Edit change 1"', 'aria-label="Edit change 2"', 'aria-label="Edit change 4"']);
    expect(words(html)).toContain("1 Create scope of work “Operations 2027” in /projects edited");
    expect(words(html)).toContain("Nothing changes until you apply. You can edit any change first. One of them removes something, marked ⚠.");
  });

  it("opens one change in place: its words as fields, Remove · Cancel · Done — and holds Apply until it is done", () => {
    const html = render({ at: "projects[0]", values: { code: "INF", title: "Infrastructure", owner: "Bob", budgetType: "OPEX", currency: "", budget: "" }, error: null, busy: false });
    const text = words(html);
    expect(text).toContain("Code");
    expect(text).toContain("Owner (a person's name) · optional");
    expect(html).toMatch(/<input[^>]*value="Infrastructure"/);
    expect(html).toMatch(/<option value="OPEX" selected="">OPEX<\/option>/);
    expect(text).toContain("Remove this change Cancel Done");
    expect(text).toContain("Finish editing the open change to apply.");
    expect(html).not.toContain('aria-label="Edit change');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply 4 changes<\/button>/);
  });

  it("shows why an edit was refused, and Checking… while it is checked", () => {
    expect(words(render({ at: "scopes[0]", values: { title: "x", description: "" }, error: "The scope has no title.", busy: false }))).toContain("The scope has no title.");
    expect(words(render({ at: "scopes[0]", values: { title: "x", description: "" }, error: null, busy: "checking" }))).toContain("Remove this change Cancel Checking…");
  });

  it("offers nothing to edit in a deletion, only taking it out", () => {
    expect(words(render({ at: "deletions[0]", values: {}, error: null, busy: false }))).toContain("Nothing to edit in this change — you can take it out of the proposal. Remove this change Cancel");
  });

  it("offers no editing once applied, or for a proposal without its form", () => {
    expect(render(null, { phase: "settled", outcome: { status: "cancelled", results: [], created: [], touched: [], at: "t" } })).not.toContain("Edit change");
    expect(renderToStaticMarkup(<WorkProposalView proposal={proposal} state={{ phase: "pending" }} onApply={noop} onCancel={noop} onReopen={noop} onOpen={noop} onStartEdit={noop} />)).not.toContain("Edit change");
  });

  it("names the scopes a proposal deletes whole — what the person types to confirm", () => {
    const r = checkProposal({ summary: "x", changes: formToChanges({ deletions: [{ document: "scope-1" }, { document: "wbs-1" }] }) }, loadedWorkDocs());
    expect(r.ok && scopesDeletedBy(r.proposal)).toEqual(["Powerhouse 2026"]);
  });
});
