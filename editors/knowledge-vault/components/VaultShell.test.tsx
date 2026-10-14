import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VaultShell } from "./VaultShell.js";

describe("VaultShell", () => {
  it("names the vault in the host bar", () => {
    const html = renderToStaticMarkup(
      <VaultShell title="Liberuum" barControls={<button>All sources read</button>}>
        <p>content</p>
      </VaultShell>,
    );
    expect(html).toContain('class="vault-hostbar"');
    expect(html).toContain("Liberuum");
    expect(html).toContain("content");
  });

  it("takes the sidebar width from the sidebar, not from itself", () => {
    const html = renderToStaticMarkup(
      <VaultShell title="V" sidebar={<nav>rail</nav>} sidebarWidth={312}>
        <p>c</p>
      </VaultShell>,
    );
    // React serializes inline styles without the space after the colon.
    expect(html).toContain("--vault-sidebar-w:312px");
    // Omitted entirely when the sidebar owns the column (see Step 3).
    const owned = renderToStaticMarkup(
      <VaultShell title="V" sidebar={<nav>rail</nav>} sidebarHidden>
        <p>c</p>
      </VaultShell>,
    );
    expect(owned).not.toContain("--vault-sidebar-w");
  });

  it("gives the hosted editor's rail its own column and top row", () => {
    const html = renderToStaticMarkup(
      <VaultShell title="V" sidebar={<nav>rail</nav>} sidebarHidden>
        <p>c</p>
      </VaultShell>,
    );
    expect(html).toContain("data-vault-hosts-editor");
    expect(html).toContain("--vault-topbar-h");
    // The bar keeps column 2 / row 1 so the editor's rail reaches the top.
    const bar = /<div class="vault-hostbar" style="([^"]*)"/.exec(html)?.[1];
    expect(bar).toContain("grid-column:2;grid-row:1;z-index:5");
    expect(html).toContain("grid-template-columns:var(--sow-rail-w, 0px) minmax(0, 1fr)");
    // The content spans every cell and opens no stacking context.
    const content = /<div class="relative min-w-0 overflow-hidden" style="([^"]*)"/.exec(html)?.[1];
    expect(content).toBe("grid-column:1 / -1;grid-row:1 / -1");
  });

  it("spans the bar across both columns when the vault owns the sidebar", () => {
    const html = renderToStaticMarkup(
      <VaultShell title="V" sidebar={<nav>rail</nav>}>
        <p>c</p>
      </VaultShell>,
    );
    expect(html).not.toContain("data-vault-hosts-editor");
    expect(html).toContain("grid-column:1 / -1;grid-row:1");
  });

  it("lifts the hosted bar above the editor's layers while a menu is open", () => {
    const html = renderToStaticMarkup(
      <VaultShell title="V" sidebarHidden settingsOpen>
        <p>c</p>
      </VaultShell>,
    );
    expect(html).toContain("grid-column:2;grid-row:1;z-index:40");
  });
});
