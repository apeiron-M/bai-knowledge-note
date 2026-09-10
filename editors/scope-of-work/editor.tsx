import { useCallback, useMemo, useState } from "react";
import {
  DocumentToolbar,
  ToolbarHistoryButton,
  type ToolbarButtonProps,
} from "@powerhousedao/design-system/connect";
import { useSelectedScopeOfWorkDocument } from "document-models/scope-of-work";
import { ThemeProvider, TOOLBAR_CLASS } from "../shared/theme-context.js";
import { CollapsibleToolbar } from "./components/CollapsibleToolbar.js";
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
        toolbar={
          <CollapsibleToolbar>
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
