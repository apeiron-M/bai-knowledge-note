import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildPlaces, PLACE_VIEW, RENDERED_VIEWS } from "./DriveExplorer.js";
import { PLACE_SECTION, VaultPlaces } from "./VaultPlaces.js";
import { sidebarBody } from "./VaultSidebar.js";

describe("VaultPlaces", () => {
  it("lists the places in the design's order, with the vault's words", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces
        places={[
          { id: "ask", label: "Ask" },
          { id: "notes", label: "Notes", count: 217 },
          { id: "topics", label: "Topics", count: 18 },
          { id: "sources", label: "Sources", count: 98 },
          { id: "work", label: "Work", count: 9 },
          { id: "graph", label: "Graph" },
          {
            id: "contradictions",
            label: "Contradictions",
            count: 2,
            tone: "warn",
          },
        ]}
        active="notes"
        onSelect={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect([...html.matchAll(/data-place="([a-z]+)"/g)].map((m) => m[1])).toEqual(
      ["ask", "notes", "topics", "sources", "work", "graph", "contradictions"],
    );
    expect(html).not.toMatch(/MOCs|Signals|Tree/);
    expect(html).toContain("217");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Vault settings");
  });

  it("omits a count of zero rather than showing a bare 0", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces
        places={[{ id: "topics", label: "Topics", count: 0 }]}
        active="ask"
        onSelect={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(html).toContain("Topics");
    expect(html).not.toContain(">0<");
  });

  it("renders no rows at all when the vault has no places yet", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces
        places={[]}
        active="ask"
        onSelect={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(html).not.toContain("data-place=");
    expect(html).toContain("Vault settings");
  });

  it("colours a warn count with the warning token, and no other", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces
        places={[
          { id: "notes", label: "Notes", count: 3 },
          { id: "contradictions", label: "Contradictions", count: 2, tone: "warn" },
        ]}
        active="ask"
        onSelect={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(html.match(/color:var\(--bai-warn\)/g)).toHaveLength(1);
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
    const places = buildPlaces({
      notes: 1,
      topics: 1,
      sources: 1,
      work: 1,
      contradictions: 1,
    });
    expect(places.map((p) => p.id)).toEqual([
      "ask",
      "notes",
      "topics",
      "sources",
      "work",
      "graph",
    ]);
    for (const place of places) {
      const view = PLACE_VIEW[place.id];
      expect(view).toBeDefined();
      expect(RENDERED_VIEWS).toContain(view);
    }
  });

  it("decides the sidebar body in one place: context, then tree, then the places alone", () => {
    expect(sidebarBody(true, true)).toBe("context");
    expect(sidebarBody(true, false)).toBe("context");
    expect(sidebarBody(false, true)).toBe("folders");
    expect(sidebarBody(false, false)).toBe("places");
  });

  it("keeps the drive tree reachable from the sidebar", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces
        places={[]}
        active="ask"
        onSelect={() => {}}
        onOpenSettings={() => {}}
        tree={{ active: false, onOpen: () => {} }}
      />,
    );
    expect(html).toContain("data-tree");
    expect(html).toContain(">Tree<");
  });

  it("marks the tree row current while the tree is open", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces
        places={[]}
        active="ask"
        onSelect={() => {}}
        onOpenSettings={() => {}}
        tree={{ active: true, onOpen: () => {} }}
      />,
    );
    expect(html).toMatch(/data-tree[^>]*aria-current="page"/);
  });

  it("shows no tree row unless the sidebar passes one", () => {
    const html = renderToStaticMarkup(
      <VaultPlaces
        places={[]}
        active="ask"
        onSelect={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(html).not.toContain("data-tree");
  });
});
