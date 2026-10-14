import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useMeasuredHeight } from "../../shared/use-measured.js";

export type VaultShellProps = {
  /** Shown in the host bar, left of the controls. */
  title: string;
  /** The content column. Owns its own scrolling. */
  children: ReactNode;
  /** The sidebar column. Omit when `sidebarHidden`. */
  sidebar?: ReactNode;
  /** Set by the sidebar's own width state; the shell only reads it. */
  sidebarWidth?: number;
  /** The scope-of-work editor brings its own rail (DriveExplorer:137). */
  sidebarHidden?: boolean;
  /** Right-hand host-bar controls: processing status, settings. */
  barControls?: ReactNode;
  /** Drop target for files dragged over the whole frame. */
  fileDrop?: { rootProps: Record<string, unknown>; overlay: ReactNode };
  /** The view tabs, between the title and the controls. */
  tabs?: ReactNode;
  /** Makes the title a button (back to the vault overview). */
  onTitleClick?: () => void;
  /** While a bar menu is open the hosted bar rises above the editor's layers. */
  settingsOpen?: boolean;
  /** The caller's own handle on the bar, for width-dependent tabs. */
  barRef?: RefObject<HTMLDivElement | null>;
};

export function VaultShell({
  title,
  children,
  sidebar,
  sidebarWidth,
  sidebarHidden = false,
  barControls,
  fileDrop,
  tabs,
  onTitleClick,
  settingsOpen = false,
  barRef,
}: VaultShellProps) {
  const ownBarRef = useRef<HTMLDivElement>(null);
  const bar = barRef ?? ownBarRef;
  // Published to the hosted editor as `--vault-topbar-h` so its grid can
  // reserve a matching top row. Our own element, so measuring it is safe.
  const topBarHeight = useMeasuredHeight(bar, sidebarHidden);

  const frameStyle: CSSProperties = sidebarHidden
    ? ({
        // A hosted editor draws its own sidebar. The shell reserves a left
        // column exactly as wide as that sidebar and lets the editor span the
        // full height, with the bar occupying only the column beside it. The
        // bar keeps the x-offset it has next to the vault sidebar, and the
        // hosted sidebar reaches the top.
        //
        // The width is DECLARED, not measured. The editor that owns the
        // sidebar defines `--sow-rail-w` on this frame from its own
        // stylesheet (by breakpoint, and as 0 while it mirrors a collapsed
        // rail onto `data-sow-rail="closed"`). With no such editor mounted
        // the variable is undefined and the fallback of 0 is the truthful
        // width.
        gridTemplateColumns: "var(--sow-rail-w, 0px) minmax(0, 1fr)",
        gridTemplateRows: "auto minmax(0, 1fr)",
        // Read by the hosted editor's stylesheet, which reserves a matching
        // top row so its canvas starts below the bar.
        "--vault-topbar-h": `${topBarHeight}px`,
      } as CSSProperties)
    : ({
        gridTemplateColumns: "var(--vault-sidebar-w, 236px) minmax(0, 1fr)",
        gridTemplateRows: "auto minmax(0, 1fr)",
        // The sidebar owns its width and publishes it here.
        ...(sidebarWidth !== undefined
          ? { "--vault-sidebar-w": `${sidebarWidth}px` }
          : null),
      } as CSSProperties);

  const barStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "8px 16px",
    borderBottom: "1px solid var(--bai-border)",
    backgroundColor: "var(--bai-surface)",
    ...(sidebarHidden
      ? // Column 2 only, so the hosted sidebar in column 1 runs to the top.
        // z-index 5 sits within the hosted editor's scale: over sticky table
        // headers (1-4), under drawer handles (6) so the rail toggle can
        // overhang the bar. While the settings menu is open the bar jumps
        // above that scale so the dropdown is not trapped under the editor's
        // close/handle layer.
        { gridColumn: 2, gridRow: 1, zIndex: settingsOpen ? 40 : 5 }
      : { gridColumn: "1 / -1", gridRow: 1 }),
  };

  const contentStyle: CSSProperties | undefined = sidebarHidden
    ? // Deliberately no z-index: it would open a stacking context and cap
      // everything inside below the bar, toggle included.
      { gridColumn: "1 / -1", gridRow: "1 / -1" }
    : { gridColumn: sidebar ? 2 : "1 / -1", gridRow: 2 };

  return (
    <div
      data-vault-hosts-editor={sidebarHidden ? "" : undefined}
      className="vault-frame"
      style={{
        display: "grid",
        position: "relative",
        height: "100%",
        overflow: "hidden",
        ...frameStyle,
      }}
      {...fileDrop?.rootProps}
    >
      {fileDrop?.overlay}

      <div ref={bar} className="vault-hostbar" style={barStyle}>
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            title="Back to vault overview"
            style={titleStyle}
          >
            {title}
          </button>
        ) : (
          <span style={titleStyle}>{title}</span>
        )}
        {tabs}
        {barControls && (
          <div style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 12 }}>
            {barControls}
          </div>
        )}
      </div>

      {!sidebarHidden && sidebar && (
        <div style={{ gridColumn: 1, gridRow: 2, minHeight: 0, minWidth: 0 }}>
          {sidebar}
        </div>
      )}

      <div
        className={sidebarHidden ? "relative min-w-0 overflow-hidden" : "min-w-0 overflow-auto"}
        style={contentStyle}
      >
        {children}
      </div>
    </div>
  );
}

const titleStyle: CSSProperties = {
  flexShrink: 0,
  maxWidth: 160,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 14,
  fontWeight: 600,
  color: "var(--bai-text)",
  textAlign: "left",
};
