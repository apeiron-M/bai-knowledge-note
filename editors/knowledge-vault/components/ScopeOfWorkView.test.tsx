/**
 * Deleting a scope of work: the dialog names the work breakdowns that deliver
 * it, with their progress; "Also delete these work breakdowns" starts checked;
 * unchecked, they stay — outside any scope.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeleteScopeBody } from "./ScopeOfWorkView.js";
import { breakdownRow } from "../lib/scope-breakdowns.js";

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
const todo = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, description: "x", status: "TODO", notes: [] }));
const PLAN = breakdownRow("wbs-plan", "Knowledge Vault Go-to-Market Plan", { goals: todo(3), sowRef: "scope-1" });
const WORKED = breakdownRow("wbs-done", "Launch", {
  goals: [
    { id: "a", description: "x", status: "COMPLETED", notes: [{ id: "n1", note: "shipped" }] },
    { id: "b", description: "y", status: "COMPLETED", notes: [] },
  ],
  sowRef: "scope-1",
});
const body = (breakdowns = [PLAN], alsoDelete = true) =>
  renderToStaticMarkup(<DeleteScopeBody breakdowns={breakdowns} alsoDelete={alsoDelete} onAlsoDelete={noop} />);

describe("the dialog for deleting a scope of work", () => {
  it("lists the breakdowns that deliver it, each with its progress", () => {
    expect(text(body())).toContain("Knowledge Vault Go-to-Market Plan — 3 goals, none done");
  });

  it("has the checkbox, checked by default", () => {
    const html = body();
    expect(html).toMatch(/<input type="checkbox" checked=""/);
    expect(text(html)).toContain("Also delete these work breakdowns");
  });

  it("says what recorded work would go while checked", () => {
    expect(text(body([PLAN, WORKED]))).toContain("2 goals done and 1 note would be deleted with them.");
    expect(text(body([PLAN]))).not.toContain("would be deleted");
  });

  it("says they stay, outside any scope, when unchecked", () => {
    const html = body([PLAN, WORKED], false);
    expect(html).not.toMatch(/<input type="checkbox" checked=""/);
    expect(text(html)).toContain("They stay, outside any scope.");
    expect(text(html)).not.toContain("would be deleted");
  });

  it("names neither list nor checkbox when nothing delivers the scope", () => {
    const html = body([]);
    expect(html).not.toContain('type="checkbox"');
    expect(text(html)).toContain("This deletes the whole scope of work");
  });
});
