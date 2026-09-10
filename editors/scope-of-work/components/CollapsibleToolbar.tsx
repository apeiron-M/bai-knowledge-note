import { useEffect, type ReactNode } from "react";

/**
 * Keeps the design-system DocumentToolbar mounted — every editor must include
 * it — but folded away by default behind a drawer handle that costs no
 * vertical space while closed. Open, the toolbar takes its row in the Shell's
 * grid and the same handle hangs from its bottom edge.
 *
 * Why: inside the vault the SoW editor already sits under the drive's tab bar,
 * and its own rail/canvas/inspector chrome is dense. A second full-height bar
 * (undo · redo · download · title · history · close) cost ~50px of every
 * viewport for controls most sessions never touch.
 *
 * Controlled, deliberately. The state used to live here and be reported to
 * the editor through an effect, which meant the canvas's close button — shown
 * only while this is closed — learned of a toggle one commit late: a visible
 * frame with the toolbar open AND the close button still there. With the
 * editor owning `open`, one click updates both in the same render.
 *
 * The toolbar is collapsed by animating the drawer's grid row from 0fr to 1fr
 * rather than toggled with `hidden`: it stays mounted either way, so its
 * effects (keyboard shortcuts, revision-history wiring) keep working out of
 * sight, and the row can move smoothly. `inert` keeps its buttons out of the
 * tab order while it is closed, which `hidden` used to do for free.
 *
 * Shell fits the grid to the viewport by measuring its own top edge, listening
 * to `resize`; the toggle announces itself as a resize so that stays true.
 */
const STORAGE_KEY = "sow:toolbar-open";

/** The persisted drawer state. Closed unless the user has opened it before. */
export function readToolbarOpen(): boolean {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeToolbarOpen(open: boolean): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  } catch {
    // a blocked localStorage only loses the memory of the preference
  }
}

export function CollapsibleToolbar({
  children,
  open,
  onToggle,
}: {
  children: ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  useEffect(() => {
    // Shell re-fits its height on `resize`; the drawer's edge just moved.
    globalThis.dispatchEvent(new Event("resize"));
  }, [open]);

  return (
    <div className="sow-tb">
      <div
        className={`sow-tb-drawer${open ? " open" : ""}`}
        aria-hidden={!open}
        inert={!open}
      >
        {/* `sow-embed`: the design-system toolbar keeps its own button and
            input styling — the editor's resets skip foreign widgets. */}
        <div id="sow-document-toolbar" className="sow-tb-content sow-embed">
          {children}
        </div>
      </div>
      <button
        type="button"
        className={`sow-tb-handle ${open ? "open" : ""}`}
        aria-expanded={open}
        aria-controls="sow-document-toolbar"
        title={open ? "Hide document toolbar" : "Show document toolbar"}
        onClick={onToggle}
      >
        <span className="sow-tb-chev" aria-hidden>
          ▾
        </span>
        <span className="sow-tb-label">{open ? "hide" : "toolbar"}</span>
      </button>
    </div>
  );
}
