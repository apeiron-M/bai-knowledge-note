/**
 * The add-link form: no manual entry — a target is a document of this vault,
 * chosen from a list or by a pasted id — and Add stays asleep until there is
 * a target and a reason.
 */
import "../../shared/test/browser-globals.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddLinkForm, type TargetFinder } from "./links-section.js";
import type { LinkCandidate } from "../lib/link-targets.js";

const noop = () => {};
const SOURCE: LinkCandidate = { id: "src-3", title: "Chapter 3 Hardware", kind: "source" };
const targets: TargetFinder = { candidates: () => [SOURCE], pasted: () => null };
const form = (selected: LinkCandidate | null = null) =>
  renderToStaticMarkup(<AddLinkForm targets={targets} onAdd={noop} onCancel={noop} initialSelected={selected} />);
const addButton = (html: string) => /<button[^>]*>Add<\/button>/.exec(html)?.[0] ?? "";

describe("adding a link", () => {
  it("has no manual entry: the target is chosen from the vault", () => {
    const html = form();
    expect(html).not.toContain("Manual entry");
    expect(html).not.toContain("Document PHID");
    expect(html).not.toContain("Link title");
    expect(html).toContain("Search notes by title, or paste an id");
    expect(html).toContain("Chapter 3 Hardware · source");
  });

  it("keeps Add disabled until a document is chosen and a reason is written", () => {
    expect(addButton(form())).toContain('disabled=""');
    const chosen = form(SOURCE);
    expect(chosen).toContain("Chapter 3 Hardware · source");
    expect(addButton(chosen)).toContain('disabled=""');
    expect(addButton(chosen)).toContain("Say why this link exists first");
  });
});
