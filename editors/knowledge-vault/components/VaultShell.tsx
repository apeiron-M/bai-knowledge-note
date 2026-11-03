import { VAULT_CONTROLS_CSS } from "./vault-controls-css.js";
import { role } from "../lib/theme.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * The vault's frame: a sidebar column and a content column, and nothing above
 * them. Everything that used to sit in a bar over the content — the vault's
 * name, the views, New, settings, the guide — lives in the sidebar, so the
 * content starts at the top of the window (design: docs/design/vault-view).
 *
 * On a phone (a frame narrower than DRAWER_BELOW) there is no sidebar column:
 * the content takes the whole width, a small floating button at the top left
 * opens the sidebar as a drawer, and anything picked in it closes it again.
 * Views keep their top row clear of the button with `--vault-menu-gap`, which
 * is 0 everywhere else.
 */
export type VaultShellProps = {
  /** The content column. Owns its own scrolling. */
  children: ReactNode;
  /** The sidebar column. Omit when `sidebarHidden`. */
  sidebar?: ReactNode;
  /**
   * Published by the sidebar, which owns its width: a dragged width, or the
   * rail's. `undefined` leaves the column to CSS (256px; 220px in a frame
   * narrower than 1180px — style.css).
   */
  sidebarWidth?: number;
  /**
   * A hosted editor brings its own rail (the scope of work): the vault's
   * sidebar closes and the editor takes the whole frame. Its stylesheet keys on
   * `data-vault-hosts-editor` (editors/scope-of-work/lib/styles.ts).
   */
  sidebarHidden?: boolean;
  /** Drop target for files dragged over the whole frame. */
  fileDrop?: { rootProps: Record<string, unknown>; overlay: ReactNode };
  /** Above both columns, over the whole frame: the Ctrl K palette. */
  overlay?: ReactNode;
  /**
   * Where the reader is (the view, the open document, the chat…). The phone's
   * drawer closes whenever it changes: picking anything in it has taken them there.
   */
  drawerKey?: string;
  /** The phone's drawer starts open (a static render; tests). */
  defaultDrawerOpen?: boolean;
};

/** Below this frame width the sidebar is a drawer behind a floating button (a phone). */
export const DRAWER_BELOW = 640;

export type VaultLayout = {
  /** The frame's width in px; 0 until it has been measured (and wherever nothing is laid out). */
  frameWidth: number;
  /** A phone: the sidebar is a drawer, not a column. */
  drawer: boolean;
  closeDrawer: () => void;
};

const Layout = createContext<VaultLayout>({ frameWidth: 0, drawer: false, closeDrawer: () => undefined });
export const useVaultLayout = (): VaultLayout => useContext(Layout);
/** The frame's width in px; 0 until it has been measured. */
export const useFrameWidth = (): number => useContext(Layout).frameWidth;

/** Whether a frame this wide holds the sidebar as a drawer. Unmeasured (0) is not a phone. */
export function isDrawerWidth(frameWidth: number): boolean {
  return frameWidth > 0 && frameWidth < DRAWER_BELOW;
}

/** The first guess before the frame is measured: the window, so a phone never paints the sidebar first. */
const initialWidth = () => (typeof window === "undefined" ? 0 : Math.round(window.innerWidth));

export const VAULT_SHELL_CSS = `
.vault-frame[data-drawer] { --vault-menu-gap: 40px; }
.vault-menu-fab {
  position: absolute; z-index: 40; top: max(6px, env(safe-area-inset-top)); left: max(8px, env(safe-area-inset-left));
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--bai-border); background: color-mix(in srgb, var(--bai-surface) 84%, transparent);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); box-shadow: ${role("raise")};
  color: var(--bai-text-secondary); cursor: pointer;
}
.vault-menu-fab::before { content: ""; position: absolute; inset: -4px; }
.vault-menu-fab:hover { color: var(--bai-text); background: var(--bai-hover); }
.vault-menu-fab:focus-visible { outline: 2px solid var(--bai-accent); outline-offset: 2px; }
.vault-scrim { position: absolute; inset: 0; z-index: 45; background: ${role("scrim")}; animation: vault-scrim-in 0.18s ease-out; }
@keyframes vault-scrim-in { from { opacity: 0; } }
/* In the page only while open: closed, nothing of it can be found, focused or measured (the landing's tour reads sizes). */
.vault-drawer {
  position: absolute; z-index: 50; top: 0; bottom: 0; left: 0; width: min(320px, 86%);
  box-shadow: ${role("shadow")}; padding-top: env(safe-area-inset-top);
  animation: vault-drawer-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes vault-drawer-in { from { transform: translateX(-104%); } }
.vault-drawer > .vault-sidebar { border-right: 0; }
/* A document editor brings its own toolbar to the top: the button gets a band of its own above it. */
.vault-frame[data-drawer] .vault-editor-pane { padding-top: 48px; }
@media (prefers-reduced-motion: reduce) {
  .vault-drawer, .vault-scrim { animation: none; }
}
`;

