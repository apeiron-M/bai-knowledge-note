import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VaultShell } from "./VaultShell.js";

describe("VaultShell", () => {
  it("draws no bar above the content: the sidebar and the content share the frame", () => {
    const html = renderToStaticMarkup(
      <VaultShell sidebar={<nav>rail</nav>}>
        <p>content</p>
      </VaultShell>,
    );
    expect(html).not.toContain("vault-hostbar");
    expect(html).not.toContain("--vault-topbar-h");
    expect(html).toContain('class="vault-sidebar-col"');
    expect(html).toContain("rail");
    expect(html).toContain("content");
    expect(html).toContain("grid-template-columns:auto minmax(0, 1fr)");
  });

  it("takes the sidebar width from the sidebar, and leaves it to CSS until the sidebar says", () => {
    const set = renderToStaticMarkup(
      <VaultShell sidebar={<nav>rail</nav>} sidebarWidth={312}>
        <p>c</p>
      </VaultShell>,
    );
    expect(set).toContain("--vault-sidebar-w:312px");
    const untouched = renderToStaticMarkup(
      <VaultShell sidebar={<nav>rail</nav>}>
        <p>c</p>
      </VaultShell>,
    );
    expect(untouched).not.toContain("--vault-sidebar-w");
  });

  it("gives a hosted editor the whole frame: its own rail reaches the top", () => {
    const html = renderToStaticMarkup(
      <VaultShell sidebar={<nav>rail</nav>} sidebarHidden>
        <p>editor</p>
      </VaultShell>,
    );
    expect(html).toContain("data-vault-hosts-editor");
    expect(html).not.toContain("vault-sidebar-col");
    expect(html).not.toContain(">rail<");
    expect(html).toContain("grid-template-columns:minmax(0, 1fr)");
  });
});
