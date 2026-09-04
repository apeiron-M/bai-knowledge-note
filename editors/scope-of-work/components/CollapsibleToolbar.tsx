import { useEffect, useState, type ReactNode } from "react";

/**
 * Keeps the design-system DocumentToolbar mounted — every editor must include
 * it — but folded away by default behind a floating drawer handle that costs
 * no vertical space: the wrapper is zero-height while collapsed and the handle
 * is absolutely positioned, hanging from the wrapper's bottom edge over the
 * canvas's own top padding (which is empty in every view). Open, the toolbar
 * takes its normal row and the same handle hangs from its bottom edge.
 *
 * Why: inside the vault the SoW editor already sits under the drive's tab bar,
 * and its own rail/canvas/inspector chrome is dense. A second full-height bar
 * (undo · redo · download · title · history · close) cost ~50px of every
 * viewport for controls most sessions never touch. The toolbar is `hidden`
 * rather than unmounted so its effects (keyboard shortcuts, revision-history
 * wiring) keep working while it is out of sight.
 *
 * The choice is remembered per browser: someone who wants the bar open gets it
 * open next time.
 *
 * Shell fits the grid to the viewport by measuring its own top edge, listening
 * to `resize`; toggling the bar moves that edge without resizing the window,
 * so the toggle announces itself as a resize to trigger the re-measure.
 */
const STORAGE_KEY = "sow:toolbar-open";

function readPreference(): boolean {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function CollapsibleToolbar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<boolean>(readPreference);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      // a blocked localStorage only loses the memory of the preference
    }
    // Shell re-fits its height on `resize`; the bar's edge just moved.
    globalThis.dispatchEvent(new Event("resize"));
  }, [open]);

  return (
    <div className="sow-tb">
      <div id="sow-document-toolbar" hidden={!open}>
        {children}
      </div>
      <button
        type="button"
        className={`sow-tb-handle ${open ? "open" : ""}`}
        aria-expanded={open}
        aria-controls="sow-document-toolbar"
        title={open ? "Hide document toolbar" : "Show document toolbar"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sow-tb-chev" aria-hidden>
          ▾
        </span>
        <span className="sow-tb-label">{open ? "hide" : "toolbar"}</span>
      </button>
    </div>
  );
}
