/**
 * Lets Connect's toasts follow the vault's theme.
 *
 * Connect renders react-toastify in a portal at `<body>` level and mounts its
 * container with no `theme`, so every toast is the library's default light
 * card — white, on a dark vault. The card sits OUTSIDE the `.bai-theme` div
 * that carries `data-bai-theme`, so nothing keyed on that attribute can reach
 * it, and the toast call sites cannot fix it either: `PHToastOptions` carries
 * no theme, and Connect's own toasts do not go through our code at all.
 *
 * So the theme is mirrored one level up, onto `<html>`, as
 * `data-bai-toast-theme`. `style.css` keys the toast rules on that attribute —
 * and re-declares the palette there, since `var(--bai-*)` is otherwise only
 * defined inside the vault's subtree. Because the attribute exists only while
 * one of this package's editors is mounted, Connect's toasts look like Connect
 * again the moment the user leaves the vault.
 *
 * Reference-counted, not set-and-forget. Connect renders a document editor in
 * its own React tree, not as a child of the drive app, so when the SoW editor
 * is open inside the vault there are TWO outermost ThemeProviders. If the
 * first to unmount simply removed the attribute, the other's toasts would
 * snap back to white. The attribute is removed only when the last holder lets
 * go, and re-applied whenever any holder's theme changes.
 */
import type { BaiTheme } from "./theme-context.js";

export const TOAST_THEME_ATTR = "data-bai-toast-theme";

/** The part of `Element` this needs — so a test can pass a plain object. */
export type AttributeTarget = {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

const holders = new Map<AttributeTarget, Set<symbol>>();

function documentRoot(): AttributeTarget | undefined {
  // `document` is absent in tests and on the server; there is nothing to
  // theme there, and nothing to fail over.
  return typeof document === "undefined" ? undefined : document.documentElement;
}

/**
 * Claim the toast theme for the lifetime of a mounted provider. Returns the
 * release; calling it twice is a no-op.
 */
export function acquireToastTheme(
  theme: BaiTheme,
  root: AttributeTarget | undefined = documentRoot(),
): () => void {
  if (!root) return () => {};
  const token = Symbol("toast-theme");
  let set = holders.get(root);
  if (!set) {
    set = new Set();
    holders.set(root, set);
  }
  set.add(token);
  // Last writer wins while several holders coexist. They derive from the same
  // Connect theme, so in practice they agree; when they briefly do not (one
  // tree has re-rendered after a switch, the other has not yet) the newer
  // value is the right one.
  root.setAttribute(TOAST_THEME_ATTR, theme);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = holders.get(root);
    if (!current) return;
    current.delete(token);
    if (current.size === 0) {
      holders.delete(root);
      root.removeAttribute(TOAST_THEME_ATTR);
    }
  };
}
