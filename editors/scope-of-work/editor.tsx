import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DocumentToolbar,
  ToolbarHistoryButton,
  type ToolbarButtonProps,
} from "@powerhousedao/design-system/connect";
import { useSelectedScopeOfWorkDocument } from "document-models/scope-of-work";
import { ThemeProvider, TOOLBAR_CLASS } from "../shared/theme-context.js";
import {
  CollapsibleToolbar,
  readToolbarOpen,
  writeToolbarOpen,
} from "./components/CollapsibleToolbar.js";
import { Shell } from "./components/Shell.js";

/**
 * Scope of Work editor: outline rail · document canvas · deliverable inspector.
 *
 * The document toolbar is handed to the Shell and laid out INSIDE its grid, in
 * the row above the canvas, so it sits beside the rail rather than across it.
 *
 * Its history button is overridden. The built-in one calls Connect's global
 * `showRevisionHistory`, and Connect answers by unmounting the editor and
 * rendering `RevisionHistory` in its place — rail, inspector and all. So the
 * outline the user had open vanished the moment they asked for history. The
 * override keeps the editor mounted and has the Shell render the very same
 * `RevisionHistory` component in its canvas, with the rail exactly as it was.
 */
export default function Editor() {
  const [document, dispatch] = useSelectedScopeOfWorkDocument();
  const [historyOpen, setHistoryOpen] = useState(false);
  // The drawer's state lives here, not in the drawer: the Shell shows a close
  // button in the canvas corner only while the drawer is closed, and both
  // must change in the SAME render — an effect-reported state left the close
  // button visible for a frame after the drawer opened.
  const [toolbarOpen, setToolbarOpen] = useState(readToolbarOpen);
  const toggleToolbar = useCallback(() => setToolbarOpen((v) => !v), []);
  useEffect(() => {
    writeToolbarOpen(toolbarOpen);
  }, [toolbarOpen]);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  // A stable component, not an inline arrow: a fresh component identity per
  // render would remount the button on every keystroke in the editor.
  const HistoryControl = useMemo(
    () =>
      function HistoryControl(props: ToolbarButtonProps) {
        return (
          <ToolbarHistoryButton {...props} onClick={() => setHistoryOpen(true)} />
        );
      },
    [],
  );

  return (
    <ThemeProvider>
      <Shell
        document={document}
        dispatch={dispatch}
        historyOpen={historyOpen}
        onCloseHistory={closeHistory}
        toolbarOpen={toolbarOpen}
        toolbar={
          <CollapsibleToolbar open={toolbarOpen} onToggle={toggleToolbar}>
            <DocumentToolbar
              toolbarClassName={TOOLBAR_CLASS}
              componentOverrides={{ history: HistoryControl }}
            />
          </CollapsibleToolbar>
        }
      />
    </ThemeProvider>
  );
}
