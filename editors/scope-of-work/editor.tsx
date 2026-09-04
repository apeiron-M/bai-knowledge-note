import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedScopeOfWorkDocument } from "document-models/scope-of-work";
import { ThemeProvider, TOOLBAR_CLASS } from "../shared/theme-context.js";
import { CollapsibleToolbar } from "./components/CollapsibleToolbar.js";
import { Shell } from "./components/Shell.js";

/** Scope of Work editor: outline rail · document canvas · deliverable inspector. */
export default function Editor() {
  const [document, dispatch] = useSelectedScopeOfWorkDocument();
  return (
    <ThemeProvider>
      <CollapsibleToolbar>
        <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
      </CollapsibleToolbar>
      <Shell document={document} dispatch={dispatch} />
    </ThemeProvider>
  );
}
