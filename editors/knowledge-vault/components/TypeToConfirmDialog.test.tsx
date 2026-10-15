/**
 * The confirmation for deleting a whole document: the button wakes only when
 * the person has typed its name.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TypeToConfirmPanel, namesIt } from "./TypeToConfirmDialog.js";

const noop = () => {};
const panel = (typed: string, extra: { busy?: boolean; error?: string } = {}) =>
  renderToStaticMarkup(
    <TypeToConfirmPanel
      title="Delete “Vault operations 2027”?"
      name="Vault operations 2027"
      nameLabel="the scope's title"
      confirmLabel="Delete scope of work"
      busyLabel="Deleting…"
      onConfirm={noop}
      onCancel={noop}
      initialTyped={typed}
      {...extra}
    >
      <p>This deletes the whole scope of work.</p>
    </TypeToConfirmPanel>,
  );
const confirmButton = (html: string) => /<button type="submit"[^>]*>[^<]*<\/button>/.exec(html)?.[0] ?? "";

describe("typing the name to confirm", () => {
  it("matches the same words, whatever their case or spacing — and nothing less", () => {
    expect(namesIt("Vault operations 2027", "Vault operations 2027")).toBe(true);
    expect(namesIt("  vault  OPERATIONS 2027 ", "Vault operations 2027")).toBe(true);
    expect(namesIt("Vault operations", "Vault operations 2027")).toBe(false);
    expect(namesIt("", "")).toBe(false);
  });

  it("is a labelled dialog that says what goes, and names what to type", () => {
    const html = panel("");
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="[^"]+" aria-describedby="[^"]+"/);
    expect(html).toContain("Delete “Vault operations 2027”?");
    expect(html).toContain("This deletes the whole scope of work.");
    expect(html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'")).toContain("To confirm, type the scope's title: Vault operations 2027");
  });

  it("keeps the delete button asleep until the name is typed", () => {
    expect(confirmButton(panel(""))).toContain('disabled=""');
    expect(confirmButton(panel("Vault"))).toContain('disabled=""');
    expect(confirmButton(panel("vault operations 2027"))).not.toContain('disabled=""');
  });

  it("says when it is deleting, and why it could not", () => {
    expect(confirmButton(panel("Vault operations 2027", { busy: true }))).toContain("Deleting…");
    expect(panel("x", { error: "You don't have permission to change this vault." })).toMatch(/role="alert"[^>]*>You don&#x27;t have permission/);
  });
});