export function VaultShell({
  children,
  sidebar,
  sidebarWidth,
  sidebarHidden = false,
  fileDrop,
  overlay,
  drawerKey,
  defaultDrawerOpen = false,
}: VaultShellProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(initialWidth);
  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) =>
      setFrameWidth(Math.round(entries[0]?.contentRect.width ?? 0)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const withSidebar = !sidebarHidden && sidebar !== undefined;
  const drawer = withSidebar && isDrawerWidth(frameWidth);
  const [open, setOpen] = useState(defaultDrawerOpen);
  const fabRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeDrawer = useCallback(() => setOpen(false), []);

  // Picking anything in the drawer takes the reader somewhere: it closes. So does a wider frame.
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    setOpen(false);
  }, [drawerKey, drawer]);
  // Open: focus moves into it, Escape closes it — unless a menu inside is taking Escape.
  // Closed again: focus goes back to the button, if it was in the drawer.
  useEffect(() => {
    if (!open) return;
    const panel = drawerRef.current;
    const fab = fabRef.current;
    panel?.querySelector<HTMLElement>("button, [href], input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || panel?.querySelector('[role="menu"]')) return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (panel?.contains(document.activeElement)) fab?.focus();
    };
  }, [open]);

  const layout = useMemo(() => ({ frameWidth, drawer, closeDrawer }), [frameWidth, drawer, closeDrawer]);
  const columnStyle = {
    gridColumn: 1,
    gridRow: 1,
    minHeight: 0,
    minWidth: 0,
    ...(sidebarWidth !== undefined
      ? { "--vault-sidebar-w": `${sidebarWidth}px` }
      : null),
  } as CSSProperties;

  return (
    <Layout.Provider value={layout}>
      <div
        ref={frameRef}
        data-vault-hosts-editor={sidebarHidden ? "" : undefined}
        data-drawer={drawer ? "" : undefined}
        className="vault-frame"
        style={{
          display: "grid",
          position: "relative",
          height: "100%",
          overflow: "hidden",
          gridTemplateColumns: withSidebar && !drawer ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
          gridTemplateRows: "minmax(0, 1fr)",
        }}
        {...fileDrop?.rootProps}
      >
        <style aria-hidden="true">{VAULT_CONTROLS_CSS}</style>
        <style aria-hidden="true">{VAULT_SHELL_CSS}</style>
        {fileDrop?.overlay}
        {withSidebar && !drawer && (
          <div className="vault-sidebar-col" style={columnStyle}>
            {sidebar}
          </div>
        )}
        <div
          className={
            sidebarHidden
              ? // Deliberately no z-index: it would open a stacking context
                // and trap the hosted editor's rail toggle under its layers.
                "relative min-w-0 overflow-hidden"
              : "vault-content min-w-0 overflow-auto"
          }
          style={{ gridColumn: withSidebar && !drawer ? 2 : 1, gridRow: 1, minHeight: 0 }}
        >
          {children}
        </div>
        {drawer && (
          <>
            <button
              ref={fabRef}
              type="button"
              className="vault-menu-fab"
              aria-label="Open the menu"
              aria-expanded={open}
              aria-controls={open ? "vault-drawer" : undefined}
              onClick={() => setOpen(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h10" />
              </svg>
            </button>
            {open && (
              <>
                <div className="vault-scrim" onClick={closeDrawer} aria-hidden="true" />
                <div ref={drawerRef} id="vault-drawer" className="vault-drawer" role="dialog" aria-modal="true" aria-label="Menu">
                  {sidebar}
                </div>
              </>
            )}
          </>
        )}
        {overlay}
      </div>
    </Layout.Provider>
  );
}
