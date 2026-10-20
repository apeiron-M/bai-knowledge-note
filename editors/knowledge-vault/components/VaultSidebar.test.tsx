import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { VaultContextListProps } from "./VaultContextList.js";
import { RAIL_BELOW, sidebarMode, VaultSidebar } from "./VaultSidebar.js";

vi.mock("@powerhousedao/reactor-browser", () => ({
  isFileNodeKind: () => false,
  setSelectedNode: () => {},
  useNodesInSelectedDrive: () => [],
  useSelectedNode: () => undefined,
}));

const places = [
  { id: "sources" as const, label: "Sources", count: 2 },
  { id: "topics" as const, label: "Topics", count: 1 },
  { id: "graph" as const, label: "Graph" },
];

function context(place: VaultContextListProps["place"]): VaultContextListProps {
  return {
    place,
    title: "Current",
    subtitle: "2 items",
    items: [
      { id: "x1", label: "First" },
      { id: "x2", label: "Second" },
    ],
    activeId: "x2",
    onOpen: () => {},
    onBack: () => {},
  };
}

function render(ctx?: VaultContextListProps) {
  return renderToStaticMarkup(
    <VaultSidebar
      notes={[]}
      places={places}
      place="sources"
      context={ctx}
      onSelectPlace={() => {}}
      vaultName="Liberuum"
      glyphSeeds={["t1", "t2"]}
      menuItems={[{ key: "config", label: "Vault settings", icon: "gear" }]}
      onMenuSelect={() => {}}
      onSearch={() => {}}
      onAddSources={() => {}}
      createItems={[{ key: "note", label: "Write a note", icon: "pencil" }]}
      onCreate={() => {}}
      onGettingStarted={() => {}}
    />,
  );
}

describe("VaultSidebar", () => {
  it("holds what the bar above the content used to: the vault, search, adding, settings and the guide", () => {
    const html = render();
    expect(html).toContain("Liberuum");
    expect(html).toContain("vault-glyph");
    expect(html).toContain(">Search<");
    expect(html).toContain(">Add sources<");
    expect(html).toContain('aria-label="More to add"');
    expect(html).toContain(">Vault settings<");
    expect(html).toContain(">Getting started<");
    expect(html).toContain('data-mode="full"');
  });

  it.each(["sources", "topics", "graph"] as const)(
    "shows a %s context as the list, with the places folded into one row of icons above it",
    (place) => {
      const html = render(context(place));
      expect(html).toContain('role="listbox"');
      expect(html).toContain("First");
      expect(html).toContain('data-place-icon="sources"');
      expect(html).not.toMatch(/<button[^>]*\sdata-place="/);
    },
  );

  it("shows the labelled places alone once there is no context", () => {
    const html = render(undefined);
    expect(html).toMatch(/<button[^>]*\sdata-place="sources"/);
    expect(html).not.toMatch(/<button[^>]*\sdata-place-icon=/);
    expect(html).not.toContain('role="listbox"');
  });

  it("is the icon rail when collapsed, or when the frame is too narrow for two columns", () => {
    expect(sidebarMode(1400, false)).toBe("full");
    expect(sidebarMode(1400, true)).toBe("rail");
    expect(sidebarMode(RAIL_BELOW - 1, false)).toBe("rail");
    expect(sidebarMode(RAIL_BELOW, false)).toBe("full");
    // Not measured yet (or nothing laid out): the full sidebar.
    expect(sidebarMode(0, false)).toBe("full");
  });
});
