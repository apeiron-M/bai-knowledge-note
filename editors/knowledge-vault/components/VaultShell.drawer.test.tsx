import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAWER_BELOW, VaultShell, isDrawerWidth } from "./VaultShell.js";
import { VaultSidebar } from "./VaultSidebar.js";

vi.mock("@powerhousedao/reactor-browser", () => ({
  isFileNodeKind: () => false,
  setSelectedNode: () => {},
  useNodesInSelectedDrive: () => [],
  useSelectedNode: () => undefined,
  useSelectedDrive: () => [undefined],
}));

const places = [
  { id: "ask" as const, label: "Ask" },
  { id: "notes" as const, label: "Notes", count: 338 },
  { id: "graph" as const, label: "Graph" },
];

describe("the vault on a phone", () => {
  // The frame is measured after paint; the first render guesses from the window, so a phone never paints the column first.
  beforeEach(() => vi.stubGlobal("window", { innerWidth: 390 }));
  afterEach(() => vi.unstubAllGlobals());

  it("is a phone below the drawer width, and an unmeasured frame is not", () => {
    expect(isDrawerWidth(390)).toBe(true);
    expect(isDrawerWidth(DRAWER_BELOW - 1)).toBe(true);
    expect(isDrawerWidth(DRAWER_BELOW)).toBe(false);
    expect(isDrawerWidth(0)).toBe(false);
  });

  it("gives the content the whole width and keeps the sidebar out of the page until the button opens it", () => {
    const html = renderToStaticMarkup(
      <VaultShell sidebar={<nav>places</nav>}>
        <p>content</p>
      </VaultShell>,
    );
    expect(html).not.toContain('class="vault-sidebar-col"');
    expect(html).toContain("grid-template-columns:minmax(0, 1fr)");
    expect(html).toContain('aria-label="Open the menu"');
    expect(html).toContain('aria-expanded="false"');
    // Closed, nothing of it is in the page: no tour, focus or measurement can find it.
    expect(html).not.toContain('id="vault-drawer"');
    expect(html).not.toContain(">places<");
    expect(html).toContain("data-drawer");
    expect(html).toContain("--vault-menu-gap: 40px");
  });

  it("keeps no button when a hosted editor has taken the frame", () => {
    const html = renderToStaticMarkup(
      <VaultShell sidebar={<nav>places</nav>} sidebarHidden>
        <p>content</p>
      </VaultShell>,
    );
    expect(html).not.toContain("Open the menu");
    expect(html).not.toContain('id="vault-drawer"');
  });

  it("shows the whole sidebar in the open drawer, with a close button instead of the rail's", () => {
    const html = renderToStaticMarkup(
      <VaultShell
        defaultDrawerOpen
        sidebar={
          <VaultSidebar
            notes={[]}
            places={places}
            place="ask"
            onSelectPlace={() => {}}
            vaultName="Liberuum"
            recentChats={[{ id: "c1", title: "What did the book say about upsells?" }]}
            onOpenChat={() => {}}
          />
        }
      >
        <p>content</p>
      </VaultShell>,
    );
    expect(html).toMatch(/id="vault-drawer"[^>]*role="dialog"[^>]*aria-modal="true"/);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-mode="full"');
    expect(html).toContain('aria-label="Close the menu"');
    expect(html).not.toContain("Collapse the sidebar");
    expect(html).not.toContain('class="sidebar-resize-handle');
    expect(html).toContain("Recent chats");
    expect(html).toContain("What did the book say about upsells?");
  });
});

describe("the vault on a wider screen", () => {
  it("keeps the sidebar column and no menu button", () => {
    vi.stubGlobal("window", { innerWidth: 1280 });
    const html = renderToStaticMarkup(
      <VaultShell sidebar={<nav>places</nav>}>
        <p>content</p>
      </VaultShell>,
    );
    vi.unstubAllGlobals();
    expect(html).toContain('class="vault-sidebar-col"');
    expect(html).not.toContain("Open the menu");
  });
});
