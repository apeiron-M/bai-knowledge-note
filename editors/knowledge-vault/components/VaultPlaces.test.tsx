import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildPlaces, PLACE_VIEW, RENDERED_VIEWS } from "./DriveExplorer.js";
import { PLACE_SECTION, VaultPlaces } from "./VaultPlaces.js";
import { sidebarBody } from "./VaultSidebar.js";

const noop = () => {};

describe("VaultPlaces", () => {
  it("lists the places in the design's order, with the vault's words and an icon each", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces
        places={[
          { id: "ask", label: "Ask" },
          { id: "notes", label: "Notes", count: 217 },
          { id: "topics", label: "Topics", count: 18 },
          { id: "sources", label: "Sources", count: 98 },
          { id: "work", label: "Work", count: 9 },
          { id: "graph", label: "Graph" },
          { id: "contradictions", label: "Contradictions", count: 2, tone: "warn" },
        ]}
        active="notes"
        onSelect={noop}
      />,
    );
    expect([...html.matchAll(/data-place="([a-z]+)"/g)].map((m) => m[1])).toEqual(
      ["ask", "notes", "topics", "sources", "work", "graph", "contradictions"],
    );
    expect(html.match(/<svg/g)).toHaveLength(7);
    expect(html).not.toMatch(/MOCs|Signals|Tree/);
    expect(html).toContain("217");
    expect(html).toMatch(/data-place="notes"[^>]*aria-current="page"/);
  });

  it("omits a count of zero rather than showing a bare 0", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces places={[{ id: "topics", label: "Topics", count: 0 }]} active="ask" onSelect={noop} />,
    );
    expect(html).toContain("Topics");
    expect(html).not.toContain(">0<");
  });

  it("renders no rows at all when the vault has no places yet", () => {
    const html = renderToStaticMarkup(<VaultPlaces places={[]} active="ask" onSelect={noop} />);
    expect(html).not.toContain("data-place=");
  });

  it("marks only a warn count as one, and says what it counts", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces
        places={[
          { id: "notes", label: "Notes", count: 3 },
          { id: "sources", label: "Sources", count: 2, tone: "warn", countTitle: "2 files waiting for your review", busy: true },
        ]}
        active="ask"
        onSelect={noop}
      />,
    );
    expect(html.match(/data-tone="warn"/g)).toHaveLength(1);
    expect(html).toContain('title="2 files waiting for your review"');
    expect(html).toContain("vault-place-busy");
  });

  it("folds into one row of icons: every place still there, the current one marked", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces
        places={[
          { id: "ask", label: "Ask" },
          { id: "sources", label: "Sources", count: 98 },
          { id: "graph", label: "Graph" },
        ]}
        active="sources"
        onSelect={noop}
        variant="icons"
      />,
    );
    expect([...html.matchAll(/data-place-icon="([a-z]+)"/g)].map((m) => m[1])).toEqual(["ask", "sources", "graph"]);
    expect(html).toMatch(/aria-label="Sources"[^>]*aria-current="page"|aria-current="page"[^>]*aria-label="Sources"/);
    expect(html).not.toContain("data-place=");
    expect(html).not.toContain("98");
  });

  it("maps every place to the sidebar body that shows when nothing overrides it", () => {
    expect(PLACE_SECTION).toEqual({
      ask: "none",
      notes: "notes",
      topics: "topics",
      sources: "sources",
      work: "work",
      graph: "graph",
      contradictions: "contradictions",
    });
  });

  it("builds no place that points at a view with no render branch", () => {
    const places = buildPlaces({ notes: 1, topics: 1, sources: 1, work: 1, contradictions: 1 });
    expect(places.map((p) => p.id)).toEqual(["ask", "notes", "topics", "sources", "work", "graph"]);
    for (const place of places) {
      const view = PLACE_VIEW[place.id];
      expect(view).toBeDefined();
      expect(RENDERED_VIEWS).toContain(view);
    }
  });

  it("puts files waiting for review before the plain source count, as the old tab did", () => {
    const counts = { notes: 1, topics: 1, sources: 98, work: 0, contradictions: 0 };
    const waiting = buildPlaces({ ...counts, sourcesWaiting: 3, sourcesBusy: true }).find((p) => p.id === "sources");
    expect(waiting).toMatchObject({ count: 3, tone: "warn", busy: true, countTitle: "3 files waiting for your review" });
    const plain = buildPlaces(counts).find((p) => p.id === "sources");
    expect(plain).toMatchObject({ count: 98 });
    expect(plain?.tone).toBeUndefined();
  });

  it("decides the sidebar body in one place: context, then tree, then the places alone", () => {
    expect(sidebarBody(true, true)).toBe("context");
    expect(sidebarBody(true, false)).toBe("context");
    expect(sidebarBody(false, true)).toBe("folders");
    expect(sidebarBody(false, false)).toBe("places");
  });
});
