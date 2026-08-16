import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedProjectDocument } from "document-models/project";
import { ThemeProvider } from "../shared/theme-context.js";
import { InitCard } from "./components/InitCard.js";
import { HeaderBar } from "./components/HeaderBar.js";
import { LinkedWbsProvider, WbsPanel } from "./components/WbsPanel.js";
import { DeliverablesSection } from "./components/DeliverablesSection.js";
import { TeamSection } from "./components/TeamSection.js";
import { KnowledgeSection } from "./components/KnowledgeSection.js";
import { ReferencesSection } from "./components/ReferencesSection.js";

export default function Editor() {
  const [document, dispatch] = useSelectedProjectDocument();
  const state = document.state.global;

  return (
    <ThemeProvider>
      <DocumentToolbar />
      <div
        style={{
          backgroundColor: "var(--bai-bg)",
          color: "var(--bai-text)",
          minHeight: "100%",
        }}
      >
        {!state.name ? (
          <InitCard initialName={document.header.name} dispatch={dispatch} />
        ) : (
          <div className="mx-auto max-w-5xl space-y-4 p-6">
            <HeaderBar state={state} dispatch={dispatch} />

            <LinkedWbsProvider wbsRef={state.wbsRef}>
              <WbsPanel
                dispatch={dispatch}
                projectId={document.header.id}
                projectName={state.name}
              />
              <DeliverablesSection state={state} dispatch={dispatch} />
            </LinkedWbsProvider>

            <TeamSection state={state} dispatch={dispatch} />
            <KnowledgeSection state={state} dispatch={dispatch} />
            <ReferencesSection state={state} dispatch={dispatch} />
          </div>
        )}
      </div>
    </ThemeProvider>
  );
}
