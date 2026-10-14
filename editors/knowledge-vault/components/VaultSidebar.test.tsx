import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { VaultContextListProps } from "./VaultContextList.js";
import { VaultSidebar } from "./VaultSidebar.js";

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
      onOpenSettings={() => {}}
    />,
  );
}

describe("VaultSidebar body", () => {
  it.each(["sources", "topics", "graph"] as const)(
    "shows a %s context as the list, in place of the places rail",
    (place) => {
      const html = render(context(place));
      expect(html).toContain('role="listbox"');
      expect(html).toContain("First");
      expect(html).not.toContain("data-place=");
    },
  );

  it("draws no legacy body once there is no context: the places rail alone", () => {
    const html = render(undefined);
    expect(html).toContain('data-place="sources"');
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toMatch(/class="[^"]*sidebar-row/);
    expect(html).not.toContain("No knowledge notes yet");
  });
});
