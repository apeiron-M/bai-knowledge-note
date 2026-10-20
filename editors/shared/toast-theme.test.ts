import { describe, expect, it } from "vitest";
import { acquireToastTheme, TOAST_THEME_ATTR, type AttributeTarget } from "./toast-theme.js";

function fakeRoot() {
  const attrs = new Map<string, string>();
  const root: AttributeTarget & { get(): string | undefined } = {
    setAttribute: (n, v) => void attrs.set(n, v),
    removeAttribute: (n) => void attrs.delete(n),
    get: () => attrs.get(TOAST_THEME_ATTR),
  };
  return root;
}

describe("acquireToastTheme", () => {
  it("mirrors the theme onto the root and clears it on release", () => {
    const root = fakeRoot();
    const release = acquireToastTheme("dark", root);
    expect(root.get()).toBe("dark");
    release();
    expect(root.get()).toBeUndefined();
  });

  it("keeps the attribute while any holder remains — two editor trees may coexist", () => {
    const root = fakeRoot();
    const releaseVault = acquireToastTheme("dark", root);
    const releaseSow = acquireToastTheme("dark", root);
    releaseVault(); // the drive app goes first; the hosted editor is still up
    expect(root.get()).toBe("dark");
    releaseSow();
    expect(root.get()).toBeUndefined();
  });

  it("a theme switch re-applies without disturbing the count", () => {
    const root = fakeRoot();
    const other = acquireToastTheme("dark", root);
    // The provider's effect re-runs: release the old claim, acquire the new.
    const first = acquireToastTheme("dark", root);
    first();
    const second = acquireToastTheme("light", root);
    expect(root.get()).toBe("light");
    second();
    expect(root.get()).toBe("light"); // `other` still holds it
    other();
    expect(root.get()).toBeUndefined();
  });

  it("releasing twice is harmless and never strips another holder", () => {
    const root = fakeRoot();
    const a = acquireToastTheme("dark", root);
    const b = acquireToastTheme("dark", root);
    a();
    a();
    expect(root.get()).toBe("dark");
    b();
    expect(root.get()).toBeUndefined();
  });

  it("is a no-op without a document", () => {
    expect(() => acquireToastTheme("dark", undefined)()).not.toThrow();
  });
});
