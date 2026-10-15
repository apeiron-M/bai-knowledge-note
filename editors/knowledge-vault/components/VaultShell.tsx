import {
  createContext,
  useContext,
  useEffect,
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
};

/** The frame's width in px; 0 until it has been measured (and wherever nothing is laid out). */
const FrameWidth = createContext(0);
export const useFrameWidth = (): number => useContext(FrameWidth);

export function VaultShell({
  children,
  sidebar,
  sidebarWidth,
  sidebarHidden = false,
  fileDrop,
}: VaultShellProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
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
    <FrameWidth.Provider value={frameWidth}>
      <div
        ref={frameRef}
        data-vault-hosts-editor={sidebarHidden ? "" : undefined}
        className="vault-frame"
        style={{
          display: "grid",
          position: "relative",
          height: "100%",
          overflow: "hidden",
          gridTemplateColumns: withSidebar ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
          gridTemplateRows: "minmax(0, 1fr)",
        }}
        {...fileDrop?.rootProps}
      >
        {fileDrop?.overlay}
        {withSidebar && (
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
          style={{ gridColumn: withSidebar ? 2 : 1, gridRow: 1, minHeight: 0 }}
        >
          {children}
        </div>
      </div>
    </FrameWidth.Provider>
  );
}
