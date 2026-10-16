/**
 * The graph's legend is its filter: every entry is a toggle, a hidden one is
 * struck through, and "Show all" appears while anything is hidden.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphLegend } from "./GraphLegend.js";
import {
  EMPTY_GRAPH_FILTER,
  toggleLinkKind,
  toggleNodeKind,
  type GraphFilter,
} from "./model.js";

const noop = () => {};
const legend = (filter: GraphFilter) =>
  renderToStaticMarkup(<GraphLegend filter={filter} onChange={noop} />);
const toggles = (html: string) =>
  [
    ...html.matchAll(
      /<button[^>]*data-kind="([A-Z_]+)" aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g,
    ),
  ].map((m) => ({
    kind: m[1],
    shown: m[2] === "true",
    text: m[3].replace(/<[^>]+>/g, ""),
    struck: m[3].includes("line-through"),
  }));

describe("GraphLegend", () => {
  it("makes every node and link entry a toggle, in the spec's words, all shown", () => {
    const html = legend(EMPTY_GRAPH_FILTER);
    const all = toggles(html);
    expect(all.map((t) => t.kind)).toEqual([
      "DRAFT",
      "IN_REVIEW",
      "CANONICAL",
      "ARCHIVED",
      "MOC",
      "RELATES_TO",
      "BUILDS_ON",
      "CONTRADICTS",
      "SUPERSEDES",
      "DERIVED_FROM",
      "CORE_IDEA",
    ]);
    expect(all.map((t) => t.text)).toEqual([
      "Draft",
      "In review",
      "Canonical",
      "Archived",
      "MOC",
      "relates to",
      "builds on",
      "contradicts",
      "supersedes",
      "derived from",
      "core idea",
    ]);
    expect(all.every((t) => t.shown && !t.struck)).toBe(true);
    expect(html).not.toContain("Show all");
    expect(html).not.toMatch(/cites|delivered by/i);
  });

  it("strikes through what is hidden and offers Show all", () => {
    const filter = toggleLinkKind(
      toggleNodeKind(EMPTY_GRAPH_FILTER, "ARCHIVED"),
      "CORE_IDEA",
    );
    const html = legend(filter);
    const by = new Map(toggles(html).map((t) => [t.kind, t]));
    expect(by.get("ARCHIVED")).toMatchObject({ shown: false, struck: true });
    expect(by.get("CORE_IDEA")).toMatchObject({ shown: false, struck: true });
    expect(by.get("DRAFT")).toMatchObject({ shown: true, struck: false });
    expect(html).toMatch(/<button type="button"[^>]*>Show all<\/button>/);
  });
});
